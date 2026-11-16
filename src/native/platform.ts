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

export type NativeErrorCode =
  | "native.config_invalid"
  | "native.credentials_required"
  | "native.storage_failed"
  | "native.network_failed"
  | "native.file_failed"
  | "native.unsupported"
  | "native.unknown";

export type NativeErrorParams = Record<string, string | number>;

export interface NativeErrorDetails {
  code?: NativeErrorCode;
  params?: NativeErrorParams;
  diagnostic?: string;
}

export interface HarmonyReply extends NativeErrorDetails {
  status: "ok" | "cancelled" | "error";
  message?: string;
}

export type HarmonyShareResult =
  | { status: "shared" }
  | { status: "cancelled" };

/** 桥不可用、调用失败或响应不符合协议时抛出;message 可直接展示。 */
export class HarmonyBridgeError extends Error {
  readonly code: NativeErrorCode;
  readonly params?: NativeErrorParams;
  readonly diagnostic?: string;

  constructor(message: string, details: NativeErrorDetails = {}) {
    super(message);
    this.name = "HarmonyBridgeError";
    this.code = details.code ?? "native.unknown";
    if (details.params && Object.keys(details.params).length > 0) {
      this.params = details.params;
    }
    if (details.diagnostic !== undefined) {
      this.diagnostic = details.diagnostic;
    }
  }
}

const INVALID_REPLY = "鸿蒙桥返回了无效响应";
const THEME_FALLBACK = "鸿蒙系统主题同步失败";
const SHARE_FALLBACK = "鸿蒙系统分享失败";
const NATIVE_ERROR_CODES = new Set<NativeErrorCode>([
  "native.config_invalid",
  "native.credentials_required",
  "native.storage_failed",
  "native.network_failed",
  "native.file_failed",
  "native.unsupported",
  "native.unknown",
]);
const NATIVE_PARAM_FORBIDDEN_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function nativeCode(value: unknown): NativeErrorCode {
  return typeof value === "string" &&
    NATIVE_ERROR_CODES.has(value as NativeErrorCode)
    ? (value as NativeErrorCode)
    : "native.unknown";
}

