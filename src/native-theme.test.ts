import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const apply = vi.fn();
  return {
    apply,
    Capacitor: { isNativePlatform: vi.fn() },
    registerPlugin: vi.fn(() => ({ apply })),
  };
});

vi.mock("@capacitor/core", () => mocks);

const desktopMock = vi.hoisted(() => ({
  isDesktopPlatform: vi.fn(),
  saveDesktopFile: vi.fn(),
}));

vi.mock("./native/desktop", () => desktopMock);

const windowMock = vi.hoisted(() => ({
  setTheme: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => windowMock);

import { applyNativeTheme } from "./native-theme";

function installHarmony(invoke: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, "fgeHarmony", {
    configurable: true,
    value: { invoke },
  });
}

function removeHarmony(): void {
  delete (window as unknown as Record<string, unknown>).fgeHarmony;
}

beforeEach(() => {
  vi.clearAllMocks();
  removeHarmony();
  desktopMock.isDesktopPlatform.mockReturnValue(false);
  windowMock.setTheme.mockResolvedValue(undefined);
  windowMock.getCurrentWindow.mockReturnValue({ setTheme: windowMock.setTheme });
  mocks.registerPlugin.mockReturnValue({ apply: mocks.apply });
  mocks.apply.mockResolvedValue(undefined);
});

afterEach(() => {
  removeHarmony();
});

describe("applyNativeTheme", () => {
  test("注册名为 AppTheme 的插件", () => {
    applyNativeTheme("light");
    expect(mocks.registerPlugin).toHaveBeenCalledWith("AppTheme");
  });

  test("原生平台调用 apply({mode})", () => {
    mocks.Capacitor.isNativePlatform.mockReturnValue(true);
    applyNativeTheme("dark");
    expect(mocks.apply).toHaveBeenCalledWith({ mode: "dark" });
  });

  test("Web 平台不调用原生", () => {
    mocks.Capacitor.isNativePlatform.mockReturnValue(false);
    applyNativeTheme("dark");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  test("原生调用失败被吞掉,不影响调用方", async () => {
    mocks.Capacitor.isNativePlatform.mockReturnValue(true);
    mocks.apply.mockRejectedValueOnce(new Error("not registered"));
    expect(() => applyNativeTheme("light")).not.toThrow();
    await Promise.resolve();
  });
});

describe("applyNativeTheme harmony", () => {
  test("鸿蒙桥优先于 Capacitor,发送 applyTheme 请求", () => {
    mocks.Capacitor.isNativePlatform.mockReturnValue(true);
    const invoke = vi.fn<(requestJson: string) => Promise<string>>(
      async () => '{"status":"ok"}'
    );
    installHarmony(invoke);

    applyNativeTheme("dark");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.parse(invoke.mock.calls[0][0])).toEqual({
      version: 1,
      operation: "applyTheme",
      mode: "dark",
    });
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  test("桥响应失败仍 best effort,不抛错", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("bridge down");
    });
    installHarmony(invoke);

    expect(() => applyNativeTheme("light")).not.toThrow();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("applyNativeTheme desktop", () => {
  test("Tauri 桌面通过窗口 API 同步标题栏主题,不触碰 Capacitor", async () => {
    desktopMock.isDesktopPlatform.mockReturnValue(true);

    applyNativeTheme("dark");

    await vi.waitFor(() =>
      expect(windowMock.setTheme).toHaveBeenCalledWith("dark")
    );
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  test("桌面主题失败仍是 best effort", async () => {
    desktopMock.isDesktopPlatform.mockReturnValue(true);
    windowMock.setTheme.mockRejectedValueOnce(new Error("no permission"));

    expect(() => applyNativeTheme("light")).not.toThrow();
    await vi.waitFor(() =>
      expect(windowMock.setTheme).toHaveBeenCalledWith("light")
    );
  });
});
