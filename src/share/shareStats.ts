import { Capacitor } from "@capacitor/core";
import type { Progress } from "../types";
import {
  buildStatsCardData,
  createStatsCardCanvas,
  statsCardBase64,
  statsCardBlob,
  statsCardFilename,
} from "./statsCard";

export type ShareResult =
  | { status: "shared" }
  | { status: "downloaded"; filename: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const SHARE_TITLE = "我的法语学习打卡";
const SHARE_DIALOG_TITLE = "分享打卡";
const BASE64_PNG_PREFIX = /^data:image\/png;base64,/;

function messageFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "分享失败，请重试";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** 生成分享卡并调起 Web Share / 系统分享;失败降级为下载或返回 error。 */
export async function shareStatsCard(
  progress: Progress,
  date: string
): Promise<ShareResult> {
  try {
    const filename = statsCardFilename(date);
    const canvas = createStatsCardCanvas(buildStatsCardData(progress, date));
    return Capacitor.isNativePlatform()
      ? await shareNative(canvas, filename)
      : await shareWeb(canvas, filename);
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
}

async function shareNative(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<ShareResult> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const path = `share/${filename}`;
  const data = statsCardBase64(canvas).replace(BASE64_PNG_PREFIX, "");

  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({
    title: SHARE_TITLE,
    dialogTitle: SHARE_DIALOG_TITLE,
    files: [uri],
  });

  return { status: "shared" };
}

async function shareWeb(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<ShareResult> {
  const blob = await statsCardBlob(canvas);
  const file = new File([blob], filename, { type: "image/png" });

  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: SHARE_TITLE });
      return { status: "shared" };
    } catch (error) {
      if (isAbortError(error)) return { status: "cancelled" };
      // 其它分享错误降级为下载,保证用户仍能拿到图片。
    }
  }

  return downloadBlob(blob, filename);
}

function canShareFile(file: File): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  ) {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): ShareResult {
  const link = document.createElement("a");
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    // Firefox / 部分 WebView 会忽略未挂载的 anchor,下载必须在文档内触发。
    document.body.appendChild(link);
    link.click();
    return { status: "downloaded", filename };
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  } finally {
    link.remove();
    if (url) {
      const objectUrl = url;
      // 延迟回收:立即 revoke 会让 Firefox/WebView 在下载开始前取消 blob 下载。
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }
}
