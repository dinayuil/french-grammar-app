import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import {
  HarmonyBridgeError,
  applyHarmonyTheme,
  disconnectHarmonySync,
  isHarmonyPlatform,
  readHarmonySyncConfig,
  requestHarmonySync,
  shareHarmonyFile,
  writeHarmonySyncConfig,
} from "./platform";
import { DAV_PROPERTY_QUERY } from "../sync/types";

type Invoke = (requestJson: string) => Promise<string>;
type InvokeMock = Mock<Invoke>;

function installBridge(invoke: InvokeMock): void {
  Object.defineProperty(window, "fgeHarmony", {
    configurable: true,
    value: { invoke },
  });
}

function removeBridge(): void {
  delete (window as unknown as Record<string, unknown>).fgeHarmony;
}

function sentRequest(invoke: InvokeMock): Record<string, unknown> {
  expect(invoke).toHaveBeenCalledTimes(1);
  return JSON.parse(invoke.mock.calls[0][0]) as Record<string, unknown>;
}

function sentAt(invoke: InvokeMock, index: number): Record<string, unknown> {
  const call = invoke.mock.calls[index];
  if (!call) throw new Error(`bridge call ${index} was not made`);
  return JSON.parse(call[0]) as Record<string, unknown>;
}

beforeEach(() => {
  removeBridge();
});

afterEach(() => {
  removeBridge();
  vi.restoreAllMocks();
});

describe("isHarmonyPlatform", () => {
  test("未注入 fgeHarmony 时不是鸿蒙", () => {
    expect(isHarmonyPlatform()).toBe(false);
  });

  test("存在 invoke 函数时识别为鸿蒙", () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    expect(isHarmonyPlatform()).toBe(true);
  });

  test("fgeHarmony 缺少 invoke 或不是对象时不误判", () => {
    Object.defineProperty(window, "fgeHarmony", {
      configurable: true,
      value: { invoke: "not-a-function" },
    });
    expect(isHarmonyPlatform()).toBe(false);

    Object.defineProperty(window, "fgeHarmony", {
      configurable: true,
      value: "harmony",
    });
    expect(isHarmonyPlatform()).toBe(false);

    Object.defineProperty(window, "fgeHarmony", {
      configurable: true,
      value: null,
    });
    expect(isHarmonyPlatform()).toBe(false);
  });
});

describe("shareHarmonyFile", () => {
  test("按锁定协议发送 shareFile 请求 → shared", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installBridge(invoke);

    const result = await shareHarmonyFile({
      filename: "fge-stats-2026-11-15.png",
      mimeType: "image/png",
      encoding: "base64",
      data: "QUJD",
    });

    expect(result).toEqual({ status: "shared" });
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "shareFile",
      filename: "fge-stats-2026-11-15.png",
      mimeType: "image/png",
      encoding: "base64",
      data: "QUJD",
    });
  });

  test("用户取消原生分享 → cancelled,不抛错", async () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"cancelled"}'));

    await expect(
      shareHarmonyFile({
        filename: "a.json",
        mimeType: "application/json",
        encoding: "utf8",
        data: "{}",
      })
    ).resolves.toEqual({ status: "cancelled" });
  });

  test("error 响应携带 message → HarmonyBridgeError,保留可展示信息", async () => {
    installBridge(
      vi.fn<Invoke>(async () =>
        JSON.stringify({ status: "error", message: "没有可用的分享目标" })
      )
    );

    const result = shareHarmonyFile({
      filename: "a.png",
      mimeType: "image/png",
      encoding: "base64",
      data: "QUJD",
    });

    await expect(result).rejects.toBeInstanceOf(HarmonyBridgeError);
    await expect(result).rejects.toThrow("没有可用的分享目标");
  });

  test("error 响应缺少 message → 使用可知的默认错误", async () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"error"}'));

    await expect(
      shareHarmonyFile({
        filename: "a.png",
        mimeType: "image/png",
        encoding: "base64",
        data: "QUJD",
      })
    ).rejects.toThrow(/分享/);
  });

  test.each([
    ["非 JSON", "oops"],
    ["空字符串", ""],
    ["非对象", "[]"],
    ["未知状态", '{"status":"done"}'],
    ["缺少状态", "{}"],
  ])("坏响应(%s) → HarmonyBridgeError", async (_name, reply) => {
    installBridge(vi.fn<Invoke>(async () => reply));

    await expect(
      shareHarmonyFile({
        filename: "a.png",
        mimeType: "image/png",
        encoding: "base64",
        data: "QUJD",
      })
    ).rejects.toBeInstanceOf(HarmonyBridgeError);
  });

  test("桥调用 reject → HarmonyBridgeError 保留原始 message", async () => {
    installBridge(
      vi.fn<Invoke>(async () => {
        throw new Error("permission denied");
      })
    );

    await expect(
      shareHarmonyFile({
        filename: "a.png",
        mimeType: "image/png",
        encoding: "base64",
        data: "QUJD",
      })
    ).rejects.toThrow("permission denied");
  });

  test("没有鸿蒙桥时直接失败,不降级为其他平台", async () => {
    await expect(
      shareHarmonyFile({
        filename: "a.png",
        mimeType: "image/png",
        encoding: "base64",
        data: "QUJD",
      })
    ).rejects.toBeInstanceOf(HarmonyBridgeError);
  });
});

