import {
  createBackup,
  parseBackup,
} from "../backup/progressBackup";
import type { ProgressBackup } from "../backup/progressBackup";
import type { Progress } from "../types";
import { sameProgress } from "./webdav";

/**
 * localStorage 只保存非敏感同步数据:上次共同基线、冲突/覆盖前恢复副本。
 * 密码、Authorization 与任何凭据绝不进入这里。
 */
export type SyncEdition = "public" | "internal";
export type SyncRecoveryReason =
  | "conflict"
  | "remote-apply"
  | "local-overwrite"
  | "remote-overwrite";

export interface SyncAccount {
  url: string;
  username: string;
}

export interface SyncBaselineRecord {
  version: 1;
  edition: SyncEdition;
  account: string;
  url: string;
  username: string;
  etag: string;
  progress: Progress;
  syncedAt: string;
}

export interface SyncRecoveryRecord {
  version: 1;
  edition: SyncEdition;
  account: string;
  url: string;
  username: string;
  savedAt: string;
  reason: SyncRecoveryReason;
  local: ProgressBackup;
  remote: ProgressBackup | null;
}

export class SyncStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStorageError";
  }
}

/** 单槽记录继续供现有 UI 使用;历史保留最近若干份可恢复副本。 */
const RECOVERY_HISTORY_LIMIT = 3;
const RECOVERY_REASONS = new Set<SyncRecoveryReason>([
  "conflict",
  "remote-apply",
  "local-overwrite",
  "remote-overwrite",
]);

function currentEdition(): SyncEdition {
  return __FGE_EDITION__;
}

