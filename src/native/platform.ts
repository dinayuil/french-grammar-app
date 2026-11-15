/**
 * 原生能力薄适配层。
 *
 * 鸿蒙只通过 ArkWeb 注入的 `window.fgeHarmony` 识别:桥存在时优先于
 * Capacitor;不存在时保持 Android Capacitor / Web 的既有分支不变。
 * 请求/响应都使用锁定的 JSON 字符串协议,不在 JS 侧推断原生平台。
 */

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

export type HarmonyRequest = HarmonyThemeRequest | HarmonyShareRequest;

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

function parseReply(raw: unknown, fallback: string): HarmonyReply {
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

  const status = (parsed as { status?: unknown }).status;
  if (status !== "ok" && status !== "cancelled" && status !== "error") {
    throw new HarmonyBridgeError(INVALID_REPLY);
  }
  if (status === "error") {
    const message = (parsed as { message?: unknown }).message;
    return {
      status,
      message:
        typeof message === "string" && message.length > 0 ? message : fallback,
    };
  }
  return { status };
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
