import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatUserError } from "../i18n/errors";
import type { Progress } from "../types";
import { shareStatsCard, type ShareResult } from "./shareStats";

const DATE = "2026-11-04";
const CJK = /[\u3400-\u9fff]/;
const FILENAME = "fge-stats-2026-11-04.png";
const CACHED_URI = `file:///cache/share/${FILENAME}`;
const PROGRESS = { xp: 42 } as Progress;

const statsCardMocks = vi.hoisted(() => ({
  buildStatsCardData: vi.fn(),
  createStatsCardCanvas: vi.fn(),
  statsCardBlob: vi.fn(),
  statsCardBase64: vi.fn(),
  statsCardFilename: vi.fn(),
}));

vi.mock("./statsCard", () => statsCardMocks);

const capacitorMock = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitorMock }));

const filesystemMock = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystemMock,
  Directory: { Cache: "CACHE" },
}));

const sharePluginMock = vi.hoisted(() => ({ share: vi.fn() }));

vi.mock("@capacitor/share", () => ({ Share: sharePluginMock }));

const desktopMock = vi.hoisted(() => ({
  isDesktopPlatform: vi.fn(),
  saveDesktopFile: vi.fn(),
}));

vi.mock("../native/desktop", () => desktopMock);

type ShareFn = (data?: ShareData) => Promise<unknown>;
type CanShareFn = (data?: ShareData) => boolean;

const urlDescriptors = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
};

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchors: HTMLAnchorElement[];
let clickedAnchorsConnected: boolean[];

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installHarmonyBridge(invoke: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, "fgeHarmony", {
    configurable: true,
    value: { invoke },
  });
}

function removeHarmonyBridge(): void {
  delete (window as unknown as Record<string, unknown>).fgeHarmony;
}

function harmonyRequest(
  invoke: ReturnType<typeof vi.fn>
): Record<string, unknown> {
  expect(invoke).toHaveBeenCalledTimes(1);
  return JSON.parse(invoke.mock.calls[0][0]) as Record<string, unknown>;
}

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor?: PropertyDescriptor
): void {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    delete (URL as unknown as Record<string, unknown>)[name];
  }
}

function setNavigatorMethod(name: "share" | "canShare", value: unknown): void {
  if (value === undefined) {
    delete (navigator as unknown as Record<string, unknown>)[name];
  } else {
    Object.defineProperty(navigator, name, { configurable: true, value });
  }
}

function mockWebShare(
  methods: { canShare?: CanShareFn; share?: ShareFn } = {}
): void {
  setNavigatorMethod("canShare", methods.canShare);
  setNavigatorMethod("share", methods.share);
}

function errorOf(result: ShareResult): Extract<ShareResult, { status: "error" }> {
  if (result.status !== "error") {
    throw new Error(`expected error, received ${result.status}`);
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  removeHarmonyBridge();

  statsCardMocks.buildStatsCardData.mockReturnValue({});
  statsCardMocks.createStatsCardCanvas.mockReturnValue({});
  statsCardMocks.statsCardBlob.mockResolvedValue(
    new Blob(["png"], { type: "image/png" })
  );
  statsCardMocks.statsCardBase64.mockReturnValue("data:image/png;base64,QUJD");
  statsCardMocks.statsCardFilename.mockReturnValue(FILENAME);

  capacitorMock.isNativePlatform.mockReturnValue(false);
  desktopMock.isDesktopPlatform.mockReturnValue(false);
  filesystemMock.writeFile.mockResolvedValue({ uri: CACHED_URI });
  filesystemMock.getUri.mockResolvedValue({ uri: CACHED_URI });
  sharePluginMock.share.mockResolvedValue({ activityType: "test" });

  clickedAnchors = [];
  clickedAnchorsConnected = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
      clickedAnchorsConnected.push(this.isConnected);
    }
  );

  createObjectURL = vi.fn(() => "blob:mock-url");
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  removeHarmonyBridge();
  mockWebShare();
  restoreUrlMethod("createObjectURL", urlDescriptors.createObjectURL);
  restoreUrlMethod("revokeObjectURL", urlDescriptors.revokeObjectURL);
  vi.restoreAllMocks();
});

