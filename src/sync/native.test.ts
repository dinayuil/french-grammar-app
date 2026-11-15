import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import type { SyncRequest } from "./types";
import { DAV_PROPERTY_QUERY } from "./types";

const mocks = vi.hoisted(() => {
  const readConfig = vi.fn();
  const writeConfig = vi.fn();
  const disconnect = vi.fn();
  const request = vi.fn();
  const isNativePlatform = vi.fn(() => false);
  const getPlatform = vi.fn(() => "web");
  const registerPlugin = vi.fn();
  return {
    readConfig,
    writeConfig,
    disconnect,
    request,
    isNativePlatform,
    getPlatform,
    registerPlugin,
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
  registerPlugin: mocks.registerPlugin,
}));

import { getSyncAdapter, isSyncAvailable } from "./native";

type Invoke = (requestJson: string) => Promise<string>;
type InvokeMock = Mock<Invoke>;

function installHarmony(invoke: InvokeMock): void {
  Object.defineProperty(window, "fgeHarmony", {
    configurable: true,
    value: { invoke },
  });
}

function installTauri(invoke: (command: string, args?: unknown) => Promise<unknown>): void {
  Object.defineProperty(window, "isTauri", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke },
  });
}

function clearGlobals(): void {
  delete (window as unknown as Record<string, unknown>).fgeHarmony;
  delete (window as unknown as Record<string, unknown>).isTauri;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

function sentRequest(invoke: InvokeMock, index = 0): Record<string, unknown> {
  const call = invoke.mock.calls[index];
  if (!call) throw new Error("bridge was not called");
  return JSON.parse(call[0]) as Record<string, unknown>;
}

const CONFIG = {
  url: "https://dav.example.com/progress",
  username: "learner",
  autoSync: true,
  hasPassword: true,
};

const OK_CONFIG = JSON.stringify({ status: "ok", config: CONFIG });

const FILENAME =
  __FGE_EDITION__ === "internal"
    ? "fge-progress-internal.json"
    : "fge-progress-public.json";
const OTHER_FILENAME =
  __FGE_EDITION__ === "internal"
    ? "fge-progress-public.json"
    : "fge-progress-internal.json";

const REQUEST: SyncRequest = {
  method: "GET",
  filename: FILENAME,
  headers: { Accept: "application/json", "If-None-Match": '*' },
};

const RESPONSE = {
  status: 200,
  headers: { etag: '"v1"', "content-type": "application/json" },
  body: '{"format":"fge-sync"}',
};

beforeEach(() => {
  vi.clearAllMocks();
  clearGlobals();
  mocks.isNativePlatform.mockReturnValue(false);
  mocks.getPlatform.mockReturnValue("web");
  mocks.registerPlugin.mockReturnValue({
    readConfig: mocks.readConfig,
    writeConfig: mocks.writeConfig,
    disconnect: mocks.disconnect,
    request: mocks.request,
  });
});

afterEach(() => {
  clearGlobals();
  vi.restoreAllMocks();
});

describe("isSyncAvailable", () => {
  test("普通网页不可用，也不注册插件", () => {
    expect(isSyncAvailable()).toBe(false);
    expect(getSyncAdapter()).toBeNull();
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
  });

  test("鸿蒙桥存在时可用", () => {
    installHarmony(vi.fn<Invoke>(async () => OK_CONFIG));
    expect(isSyncAvailable()).toBe(true);
    expect(getSyncAdapter()).not.toBeNull();
    // 可用性判断是纯检测：不读取配置、不发请求。
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
  });

  test("仅 Capacitor Android 原生容器可用", () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
    expect(isSyncAvailable()).toBe(true);

    mocks.getPlatform.mockReturnValue("ios");
    expect(isSyncAvailable()).toBe(false);

    mocks.getPlatform.mockReturnValue("web");
    expect(isSyncAvailable()).toBe(false);
  });

  test("Tauri 注入标记存在且可 invoke 时可用", () => {
    installTauri(async () => null);
    expect(isSyncAvailable()).toBe(true);
  });

  test("半注入的 Tauri 标记不误判", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: "not-a-function" },
    });
    expect(isSyncAvailable()).toBe(false);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

    Object.defineProperty(window, "isTauri", {
      configurable: true,
      value: true,
    });
    expect(isSyncAvailable()).toBe(false);
  });
});

