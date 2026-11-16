import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const coreMock = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

const windowMock = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  setTitle: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => coreMock);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMock.getCurrentWindow,
}));

import {
  applyDesktopWindowTitle,
  isDesktopPlatform,
  saveDesktopFile,
} from "./desktop";

beforeEach(() => {
  coreMock.isTauri.mockReset();
  coreMock.invoke.mockReset();
  windowMock.getCurrentWindow.mockReset().mockReturnValue({
    setTitle: windowMock.setTitle,
  });
  windowMock.setTitle.mockReset().mockResolvedValue(undefined);
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

describe("applyDesktopWindowTitle", () => {
  test("uses the current Tauri window and sets the exact title", async () => {
    coreMock.isTauri.mockReturnValue(true);

    await expect(
      applyDesktopWindowTitle("Exercices de grammaire française"),
    ).resolves.toBeUndefined();

    expect(windowMock.getCurrentWindow).toHaveBeenCalledTimes(1);
    expect(windowMock.setTitle).toHaveBeenCalledWith(
      "Exercices de grammaire française",
    );
  });

  test("does not load or call the window API outside the desktop container", async () => {
    coreMock.isTauri.mockReturnValue(false);

    await expect(applyDesktopWindowTitle("中文标题")).resolves.toBeUndefined();

    expect(windowMock.getCurrentWindow).not.toHaveBeenCalled();
    expect(windowMock.setTitle).not.toHaveBeenCalled();
  });

  test("a delayed old setTitle cannot overwrite the latest requested title", async () => {
    coreMock.isTauri.mockReturnValue(true);
    let releaseFirst!: () => void;
    windowMock.setTitle
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const first = applyDesktopWindowTitle("法语语法练习");
    await vi.waitFor(() => {
      expect(windowMock.setTitle).toHaveBeenCalledWith("法语语法练习");
    });

    const second = applyDesktopWindowTitle("Exercices de grammaire française");
    releaseFirst();
    await Promise.all([first, second]);

    expect(windowMock.setTitle.mock.calls.map(([title]) => title)).toEqual([
      "法语语法练习",
      "Exercices de grammaire française",
    ]);
  });

  test("native title failures are swallowed and still resolve", async () => {
    coreMock.isTauri.mockReturnValue(true);
    windowMock.setTitle.mockRejectedValue(new Error("title denied"));

    await expect(applyDesktopWindowTitle("Exercices")).resolves.toBeUndefined();
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

describe("可选对话框标题与原生错误协议", () => {
  const file = {
    filename: "fge-progress-public-2026-11-16.json",
    mimeType: "application/json",
    encoding: "utf8" as const,
    data: '{"format":"fge-progress"}',
  };

  test("传入 dialogTitle 时只追加标题参数，文件名与数据不变", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockResolvedValue({ status: "saved" });

    await expect(
      saveDesktopFile(file, { dialogTitle: "Enregistrer l'export" })
    ).resolves.toEqual({ status: "saved" });

    expect(coreMock.invoke).toHaveBeenCalledWith("save_export_file", {
      filename: file.filename,
      mimeType: file.mimeType,
      encoding: file.encoding,
      data: file.data,
      dialogTitle: "Enregistrer l'export",
    });
  });

  test("空标题或缺省标题不新增协议字段，旧命令仍可调用", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockResolvedValue({ status: "saved" });

    await saveDesktopFile(file);
    await saveDesktopFile(file, {});
    await saveDesktopFile(file, { dialogTitle: "" });
    await saveDesktopFile(file, { dialogTitle: "   " });

    for (const call of coreMock.invoke.mock.calls) {
      expect(call[1]).toEqual({
        filename: file.filename,
        mimeType: file.mimeType,
        encoding: file.encoding,
        data: file.data,
      });
      expect(call[1]).not.toHaveProperty("dialogTitle");
    }
  });

  test("结构化原生失败保留 code、params 与原始诊断", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockRejectedValueOnce({
      code: "native.file_failed",
      params: { operation: "save" },
      message: "无法写入导出文件",
    });

    const result = saveDesktopFile(file);
    await expect(result).rejects.toMatchObject({
      code: "native.file_failed",
      params: { operation: "save" },
      diagnostic: "无法写入导出文件",
    });
    await expect(result).rejects.toThrow("无法写入导出文件");
  });

  test("旧桥字符串与未知 code 归为 native.unknown 并保留诊断", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockRejectedValueOnce("无法写入导出文件");
    await expect(saveDesktopFile(file)).rejects.toMatchObject({
      code: "native.unknown",
      diagnostic: "无法写入导出文件",
    });

    coreMock.invoke.mockRejectedValueOnce({
      code: "native.future_code",
      message: "未来的错误",
    });
    await expect(saveDesktopFile(file)).rejects.toMatchObject({
      code: "native.unknown",
      diagnostic: "未来的错误",
    });
  });

  test("文件名前置校验使用 native.file_failed", async () => {
    coreMock.isTauri.mockReturnValue(true);
    await expect(
      saveDesktopFile({ ...file, filename: "../evil.json" })
    ).rejects.toMatchObject({
      code: "native.file_failed",
      diagnostic: "导出文件名无效",
    });
    expect(coreMock.invoke).not.toHaveBeenCalled();
  });

  test("非桌面环境使用 native.unsupported", async () => {
    coreMock.isTauri.mockReturnValue(false);
    await expect(saveDesktopFile(file)).rejects.toMatchObject({
      code: "native.unsupported",
    });
  });

  test("无效原生响应使用 native.unknown 但保留可读提示", async () => {
    coreMock.isTauri.mockReturnValue(true);
    coreMock.invoke.mockResolvedValueOnce({ status: "unknown" });
    await expect(saveDesktopFile(file)).rejects.toMatchObject({
      code: "native.unknown",
      diagnostic: "原生文件保存返回了无效响应",
    });
  });
});
