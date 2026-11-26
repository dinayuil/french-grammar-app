import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { ClientUpdateSettings } from "./ClientUpdateSettings";
import { SettingsView } from "./SettingsView";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { LOCALE_STORAGE_KEY } from "../i18n/locale";
import { DEFAULT_PROGRESS } from "../storage";
import type { ClientUpdates } from "../native/useClientUpdates";

const updateState = vi.hoisted(() => ({
  current: null as ClientUpdates | null,
}));

vi.mock("../native/useClientUpdates", () => ({
  useClientUpdates: () => updateState.current,
}));

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("../test/fixtures");
  return {
    CHAPTERS: [syntheticChapter],
    SUPPORTED_LOCALES: ["zh-CN", "fr"],
  };
});

import App from "../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  updateState.current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

interface FakeUpdateOptions {
  installedVersion?: string;
  status?: ClientUpdates["status"];
  latestVersion?: string | null;
  check?: () => void;
  openRelease?: () => Promise<void>;
}

function fakeUpdates(options: FakeUpdateOptions = {}): ClientUpdates {
  const updates = {
    installedVersion: options.installedVersion ?? "1.2.3",
    status: options.status ?? "current",
    latestVersion: options.latestVersion ?? null,
    check: options.check ?? vi.fn(),
    openRelease: options.openRelease ?? vi.fn(async () => {}),
  };
  // 测试允许自行组合状态;运行时状态联合的约束由组件分支保证。
  return updates as ClientUpdates;
}

function render(node: ReactNode, locale: "zh-CN" | "fr" = "zh-CN") {
  if (locale === "fr") {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
  } else {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  }
  act(() =>
    root.render(
      <LocaleProvider supportedLocales={["zh-CN", "fr"]}>{node}</LocaleProvider>
    )
  );
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text
  );
  if (!button) throw new Error(`按钮不存在: ${text}`);
  return button;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  });
}

describe("SettingsView 客户端更新入口", () => {
  test("没有原生更新状态时不渲染更新面板", () => {
    render(<SettingsView progress={DEFAULT_PROGRESS} onChange={() => {}} />);
    expect(container.textContent).not.toContain("客户端更新");
  });

  test("传入更新状态后显示面板并保留原有设置", () => {
    render(
      <SettingsView
        progress={DEFAULT_PROGRESS}
        onChange={() => {}}
        clientUpdates={fakeUpdates()}
      />
    );
    expect(container.textContent).toContain("客户端更新");
    expect(container.textContent).toContain("当前版本 1.2.3");
    expect(container.textContent).toContain("界面语言");
  });
});

describe("ClientUpdateSettings", () => {
  test("没有可用更新时显示当前版本和暂无更新状态", () => {
    render(<ClientUpdateSettings updates={fakeUpdates()} />);
    expect(container.textContent).toContain("当前版本 1.2.3");
    expect(container.textContent).toContain("暂无可用更新。");
    expect(container.querySelector(".backup-status")?.textContent).toBe(
      "暂无可用更新。"
    );
  });

  test("有新版本时显示更新状态，检查与打开发布页各自触发一次", async () => {
    const updates = fakeUpdates({
      status: "available",
      latestVersion: "1.4.0",
    });
    render(<ClientUpdateSettings updates={updates} />);

    expect(container.textContent).toContain(
      "有新版本可用，可在发布页下载安装。"
    );

    click(buttonByText("检查更新"));
    expect(updates.check).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonByText("打开 GitHub 发布页").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });
    expect(updates.openRelease).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".backup-error")).toBeNull();
  });

  test("检查中禁用按钮；检查失败提供重试并提示本地化错误", () => {
    const checking = fakeUpdates({ status: "checking" });
    render(<ClientUpdateSettings updates={checking} />);
    expect(container.textContent).toContain("正在检查更新…");
    expect(buttonByText("正在检查…").disabled).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    const failed = fakeUpdates({ status: "error" });
    render(<ClientUpdateSettings updates={failed} />);

    expect(container.textContent).toContain("检查更新失败，请稍后重试。");
    click(buttonByText("重新检查"));
    expect(failed.check).toHaveBeenCalledTimes(1);
  });

  test("打开发布页失败时保留面板并提示本地化错误", async () => {
    const updates = fakeUpdates({
      status: "available",
      latestVersion: "1.4.0",
      openRelease: vi.fn(async () => {
        throw new Error("open failed");
      }),
    });
    render(<ClientUpdateSettings updates={updates} />);

    await act(async () => {
      buttonByText("打开 GitHub 发布页").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(container.querySelector(".backup-error")?.textContent).toContain(
      "无法打开发布页面，请稍后重试。"
    );
    expect(buttonByText("打开 GitHub 发布页").disabled).toBe(false);
  });

  test("打开发布页期间显示进行中且禁止重复点击", async () => {
    let finish!: () => void;
    const openRelease = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(<ClientUpdateSettings updates={fakeUpdates({ openRelease })} />);

    act(() => {
      buttonByText("打开 GitHub 发布页").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    const opening = buttonByText("正在打开…");
    expect(opening.disabled).toBe(true);
    expect(openRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(buttonByText("打开 GitHub 发布页").disabled).toBe(false);
  });

  test("法语界面使用法语状态与版本文案", () => {
    render(<ClientUpdateSettings updates={fakeUpdates()} />, "fr");
    expect(container.textContent).toContain("Mise à jour de l'application");
    expect(container.textContent).toContain("Version actuelle : 1.2.3");
    expect(container.textContent).toContain("Aucune mise à jour disponible.");
  });
});

describe("首页更新提示", () => {
  test("没有新版本时首页不显示提示", () => {
    updateState.current = fakeUpdates();
    act(() => root.render(<App />));
    expect(container.querySelector(".update-callout")).toBeNull();
  });

  test("发现新版本时显示提示，点击后回到设置顶部查看更新面板", () => {
    updateState.current = fakeUpdates({
      status: "available",
      latestVersion: "1.0-test.9",
    });
    act(() => root.render(<App />));

    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const callout = container.querySelector<HTMLButtonElement>(".update-callout");
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain("新版本 1.0-test.9 可用");
    expect(callout?.textContent).toContain("查看更新");

    click(callout!);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    expect(
      container.querySelector(".bottom-nav .nav-item.active")?.textContent
    ).toContain("设置");
    expect(container.textContent).toContain("客户端更新");
    expect(container.textContent).toContain(
      "有新版本可用，可在发布页下载安装。"
    );
  });
});