describe("鸿蒙 adapter", () => {
  test("readConfig 走 syncReadConfig 并返回脱敏配置", async () => {
    const invoke = vi.fn<Invoke>(async () => OK_CONFIG);
    installHarmony(invoke);

    await expect(getSyncAdapter()!.readConfig()).resolves.toEqual(CONFIG);
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncReadConfig",
    });
  });

  test("readConfig 未配置时返回 null", async () => {
    installHarmony(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(getSyncAdapter()!.readConfig()).resolves.toBeNull();
  });

  test("readConfig 丢弃原生多返回的敏感字段", async () => {
    installHarmony(
      vi.fn<Invoke>(async () =>
        JSON.stringify({
          status: "ok",
          config: { ...CONFIG, password: "secret" },
        })
      )
    );
    await expect(getSyncAdapter()!.readConfig()).resolves.toEqual(CONFIG);
  });

  test("writeConfig 转发可选密码；未提供时不发送密码键", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);
    const adapter = getSyncAdapter()!;

    await adapter.writeConfig(
      { url: CONFIG.url, username: CONFIG.username, autoSync: false },
      "app-password"
    );
    expect(sentRequest(invoke, 0)).toEqual({
      version: 1,
      operation: "syncWriteConfig",
      config: { url: CONFIG.url, username: CONFIG.username, autoSync: false },
      password: "app-password",
    });

    await adapter.writeConfig({
      url: CONFIG.url,
      username: CONFIG.username,
      autoSync: true,
    });
    const second = sentRequest(invoke, 1);
    expect(second).toEqual({
      version: 1,
      operation: "syncWriteConfig",
      config: { url: CONFIG.url, username: CONFIG.username, autoSync: true },
    });
    expect("password" in second).toBe(false);
  });

  test("writeConfig 允许 HTTP/HTTPS,拒绝其它 scheme/userinfo/query/fragment", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);
    const adapter = getSyncAdapter()!;
    const base = { username: CONFIG.username, autoSync: true };

    await expect(
      adapter.writeConfig({ ...base, url: "http://192.168.1.10:8080/dav" })
    ).resolves.toBeUndefined();
    await expect(
      adapter.writeConfig({ ...base, url: "https://dav.example.com/root" })
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);

    for (const url of [
      "ftp://dav.example.com/root",
      "https://user:password@dav.example.com/root",
      "https://dav.example.com/root?token=1",
      "https://dav.example.com/root#fragment",
      "not-a-url",
    ]) {
      await expect(adapter.writeConfig({ ...base, url })).rejects.toThrow(/地址/);
    }
  });

  test("disconnect 走 syncDisconnect", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);
    await getSyncAdapter()!.disconnect();
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncDisconnect",
    });
  });

  test("request 转发固定格式并返回响应", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({ status: "ok", response: RESPONSE })
    );
    installHarmony(invoke);

    await expect(getSyncAdapter()!.request(REQUEST)).resolves.toEqual(RESPONSE);
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncRequest",
      request: REQUEST,
    });
  });

  test("request 的 error 回复转为可展示错误", async () => {
    installHarmony(
      vi.fn<Invoke>(async () =>
        JSON.stringify({ status: "error", message: "同步请求失败" })
      )
    );
    await expect(getSyncAdapter()!.request(REQUEST)).rejects.toThrow(
      "同步请求失败"
    );
  });
});

