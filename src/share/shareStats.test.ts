import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Progress } from "../types";
import { shareStatsCard } from "./shareStats";

const DATE = "2026-11-04";
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

beforeEach(() => {
  vi.clearAllMocks();

  statsCardMocks.buildStatsCardData.mockReturnValue({});
  statsCardMocks.createStatsCardCanvas.mockReturnValue({});
  statsCardMocks.statsCardBlob.mockResolvedValue(
    new Blob(["png"], { type: "image/png" })
  );
  statsCardMocks.statsCardBase64.mockReturnValue("data:image/png;base64,QUJD");
  statsCardMocks.statsCardFilename.mockReturnValue(FILENAME);

  capacitorMock.isNativePlatform.mockReturnValue(false);
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

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({
      status: "error",
      message: "Canvas PNG export failed",
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

  test("系统分享 reject → error,message 可见", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    sharePluginMock.share.mockRejectedValue(new Error("没有可用的分享目标"));

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({
      status: "error",
      message: "没有可用的分享目标",
    });
  });
});

describe("shareStatsCard generation", () => {
  test("分享卡生成失败 → error", async () => {
    statsCardMocks.createStatsCardCanvas.mockImplementation(() => {
      throw new Error("Canvas 2D unavailable");
    });

    const result = await shareStatsCard(PROGRESS, DATE);

    expect(result).toEqual({
      status: "error",
      message: "Canvas 2D unavailable",
    });
  });
});
