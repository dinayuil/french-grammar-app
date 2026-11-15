import {
  MAX_BACKUP_BYTES,
  parseBackup,
} from "../backup/progressBackup";
import type { ProgressBackup } from "../backup/progressBackup";
import type { Progress } from "../types";
import type { SyncRequest } from "./types";
import { DAV_PROPERTY_QUERY, SYNC_APP_FOLDER } from "./types";

/** 云端文件外层格式;内部 payload 仍是 version 1 的 ProgressBackup。 */
export const SYNC_FORMAT = "fge-sync";
export const SYNC_VERSION = 1 as const;
/** 同步请求/响应整体上限,与备份上限一致。 */
export const MAX_SYNC_BYTES = MAX_BACKUP_BYTES;

export type SyncEdition = "public" | "internal";

/** 同步协议/数据错误;message 可直接展示。 */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

export interface SyncDocument {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  backup: ProgressBackup;
}

export type SyncWriteCondition =
  | { ifMatch: string }
  | { ifNoneMatch: "*" };

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length * 3;
}

function currentEdition(): SyncEdition {
  return __FGE_EDITION__;
}

/** 固定文件名:公开版与内部版远端互不读取。 */
export function syncFilename(edition: SyncEdition = currentEdition()): string {
  return edition === "internal"
    ? "fge-progress-internal.json"
    : "fge-progress-public.json";
}

/** 生成普通同步文件(JSON 文本);超过大小上限时拒绝发起请求。 */
export function encodeSyncDocument(backup: ProgressBackup): string {
  const document: SyncDocument = {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    backup,
  };
  const text = JSON.stringify(document);
  if (utf8ByteLength(text) > MAX_SYNC_BYTES) {
    throw new SyncError("同步数据超过 5 MB 上限");
  }
  return text;
}

/** 解析云端同步文件;格式、版本或进度不合法时抛 SyncError。 */
export function parseSyncDocument(text: string): ProgressBackup {
  if (typeof text !== "string" || text.length === 0) {
    throw new SyncError("云端同步文件为空");
  }
  if (utf8ByteLength(text) > MAX_SYNC_BYTES) {
    throw new SyncError("云端同步文件超过 5 MB 上限");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyncError("云端同步文件不是有效的 JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SyncError("云端同步文件格式无效");
  }
  const document = raw as Record<string, unknown>;
  if (document.format !== SYNC_FORMAT) {
    throw new SyncError("不是本应用的同步文件");
  }
  if (document.version !== SYNC_VERSION) {
    throw new SyncError(`不支持的同步文件版本：${String(document.version)}`);
  }
  if (
    typeof document.backup !== "object" ||
    document.backup === null ||
    Array.isArray(document.backup)
  ) {
    throw new SyncError("云端同步文件缺少学习进度");
  }

  try {
    return parseBackup(JSON.stringify(document.backup));
  } catch (error) {
    throw new SyncError(
      error instanceof Error && error.message
        ? error.message
        : "云端学习进度数据无效"
    );
  }
}

/** 大小写不敏感读取响应头;缺失返回 null。 */
export function getHeader(
  headers: Record<string, string> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }
  return null;
}

/**
 * 合法强 ETag:单个双引号包裹的 opaque-tag。
 * 拒绝 W/、*、裸值、逗号分隔列表、空格/控制字符和尾部垃圾。
 * 空标签 "" 在 RFC 语法上合法,保留。
 */
const STRONG_ETAG_RE = /^"(?:[\u0021\u0023-\u007E\u0080-\u00FF])*"$/;

/**
 * 只有非空、非 W/ 的单个带引号 ETag 才能支撑条件写。
 * 返回 trim 后的原值(保留引号),其他情况返回 null。
 */
export function getStrongEtag(
  headers: Record<string, string> | undefined
): string | null {
  const value = getHeader(headers, "etag");
  if (!value) return null;
  const etag = value.replace(/^[ \t]+|[ \t]+$/g, "");
  return STRONG_ETAG_RE.test(etag) ? etag : null;
}

export function buildGetRequest(filename: string = syncFilename()): SyncRequest {
  return {
    method: "GET",
    filename,
    headers: { Accept: "application/json" },
  };
}

/** 创建固定应用目录;正文必须为空,原生只拼接 root/FrenchGrammarExercise/。 */
export function buildMkcolRequest(
  filename: string = syncFilename()
): SyncRequest {
  return {
    method: "MKCOL",
    filename,
    headers: {},
  };
}

