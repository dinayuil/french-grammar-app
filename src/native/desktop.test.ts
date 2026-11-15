import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const coreMock = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => coreMock);

import {
  isDesktopPlatform,
  saveDesktopFile,
} from "./desktop";

beforeEach(() => {
  coreMock.isTauri.mockReset();
  coreMock.invoke.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isDesktopPlatform", () => {
  test("only reports true when the Tauri marker is present", () => {
    coreMock.isTauri.mockReturnValue(false);
    expect(isDesktopPlatform()).toBe(false);

    coreMock.isTauri.mockReturnValue(true);
    expect(isDesktopPlatform()).toBe(true);
  });
});

describe("saveDesktopFile", () => {
  test("passes a bounded JSON export to the narrow native command", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockResolvedValue({ status: "saved" });

    const result = await saveDesktopFile({
      filename: "fge-progress-public-2026-11-15.json",
      mimeType: "application/json",
      encoding: "utf8",
      data: "{}",
    });

    expect(result).toEqual({ status: "saved" });
    expect(coreMock.invoke).toHaveBeenCalledWith("save_export_file", {
      filename: "fge-progress-public-2026-11-15.json",
      mimeType: "application/json",
      encoding: "utf8",
      data: "{}",
    });
  });

  test("maps the native dialog cancellation to cancelled", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockResolvedValue({ status: "cancelled" });

    await expect(
      saveDesktopFile({
        filename: "fge-stats-2026-11-15.png",
        mimeType: "image/png",
        encoding: "base64",
        data: "aGVsbG8=",
      })
    ).resolves.toEqual({ status: "cancelled" });
  });

  test("rejects invalid filenames before invoking native code", async () => {
    coreMock.isTauri.mockReturnValue(true);

    for (const filename of [
      "../evil.json",
      "sub/evil.json",
      ".hidden.json",
      "CON.json",
      "fge.json.",
      "",
    ]) {
      await expect(
        saveDesktopFile({
          filename,
          mimeType: "application/json",
          encoding: "utf8",
          data: "{}",
        })
      ).rejects.toThrow(/文件名/);
    }
    expect(coreMock.invoke).not.toHaveBeenCalled();
  });

  test("surfaces native failures and rejects malformed replies", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockRejectedValueOnce("无法写入导出文件");
    await expect(
      saveDesktopFile({
        filename: "fge.json",
        mimeType: "application/json",
        encoding: "utf8",
        data: "{}",
      })
    ).rejects.toThrow("无法写入导出文件");

    coreMock.invoke.mockResolvedValueOnce({ status: "unknown" });
    await expect(
      saveDesktopFile({
        filename: "fge.json",
        mimeType: "application/json",
        encoding: "utf8",
        data: "{}",
      })
    ).rejects.toThrow(/无效响应/);
  });

  test("refuses to run outside the desktop container", async () => {
    coreMock.isTauri.mockReturnValue(false);
    await expect(
      saveDesktopFile({
        filename: "fge.json",
        mimeType: "application/json",
        encoding: "utf8",
        data: "{}",
      })
    ).rejects.toThrow(/不支持/);
    expect(coreMock.invoke).not.toHaveBeenCalled();
  });
});
