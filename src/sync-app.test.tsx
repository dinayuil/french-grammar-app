import { createRoot, type Root } from "react-dom/client";
import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PROGRESS } from "./storage";
import type { Progress } from "./types";
import type { SyncAdapter, SyncSettings, SyncSnapshot } from "./sync/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface SyncOptions {
  adapter: SyncAdapter;
  getProgress: () => Progress;
  applyProgress: (progress: Progress) => void;
  canApplyRemote?: () => boolean;
}

interface FakeController {
  options: SyncOptions;
  getSnapshot(): SyncSnapshot;
  setSnapshot(next: SyncSnapshot): void;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  configure(settings: SyncSettings, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  resolveConflict(choice: "local" | "remote"): Promise<void>;
  notifyLocalChange(): void;
  dispose(): void;
  initializeCalls: number;
  syncCalls: number;
  notifyCalls: number;
  disposed: boolean;
  applyRemote(progress: Progress): void;
}

const syncHarness = vi.hoisted(() => ({
  available: false,
  autoSync: true,
  adapterCalls: 0,
  controllers: [] as FakeController[],
}));

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

vi.mock("./sync/native", () => ({
  isSyncAvailable: () => syncHarness.available,
  getSyncAdapter: () => {
    syncHarness.adapterCalls += 1;
    return syncHarness.available ? ({} as SyncAdapter) : null;
  },
}));

vi.mock("./sync/controller", () => ({
  createSyncController: (options: SyncOptions): FakeController => {
    let snapshot: SyncSnapshot = {
      status: "idle",
      config: {
        url: "https://dav.example.com/fge",
        username: "yandi",
        autoSync: syncHarness.autoSync,
        hasPassword: true,
      },
      message: "",
      lastSyncedAt: null,
      conflict: null,
    };
    const listeners = new Set<() => void>();
    const controller: FakeController = {
      options,
      getSnapshot: () => snapshot,
      setSnapshot(next) {
        snapshot = next;
        for (const listener of [...listeners]) listener();
      },
      initializeCalls: 0,
      syncCalls: 0,
      notifyCalls: 0,
      disposed: false,
      applyRemote(progress) {
        options.applyProgress(progress);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      initialize: async () => {
        controller.initializeCalls += 1;
      },
      configure: async (_settings: SyncSettings, _password?: string) => {},
      disconnect: async () => {},
      sync: async () => {
        controller.syncCalls += 1;
      },
      resolveConflict: async () => {},
      notifyLocalChange: () => {
        controller.notifyCalls += 1;
      },
      dispose: () => {
        controller.disposed = true;
        listeners.clear();
      },
    };
    syncHarness.controllers.push(controller);
    return controller;
  },
}));

import App from "./App";
import { STORAGE_KEY } from "./config";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  syncHarness.available = false;
  syncHarness.autoSync = true;
  syncHarness.adapterCalls = 0;
  syncHarness.controllers.length = 0;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function navByText(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>(".nav-item")].find(
    (item) => item.textContent?.includes(text)
  );
  click(button ?? null);
}

function lastController(): FakeController {
  const controller = syncHarness.controllers[syncHarness.controllers.length - 1];
  if (!controller) throw new Error("sync controller not created");
  return controller;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mount() {
  act(() => root.render(<App />));
  await flush();
}

function remoteProgress(): Progress {
  return { ...DEFAULT_PROGRESS, xp: 999 };
}

describe("App 同步生命周期", () => {
  test("网页版不创建控制器、不读取适配器，设置页完全不显示同步", async () => {
    syncHarness.available = false;
    await mount();

    expect(syncHarness.controllers).toHaveLength(0);
    expect(syncHarness.adapterCalls).toBe(0);

    navByText("设置");
    expect(container.textContent).not.toContain("跨设备同步");
    expect(container.querySelector("#sync-url")).toBeNull();
  });

  test("原生端只挂载一个控制器并初始化，设置页显示同步入口", async () => {
    syncHarness.available = true;
    await mount();

    expect(syncHarness.controllers).toHaveLength(1);
    const controller = lastController();
    expect(controller.initializeCalls).toBe(1);
    expect(controller.disposed).toBe(false);

    navByText("设置");
    expect(container.textContent).toContain("跨设备同步");
    expect(container.querySelector("#sync-url")).not.toBeNull();
  });

  test("回到前台触发一次自动同步，未配置自动同步时不触发", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(controller.syncCalls).toBe(1);

    act(() => root.unmount());
    root = createRoot(container);
    syncHarness.available = true;
    syncHarness.autoSync = false;
    await mount();
    const manualOnly = lastController();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(manualOnly.syncCalls).toBe(0);
  });

  test("本地修改只通知 dirty，不重复创建控制器", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();

    navByText("设置");
    const goal = [...container.querySelectorAll<HTMLButtonElement>(".option-btn")].find(
      (button) => button.textContent?.includes("60 XP / 天")
    );
    click(goal ?? null);

    expect(controller.notifyCalls).toBe(1);
    expect(syncHarness.controllers).toHaveLength(1);
  });

  test("应用云端进度先写入本地存储再更新界面，且不通知 dirty", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();
    navByText("统计");

    act(() => {
      controller.applyRemote(remoteProgress());
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Progress;
    expect(stored.xp).toBe(999);
    expect(container.querySelector(".stat-num")?.textContent).toBe("999");
    expect(controller.notifyCalls).toBe(0);
  });

  test("本地存储写入失败时拒绝应用云端进度，界面保持原样", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();
    navByText("统计");
    expect(container.querySelector(".stat-num")?.textContent).toBe("0");

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(() => controller.applyRemote(remoteProgress())).toThrow("quota exceeded");
    setItem.mockRestore();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(container.querySelector(".stat-num")?.textContent).toBe("0");
    expect(controller.notifyCalls).toBe(0);
  });

  test("练习进行中禁止应用云端，退出练习后允许并补一次同步", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();

    click(container.querySelector(".chapter-toggle"));
    click(container.querySelector(".lesson-item"));
    await flush();

    expect(controller.options.canApplyRemote?.()).toBe(false);

    click(container.querySelector(".lesson-header .btn-ghost"));
    await flush();

    expect(controller.options.canApplyRemote?.()).toBe(true);
    expect(controller.syncCalls).toBe(1);
  });

  test("StrictMode 重挂载后保留可用控制器，旧实例已清理", async () => {
    syncHarness.available = true;
    act(() => root.render(
      <StrictMode>
        <App />
      </StrictMode>
    ));
    await flush();

    expect(syncHarness.controllers.length).toBeGreaterThanOrEqual(1);
    const live = lastController();
    expect(live.disposed).toBe(false);
    if (syncHarness.controllers.length > 1) {
      expect(syncHarness.controllers[0]?.disposed).toBe(true);
    }

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(live.syncCalls).toBeGreaterThanOrEqual(1);
  });

  test("卸载 App 时释放同步控制器", async () => {
    syncHarness.available = true;
    await mount();
    const controller = lastController();

    act(() => root.unmount());
    expect(controller.disposed).toBe(true);

    // afterEach 还会再卸载一次;换成新的挂载点避免重复卸载报错。
    root = createRoot(container);
  });
});
