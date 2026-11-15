import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import {
  HarmonyBridgeError,
  applyHarmonyTheme,
  isHarmonyPlatform,
  shareHarmonyFile,
} from "./platform";

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
