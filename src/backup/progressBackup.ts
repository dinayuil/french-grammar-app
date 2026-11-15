import { Capacitor } from "@capacitor/core";
import { isDesktopPlatform, saveDesktopFile } from "../native/desktop";
import { isHarmonyPlatform, shareHarmonyFile } from "../native/platform";
import { saveProgress } from "../storage";
import type { DayRecord, LessonRecord, MistakeInfo, Progress } from "../types";

/** 学习进度备份文件格式;主题、题库与购买权益不进入备份。 */
export interface ProgressBackup {
  format: "fge-progress";
  version: 1;
  edition: "public" | "internal";
  exportedAt: string;
  progress: Progress;
}

export const BACKUP_FORMAT = "fge-progress";
export const BACKUP_VERSION = 1 as const;
/** 单个备份文件上限 5 MB,防止恶意大文件拖垮解析。 */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
/** 恢复前进度快照的存储键;按 edition 隔离,公开版绝不读写内部版快照。 */
export const RECOVERY_STORAGE_KEY: string =
  __FGE_EDITION__ === "internal"
    ? "fge.progress.recovery.v1"
    : "fge.public.progress.recovery.v1";

const MAX_DAYS = 3660;
const MAX_LESSONS = 20000;
const MAX_MISTAKES = 20000;
const MAX_DAY_IDS = 5000;
const MAX_ID_LENGTH = 256;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const SHARE_TITLE = "法语学习进度备份";
const SHARE_DIALOG_TITLE = "导出学习进度";

/** 备份校验/存储失败;message 可直接展示给用户。 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** 用户在系统分享面板取消导出(取消不是成功)。 */
export class BackupCancelledError extends BackupError {
  constructor(message = "已取消导出") {
    super(message);
    this.name = "BackupCancelledError";
  }
}

export function isBackupCancelled(error: unknown): boolean {
  return (
    error instanceof BackupCancelledError ||
    (error instanceof Error && error.name === "BackupCancelledError")
  );
}

function fail(message: string): never {
  throw new BackupError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`${path} 必须是对象`);
  return value;
}

/** 拒绝 __proto__ / prototype / constructor 等可用于原型污染的键。 */
function assertSafeKeys(obj: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) fail(`${path} 含非法键 ${key}`);
  }
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function requireSafeNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path} 必须是非负安全整数`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} 必须是布尔值`);
  return value;
}

function requireId(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH
  ) {
    fail(`${path} 必须是非空字符串且长度不超过 ${MAX_ID_LENGTH}`);
  }
  return value;
}

function requireIdArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(`${path} 必须是数组`);
  if (value.length > MAX_DAY_IDS) {
    fail(`${path} 数量超出上限（${MAX_DAY_IDS}）`);
  }
  return value.map((item, index) => requireId(item, `${path}[${index}]`));
}

/** 真实日期(YYYY-MM-DD):拒绝 2026-02-30、2026-13-01 等。 */
function isRealDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** 真实 UTC ISO 时间;createBackup 写出的格式,也接受精度较短的毫秒。 */
function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
  if (year < 1000) return false;
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  );
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function normalizeDayRecord(value: unknown, path: string): DayRecord {
  const raw = requireObject(value, path);
  assertSafeKeys(raw, path);

  const record: DayRecord = {
    xp: requireSafeNonNegativeInt(raw.xp, `${path}.xp`),
    earnedQids: requireIdArray(raw.earnedQids, `${path}.earnedQids`),
    bonusIds: requireIdArray(raw.bonusIds, `${path}.bonusIds`),
  };

  if (hasOwn(raw, "sharePrompted") && raw.sharePrompted !== undefined) {
    record.sharePrompted = requireBoolean(
      raw.sharePrompted,
      `${path}.sharePrompted`
    );
  }
  if (hasOwn(raw, "readSeconds") && raw.readSeconds !== undefined) {
    record.readSeconds = requireSafeNonNegativeInt(
      raw.readSeconds,
      `${path}.readSeconds`
    );
  }
  if (hasOwn(raw, "practiceSeconds") && raw.practiceSeconds !== undefined) {
    record.practiceSeconds = requireSafeNonNegativeInt(
      raw.practiceSeconds,
      `${path}.practiceSeconds`
    );
  }

  return record;
}

