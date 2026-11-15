/**
 * 客户端原生 WebDAV 同步适配器。
 *
 * 只在真实原生容器(Harmony ArkWeb 桥 / Capacitor Android / Tauri)暴露;
 * 网页端不探测配置、不发起网络请求。所有 URL、认证、重定向、超时和
 * 5 MB 限额都由原生执行,JS 侧只做固定文件名与请求形状的快速校验。
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import {
  disconnectHarmonySync,
  isHarmonyPlatform,
  parseNativeSyncConfig,
  parseNativeSyncResponse,
  readHarmonySyncConfig,
  requestHarmonySync,
  writeHarmonySyncConfig,
} from "../native/platform";
import type { SyncAdapter, SyncRequest, SyncSettings } from "./types";
import { DAV_PROPERTY_QUERY, validateSyncRootUrl } from "./types";

const SYNC_MAX_BYTES = 5 * 1024 * 1024;
const SYNC_FILENAME =
  __FGE_EDITION__ === "internal"
    ? "fge-progress-internal.json"
    : "fge-progress-public.json";
const SYNC_METHODS = new Set(["GET", "PUT", "MKCOL", "PROPFIND"]);
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "if-match",
  "if-none-match",
  "depth",
]);

interface FgeSyncPlugin {
  readConfig(): Promise<unknown>;
  writeConfig(options: {
    config: SyncSettings;
    password?: string;
  }): Promise<void>;
  disconnect(): Promise<void>;
  request(options: { request: SyncRequest }): Promise<unknown>;
}

let registeredPlugin: FgeSyncPlugin | undefined;

/** 只在真正使用同步时才注册 Capacitor 插件。 */
function getPlugin(): FgeSyncPlugin {
  registeredPlugin ??= registerPlugin<FgeSyncPlugin>("FgeSync");
  return registeredPlugin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length * 3;
}

/**
 * 与 desktop.ts 一致使用 @tauri-apps/api/core;同时要求真正的 IPC 注入,
 * 避免仅有 isTauri 标记的半注入环境误判可用。
 */
function isTauriRuntime(): boolean {
  if (typeof window === "undefined" || !isTauri()) return false;
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: unknown }
  ).__TAURI_INTERNALS__;
  return isRecord(internals) && typeof internals.invoke === "function";
}

function isCapacitorAndroid(): boolean {
  return (
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
  );
}

/** Web 版为 false;不读取配置、不注册插件。 */
export function isSyncAvailable(): boolean {
  if (isHarmonyPlatform()) return true;
  if (isTauriRuntime()) return true;
  return isCapacitorAndroid();
}

function prepareSettings(settings: SyncSettings): SyncSettings {
  if (!isRecord(settings)) fail("同步配置无效");
  const { url, username, autoSync } = settings;
  if (
    typeof url !== "string" ||
    typeof username !== "string" ||
    typeof autoSync !== "boolean" ||
    /[\r\n\0]/.test(url) ||
    /[\r\n\0]/.test(username)
  ) {
    fail("同步配置无效");
  }
  const urlError = validateSyncRootUrl(url);
  if (urlError) fail(urlError);
  return { url, username, autoSync };
}

function preparePassword(password: unknown): string {
  if (typeof password !== "string" || /[\r\n\0]/.test(password)) {
    fail("同步密码无效");
  }
  return password;
}

/**
 * 只允许固定的 GET/PUT 请求、当前 edition 的固定文件名和白名单头。
 * Authorization 由原生根据加密凭据构造,绝不从 JS 透传。
 */
function prepareRequest(request: SyncRequest): SyncRequest {
  if (!isRecord(request)) fail("同步请求无效");
  const { method, filename, headers, body } = request;

  if (!SYNC_METHODS.has(method)) {
    fail("同步请求方法无效");
  }
  if (typeof filename !== "string" || filename !== SYNC_FILENAME) {
    fail("同步文件名无效");
  }
  if (!isRecord(headers)) fail("同步请求头无效");

  const cleanHeaders: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      name.length === 0 ||
      !ALLOWED_REQUEST_HEADERS.has(lower) ||
      seen.has(lower) ||
      typeof value !== "string" ||
      /[\r\n\0]/.test(value) ||
      value.length > 8192 ||
      (lower === "depth" && value !== "0")
    ) {
      fail("同步请求头无效");
    }
    seen.add(lower);
    cleanHeaders[name] = value;
  }

  if (body !== undefined && typeof body !== "string") {
    fail("同步请求体无效");
  }
  if (method === "GET" || method === "MKCOL") {
    if (body !== undefined) fail(`${method} 请求不能携带请求体`);
  }
  if (method === "PROPFIND") {
    if (!seen.has("depth")) fail("PROPFIND 请求头无效");
    if (body !== undefined && body !== DAV_PROPERTY_QUERY) {
      fail("PROPFIND 请求体无效");
    }
  }
  if (method === "PUT") {
    if (typeof body !== "string" || body.length === 0) {
      fail("PUT 请求体无效");
    }
  }
  if (body !== undefined && utf8ByteLength(body) > SYNC_MAX_BYTES) {
    fail("同步请求超过大小上限");
  }

  const clean: SyncRequest = {
    method: method as SyncRequest["method"],
    filename,
    headers: cleanHeaders,
  };
  if (body !== undefined) clean.body = body;
  return clean;
}

const harmonyAdapter: SyncAdapter = {
  readConfig: () => readHarmonySyncConfig(),
  async writeConfig(config, password) {
    await writeHarmonySyncConfig(
      prepareSettings(config),
      password === undefined
        ? undefined
        : preparePassword(password)
    );
  },
  disconnect: () => disconnectHarmonySync(),
  async request(request) {
    return requestHarmonySync(prepareRequest(request));
  },
};

const capacitorAdapter: SyncAdapter = {
  async readConfig() {
    const result = await getPlugin().readConfig();
    if (!isRecord(result)) fail("原生同步配置无效");
    return parseNativeSyncConfig(result.config);
  },
  async writeConfig(config, password) {
    const options: { config: SyncSettings; password?: string } = {
      config: prepareSettings(config),
    };
    if (password !== undefined) {
      options.password = preparePassword(password);
    }
    await getPlugin().writeConfig(options);
  },
  async disconnect() {
    await getPlugin().disconnect();
  },
  async request(request) {
    const response = await getPlugin().request({
      request: prepareRequest(request),
    });
    return parseNativeSyncResponse(response);
  },
};

const tauriAdapter: SyncAdapter = {
  async readConfig() {
    return parseNativeSyncConfig(await tauriInvoke("sync_get_config"));
  },
  async writeConfig(config, password) {
    const args: Record<string, unknown> = {
      config: prepareSettings(config),
    };
    if (password !== undefined) {
      args.password = preparePassword(password);
    }
    await tauriInvoke("sync_set_config", args);
  },
  async disconnect() {
    await tauriInvoke("sync_disconnect");
  },
  async request(request) {
    const response = await tauriInvoke("sync_request", {
      request: prepareRequest(request),
    });
    return parseNativeSyncResponse(response);
  },
};

/** 返回当前容器的适配器;网页或未知容器返回 null。 */
export function getSyncAdapter(): SyncAdapter | null {
  if (isHarmonyPlatform()) return harmonyAdapter;
  if (isTauriRuntime()) return tauriAdapter;
  if (isCapacitorAndroid()) return capacitorAdapter;
  return null;
}