/** 稳定、非敏感的账号指纹;纯函数,用于隔离不同 URL/账号的本地数据。 */
export function accountFingerprint(
  account: SyncAccount,
  edition: SyncEdition = currentEdition()
): string {
  const input = `${edition}\n${account.url}\n${account.username}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${edition}.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * 应用目录布局使用新的基线 namespace:旧版直接写用户根的基线(v1)不再读取,
 * 避免把新目录里的云端进度与旧根文件基线错误比较。恢复副本保持 v1 可读。
 */
export function syncBaselineKey(
  account: string,
  edition: SyncEdition = currentEdition()
): string {
  return `fge.sync.baseline.v2.${edition}.${account}`;
}

export function syncRecoveryKey(
  account: string,
  edition: SyncEdition = currentEdition()
): string {
  return `fge.sync.recovery.v1.${edition}.${account}`;
}

export function syncRecoveryHistoryKey(
  account: string,
  edition: SyncEdition = currentEdition()
): string {
  return `fge.sync.recovery.history.v1.${edition}.${account}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedProgress(value: unknown): Progress | null {
  try {
    return createBackup(value as Progress).progress;
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 读取上次共同基线;不存在、损坏或账号/版本不匹配时返回 null,绝不抛异常。 */
export function readSyncBaseline(
  storage: Storage | null | undefined,
  account: SyncAccount
): SyncBaselineRecord | null {
  if (!storage) return null;
  try {
    const key = syncBaselineKey(accountFingerprint(account));
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = parseJson(raw);
    if (!isPlainObject(value)) return null;
    if (
      value.version !== 1 ||
      value.edition !== currentEdition() ||
      value.account !== accountFingerprint(account) ||
      value.url !== account.url ||
      value.username !== account.username ||
      typeof value.etag !== "string" ||
      value.etag.length === 0 ||
      typeof value.syncedAt !== "string"
    ) {
      return null;
    }
    const progress = normalizedProgress(value.progress);
    if (!progress) return null;
    return {
      version: 1,
      edition: currentEdition(),
      account: accountFingerprint(account),
      url: account.url,
      username: account.username,
      etag: value.etag,
      progress,
      syncedAt: value.syncedAt,
    };
  } catch {
    return null;
  }
}

/** 保存成功基线;失败必须抛出,调用方不得把本次同步记为成功。 */
export function writeSyncBaseline(
  storage: Storage | null | undefined,
  account: SyncAccount,
  value: { etag: string; progress: Progress; syncedAt: string }
): void {
  if (!storage) {
    throw new SyncStorageError("当前环境不支持本地存储，无法保存同步基线");
  }
  const fingerprint = accountFingerprint(account);
  const record: SyncBaselineRecord = {
    version: 1,
    edition: currentEdition(),
    account: fingerprint,
    url: account.url,
    username: account.username,
    etag: value.etag,
    progress: value.progress,
    syncedAt: value.syncedAt,
  };
  try {
    storage.setItem(syncBaselineKey(fingerprint), JSON.stringify(record));
  } catch {
    throw new SyncStorageError("保存同步基线失败，请检查本地存储空间");
  }
}

/**
 * 断开/重置时删除基线。removeItem 失败绝不静默:先尝试写墓碑使旧基线不可用,
 * 然后仍抛出,让控制器 fail closed(不继续同步)。
 */
export function clearSyncBaseline(
  storage: Storage | null | undefined,
  account: SyncAccount
): void {
  if (!storage) return;
  const key = syncBaselineKey(accountFingerprint(account));
  try {
    storage.removeItem(key);
    return;
  } catch {
    // 继续尝试墓碑覆盖。
  }
  try {
    storage.setItem(key, "");
  } catch {
    throw new SyncStorageError("清理同步基线失败，请检查本地存储空间");
  }
  throw new SyncStorageError("清理同步基线失败，请检查本地存储空间");
}

function sameRecovery(
  a: SyncRecoveryRecord,
  b: SyncRecoveryRecord
): boolean {
  const aConflict = a.reason === "conflict";
  const bConflict = b.reason === "conflict";
  if (aConflict !== bConflict) return false;
  if (!sameProgress(a.local.progress, b.local.progress)) return false;
  if (!a.remote && !b.remote) return true;
  if (!a.remote || !b.remote) return false;
  return sameProgress(a.remote.progress, b.remote.progress);
}

/**
 * 有界保留最近 3 份。冲突记录不能挤掉覆盖前副本(overwrite 类):
 * 满员时优先淘汰最旧 conflict,只有全是 overwrite 时才淘汰最旧一份。
 */
function trimRecoveryHistory(
  records: SyncRecoveryRecord[]
): SyncRecoveryRecord[] {
  const result = [...records];
  while (result.length > RECOVERY_HISTORY_LIMIT) {
    let index = -1;
    for (let cursor = result.length - 1; cursor >= 0; cursor -= 1) {
      if (result[cursor].reason === "conflict") {
        index = cursor;
        break;
      }
    }
    if (index < 0) index = result.length - 1;
    result.splice(index, 1);
  }
  return result;
}

/** 保存冲突/覆盖前副本;同时写兼容单槽与有界历史。失败抛出。 */
export function writeSyncRecovery(
  storage: Storage | null | undefined,
  account: SyncAccount,
  value: {
    savedAt: string;
    reason: SyncRecoveryReason;
    local: ProgressBackup;
    remote: ProgressBackup | null;
  }
): void {
  if (!storage) {
    throw new SyncStorageError("当前环境不支持本地存储，无法保存恢复副本");
  }
  const fingerprint = accountFingerprint(account);
  const record: SyncRecoveryRecord = {
    version: 1,
    edition: currentEdition(),
    account: fingerprint,
    url: account.url,
    username: account.username,
    savedAt: value.savedAt,
    reason: value.reason,
    local: value.local,
    remote: value.remote,
  };
  try {
    storage.setItem(syncRecoveryKey(fingerprint), JSON.stringify(record));
    const existing = readRawRecoveryHistory(storage, account) ?? [];
    const duplicate = existing.findIndex((item) => sameRecovery(item, record));
    if (duplicate >= 0) {
      existing[duplicate] = record;
    } else {
      existing.unshift(record);
    }
    storage.setItem(
      syncRecoveryHistoryKey(fingerprint),
      JSON.stringify(trimRecoveryHistory(existing))
    );
  } catch {
    throw new SyncStorageError("保存同步恢复副本失败，请检查本地存储空间");
  }
}

function parseRecoveryRecord(
  value: unknown,
  account: SyncAccount
): SyncRecoveryRecord | null {
  if (!isPlainObject(value)) return null;
  if (
    value.version !== 1 ||
    value.edition !== currentEdition() ||
    value.account !== accountFingerprint(account) ||
    value.url !== account.url ||
    value.username !== account.username ||
    typeof value.savedAt !== "string" ||
    typeof value.reason !== "string" ||
    !RECOVERY_REASONS.has(value.reason as SyncRecoveryReason) ||
    !isPlainObject(value.local)
  ) {
    return null;
  }
  let local: ProgressBackup;
  try {
    local = parseBackup(JSON.stringify(value.local));
  } catch {
    return null;
  }
  let remote: ProgressBackup | null = null;
  if (isPlainObject(value.remote)) {
    try {
      remote = parseBackup(JSON.stringify(value.remote));
    } catch {
      remote = null;
    }
  }
  return {
    version: 1,
    edition: currentEdition(),
    account: accountFingerprint(account),
    url: account.url,
    username: account.username,
    savedAt: value.savedAt,
    reason: value.reason as SyncRecoveryReason,
    local,
    remote,
  };
}

function readRawRecoveryHistory(
  storage: Storage,
  account: SyncAccount
): SyncRecoveryRecord[] | null {
  const raw = storage.getItem(syncRecoveryHistoryKey(accountFingerprint(account)));
  if (!raw) return null;
  const value = parseJson(raw);
  if (!Array.isArray(value)) return null;
  const records: SyncRecoveryRecord[] = [];
  for (const item of value) {
    const record = parseRecoveryRecord(item, account);
    if (record) records.push(record);
  }
  return records.slice(0, RECOVERY_HISTORY_LIMIT);
}

/** 读取最近一次恢复副本(兼容现有 UI);损坏或跨账号时返回 null。 */
export function readSyncRecovery(
  storage: Storage | null | undefined,
  account: SyncAccount
): SyncRecoveryRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(
      syncRecoveryKey(accountFingerprint(account))
    );
    if (!raw) return null;
    return parseRecoveryRecord(parseJson(raw), account);
  } catch {
    return null;
  }
}

/**
 * 读取最近恢复副本历史(新→旧),供 UI 找回被覆盖/冲突前的旧进度。
 * 历史键缺失或损坏时回退到兼容单槽记录。最多 3 条。
 */
export function readSyncRecoveryHistory(
  storage: Storage | null | undefined,
  account: SyncAccount
): SyncRecoveryRecord[] {
  if (!storage) return [];
  try {
    const history = readRawRecoveryHistory(storage, account);
    if (history && history.length > 0) {
      return history.slice(0, RECOVERY_HISTORY_LIMIT);
    }
  } catch {
    // 回退到单槽记录。
  }
  const latest = readSyncRecovery(storage, account);
  return latest ? [latest] : [];
}

/** 断开连接时删除该账号在本 edition 的基线/恢复数据(不碰学习进度)。 */
export function clearSyncState(
  storage: Storage | null | undefined,
  account: SyncAccount
): void {
  if (!storage) return;
  clearSyncBaseline(storage, account);
  const fingerprint = accountFingerprint(account);
  try {
    storage.removeItem(syncRecoveryKey(fingerprint));
    storage.removeItem(syncRecoveryHistoryKey(fingerprint));
  } catch {
    // 清理失败不阻断断开;下次 configure 也会重置基线。
  }
}
