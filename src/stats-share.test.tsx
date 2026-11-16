import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StatsView } from "./views/StatsView";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";
import { DEFAULT_PROGRESS } from "./storage";
import type { ShareResult } from "./share/shareStats";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $ = (selector: string) => container.querySelector(selector) as HTMLElement | null;

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return (
    <div>
      <button data-testid="locale-zh" onClick={() => setLocale("zh-CN")}>
        zh
      </button>
      <button data-testid="locale-fr" onClick={() => setLocale("fr")}>
        fr
      </button>
    </div>
  );
}

function renderStats(onShare?: () => Promise<ShareResult>) {
  act(() =>
    root.render(
      <LocaleProvider supportedLocales={["zh-CN", "fr"]}>
        <LocaleSwitch />
        <StatsView progress={DEFAULT_PROGRESS} onShare={onShare} />
      </LocaleProvider>
    )
  );
}

function switchLocale(locale: "fr" | "zh-CN") {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="locale-${locale}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function statusMainText(): string {
  const status = $(".stats-share-status");
  return status?.firstElementChild?.textContent ?? "";
}

function statusDetailText(): string {
  return $(".stats-share-status details span")?.textContent ?? "";
}

function shareButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".stats-share-btn");
  if (!button) throw new Error("share button not found");
  return button;
}

function clickShare() {
  act(() => {
    shareButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function deferredShare() {
  let resolve!: (result: ShareResult) => void;
  const promise = new Promise<ShareResult>((r) => {
    resolve = r;
  });
  const onShare = vi.fn(() => promise);
  return { onShare, resolve };
}

async function resolveShare(
  resolve: (result: ShareResult) => void,
  result: ShareResult
) {
  await act(async () => {
    resolve(result);
    await Promise.resolve();
  });
}

describe("StatsView 分享入口", () => {
  test("0 XP 的 DEFAULT_PROGRESS 仍显示分享按钮,点击调用 onShare", () => {
    expect(DEFAULT_PROGRESS.xp).toBe(0);
    const onShare = vi.fn(() => new Promise<ShareResult>(() => {}));
    renderStats(onShare);

    const button = shareButton();
    expect(button.textContent).toContain("分享今日打卡");
    expect(button.classList.contains("btn-small")).toBe(true);
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe("⬆");
    expect(button.getAttribute("aria-label")).toBe("分享今日打卡图片");
    expect(button.disabled).toBe(false);

    clickShare();
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  test("未传 onShare 时不渲染分享入口", () => {
    renderStats();
    expect($(".stats-share")).toBeNull();
    expect(container.textContent).not.toContain("分享今日打卡");
  });

  test("生成中按钮禁用、aria-busy=true 且文案为生成中…", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();

    const button = shareButton();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("生成中…");

    await resolveShare(resolve, { status: "shared" });
    expect(shareButton().disabled).toBe(false);
    expect(shareButton().getAttribute("aria-busy")).toBe("false");
  });

  test("shared 后按钮恢复并显示已打开分享", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();
    await resolveShare(resolve, { status: "shared" });

    expect(shareButton().textContent).toContain("分享今日打卡");
    expect(shareButton().disabled).toBe(false);
    expect($(".stats-share-status")?.textContent).toContain("已打开分享");
  });

  test("downloaded 后状态行提示图片已保存到本地", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();
    await resolveShare(resolve, {
      status: "downloaded",
      filename: "fge-stats-2026-11-04.png",
    });

    expect(shareButton().textContent).toContain("分享今日打卡");
    expect($(".stats-share-status")?.textContent).toContain("图片已保存到本地");
  });

  test("cancelled 后状态行提示已取消", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();
    await resolveShare(resolve, { status: "cancelled" });

    expect(shareButton().textContent).toContain("分享今日打卡");
    expect($(".stats-share-status")?.textContent).toContain("已取消");
  });

  test("旧 message-only error 规范化为通用主提示，原文进技术详情", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();
    await resolveShare(resolve, { status: "error", message: "网络错误" });

    const button = shareButton();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("重试");
    expect(button.textContent).toContain("分享失败");

    expect(statusMainText()).toBe("操作失败，请重试。");
    expect(statusMainText()).not.toContain("分享失败");
    expect(statusMainText()).not.toContain("网络错误");
    expect($(".stats-share-status details summary")?.textContent).toBe("技术详情");
    expect(statusDetailText()).toBe("网络错误");
  });

  test("onShare 抛异常时主提示本地化，原文只进技术详情", async () => {
    const onShare = vi.fn(async () => {
      throw new Error("生成失败");
    });
    renderStats(onShare);
    clickShare();
    await act(async () => {
      await Promise.resolve();
    });

    expect(shareButton().textContent).toContain("重试");
    expect(statusMainText()).toBe("操作失败，请重试。");
    expect(statusMainText()).not.toContain("生成失败");
    expect(statusDetailText()).toBe("生成失败");
  });

  test("结构化原生错误保留 code，异步返回后按当前语言显示主提示", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();

    switchLocale("fr");
    await resolveShare(resolve, {
      status: "error",
      message: "compat raw",
      error: {
        code: "native.file_failed",
        params: { operation: "share" },
        diagnostic: "disk raw detail",
      },
    });

    expect(statusMainText()).toContain(
      "Impossible de lire ou d'écrire le fichier de sauvegarde"
    );
    expect(statusMainText()).not.toContain("Échec du partage");
    expect($(".stats-share-status details summary")?.textContent).toBe(
      "Détails techniques"
    );
    expect(statusDetailText()).toBe("disk raw detail");
  });

  test("旧 message-only 结果在法语下不用中文作主提示", async () => {
    const { onShare, resolve } = deferredShare();
    renderStats(onShare);
    clickShare();

    switchLocale("fr");
    await resolveShare(resolve, { status: "error", message: "网络错误" });

    expect(statusMainText()).toBe("L'opération a échoué. Veuillez réessayer.");
    expect(statusMainText()).not.toMatch(/[\u3400-\u9fff]/);
    expect(statusMainText()).not.toContain("Échec du partage");
    expect(statusDetailText()).toBe("网络错误");
  });
});