describe("shareStatsCard web", () => {
  test("支持文件分享时调用 navigator.share → shared", async () => {
    const canShare = vi.fn<CanShareFn>(() => true);
    const share = vi.fn<ShareFn>(async () => {});
    mockWebShare({ canShare, share });

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "shared" });
    expect(canShare).toHaveBeenCalledWith({ files: [expect.any(File)] });
    expect(statsCardMocks.buildStatsCardData).toHaveBeenCalledWith(
      PROGRESS,
      DATE,
      "zh-CN"
    );
    expect(statsCardMocks.statsCardFilename).toHaveBeenCalledWith(DATE, "zh-CN");
    expect(share).toHaveBeenCalledTimes(1);
    const options = share.mock.calls[0][0];
    expect(options?.title).toBe("我的法语学习打卡");
    expect(options?.files).toHaveLength(1);
    expect(options?.files?.[0]).toBeInstanceOf(File);
    expect(options?.files?.[0]).toMatchObject({
      name: FILENAME,
      type: "image/png",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("法语：文件名、卡片数据与 Web 分享标题使用当前语言", async () => {
    const canShare = vi.fn<CanShareFn>(() => true);
    const share = vi.fn<ShareFn>(async () => {});
    mockWebShare({ canShare, share });

    const result = await shareStatsCard(PROGRESS, DATE, "fr");

    expect(result).toEqual({ status: "shared" });
    expect(statsCardMocks.buildStatsCardData).toHaveBeenCalledWith(
      PROGRESS,
      DATE,
      "fr"
    );
    expect(statsCardMocks.statsCardFilename).toHaveBeenCalledWith(DATE, "fr");
    expect(share.mock.calls[0][0]?.title).toBe(
      "Ma progression en grammaire française"
    );
  });

  test("法语 Error 原文只作诊断，不作主提示", async () => {
    mockWebShare();
    statsCardMocks.createStatsCardCanvas.mockImplementation(() => {
      throw new Error("Canvas 2D unavailable");
    });

    const result = errorOf(await shareStatsCard(PROGRESS, DATE, "fr"));

    expect(result.message).toBe("Canvas 2D unavailable");
    expect(result.error).toEqual({
      code: "errors.unknown",
      diagnostic: "Canvas 2D unavailable",
    });

    const formatted = formatUserError(result.error, "fr");
    expect(formatted.message).toBe("L'opération a échoué. Veuillez réessayer.");
    expect(formatted.message).not.toContain("Canvas");
    expect(formatted.diagnostic).toBe("Canvas 2D unavailable");
  });

  test("法语旧字符串规范化为 unknown 诊断，不用中文当主提示", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    sharePluginMock.share.mockRejectedValue("没有可用的分享目标");

    const result = errorOf(await shareStatsCard(PROGRESS, DATE, "fr"));

    expect(result.message).toBe("没有可用的分享目标");
    expect(result.error).toEqual({
      code: "errors.unknown",
      diagnostic: "没有可用的分享目标",
    });

    const formatted = formatUserError(result.error, "fr");
    expect(formatted.message).not.toMatch(CJK);
    expect(formatted.message).not.toContain("没有可用的分享目标");
    expect(formatted.diagnostic).toBe("没有可用的分享目标");
  });

  test("用户取消(AbortError)→ cancelled,不触发下载", async () => {
    mockWebShare({
      canShare: () => true,
      share: vi.fn<ShareFn>(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    });

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "cancelled" });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
  });

  test("浏览器不支持文件分享 → 下载 PNG", async () => {
    mockWebShare();

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "downloaded", filename: FILENAME });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].download).toBe(FILENAME);
    await flushTasks();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  test("下载链接点击时已挂载到文档,对象 URL 延迟回收", async () => {
    mockWebShare();

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "downloaded", filename: FILENAME });
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchorsConnected).toEqual([true]);
    // 点击后链接立即移除,避免留在页面上。
    expect(clickedAnchors[0].isConnected).toBe(false);
    // 回收必须晚于点击,给浏览器启动 blob 下载的机会。
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await flushTasks();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  test("分享抛其它错误 → 下载 PNG", async () => {
    const share = vi.fn<ShareFn>(async () => {
      throw new TypeError("files unsupported");
    });
    mockWebShare({ canShare: () => true, share });

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "downloaded", filename: FILENAME });
    expect(share).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickedAnchors[0].download).toBe(FILENAME);
    await flushTasks();
  });

  test("PNG 导出失败 → error", async () => {
    statsCardMocks.statsCardBlob.mockRejectedValue(
      new Error("Canvas PNG export failed")
    );
    mockWebShare({ canShare: () => true, share: vi.fn(async () => {}) });

    const result = errorOf(await shareStatsCard(PROGRESS, DATE));

    expect(result).toMatchObject({
      status: "error",
      message: "Canvas PNG export failed",
      error: {
        code: "errors.unknown",
        diagnostic: "Canvas PNG export failed",
      },
    });
  });
});

