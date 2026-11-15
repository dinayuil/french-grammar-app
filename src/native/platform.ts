/**
 * 原生能力薄适配层。
 *
 * 鸿蒙只通过 ArkWeb 注入的 `window.fgeHarmony` 识别:桥存在时优先于
 * Capacitor;不存在时保持 Android Capacitor / Web 的既有分支不变。
 * 请求/响应都使用锁定的 JSON 字符串协议,不在 JS 侧推断原生平台。
 */

import type {
  SyncConfig,
  SyncRequest,
  SyncResponse,
  SyncSettings,
} from "../sync/types";
import { DAV_PROPERTY_QUERY, validateSyncRootUrl } from "../sync/types";

export interface HarmonyBridge {
  invoke(requestJson: string): Promise<string>;
}

interface HarmonyRequestBase {
  version: 1;
}

export interface HarmonyThemeRequest extends HarmonyRequestBase {
  operation: "applyTheme";
  mode: "light" | "dark";
}

export interface HarmonyShareFile {
  filename: string;
  mimeType: string;
  encoding: "base64" | "utf8";
  data: string;
}

export interface HarmonyShareRequest extends HarmonyRequestBase {
  operation: "shareFile";
  filename: string;
  mimeType: string;
  encoding: "base64" | "utf8";
  data: string;
}

export interface HarmonySyncReadConfigRequest extends HarmonyRequestBase {
  operation: "syncReadConfig";
}

export interface HarmonySyncWriteConfigRequest extends HarmonyRequestBase {
  operation: "syncWriteConfig";
  config: SyncSettings;
  password?: string;
}

export interface HarmonySyncDisconnectRequest extends HarmonyRequestBase {
  operation: "syncDisconnect";
}

export interface HarmonySyncRequestRequest extends HarmonyRequestBase {
  operation: "syncRequest";
  request: SyncRequest;
}

export type HarmonyRequest =
  | HarmonyThemeRequest
  | HarmonyShareRequest
  | HarmonySyncReadConfigRequest
  | HarmonySyncWriteConfigRequest
  | HarmonySyncDisconnectRequest
  | HarmonySyncRequestRequest;

export interface HarmonyReply {
  status: "ok" | "cancelled" | "error";
  message?: string;
}

export type HarmonyShareResult =
  | { status: "shared" }
  | { status: "cancelled" };

/** 桥不可用、调用失败或响应不符合协议时抛出;message 可直接展示。 */
export class HarmonyBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarmonyBridgeError";
  }
}

const INVALID_REPLY = "鸿蒙桥返回了无效响应";
const THEME_FALLBACK = "鸿蒙系统主题同步失败";
const SHARE_FALLBACK = "鸿蒙系统分享失败";

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** 仅把具备 invoke 函数的注入对象视为鸿蒙桥,避免半注入对象误判。 */
function getBridge(): HarmonyBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as unknown as { fgeHarmony?: unknown }).fgeHarmony;
  if (typeof injected !== "object" || injected === null) return undefined;
  const invoke = (injected as { invoke?: unknown }).invoke;
  if (typeof invoke !== "function") return undefined;
  return injected as HarmonyBridge;
}

/** 当前页面是否运行在鸿蒙 ArkWeb 容器内(优先于 Capacitor 判断)。 */
export function isHarmonyPlatform(): boolean {
  return getBridge() !== undefined;
}

interface ParsedReply {
  status: HarmonyReply["status"];
  message?: string;
  record: Record<string, unknown>;
}

function parseReplyRecord(raw: unknown, fallback: string): ParsedReply {
  if (typeof raw !== "string") throw new HarmonyBridgeError(INVALID_REPLY);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }

  const record = parsed as Record<string, unknown>;
  const status = record.status;
  if (status !== "ok" && status !== "cancelled" && status !== "error") {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }
  if (status === "error") {
    const message = record.message;
    return {
      status,
      message:
        typeof message === "string" && message.length > 0 ? message : fallback,
      record,
    };
  }
  return { status, record };
}

function parseReply(raw: unknown, fallback: string): HarmonyReply {
  const reply = parseReplyRecord(raw, fallback);
  if (reply.status === "error") {
    return { status: reply.status, message: reply.message };
  }
  return { status: reply.status };
}

async function invoke(
  request: HarmonyRequest,
  fallback: string
): Promise<HarmonyReply> {
  const bridge = getBridge();
  if (!bridge) throw new HarmonyBridgeError("鸿蒙桥不可用");

  let raw: unknown;
  try {
    raw = await bridge.invoke(JSON.stringify(request));
  } catch (error) {
    throw new HarmonyBridgeError(messageFor(error, fallback));
  }
  return parseReply(raw, fallback);
}