function normalizeDays(value: unknown): Progress["days"] {
  const raw = requireObject(value, "progress.days");
  assertSafeKeys(raw, "progress.days");
  const entries = Object.entries(raw);
  if (entries.length > MAX_DAYS) {
    fail(`progress.days 数量超出上限（${MAX_DAYS}）`);
  }

  const days: Progress["days"] = {};
  for (const [date, entry] of entries) {
    if (!isRealDateKey(date)) {
      fail(`progress.days 含无效日期键：${date}`);
    }
    days[date] = normalizeDayRecord(entry, `progress.days.${date}`);
  }
  return days;
}

function normalizeLessons(value: unknown): Progress["lessons"] {
  const raw = requireObject(value, "progress.lessons");
  assertSafeKeys(raw, "progress.lessons");
  const entries = Object.entries(raw);
  if (entries.length > MAX_LESSONS) {
    fail(`progress.lessons 数量超出上限（${MAX_LESSONS}）`);
  }

  const lessons: Progress["lessons"] = {};
  for (const [id, entry] of entries) {
    const key = requireId(id, "progress.lessons 键");
    const path = `progress.lessons.${key}`;
    const record = requireObject(entry, path);
    assertSafeKeys(record, path);
    const stars = requireSafeNonNegativeInt(record.stars, `${path}.stars`);
    if (stars > 3) fail(`${path}.stars 必须在 0 到 3 之间`);
    lessons[key] = {
      completed: requireBoolean(record.completed, `${path}.completed`),
      stars,
    } satisfies LessonRecord;
  }
  return lessons;
}

function normalizeMistakes(value: unknown): Progress["mistakes"] {
  const raw = requireObject(value, "progress.mistakes");
  assertSafeKeys(raw, "progress.mistakes");
  const entries = Object.entries(raw);
  if (entries.length > MAX_MISTAKES) {
    fail(`progress.mistakes 数量超出上限（${MAX_MISTAKES}）`);
  }

  const mistakes: Progress["mistakes"] = {};
  for (const [id, entry] of entries) {
    const key = requireId(id, "progress.mistakes 键");
    const path = `progress.mistakes.${key}`;
    const record = requireObject(entry, path);
    assertSafeKeys(record, path);
    if (!isRealDateKey(record.lastWrong)) {
      fail(`${path}.lastWrong 必须是有效日期`);
    }
    mistakes[key] = {
      lastWrong: record.lastWrong,
      count: requireSafeNonNegativeInt(record.count, `${path}.count`),
    } satisfies MistakeInfo;
  }
  return mistakes;
}

/** 只拷贝 Progress 白名单字段;未知字段(权益、主题等)一律丢弃。 */
function normalizeProgress(value: unknown): Progress {
  const raw = requireObject(value, "progress");
  assertSafeKeys(raw, "progress");

  if (raw.translationTiming !== "before" && raw.translationTiming !== "after") {
    fail("progress.translationTiming 必须是 before 或 after");
  }

  // 旧备份没有 shareCardContent:按默认 both 兼容;显式非法值拒绝导入。
  let shareCardContent: Progress["shareCardContent"];
  if (raw.shareCardContent === undefined) {
    shareCardContent = "both";
  } else if (
    raw.shareCardContent === "xp" ||
    raw.shareCardContent === "time" ||
    raw.shareCardContent === "both"
  ) {
    shareCardContent = raw.shareCardContent;
  } else {
    fail("progress.shareCardContent 必须是 xp、time 或 both");
  }

  return {
    xp: requireSafeNonNegativeInt(raw.xp, "progress.xp"),
    dailyGoal: requireSafeNonNegativeInt(raw.dailyGoal, "progress.dailyGoal"),
    sound: requireBoolean(raw.sound, "progress.sound"),
    translationEnabled: requireBoolean(
      raw.translationEnabled,
      "progress.translationEnabled"
    ),
    translationTiming: raw.translationTiming,
    shareCardContent,
    days: normalizeDays(raw.days),
    lessons: normalizeLessons(raw.lessons),
    mistakes: normalizeMistakes(raw.mistakes),
  };
}