describe("shareStatsCard native", () => {
  test("写入缓存并调用系统分享 → shared", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "shared" });
    expect(filesystemMock.writeFile).toHaveBeenCalledWith({
      path: `share/${FILENAME}`,
      data: "QUJD",
      directory: "CACHE",
      recursive: true,
    });
    expect(filesystemMock.getUri).toHaveBeenCalledWith({
      path: `share/${FILENAME}`,
      directory: "CACHE",
    });
    expect(sharePluginMock.share).toHaveBeenCalledWith({
      title: "我的法语学习打卡",
      dialogTitle: "分享打卡",
      files: [CACHED_URI],
    });
  });

  test("法语：原生分享标题与对话框标题使用当前语言", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);

    const result = await shareStatsCard(PROGRESS, DATE, "fr");

    expect(result).toEqual({ status: "shared" });
    expect(sharePluginMock.share).toHaveBeenCalledWith({
      title: "Ma progression en grammaire française",
      dialogTitle: "Partager ma progression",
      files: [CACHED_URI],
    });
    expect(statsCardMocks.statsCardFilename).toHaveBeenCalledWith(DATE, "fr");
  });

  test("系统分享 reject → 结构化 unknown，原文只进诊断", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    sharePluginMock.share.mockRejectedValue(new Error("没有可用的分享目标"));

    const result = errorOf(await shareStatsCard(PROGRESS, DATE));

    expect(result).toMatchObject({
      status: "error",
      message: "没有可用的分享目标",
      error: {
        code: "errors.unknown",
        diagnostic: "没有可用的分享目标",
      },
    });

    const fr = formatUserError(result.error, "fr");
    expect(fr.message).not.toMatch(CJK);
    expect(fr.diagnostic).toBe("没有可用的分享目标");
  });
});

