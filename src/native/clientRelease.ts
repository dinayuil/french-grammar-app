import { Capacitor, registerPlugin } from "@capacitor/core";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopPlatform } from "./desktop";
import { isHarmonyPlatform } from "./platform";

const RELEASE_API =
  "https://api.github.com/repos/dinayuil/french-grammar-app/releases/tags/client-latest";

const PLATFORM_ASSETS = {
  android: ["app-public-debug.apk"],
  windows: [
    "fge-windows-public-standard-setup.exe",
    "fge-windows-public-offline-setup.exe",
  ],
} as const;

type ReleasePlatform = keyof typeof PLATFORM_ASSETS;

const androidRelease = registerPlugin<{ openRelease(): Promise<void> }>("FgeRelease");

export function getReleasePlatform(): ReleasePlatform | null {
  if (__FGE_EDITION__ !== "public" || isHarmonyPlatform()) return null;
  if (isDesktopPlatform()) return "windows";
  return Capacitor.getPlatform() === "android" ? "android" : null;
}

export function releaseVersionName(code: number): string {
  return `1.0-test.${code}`;
}

export function openClientRelease(platform: ReleasePlatform): Promise<void> {
  return platform === "windows"
    ? invoke<void>("open_client_release")
    : androidRelease.openRelease();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchReleaseCode(
  platform: ReleasePlatform,
  signal: AbortSignal,
): Promise<number> {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Release request failed (${response.status})`);

  const release: unknown = await response.json();
  if (
    !isRecord(release) ||
    release.tag_name !== "client-latest" ||
    release.draft !== false ||
    typeof release.body !== "string" ||
    !Array.isArray(release.assets)
  ) {
    throw new Error("Invalid client release");
  }

  const codes = [...release.body.matchAll(/^- versionCode: `([^`\r\n]+)`\r?$/gm)];
  const names = [...release.body.matchAll(/^- versionName: `([^`\r\n]+)`\r?$/gm)];
  const rawCode = codes[0]?.[1] ?? "";
  const code = Number(rawCode);
  if (
    codes.length !== 1 ||
    names.length !== 1 ||
    !/^[1-9][0-9]{0,9}$/.test(rawCode) ||
    code > 2_100_000_000 ||
    names[0]?.[1] !== releaseVersionName(code)
  ) {
    throw new Error("Invalid client release version");
  }

  const assets = release.assets.filter(isRecord);
  if (!PLATFORM_ASSETS[platform].every((name) =>
    assets.some((asset) => asset.name === name && asset.state === "uploaded"),
  )) {
    throw new Error("Missing client release assets");
  }
  return code;
}