/** 验证固定应用目录已是 DAV collection;Depth 只能 0,正文固定。 */
export function buildPropfindRequest(
  filename: string = syncFilename()
): SyncRequest {
  return {
    method: "PROPFIND",
    filename,
    headers: {
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: DAV_PROPERTY_QUERY,
  };
}

const DAV_NAMESPACE = "DAV:";

function directChildren(
  parent: Element,
  namespace: string,
  localName: string
): Element[] {
  return Array.from(parent.children).filter(
    (child) =>
      child.namespaceURI === namespace && child.localName === localName
  );
}

function statusCode(element: Element): number | null {
  const match = /^\s*HTTP\/\d(?:\.\d)?\s+(\d{3})\b/.exec(
    element.textContent ?? ""
  );
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isInteger(code) ? code : null;
}

function hrefBelongsToAppFolder(href: string): boolean {
  let decoded = href.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // 保留原值;无法解码时按不匹配处理。
  }
  const path = decoded.split("#")[0].split("?")[0].replace(/\/+$/, "");
  return (
    path === SYNC_APP_FOLDER || path.endsWith(`/${SYNC_APP_FOLDER}`)
  );
}

/**
 * 严格校验 PROPFIND 207 回复:必须是 DAV multistatus,且存在目标应用目录
 * response 的至少一个 2xx propstat,其 resourcetype 含 DAV:collection。
 * HTML、错误 namespace、404 propstat、非 collection 或其它 href 全部拒绝。
 */
export function isDavCollectionPropfind(body: string): boolean {
  if (!body || utf8ByteLength(body) > MAX_SYNC_BYTES) return false;
  if (/<!DOCTYPE/i.test(body)) return false;
  if (typeof DOMParser !== "function") return false;

  let document: Document;
  try {
    document = new DOMParser().parseFromString(body, "application/xml");
  } catch {
    return false;
  }
  if (document.getElementsByTagName("parsererror").length > 0) return false;

  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== DAV_NAMESPACE ||
    root.localName !== "multistatus"
  ) {
    return false;
  }

  const responses = Array.from(root.children).filter(
    (child) =>
      child.namespaceURI === DAV_NAMESPACE && child.localName === "response"
  );

  for (const response of responses) {
    const href = directChildren(response, DAV_NAMESPACE, "href")[0];
    // 标准 DAV 必带 href;若服务端省略,Depth:0 请求的目标仍是应用目录。
    if (href && !hrefBelongsToAppFolder(href.textContent ?? "")) continue;

    for (const propstat of directChildren(response, DAV_NAMESPACE, "propstat")) {
      const status = directChildren(propstat, DAV_NAMESPACE, "status")[0];
      const code = status ? statusCode(status) : null;
      if (code === null || code < 200 || code > 299) continue;

      const prop = directChildren(propstat, DAV_NAMESPACE, "prop")[0];
      if (!prop) continue;
      const resourceType = directChildren(
        prop,
        DAV_NAMESPACE,
        "resourcetype"
      )[0];
      if (!resourceType) continue;
      if (directChildren(resourceType, DAV_NAMESPACE, "collection").length > 0) {
        return true;
      }
    }
  }

  return false;
}

/** 覆盖已有文件必须 If-Match;新建文件必须 If-None-Match: *。 */
export function buildPutRequest(
  backup: ProgressBackup,
  condition: SyncWriteCondition,
  filename: string = syncFilename()
): SyncRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if ("ifMatch" in condition) {
    const etag = getStrongEtag({ ETag: condition.ifMatch });
    if (!etag) {
      throw new SyncError("云端 ETag 无效，已停止条件覆盖");
    }
    headers["If-Match"] = etag;
  } else {
    if (condition.ifNoneMatch !== "*") {
      throw new SyncError("新建条件无效，已停止同步");
    }
    headers["If-None-Match"] = condition.ifNoneMatch;
  }
  return {
    method: "PUT",
    filename,
    headers,
    body: encodeSyncDocument(backup),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalize(item))
      .sort((a, b) => {
        const left = JSON.stringify(a) ?? "";
        const right = JSON.stringify(b) ?? "";
        return left < right ? -1 : left > right ? 1 : 0;
      });
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) result[key] = canonicalize(item);
    }
    return result;
  }
  return value;
}

function canonicalProgressJson(progress: Progress): string {
  return JSON.stringify(canonicalize(progress));
}

/**
 * 进度是否相同:只看 Progress 内容,不看备份 exportedAt;
 * 对象键和基础数组顺序不影响结果。
 */
export function sameProgress(a: Progress, b: Progress): boolean {
  return canonicalProgressJson(a) === canonicalProgressJson(b);
}

/** 是否存在值得同步/保护的学习进度(纯设置或默认值不算)。 */
export function hasLearningProgress(progress: Progress): boolean {
  if (!progress || typeof progress !== "object") return false;
  if (typeof progress.xp === "number" && progress.xp > 0) return true;

  const lessons = progress.lessons ?? {};
  for (const record of Object.values(lessons)) {
    if (record && (record.completed || record.stars > 0)) return true;
  }

  if (Object.keys(progress.mistakes ?? {}).length > 0) return true;

  const days = progress.days ?? {};
  for (const record of Object.values(days)) {
    if (!record) continue;
    if (
      record.xp > 0 ||
      (record.earnedQids?.length ?? 0) > 0 ||
      (record.bonusIds?.length ?? 0) > 0 ||
      (record.readSeconds ?? 0) > 0 ||
      (record.practiceSeconds ?? 0) > 0
    ) {
      return true;
    }
  }

  return false;
}
