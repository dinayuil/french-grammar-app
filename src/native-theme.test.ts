import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const apply = vi.fn();
  return {
    apply,
    Capacitor: { isNativePlatform: vi.fn() },
    registerPlugin: vi.fn(() => ({ apply })),
  };
});

vi.mock("@capacitor/core", () => mocks);

import { applyNativeTheme } from "./native-theme";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerPlugin.mockReturnValue({ apply: mocks.apply });
  mocks.apply.mockResolvedValue(undefined);
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