describe("请求边界", () => {
  test("调用方文件名必须匹配当前 edition", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);

    await expect(
      getSyncAdapter()!.request({ ...REQUEST, filename: OTHER_FILENAME })
    ).rejects.toThrow(/文件名/);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("只允许 GET/PUT/MKCOL/PROPFIND", async () => {
    installHarmony(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(
      getSyncAdapter()!.request({
        ...REQUEST,
        method: "POST" as SyncRequest["method"],
      })
    ).rejects.toThrow(/方法/);
    await expect(
      getSyncAdapter()!.request({
        ...REQUEST,
        method: "DELETE" as SyncRequest["method"],
      })
    ).rejects.toThrow(/方法/);
  });

  test("MKCOL 使用固定 edition 文件名且不能带正文", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({ status: "ok", response: { status: 201, headers: {}, body: "" } })
    );
    installHarmony(invoke);
    const mkcol: SyncRequest = {
      method: "MKCOL",
      filename: FILENAME,
      headers: {},
    };

    await expect(getSyncAdapter()!.request(mkcol)).resolves.toEqual({
      status: 201,
      headers: {},
      body: "",
    });
    expect(sentRequest(invoke).request).toEqual(mkcol);

    await expect(
      getSyncAdapter()!.request({ ...mkcol, filename: OTHER_FILENAME })
    ).rejects.toThrow(/文件名/);
    await expect(
      getSyncAdapter()!.request({ ...mkcol, body: "{}" })
    ).rejects.toThrow(/请求体/);
  });

  test("PROPFIND 只允许 Depth: 0 与固定属性查询", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({ status: "ok", response: { status: 207, headers: {}, body: "" } })
    );
    installHarmony(invoke);
    const propfind: SyncRequest = {
      method: "PROPFIND",
      filename: FILENAME,
      headers: { Depth: "0", "Content-Type": "application/xml" },
      body: DAV_PROPERTY_QUERY,
    };

    await expect(getSyncAdapter()!.request(propfind)).resolves.toEqual({
      status: 207,
      headers: {},
      body: "",
    });

    await expect(
      getSyncAdapter()!.request({ ...propfind, headers: { Depth: "1" } })
    ).rejects.toThrow(/请求头/);
    await expect(
      getSyncAdapter()!.request({ ...propfind, headers: {} })
    ).rejects.toThrow(/请求头|Depth/);
    await expect(
      getSyncAdapter()!.request({ ...propfind, body: "<d:propfind/>" })
    ).rejects.toThrow(/请求体/);
    await expect(
      getSyncAdapter()!.request({ ...propfind, filename: OTHER_FILENAME })
    ).rejects.toThrow(/文件名/);
  });

  test("拒绝 Authorization 等透传请求头", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);

    await expect(
      getSyncAdapter()!.request({
        ...REQUEST,
        headers: { Accept: "application/json", Authorization: "Basic abc" },
      })
    ).rejects.toThrow(/请求头/);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("GET 不能携带请求体", async () => {
    installHarmony(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(
      getSyncAdapter()!.request({ ...REQUEST, body: "{}" })
    ).rejects.toThrow(/请求体/);
  });

  test("PUT 必须有正文", async () => {
    installHarmony(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(
      getSyncAdapter()!.request({
        method: "PUT",
        filename: FILENAME,
        headers: {},
      })
    ).rejects.toThrow(/请求体/);
  });

  test("请求体超过 5 MB 时本地拒绝", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installHarmony(invoke);

    await expect(
      getSyncAdapter()!.request({
        method: "PUT",
        filename: FILENAME,
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(5 * 1024 * 1024 + 1),
      })
    ).rejects.toThrow(/大小/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("原生载荷校验", () => {
  test("坏配置(类型不符)被拒绝", async () => {
    installHarmony(
      vi.fn<Invoke>(async () =>
        JSON.stringify({
          status: "ok",
          config: { url: 1, username: "", autoSync: true, hasPassword: false },
        })
      )
    );
    await expect(getSyncAdapter()!.readConfig()).rejects.toThrow(/配置/);
  });

  test("坏响应(状态或头无效)被拒绝", async () => {
    installHarmony(
      vi.fn<Invoke>(async () =>
        JSON.stringify({ status: "ok", response: { status: "200", headers: {}, body: "" } })
      )
    );
    await expect(getSyncAdapter()!.request(REQUEST)).rejects.toThrow(/响应/);
  });
});

describe("Capacitor Android adapter", () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
  });

  test("readConfig 使用 FgeSync 插件并读取 {config}", async () => {
    mocks.readConfig.mockResolvedValue({ config: CONFIG });
    await expect(getSyncAdapter()!.readConfig()).resolves.toEqual(CONFIG);
    expect(mocks.registerPlugin).toHaveBeenCalledWith("FgeSync");
  });

  test("writeConfig 传入可选密码", async () => {
    mocks.writeConfig.mockResolvedValue(undefined);
    const adapter = getSyncAdapter()!;
    const config = { url: CONFIG.url, username: CONFIG.username, autoSync: true };

    await adapter.writeConfig(config, "pw");
    expect(mocks.writeConfig).toHaveBeenCalledWith({ config, password: "pw" });

    await adapter.writeConfig(config);
    expect(mocks.writeConfig).toHaveBeenLastCalledWith({ config });
  });

  test("request 直接返回插件响应", async () => {
    mocks.request.mockResolvedValue({
      status: 201,
      headers: { ETag: '"v2"' },
      body: "",
    });
    await expect(getSyncAdapter()!.request(REQUEST)).resolves.toEqual({
      status: 201,
      headers: { ETag: '"v2"' },
      body: "",
    });
    expect(mocks.request).toHaveBeenCalledWith({ request: REQUEST });
  });

  test("disconnect 调用插件", async () => {
    mocks.disconnect.mockResolvedValue(undefined);
    await getSyncAdapter()!.disconnect();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("Tauri adapter", () => {
  test("使用固定命令名与参数", async () => {
    const invoke = vi.fn(async (command: string, _args?: unknown) => {
      if (command === "sync_get_config") return CONFIG;
      if (command === "sync_request") return RESPONSE;
      return undefined;
    });
    installTauri(invoke);

    const adapter = getSyncAdapter()!;
    await expect(adapter.readConfig()).resolves.toEqual(CONFIG);
    await adapter.writeConfig(
      { url: CONFIG.url, username: CONFIG.username, autoSync: true },
      "pw"
    );
    await adapter.writeConfig({
      url: CONFIG.url,
      username: CONFIG.username,
      autoSync: false,
    });
    await adapter.disconnect();
    await expect(adapter.request(REQUEST)).resolves.toEqual(RESPONSE);

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "sync_get_config",
      "sync_set_config",
      "sync_set_config",
      "sync_disconnect",
      "sync_request",
    ]);
    expect(invoke.mock.calls[1][1]).toEqual({
      config: { url: CONFIG.url, username: CONFIG.username, autoSync: true },
      password: "pw",
    });
    expect(invoke.mock.calls[2][1]).toEqual({
      config: { url: CONFIG.url, username: CONFIG.username, autoSync: false },
    });
    expect(invoke.mock.calls[4][1]).toEqual({ request: REQUEST });
  });

  test("Tauri 返回空配置时为 null", async () => {
    installTauri(async () => null);
    await expect(getSyncAdapter()!.readConfig()).resolves.toBeNull();
  });
});

describe("平台优先级", () => {
  test("鸿蒙桥优先于 Capacitor", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
    const invoke = vi.fn<Invoke>(async () => OK_CONFIG);
    installHarmony(invoke);

    await expect(getSyncAdapter()!.readConfig()).resolves.toEqual(CONFIG);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
  });
});
