import { invoke, isTauri } from "@tauri-apps/api/core";

/** 桌面原生保存参数;数据仍由 WebView 生成,原生只负责校验与保存。 */
export interface DesktopFile {
  filename: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  data: string;
}

export type DesktopSaveResult =
  | { status: "saved" }
  | { status: "cancelled" };

const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

function assertFilename(filename: string): void {
  if (
    filename.length === 0 ||
    filename.length > 128 ||
    !FILENAME_RE.test(filename) ||
    filename.endsWith(".") ||
    RESERVED_NAMES.has(filename.split(".")[0]?.toUpperCase() ?? "")
  ) {
    throw new Error("导出文件名无效");
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

/**
 * 打开系统“另存为”对话框并写入一个文件。用户取消返回 cancelled;
 * 原生校验/写入失败抛错,由调用方映射为已有的导出错误。
 */
export async function saveDesktopFile(
  file: DesktopFile
): Promise<DesktopSaveResult> {
  if (!isDesktopPlatform()) {
    throw new Error("当前环境不支持桌面文件保存");
  }
  assertFilename(file.filename);

  let reply: unknown;
  try {
    reply = await invoke("save_export_file", {
      filename: file.filename,
      mimeType: file.mimeType,
      encoding: file.encoding,
      data: file.data,
    });
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    if (typeof error === "string" && error) throw new Error(error);
    throw new Error("保存文件失败，请重试");
  }

  const status = (reply as { status?: unknown } | null)?.status;
  if (status === "saved") return { status: "saved" };
  if (status === "cancelled") return { status: "cancelled" };
  throw new Error("原生文件保存返回了无效响应");
}