function normalizeBackup(value: unknown): ProgressBackup {
  const raw = requireObject(value, "备份");
  assertSafeKeys(raw, "备份");

  if (raw.format !== BACKUP_FORMAT) {
    fail("不是本应用的学习进度备份");
  }
  if (raw.version !== BACKUP_VERSION) {
    fail(`不支持的备份版本：${String(raw.version)}`);
  }
  if (raw.edition !== "public" && raw.edition !== "internal") {
    fail("备份的版本标识(edition)无效");
  }
  if (raw.edition !== __FGE_EDITION__) {
    const name = raw.edition === "internal" ? "内部版" : "公开版";
    fail(`不能把${name}备份导入当前版本`);
  }
  if (!isValidIsoTimestamp(raw.exportedAt)) {
    fail("备份的导出时间无效");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    edition: raw.edition,
    exportedAt: raw.exportedAt,
    progress: normalizeProgress(raw.progress),
  };
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).byteLength;
  }
  // 无 TextEncoder 时按最坏情况估算,宁可提前拒绝。
  return text.length * 3;
}

/**
 * 输出必须能被 parseBackup 再次导入:优先 pretty,超过 5MB 时退回 compact;
 * 若 compact 仍超限则拒绝导出,绝不生成自己无法导入的文件。
 */
function serializeBackup(backup: ProgressBackup): string {
  const pretty = JSON.stringify(backup, null, 2);
  if (utf8ByteLength(pretty) <= MAX_BACKUP_BYTES) return pretty;

  const compact = JSON.stringify(backup);
  if (utf8ByteLength(compact) > MAX_BACKUP_BYTES) {
    fail(
      `学习进度数据超过备份大小上限（${Math.floor(
        MAX_BACKUP_BYTES / 1024 / 1024
      )} MB），无法导出`
    );
  }
  return compact;
}

/** 校验并原样复制当前进度,用于生成备份或恢复前快照。 */
export function createBackup(progress: Progress): ProgressBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    edition: __FGE_EDITION__,
    exportedAt: new Date().toISOString(),
    progress: normalizeProgress(progress),
  };
}

/** 严格解析备份文本;任何异常都抛 BackupError(message 可展示)。 */
export function parseBackup(text: string): ProgressBackup {
  if (typeof text !== "string") fail("备份内容必须是文本");
  if (utf8ByteLength(text) > MAX_BACKUP_BYTES) {
    fail(
      `备份文件超出大小上限（${Math.floor(MAX_BACKUP_BYTES / 1024 / 1024)} MB）`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("备份文件不是有效的 JSON");
  }
  return normalizeBackup(raw);
}

/**
 * 恢复备份:先校验,再把 current 写入按 edition 隔离的回退快照,最后覆盖进度。
 * 在校验/快照/写入任一阶段失败时抛出可读错误,并尽力保持原进度不变。
 */
export function restoreBackup(backup: ProgressBackup, current: Progress): void {
  // 先完成全部校验,任何不合法内容都不得触碰存储。
  const restored = normalizeBackup(backup);
  const previous = createBackup(current);

  if (typeof localStorage === "undefined") {
    fail("当前环境不支持本地存储,无法恢复进度");
  }

  try {
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(previous));
  } catch {
    fail("无法保存恢复前备份，当前进度未修改");
  }

  try {
    saveProgress(restored.progress);
  } catch {
    // localStorage.setItem 本身是原子的;再显式回写一次以兼容异常实现。
    try {
      saveProgress(previous.progress);
    } catch {
      // 回滚也失败时旧值通常仍由 setItem 原子性保留,只能报告失败。
    }
    fail("保存恢复进度失败，已保留原进度");
  }
}

