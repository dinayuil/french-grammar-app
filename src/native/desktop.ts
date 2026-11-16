import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NativeErrorCode, NativeErrorParams } from "./platform";

/** 桌面原生保存参数;数据仍由 WebView 生成,原生只负责校验与保存。 */
export interface DesktopFile {
  filename: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  data: string;
}

/** 应用控制的可选参数;dialogTitle 由调用方按当前界面语言本地化。 */
export interface DesktopSaveOptions {
  dialogTitle?: string;
}

export type DesktopSaveResult =
  | { status: "saved" }
  | { status: "cancelled" };

export class DesktopFileError extends Error {
  readonly code: NativeErrorCode;
  readonly params?: NativeErrorParams;
  readonly diagnostic?: string;

  constructor(
    message: string,
    code: NativeErrorCode,
    params?: NativeErrorParams,
    diagnostic?: string
  ) {
    super(message);
    this.name = "DesktopFileError";
    this.code = code;
    if (params && Object.keys(params).length > 0) this.params = params;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);
const NATIVE_ERROR_CODES = new Set<NativeErrorCode>([
  "native.config_invalid",
  "native.credentials_required",
  "native.storage_failed",
  "native.network_failed",
  "native.file_failed",
  "native.unsupported",
  "native.unknown",
]);
const PARAM_FORBIDDEN_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeCode(value: unknown): NativeErrorCode {
  return typeof value === "string" &&
    NATIVE_ERROR_CODES.has(value as NativeErrorCode)
    ? (value as NativeErrorCode)
    : "native.unknown";
}

function nativeParams(value: unknown): NativeErrorParams | undefined {
  if (!isRecord(value)) return undefined;
  const params: NativeErrorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      key.length === 0 ||
      key.length > 64 ||
      PARAM_FORBIDDEN_KEYS.has(lower) ||
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

function saveParams(params?: NativeErrorParams): NativeErrorParams {
  return params?.operation !== undefined
    ? params
    : { ...(params ?? {}), operation: "save" };
}

/**
 * 旧桥只抛字符串时保留原文诊断,但不从中文内容推断具体错误码;新桥的
 * 结构化错误对象直接沿用 code/params。
 */
function errorFromThrown(error: unknown): DesktopFileError {
  if (isRecord(error)) {
    const diagnostic =
      typeof error.diagnostic === "string" && error.diagnostic
        ? error.diagnostic
        : typeof error.message === "string" && error.message
          ? error.message
          : undefined;
    return new DesktopFileError(
      diagnostic ?? "保存文件失败，请重试",
      nativeCode(error.code),
      saveParams(nativeParams(error.params)),
      diagnostic
    );
  }
  if (typeof error === "string" && error) {
    return new DesktopFileError(
      error,
      "native.unknown",
      saveParams(),
      error
    );
  }
  return new DesktopFileError(
    "保存文件失败，请重试",
    "native.unknown",
    saveParams()
  );
}

function assertFilename(filename: string): void {
  if (
    filename.length === 0 ||
    filename.length > 128 ||
    !FILENAME_RE.test(filename) ||
    filename.endsWith(".") ||
    RESERVED_NAMES.has(filename.split(".")[0]?.toUpperCase() ?? "")
  ) {
    throw new DesktopFileError(
      "导出文件名无效",
      "native.file_failed",
      saveParams(),
      "导出文件名无效"
    );
  }
}

/**
 * 仅真实 Tauri 桌面容器返回 true。网页与鸿蒙/Android 包装均不进入此分支,
 * 因此不会在浏览器里尝试调用原生命令。
 */
export function isDesktopPlatform(): boolean {
  if (typeof window === "undefined") return false;
  return isTauri();
}

let pendingWindowTitle: string | null = null;
let windowTitleRequest: Promise<void> | null = null;

/**
 * 异步更新 Tauri 主窗口标题。
 *
 * - 只在桌面容器调用；Web/Android/Harmony 直接忽略。
 * - 动态加载 window API，模块加载或原生设置失败都静默降级，不影响语言切换。
 * - 连续切换只保留最后一次标题：旧请求尚未完成时新标题覆盖 pending 值，
 *   完成后循环补上最新标题，避免旧 title 晚到覆盖新 title。
 */
export function applyDesktopWindowTitle(title: string): Promise<void> {
  if (!isDesktopPlatform()) return Promise.resolve();

  pendingWindowTitle = title;
  if (windowTitleRequest) return windowTitleRequest;

  windowTitleRequest = (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      while (pendingWindowTitle !== null) {
        const nextTitle = pendingWindowTitle;
        pendingWindowTitle = null;
        try {
          await getCurrentWindow().setTitle(nextTitle);
        } catch {
          // 原生标题失败不能阻断语言切换；下一次切换仍会重新尝试。
        }
      }
    } catch {
      // 动态导入失败（非 Tauri 测试桩、权限缺失或平台差异）同样静默降级。
    } finally {
      windowTitleRequest = null;
    }
  })();

  return windowTitleRequest;
}

/**
 * 打开系统“另存为”对话框并写入一个文件。用户取消返回 cancelled;
 * 原生校验/写入失败抛错,由调用方映射为已有的导出错误。
 */
export async function saveDesktopFile(
  file: DesktopFile,
  options?: DesktopSaveOptions
): Promise<DesktopSaveResult> {
  if (!isDesktopPlatform()) {
    throw new DesktopFileError(
      "当前环境不支持桌面文件保存",
      "native.unsupported",
      saveParams(),
      "当前环境不支持桌面文件保存"
    );
  }
  assertFilename(file.filename);

  const args: Record<string, unknown> = {
    filename: file.filename,
    mimeType: file.mimeType,
    encoding: file.encoding,
    data: file.data,
  };
  const dialogTitle = options?.dialogTitle;
  if (typeof dialogTitle === "string" && dialogTitle.trim().length > 0) {
    args.dialogTitle = dialogTitle;
  }

  let reply: unknown;
  try {
    reply = await invoke("save_export_file", args);
  } catch (error) {
    throw errorFromThrown(error);
  }

  const status = (reply as { status?: unknown } | null)?.status;
  if (status === "saved") return { status: "saved" };
  if (status === "cancelled") return { status: "cancelled" };
  const message = "原生文件保存返回了无效响应";
  throw new DesktopFileError(
    message,
    "native.unknown",
    saveParams(),
    message
  );
}