/** 同步类操作需要读取 ok 回复中的数据字段,与主题/分享共用同一层校验。 */
async function invokeRecord(
  request: HarmonyRequest,
  fallback: string
): Promise<Record<string, unknown>> {
  const bridge = getBridge();
  if (!bridge) throw new HarmonyBridgeError("鸿蒙桥不可用");

  let raw: unknown;
  try {
    raw = await bridge.invoke(JSON.stringify(request));
  } catch (error) {
    throw new HarmonyBridgeError(messageFor(error, fallback));
  }
  const reply = parseReplyRecord(raw, fallback);
  if (reply.status === "error") {
    throw new HarmonyBridgeError(reply.message ?? fallback);
  }
  if (reply.status !== "ok") {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }
  return reply.record;
}

/**
 * 同步原生系统栏/窗口亮暗主题;主题是 best effort,桥失败不影响 WebView
 * 内已生效的主题。
 */
export function applyHarmonyTheme(mode: "light" | "dark"): void {
  if (!isHarmonyPlatform()) return;
  void invoke(
    { version: 1, operation: "applyTheme", mode },
    THEME_FALLBACK
  ).catch(() => {
    // 原生同步失败时保留 WebView 主题,不向调用方冒泡。
  });
}

/**
 * 调用鸿蒙系统分享。用户取消返回 cancelled;原生报错或坏响应抛
 * HarmonyBridgeError,由调用方映射为已有的 error / BackupError,
 * 绝不降级到 Web 下载或 Capacitor 分享。
 */
export async function shareHarmonyFile(
  file: HarmonyShareFile
): Promise<HarmonyShareResult> {
  const reply = await invoke(
    {
      version: 1,
      operation: "shareFile",
      filename: file.filename,
      mimeType: file.mimeType,
      encoding: file.encoding,
      data: file.data,
    },
    SHARE_FALLBACK
  );

  if (reply.status === "error") {
    throw new HarmonyBridgeError(reply.message ?? SHARE_FALLBACK);
  }
  return reply.status === "cancelled"
    ? { status: "cancelled" }
    : { status: "shared" };
}

const SYNC_FALLBACK = "鸿蒙同步请求失败";
const SYNC_MAX_BYTES = 5 * 1024 * 1024;
const SYNC_FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SYNC_METHODS = new Set(["GET", "PUT", "MKCOL", "PROPFIND"]);
const ALLOWED_SYNC_HEADERS = new Set([
  "accept",
  "content-type",
  "if-match",
  "if-none-match",
  "depth",
]);
const SYNC_FILENAME =
  __FGE_EDITION__ === "internal"
    ? "fge-progress-internal.json"
    : "fge-progress-public.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSyncPayload(kind: "配置" | "响应"): never {
  throw new Error(`原生同步${kind}无效`);
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length * 3;
}

/** 原生只返回脱敏配置；任何字段类型不符都整体拒绝。 */
export function parseNativeSyncConfig(value: unknown): SyncConfig | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) invalidSyncPayload("配置");

  const { url, username, autoSync, hasPassword } = value;
  if (
    typeof url !== "string" ||
    typeof username !== "string" ||
    typeof autoSync !== "boolean" ||
    typeof hasPassword !== "boolean"
  ) {
    invalidSyncPayload("配置");
  }
  return { url, username, autoSync, hasPassword };
}

/** 保留原生响应头名称的大小写;坏状态/坏头不返回半份响应。 */
export function parseNativeSyncResponse(value: unknown): SyncResponse {
  if (!isRecord(value)) invalidSyncPayload("响应");

  const status = value.status;
  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  ) {
    invalidSyncPayload("响应");
  }

  const rawHeaders = value.headers;
  if (!isRecord(rawHeaders)) invalidSyncPayload("响应");
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(rawHeaders)) {
    const lower = name.toLowerCase();
    if (
      name.length === 0 ||
      /[\r\n]/.test(name) ||
      SYNC_FORBIDDEN_KEYS.has(lower) ||
      typeof headerValue !== "string" ||
      /[\r\n]/.test(headerValue)
    ) {
      invalidSyncPayload("响应");
    }
    headers[name] = headerValue;
  }

  const body = value.body;
  if (typeof body !== "string" || utf8ByteLength(body) > SYNC_MAX_BYTES) {
    invalidSyncPayload("响应");
  }
  return { status, headers, body };
}

