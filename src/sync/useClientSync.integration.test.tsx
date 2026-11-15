import { createRoot, type Root } from "react-dom/client";
import { act, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PROGRESS, saveProgress } from "../storage";
import { STORAGE_KEY } from "../config";
import type { Progress } from "../types";
import type {
  SyncAdapter,
  SyncRequest,
  SyncResponse,
} from "./types";
import { useClientSync } from "./useClientSync";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const nativeHarness = vi.hoisted(() => ({
  available: true,
  adapter: null as SyncAdapter | null,
  adapterCalls: 0,
}));

vi.mock("./native", () => ({
  isSyncAvailable: () => nativeHarness.available,
  getSyncAdapter: () => {
    nativeHarness.adapterCalls += 1;
    return nativeHarness.adapter;
  },
}));

const REMOTE: Progress = {
  ...DEFAULT_PROGRESS,
  xp: 500,
  days: { "2026-11-15": { xp: 20, earnedQids: ["c01-l01-q1"], bonusIds: [] } },
  lessons: { "c01-l01": { completed: true, stars: 3 } },
};

function remoteBackupBody(): string {
  return JSON.stringify({
    format: "fge-sync",
    version: 1,
    backup: {
      format: "fge-progress",
      version: 1,
      edition: __FGE_EDITION__,
      exportedAt: "2026-11-15T09:30:00.000Z",
      progress: REMOTE,
    },
  });
}

function makeAdapter(): SyncAdapter {
  return {
    readConfig: vi.fn(async () => ({
      url: "https://dav.example.com/fge",
      username: "yandi",
      autoSync: true,
      hasPassword: true,
    })),
    writeConfig: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    request: vi.fn(
      async (request: SyncRequest): Promise<SyncResponse> =>
        request.method === "GET"
          ? {
              status: 200,
              headers: { ETag: '"remote-etag-1"' },
              body: remoteBackupBody(),
            }
          : { status: 201, headers: { ETag: '"remote-etag-2"' }, body: "" }
    ),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  nativeHarness.available = true;
  nativeHarness.adapter = makeAdapter();
  nativeHarness.adapterCalls = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Harness({ interactionActive }: { interactionActive: boolean }) {
  const progressRef = useRef<Progress>(DEFAULT_PROGRESS);
  const [progress, setProgress] = useState<Progress>(progressRef.current);
  const { snapshot } = useClientSync({
    getProgress: () => progressRef.current,
    applyProgress: (remote) => {
      // 与 App 一致:先写入本机存储,失败则不更新 ref 与界面。
      saveProgress(remote);
      progressRef.current = remote;
      setProgress(remote);
    },
    interactionActive,
  });

  return (
    <div>
      <span data-testid="status">{snapshot.status}</span>
      <span data-testid="xp">{progress.xp}</span>
      <span data-testid="message">{snapshot.message}</span>
    </div>
  );
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const text = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

function hasBaseline(): boolean {
  for (let index = 0; index < localStorage.length; index += 1) {
    if (localStorage.key(index)?.startsWith("fge.sync.baseline")) return true;
  }
  return false;
}

describe("useClientSync 与真实控制器", () => {
  test("初始化自动同步云端进度，先持久化再更新界面并确认基线", async () => {
    act(() => root.render(<Harness interactionActive={false} />));
    await settle();

    expect(text("status")).toBe("synced");
    expect(text("xp")).toBe("500");
    expect(text("message")).toContain("已从云端恢复学习进度");

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Progress;
    expect(stored.xp).toBe(500);
    expect(hasBaseline()).toBe(true);
  });

  test("练习期间延后应用云端，返回后自动再次尝试并恢复", async () => {
    act(() => root.render(<Harness interactionActive />));
    await settle();

    expect(text("status")).toBe("idle");
    expect(text("message")).toContain("正在练习或阅读");
    expect(text("xp")).toBe("0");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => root.render(<Harness interactionActive={false} />));
    await settle();

    expect(text("status")).toBe("synced");
    expect(text("xp")).toBe("500");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").xp).toBe(500);
  });

  test("本机写入失败时不更新界面、不确认同步基线", async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === STORAGE_KEY) throw new Error("quota exceeded");
      return original.call(this, key, value);
    });

    act(() => root.render(<Harness interactionActive={false} />));
    await settle();

    expect(text("status")).toBe("error");
    expect(text("message")).toContain("应用云端学习进度失败");
    expect(text("xp")).toBe("0");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasBaseline()).toBe(false);
  });

  test("网页版即使有残留原生标记也不读取适配器", async () => {
    nativeHarness.available = false;
    act(() => root.render(<Harness interactionActive={false} />));
    await settle();

    expect(nativeHarness.adapterCalls).toBe(0);
    expect(text("status")).toBe("disabled");
    expect(text("xp")).toBe("0");
  });
});