describe("shareStatsCard harmony", () => {
  test("鸿蒙桥优先于 Capacitor:发送剥掉前缀的 PNG base64", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    const invoke = vi.fn(async () => '{"status":"ok"}');
    installHarmonyBridge(invoke);

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "shared" });
    expect(harmonyRequest(invoke)).toEqual({
      version: 1,
      operation: "shareFile",
      filename: FILENAME,
      mimeType: "image/png",
      encoding: "base64",
      data: "QUJD",
    });
    expect(filesystemMock.writeFile).not.toHaveBeenCalled();
    expect(sharePluginMock.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("鸿蒙取消分享 → cancelled,不降级为下载或 Capacitor", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    installHarmonyBridge(vi.fn(async () => '{"status":"cancelled"}'));

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "cancelled" });
    expect(filesystemMock.writeFile).not.toHaveBeenCalled();
    expect(sharePluginMock.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
  });

  test("鸿蒙 error 响应 → 保留结构化 code/params/diagnostic，不降级", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    installHarmonyBridge(
      vi.fn(async () =>
        JSON.stringify({
          status: "error",
          code: "native.unsupported",
          params: { operation: "share" },
          message: "没有可用的分享目标",
        })
      )
    );

    const result = errorOf(await shareStatsCard(PROGRESS, DATE, "fr"));

    expect(result.error).toEqual({
      code: "native.unsupported",
      params: { operation: "share" },
      diagnostic: "没有可用的分享目标",
    });
    expect(result.message).toBe("没有可用的分享目标");

    const fr = formatUserError(result.error, "fr");
    expect(fr.message).toContain("n'est pas prise en charge");
    expect(fr.diagnostic).toBe("没有可用的分享目标");
    expect(sharePluginMock.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("鸿蒙坏响应 → error,不偷偷走 Web 下载", async () => {
    installHarmonyBridge(vi.fn(async () => "not-json"));

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result.status).toBe("error");
    expect(result).toMatchObject({ message: expect.stringMatching(/鸿蒙|无效/) });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
  });
});

describe("shareStatsCard desktop", () => {
  beforeEach(() => {
    desktopMock.isDesktopPlatform.mockReturnValue(true);
  });

  test("桌面另存为 PNG → downloaded,不触发 Capacitor/Web 分享", async () => {
    desktopMock.saveDesktopFile.mockResolvedValue({ status: "saved" });
    capacitorMock.isNativePlatform.mockReturnValue(true);

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "downloaded", filename: FILENAME });
    expect(desktopMock.saveDesktopFile).toHaveBeenCalledWith(
      {
        filename: FILENAME,
        mimeType: "image/png",
        encoding: "base64",
        data: "QUJD",
      },
      { dialogTitle: "保存分享卡" }
    );
    expect(filesystemMock.writeFile).not.toHaveBeenCalled();
    expect(sharePluginMock.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("法语桌面另存为传本地化 dialogTitle", async () => {
    desktopMock.saveDesktopFile.mockResolvedValue({ status: "saved" });

    const result = await shareStatsCard(PROGRESS, DATE, "fr");

    expect(result).toEqual({ status: "downloaded", filename: FILENAME });
    expect(desktopMock.saveDesktopFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: FILENAME }),
      { dialogTitle: "Enregistrer la carte de partage" }
    );
  });

  test("取消另存为 → cancelled,不降级为下载", async () => {
    desktopMock.saveDesktopFile.mockResolvedValue({ status: "cancelled" });

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({ status: "cancelled" });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
  });

  test("原生保存失败 → 结构化错误,不偷偷下载", async () => {
    desktopMock.saveDesktopFile.mockRejectedValue(
      Object.assign(new Error("save failed"), {
        code: "native.file_failed",
        params: { operation: "save" },
        diagnostic: "disk raw detail",
      })
    );

    const result = errorOf(await shareStatsCard(PROGRESS, DATE, "fr"));

    expect(result.error).toEqual({
      code: "native.file_failed",
      params: { operation: "save" },
      diagnostic: "disk raw detail",
    });
    expect(result.message).toBe("disk raw detail");

    const fr = formatUserError(result.error, "fr");
    expect(fr.message).toContain("fichier de sauvegarde");
    expect(fr.diagnostic).toBe("disk raw detail");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
  });
});

describe("shareStatsCard generation", () => {
  test("分享卡生成失败 → error", async () => {
    statsCardMocks.createStatsCardCanvas.mockImplementation(() => {
      throw new Error("Canvas 2D unavailable");
    });

    const result = errorOf(await shareStatsCard(PROGRESS, DATE));

    expect(result).toMatchObject({
      status: "error",
      message: "Canvas 2D unavailable",
      error: {
        code: "errors.unknown",
        diagnostic: "Canvas 2D unavailable",
      },
    });
  });
});