function normalizeSyncSettings(settings: SyncSettings): SyncSettings {
  if (!isRecord(settings)) throw new HarmonyBridgeError("同步配置无效");
  const { url, username, autoSync } = settings;
  if (
    typeof url !== "string" ||
    typeof username !== "string" ||
    typeof autoSync !== "boolean"
  ) {
    throw new HarmonyBridgeError("同步配置无效");
  }
  const urlError = validateSyncRootUrl(url);
  if (urlError) throw new HarmonyBridgeError(urlError);
  return { url, username, autoSync };
}

function normalizeSyncRequest(request: SyncRequest): SyncRequest {
  if (!isRecord(request)) throw new HarmonyBridgeError("同步请求无效");
  const { method, filename, headers, body } = request;
  if (
    !SYNC_METHODS.has(method) ||
    typeof filename !== "string" ||
    filename !== SYNC_FILENAME ||
    !isRecord(headers) ||
    (body !== undefined && typeof body !== "string")
  ) {
    throw new HarmonyBridgeError("同步请求无效");
  }
  const cleanHeaders: Record<string, string> = {};
  const seenHeaders = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      name.length === 0 ||
      /[\r\n\0]/.test(name) ||
      !ALLOWED_SYNC_HEADERS.has(lower) ||
      seenHeaders.has(lower) ||
      typeof value !== "string" ||
      /[\r\n\0]/.test(value) ||
      value.length > 8192 ||
      (lower === "depth" && value !== "0")
    ) {
      throw new HarmonyBridgeError("同步请求无效");
    }
    seenHeaders.add(lower);
    cleanHeaders[name] = value;
  }
  if (method === "GET" || method === "MKCOL") {
    if (body !== undefined) {
      throw new HarmonyBridgeError("同步请求体无效");
    }
  }
  if (method === "PROPFIND") {
    const depthKey = Object.keys(cleanHeaders).find(
      (name) => name.toLowerCase() === "depth"
    );
    if (!depthKey || cleanHeaders[depthKey] !== "0") {
      throw new HarmonyBridgeError("同步请求头无效");
    }
    if (body !== undefined && body !== DAV_PROPERTY_QUERY) {
      throw new HarmonyBridgeError("同步请求体无效");
    }
  }
  if (method === "PUT") {
    if (typeof body !== "string" || body.length === 0) {
      throw new HarmonyBridgeError("同步请求体无效");
    }
  }
  if (body !== undefined && utf8ByteLength(body) > SYNC_MAX_BYTES) {
    throw new HarmonyBridgeError("同步请求超过大小上限");
  }
  const clean: SyncRequest = {
    method: method as SyncRequest["method"],
    filename,
    headers: cleanHeaders,
  };
  if (body !== undefined) clean.body = body;
  return clean;
}

/** 读取鸿蒙原生加密保存的同步配置；未连接返回 null。 */
export async function readHarmonySyncConfig(): Promise<SyncConfig | null> {
  const record = await invokeRecord(
    { version: 1, operation: "syncReadConfig" },
    SYNC_FALLBACK
  );
  return parseNativeSyncConfig(record.config);
}

/** 保存配置；password 省略时保留原生已有的密码。 */
export async function writeHarmonySyncConfig(
  settings: SyncSettings,
  password?: string
): Promise<void> {
  const request: HarmonySyncWriteConfigRequest = {
    version: 1,
    operation: "syncWriteConfig",
    config: normalizeSyncSettings(settings),
  };
  if (password !== undefined) {
    if (typeof password !== "string") {
      throw new HarmonyBridgeError("同步密码无效");
    }
    request.password = password;
  }
  await invokeRecord(request, SYNC_FALLBACK);
}

/** 断开同步：清除原生凭据与配置，不删除学习进度。 */
export async function disconnectHarmonySync(): Promise<void> {
  await invokeRecord(
    { version: 1, operation: "syncDisconnect" },
    SYNC_FALLBACK
  );
}

/** 发起一次受限 WebDAV 请求；URL、认证、重定向和大小上限都由原生执行。 */
export async function requestHarmonySync(
  request: SyncRequest
): Promise<SyncResponse> {
  const record = await invokeRecord(
    {
      version: 1,
      operation: "syncRequest",
      request: normalizeSyncRequest(request),
    },
    SYNC_FALLBACK
  );
  if (!("response" in record)) {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }
  return parseNativeSyncResponse(record.response);
}