describe("applyHarmonyTheme", () => {
  test("发送 applyTheme 请求且区分亮暗", () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installBridge(invoke);

    applyHarmonyTheme("dark");

    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "applyTheme",
      mode: "dark",
    });
  });

  test("桥失败或坏响应只吞掉错误,不影响调用方", async () => {
    const invoke = vi.fn<Invoke>(async () => "oops");
    installBridge(invoke);

    expect(() => applyHarmonyTheme("light")).not.toThrow();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);

    installBridge(
      vi.fn<Invoke>(async () => {
        throw new Error("bridge down");
      })
    );
    expect(() => applyHarmonyTheme("dark")).not.toThrow();
    await Promise.resolve();
  });

  test("没有鸿蒙桥时 no-op", () => {
    expect(() => applyHarmonyTheme("dark")).not.toThrow();
  });
});

describe("鸿蒙同步桥", () => {
  const config = {
    url: "https://dav.example.com/progress",
    username: "learner",
    autoSync: true,
    hasPassword: true,
  };
  const request = {
    method: "PUT" as const,
    filename:
      __FGE_EDITION__ === "internal"
        ? "fge-progress-internal.json"
        : "fge-progress-public.json",
    headers: { "Content-Type": "application/json", "If-Match": '"v1"' },
    body: '{"format":"fge-sync"}',
  };

  test("syncReadConfig 按锁定协议发送并返回配置", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({ status: "ok", config })
    );
    installBridge(invoke);

    await expect(readHarmonySyncConfig()).resolves.toEqual(config);
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncReadConfig",
    });
  });

  test("syncReadConfig 无配置 → null，多余敏感字段被丢弃", async () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(readHarmonySyncConfig()).resolves.toBeNull();

    installBridge(
      vi.fn<Invoke>(async () =>
        JSON.stringify({
          status: "ok",
          config: { ...config, password: "secret" },
        })
      )
    );
    await expect(readHarmonySyncConfig()).resolves.toEqual(config);
  });

  test("syncReadConfig error → HarmonyBridgeError", async () => {
    installBridge(
      vi.fn<Invoke>(async () =>
        JSON.stringify({ status: "error", message: "同步凭据不可用" })
      )
    );
    await expect(readHarmonySyncConfig()).rejects.toThrow("同步凭据不可用");
  });

  test("坏配置整体拒绝，不返回半份配置", async () => {
    installBridge(
      vi.fn<Invoke>(async () =>
        JSON.stringify({
          status: "ok",
          config: { url: config.url, username: 1, autoSync: true, hasPassword: true },
        })
      )
    );
    await expect(readHarmonySyncConfig()).rejects.toThrow(/配置/);
  });

  test("syncWriteConfig 转发可选密码；缺省时不含密码键", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installBridge(invoke);
    const settings = {
      url: config.url,
      username: config.username,
      autoSync: false,
    };

    await writeHarmonySyncConfig(settings, "pw");
    expect(sentAt(invoke, 0)).toEqual({
      version: 1,
      operation: "syncWriteConfig",
      config: settings,
      password: "pw",
    });

    await writeHarmonySyncConfig(settings);
    const second = sentAt(invoke, 1);
    expect(second).toEqual({
      version: 1,
      operation: "syncWriteConfig",
      config: settings,
    });
    expect("password" in second).toBe(false);
  });

  test("syncWriteConfig 允许 HTTP,拒绝非法 URL", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installBridge(invoke);
    const settings = {
      url: "http://127.0.0.1:8080/dav",
      username: config.username,
      autoSync: true,
    };

    await writeHarmonySyncConfig(settings);
    expect(sentAt(invoke, 0)).toEqual({
      version: 1,
      operation: "syncWriteConfig",
      config: settings,
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    await expect(
      writeHarmonySyncConfig({ ...settings, url: "ftp://dav.example.com/root" })
    ).rejects.toThrow(/地址/);
    await expect(
      writeHarmonySyncConfig({
        ...settings,
        url: "https://user:password@dav.example.com/root",
      })
    ).rejects.toThrow(/地址/);
  });

  test("syncDisconnect 按锁定协议发送", async () => {
    const invoke = vi.fn<Invoke>(async () => '{"status":"ok"}');
    installBridge(invoke);
    await disconnectHarmonySync();
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncDisconnect",
    });
  });

  test("syncRequest 返回响应并保留头名大小写", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({
        status: "ok",
        response: {
          status: 200,
          headers: { ETag: '"v1"', "Content-Type": "application/json" },
          body: '{"format":"fge-sync"}',
        },
      })
    );
    installBridge(invoke);

    await expect(requestHarmonySync(request)).resolves.toEqual({
      status: 200,
      headers: { ETag: '"v1"', "Content-Type": "application/json" },
      body: '{"format":"fge-sync"}',
    });
    expect(sentRequest(invoke)).toEqual({
      version: 1,
      operation: "syncRequest",
      request,
    });
  });

  test("syncRequest 转发 MKCOL 与 PROPFIND 形状", async () => {
    const invoke = vi.fn<Invoke>(async () =>
      JSON.stringify({
        status: "ok",
        response: { status: 207, headers: {}, body: "" },
      })
    );
    installBridge(invoke);
    const mkcol = {
      method: "MKCOL" as const,
      filename: request.filename,
      headers: {},
    };
    await expect(requestHarmonySync(mkcol)).resolves.toEqual({
      status: 207,
      headers: {},
      body: "",
    });
    expect(sentAt(invoke, 0)).toEqual({
      version: 1,
      operation: "syncRequest",
      request: mkcol,
    });

    const propfind = {
      method: "PROPFIND" as const,
      filename: request.filename,
      headers: { Depth: "0", "Content-Type": "application/xml" },
      body: DAV_PROPERTY_QUERY,
    };
    await expect(requestHarmonySync(propfind)).resolves.toEqual({
      status: 207,
      headers: {},
      body: "",
    });
    expect(sentAt(invoke, 1)).toEqual({
      version: 1,
      operation: "syncRequest",
      request: propfind,
    });
  });

  test("syncRequest 拒绝非法 Depth、正文与方法", async () => {
    {
      const invoke = vi.fn<Invoke>(
        async () => '{"status":"ok","response":{"status":207,"headers":{},"body":""}}'
      );
      installBridge(invoke);
      await expect(
        requestHarmonySync({
          method: "PROPFIND",
          filename: request.filename,
          headers: { Depth: "1" },
        })
      ).rejects.toThrow(/请求|Depth/);
      await expect(
        requestHarmonySync({
          method: "PROPFIND",
          filename: request.filename,
          headers: { Depth: "0" },
          body: "<d:propfind/>",
        })
      ).rejects.toThrow(/请求体/);
      await expect(
        requestHarmonySync({
          method: "MKCOL",
          filename: request.filename,
          headers: {},
          body: "{}",
        })
      ).rejects.toThrow(/请求体/);
      await expect(
        requestHarmonySync({
          method: "DELETE",
          filename: request.filename,
          headers: {},
        } as never)
      ).rejects.toThrow(/请求/);
      await expect(
        requestHarmonySync({
          method: "GET",
          filename:
            request.filename === "fge-progress-public.json"
              ? "fge-progress-internal.json"
              : "fge-progress-public.json",
          headers: {},
        })
      ).rejects.toThrow(/请求/);
      await expect(
        requestHarmonySync({
          method: "GET",
          filename: request.filename,
          headers: { Authorization: "Basic abc" },
        })
      ).rejects.toThrow(/请求/);
    }
  });

  test("syncRequest 缺少 response 或状态非法 → 无效响应", async () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"ok"}'));
    await expect(requestHarmonySync(request)).rejects.toBeInstanceOf(
      HarmonyBridgeError
    );

    installBridge(
      vi.fn<Invoke>(async () =>
        JSON.stringify({
          status: "ok",
          response: { status: 200, headers: {}, body: 1 },
        })
      )
    );
    await expect(requestHarmonySync(request)).rejects.toThrow(/响应/);
  });

  test("同步 operation 的坏外层回复 → HarmonyBridgeError", async () => {
    installBridge(vi.fn<Invoke>(async () => '{"status":"ok","config":{}}'));
    await expect(readHarmonySyncConfig()).rejects.toThrow(/配置/);

    installBridge(vi.fn<Invoke>(async () => "oops"));
    await expect(readHarmonySyncConfig()).rejects.toBeInstanceOf(
      HarmonyBridgeError
    );
  });
});