/** 读取恢复前快照;不存在、损坏或跨 edition 时返回 null,绝不抛异常。 */
export function loadRecoveryBackup(): ProgressBackup | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    return parseBackup(raw);
  } catch {
    return null;
  }
}

function backupFilename(backup: ProgressBackup): string {
  return `fge-progress-${backup.edition}-${backup.exportedAt.slice(0, 10)}.json`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function downloadWeb(json: string, filename: string): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    fail("当前浏览器不支持文件下载，请更换浏览器后重试");
  }

  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch (error) {
    fail(`无法创建下载文件：${errorMessage(error, "未知错误")}`);
  }

  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    // Firefox / 部分 WebView 会忽略未挂载的 anchor。
    document.body.appendChild(link);
    link.click();
  } catch (error) {
    fail(`导出下载失败：${errorMessage(error, "未知错误")}`);
  } finally {
    link.remove();
    // 延迟回收,避免下载开始前 URL 已被 revoke;部分 WebView 无 revoke。
    setTimeout(() => {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    }, 0);
  }
}

function isShareCancellation(error: unknown): boolean {
  if (error instanceof BackupCancelledError) return true;
  if (typeof error === "object" && error !== null) {
    if ((error as { name?: unknown }).name === "AbortError") return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /cancel|dismiss|取消/i.test(message);
}

async function shareNative(json: string, filename: string): Promise<void> {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const path = `backup/${filename}`;

  try {
    await Filesystem.writeFile({
      path,
      data: json,
      directory: Directory.Cache,
      recursive: true,
      // 不传 encoding 时 Capacitor 会把 data 当 base64 二进制,JSON 会被拒写。
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    fail(`无法写入备份文件，请检查存储空间：${errorMessage(error, "未知错误")}`);
  }

  let uri = "";
  try {
    uri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  } catch (error) {
    fail(`无法定位备份文件：${errorMessage(error, "未知错误")}`);
  }

  try {
    await Share.share({
      title: SHARE_TITLE,
      dialogTitle: SHARE_DIALOG_TITLE,
      files: [uri],
    });
  } catch (error) {
    if (isShareCancellation(error)) {
      throw new BackupCancelledError("已取消导出");
    }
    fail(`系统分享失败：${errorMessage(error, "请重试")}`);
  }
}

/** 鸿蒙系统分享 JSON;取消保留 BackupCancelledError,失败不降级到 Web。 */
async function shareHarmony(json: string, filename: string): Promise<void> {
  try {
    const result = await shareHarmonyFile({
      filename,
      mimeType: "application/json",
      encoding: "utf8",
      data: json,
    });
    if (result.status === "cancelled") {
      throw new BackupCancelledError("已取消导出");
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail(`系统分享失败：${errorMessage(error, "请重试")}`);
  }
}

/** 导出学习进度:Web 用 Blob 下载 JSON,Android/Harmony 走系统分享。 */
export async function exportBackup(progress: Progress): Promise<void> {
  const backup = createBackup(progress);
  const json = serializeBackup(backup);
  const filename = backupFilename(backup);

  try {
    if (isHarmonyPlatform()) {
      await shareHarmony(json, filename);
      return;
    }
    if (isDesktopPlatform()) {
      const result = await saveDesktopFile({
        filename,
        mimeType: "application/json",
        encoding: "utf8",
        data: json,
      });
      if (result.status === "cancelled") {
        throw new BackupCancelledError("已取消导出");
      }
      return;
    }
    if (Capacitor.isNativePlatform()) {
      await shareNative(json, filename);
      return;
    }
    downloadWeb(json, filename);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail(`导出失败：${errorMessage(error, "请重试")}`);
  }
}