/** 只转发标量非敏感参数;嵌套对象、布尔和超长文本整体丢弃。 */
function nativeParams(value: unknown): NativeErrorParams | undefined {
  if (!isRecord(value)) return undefined;
  const params: NativeErrorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      key.length === 0 ||
      key.length > 64 ||
      NATIVE_PARAM_FORBIDDEN_KEYS.has(lower) ||
      /[\r\n\0]/.test(key)
    ) {
      continue;
    }
    if (typeof entry === "string") {
      if (entry.length <= 200 && !/[\r\n\0]/.test(entry)) params[key] = entry;
    } else if (
      typeof entry === "number" &&
      Number.isFinite(entry) &&
      Number.isInteger(entry)
    ) {
      params[key] = entry;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function withOperation(
  params: NativeErrorParams | undefined,
  operation: string | undefined
): NativeErrorParams | undefined {
  if (!operation) return params;
  if (params?.operation !== undefined) return params;
  return { ...(params ?? {}), operation };
}

function nativeFailure(
  message: string,
  code: NativeErrorCode,
  params?: NativeErrorParams,
  diagnostic?: string
): HarmonyBridgeError {
  return new HarmonyBridgeError(message, { code, params, diagnostic });
}

/**
 * 旧桥只 reject 字符串时保留原文作为诊断,但绝不由中文字符串推断具体
 * 错误码;新桥的结构化对象则直接采用其 code/params。
 */
function errorFromThrown(
  error: unknown,
  fallback: string,
  operation?: string
): HarmonyBridgeError {
  if (isRecord(error)) {
    const diagnostic =
      typeof error.diagnostic === "string" && error.diagnostic
        ? error.diagnostic
        : typeof error.message === "string" && error.message
          ? error.message
          : undefined;
    const params = withOperation(
      nativeParams(error.params) ??
        nativeParams((error as { data?: unknown }).data) ??
        (isRecord((error as { data?: unknown }).data)
          ? nativeParams(
              ((error as { data: Record<string, unknown> }).data
                .params ?? undefined) as unknown
            )
          : undefined),
      operation
    );
    return new HarmonyBridgeError(diagnostic ?? fallback, {
      code: nativeCode(error.code),
      params,
      diagnostic,
    });
  }
  if (error instanceof Error && error.message) {
    return new HarmonyBridgeError(error.message, {
      code: "native.unknown",
      params: withOperation(undefined, operation),
      diagnostic: error.message,
    });
  }
  if (typeof error === "string" && error) {
    return new HarmonyBridgeError(error, {
      code: "native.unknown",
      params: withOperation(undefined, operation),
      diagnostic: error,
    });
  }
  return new HarmonyBridgeError(fallback, {
    code: "native.unknown",
    params: withOperation(undefined, operation),
  });
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

interface ParsedReply extends NativeErrorDetails {
  status: HarmonyReply["status"];
  message?: string;
  record: Record<string, unknown>;
}

function invalidReply(): HarmonyBridgeError {
  return nativeFailure(INVALID_REPLY, "native.unknown", undefined, INVALID_REPLY);
}

function parseReplyRecord(
  raw: unknown,
  fallback: string,
  operation?: string
): ParsedReply {
  if (typeof raw !== "string") throw invalidReply();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidReply();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidReply();
  }

  const record = parsed as Record<string, unknown>;
  const status = record.status;
  if (status !== "ok" && status !== "cancelled" && status !== "error") {
    throw invalidReply();
  }
  if (status === "error") {
    const nativeMessage =
      typeof record.message === "string" && record.message.length > 0
        ? record.message
        : undefined;
    return {
      status,
      message: nativeMessage ?? fallback,
      code: nativeCode(record.code),
      params: withOperation(nativeParams(record.params), operation),
      diagnostic: nativeMessage,
      record,
    };
  }
  return { status, record };
}

function parseReply(
  raw: unknown,
  fallback: string,
  operation?: string
): HarmonyReply {
  const reply = parseReplyRecord(raw, fallback, operation);
  if (reply.status === "error") {
    return {
      status: reply.status,
      message: reply.message,
      code: reply.code,
      params: reply.params,
      diagnostic: reply.diagnostic,
    };
  }
  return { status: reply.status };
}

async function invoke(
  request: HarmonyRequest,
  fallback: string
): Promise<HarmonyReply> {
  const bridge = getBridge();
  if (!bridge) {
    throw nativeFailure("鸿蒙桥不可用", "native.unsupported", {
      operation: request.operation,
    });
  }

  let raw: unknown;
  try {
    raw = await bridge.invoke(JSON.stringify(request));
  } catch (error) {
    throw errorFromThrown(error, fallback, request.operation);
  }
  return parseReply(raw, fallback, request.operation);
}

/** 同步类操作需要读取 ok 回复中的数据字段,与主题/分享共用同一层校验。 */
async function invokeRecord(
  request: HarmonyRequest,
  fallback: string
): Promise<Record<string, unknown>> {
  const bridge = getBridge();
  if (!bridge) {
    throw nativeFailure("鸿蒙桥不可用", "native.unsupported", {
      operation: request.operation,
    });
  }

  let raw: unknown;
  try {
    raw = await bridge.invoke(JSON.stringify(request));
  } catch (error) {
    throw errorFromThrown(error, fallback, request.operation);
  }
  const reply = parseReplyRecord(raw, fallback, request.operation);
  if (reply.status === "error") {
    throw new HarmonyBridgeError(reply.message ?? fallback, {
      code: reply.code,
      params: reply.params,
      diagnostic: reply.diagnostic,
    });
  }
  if (reply.status !== "ok") {
    throw invalidReply();
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
    throw new HarmonyBridgeError(reply.message ?? SHARE_FALLBACK, {
      code: reply.code,
      params: reply.params,
      diagnostic: reply.diagnostic,
    });
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
  throw nativeFailure(
    `原生同步${kind}无效`,
    "native.config_invalid",
    { operation: "sync" },
    `原生同步${kind}无效`
  );
}

function invalidSyncConfiguration(message: string): never {
  throw nativeFailure(message, "native.config_invalid", undefined, message);
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
  if (!isRecord(settings)) invalidSyncConfiguration("同步配置无效");
  const { url, username, autoSync } = settings;
  if (
    typeof url !== "string" ||
    typeof username !== "string" ||
    typeof autoSync !== "boolean"
  ) {
    invalidSyncConfiguration("同步配置无效");
  }
  const urlError = validateSyncRootUrl(url);
  if (urlError) invalidSyncConfiguration(urlError);
  return { url, username, autoSync };
}

function normalizeSyncRequest(request: SyncRequest): SyncRequest {
  if (!isRecord(request)) invalidSyncConfiguration("同步请求无效");
  const { method, filename, headers, body } = request;
  if (
    !SYNC_METHODS.has(method) ||
    typeof filename !== "string" ||
    filename !== SYNC_FILENAME ||
    !isRecord(headers) ||
    (body !== undefined && typeof body !== "string")
  ) {
    invalidSyncConfiguration("同步请求无效");
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
      invalidSyncConfiguration("同步请求无效");
    }
    seenHeaders.add(lower);
    cleanHeaders[name] = value;
  }
  if (method === "GET" || method === "MKCOL") {
    if (body !== undefined) {
      invalidSyncConfiguration("同步请求体无效");
    }
  }
  if (method === "PROPFIND") {
    const depthKey = Object.keys(cleanHeaders).find(
      (name) => name.toLowerCase() === "depth"
    );
    if (!depthKey || cleanHeaders[depthKey] !== "0") {
      invalidSyncConfiguration("同步请求头无效");
    }
    if (body !== undefined && body !== DAV_PROPERTY_QUERY) {
      invalidSyncConfiguration("同步请求体无效");
    }
  }
  if (method === "PUT") {
    if (typeof body !== "string" || body.length === 0) {
      invalidSyncConfiguration("同步请求体无效");
    }
  }
  if (body !== undefined && utf8ByteLength(body) > SYNC_MAX_BYTES) {
    invalidSyncConfiguration("同步请求超过大小上限");
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
      invalidSyncConfiguration("同步密码无效");
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
    throw invalidReply();
  }
  return parseNativeSyncResponse(record.response);
}
