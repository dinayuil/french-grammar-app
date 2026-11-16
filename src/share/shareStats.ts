import { Capacitor } from "@capacitor/core";
import {
  normalizeUserFacingError,
  type UserFacingError,
} from "../i18n/errors";
import { t } from "../i18n/messages";
import type { SharingKey } from "../i18n/sharing.zh-CN";
import type { UiLocale } from "../i18n/types";
import type { Progress } from "../types";
import { isDesktopPlatform, saveDesktopFile } from "../native/desktop";
import { isHarmonyPlatform, shareHarmonyFile } from "../native/platform";
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
  | {
      status: "error";
      /** 兼容旧调用方的技术诊断；不得再作为用户主文案。 */
      message: string;
      error?: UserFacingError;
    };

const BASE64_PNG_PREFIX = /^data:image\/png;base64,/;

type SharingTranslate = (locale: UiLocale, key: SharingKey) => string;

/**
 * 分享域的文案同样走核心 t；根目录聚合前会抛缺失键，不在此复制中文回退。
 * 聚合完成后可移除这层类型收窄。
 */
const translateSharing = t as unknown as SharingTranslate;

function sharingText(locale: UiLocale, key: SharingKey): string {
  return translateSharing(locale, key);
}

/**
 * 捕获的异常统一保留结构化 code/params/diagnostic。`message` 仅作旧调用方
 * 兼容诊断，界面必须通过 formatUserError 按当前语言生成主提示。
 */
function errorResult(error: unknown): Extract<ShareResult, { status: "error" }> {
  const normalized = normalizeUserFacingError(error);
  return {
    status: "error",
    message: normalized.diagnostic ?? normalized.code,
    error: normalized,
  };
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
  date: string,
  locale: UiLocale = "zh-CN"
): Promise<ShareResult> {
  try {
    const filename = statsCardFilename(date, locale);
    const canvas = createStatsCardCanvas(
      buildStatsCardData(progress, date, locale)
    );
    if (isHarmonyPlatform()) {
      const result = await shareHarmonyFile({
        filename,
        mimeType: "image/png",
        encoding: "base64",
        data: statsCardBase64(canvas).replace(BASE64_PNG_PREFIX, ""),
      });
      return result.status === "cancelled"
        ? { status: "cancelled" }
        : { status: "shared" };
    }
    if (isDesktopPlatform()) {
      const result = await saveDesktopFile(
        {
          filename,
          mimeType: "image/png",
          encoding: "base64",
          data: statsCardBase64(canvas).replace(BASE64_PNG_PREFIX, ""),
        },
        { dialogTitle: sharingText(locale, "sharing.share.saveDialogTitle") }
      );
      return result.status === "cancelled"
        ? { status: "cancelled" }
        : { status: "downloaded", filename };
    }
    return Capacitor.isNativePlatform()
      ? await shareNative(canvas, filename, locale)
      : await shareWeb(canvas, filename, locale);
  } catch (error) {
    return errorResult(error);
  }
}

async function shareNative(
  canvas: HTMLCanvasElement,
  filename: string,
  locale: UiLocale
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
    title: sharingText(locale, "sharing.share.title"),
    dialogTitle: sharingText(locale, "sharing.share.dialogTitle"),
    files: [uri],
  });

  return { status: "shared" };
}

async function shareWeb(
  canvas: HTMLCanvasElement,
  filename: string,
  locale: UiLocale
): Promise<ShareResult> {
  const blob = await statsCardBlob(canvas);
  const file = new File([blob], filename, { type: "image/png" });

  if (canShareFile(file)) {
    try {
      await navigator.share({
        files: [file],
        title: sharingText(locale, "sharing.share.title"),
      });
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
    return errorResult(error);
  } finally {
    link.remove();
    if (url) {
      const objectUrl = url;
      // 延迟回收:立即 revoke 会让 Firefox/WebView 在下载开始前取消 blob 下载。
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }
}
