import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GoalReachedDialog } from "./components/GoalReachedDialog";
import { DEFAULT_PROGRESS } from "./storage";
import type { Progress } from "./types";
import type { ShareResult } from "./share/shareStats";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

interface DialogProps {
  progress: Progress;
  onShare: () => Promise<ShareResult>;
  onClose: () => void;
}

const progress: Progress = { ...DEFAULT_PROGRESS, dailyGoal: 50 };

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const onShare =
    overrides.onShare ?? vi.fn(() => new Promise<ShareResult>(() => {}));
  const onClose = overrides.onClose ?? vi.fn();
  const props: DialogProps = {
    progress: overrides.progress ?? progress,
    onShare,
    onClose,
  };
  act(() => root.render(<GoalReachedDialog {...props} />));
  return { onShare, onClose };
}

const $ = (selector: string) =>
  container.querySelector(selector) as HTMLElement | null;

function primaryButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    ".goal-dialog-actions .btn-primary"
  );
  if (!button) throw new Error("primary share button not found");
  return button;
}

function statusText(): string {
  return $(".goal-dialog-status")?.textContent ?? "";
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pressKey(key: string, shiftKey = false) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
    );
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("GoalReachedDialog", () => {
  test("渲染标题、正文、按钮与对话框 ARIA 语义", () => {
    renderDialog();

    const dialog = $('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");

    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy ?? "");
    expect(title?.textContent).toContain("今日目标达成");

    expect(dialog?.textContent).toContain("已完成今日 50 XP 目标");
    expect($(".goal-dialog-actions .btn-primary")?.textContent).toContain("分享打卡");
    expect($(".goal-dialog-actions .btn-secondary")?.textContent).toContain("稍后再说");
    expect($('[aria-label="关闭"]')).not.toBeNull();
  });

  test("打开时聚焦分享打卡,卸载后焦点回到之前的按钮", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "触发按钮";
    document.body.appendChild(trigger);
    trigger.focus();

    renderDialog();
    expect(document.activeElement).toBe(primaryButton());

    act(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });

  test("点击分享打卡调用 onShare,shared 后关闭", async () => {
    const { onShare, resolve } = deferredShare();
    const onClose = vi.fn();
    renderDialog({ onShare, onClose });

    const button = primaryButton();
    click(button);

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("生成中…");

    await resolveShare(resolve, { status: "shared" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("downloaded 后保持打开并提示图片已保存", async () => {
    const { onShare, resolve } = deferredShare();
    const onClose = vi.fn();
    renderDialog({ onShare, onClose });

    click(primaryButton());
    await resolveShare(resolve, {
      status: "downloaded",
      filename: "fge-stats-2026-11-04.png",
    });

    expect(onClose).not.toHaveBeenCalled();
    expect($('[role="dialog"]')).not.toBeNull();
    expect(statusText()).toContain("图片已保存到本地，可手动分享");
  });

  test("cancelled 后保持打开并提示已取消", async () => {
    const { onShare, resolve } = deferredShare();
    const onClose = vi.fn();
    renderDialog({ onShare, onClose });

    click(primaryButton());
    await resolveShare(resolve, { status: "cancelled" });

    expect(onClose).not.toHaveBeenCalled();
    expect(statusText()).toContain("已取消");
  });

  test("error 后保持打开,显示分享失败并可重试", async () => {
    const onShare = vi
      .fn<() => Promise<ShareResult>>()
      .mockResolvedValueOnce({ status: "error", message: "网络错误" })
      .mockResolvedValueOnce({ status: "shared" });
    const onClose = vi.fn();
    renderDialog({ onShare, onClose });

    click(primaryButton());
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect(statusText()).toContain("分享失败");
    expect(statusText()).toContain("网络错误");

    const retry = primaryButton();
    expect(retry.disabled).toBe(false);
    expect(retry.textContent).toContain("重试");

    click(retry);
    await flush();

    expect(onShare).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("onShare 抛异常时显示错误,不关闭", async () => {
    const onShare = vi.fn(async (): Promise<ShareResult> => {
      throw new Error("生成失败");
    });
    const onClose = vi.fn();
    renderDialog({ onShare, onClose });

    click(primaryButton());
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect($('[role="dialog"]')).not.toBeNull();
    expect(statusText()).toContain("分享失败");
    expect(statusText()).toContain("生成失败");
    expect(primaryButton().disabled).toBe(false);
  });

  test("按 Esc 关闭", () => {
    const { onClose } = renderDialog();

    pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("点击遮罩关闭,点击面板不关闭", () => {
    const { onClose } = renderDialog();

    click($(".goal-dialog") as Element);
    expect(onClose).not.toHaveBeenCalled();

    click($(".goal-dialog-backdrop") as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("点击关闭按钮与稍后再说都关闭", () => {
    const first = renderDialog();
    click($('[aria-label="关闭"]') as Element);
    expect(first.onClose).toHaveBeenCalledTimes(1);

    act(() => root.render(null));
    const second = renderDialog();
    click($(".goal-dialog-actions .btn-secondary") as Element);
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  test("Tab 焦点在弹窗按钮内循环", () => {
    renderDialog();

    const primary = primaryButton();
    const close = $('[aria-label="关闭"]') as HTMLButtonElement;

    expect(document.activeElement).toBe(primary);

    act(() => close.focus());
    pressKey("Tab");
    expect(document.activeElement).toBe(primary);

    pressKey("Tab", true);
    expect(document.activeElement).toBe(close);
  });
});
