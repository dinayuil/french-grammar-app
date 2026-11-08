import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

import App from "./App";
import { STORAGE_KEY } from "./config";
import { today } from "./storage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("学习时长自动写入失败", () => {
  test("存储抛错不冒泡，恢复后下一轮不重复累计", () => {
    act(() => root.render(<App />));
    click(container.querySelector(".btn-cards"));
    expect(container.querySelector(".reader")).not.toBeNull();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    // 第一次自动结算:内存进度 +5s,持久化抛错被吞掉,不能从 act 里逃逸。
    expect(() => act(() => vi.advanceTimersByTime(5000))).not.toThrow();

    setItem.mockRestore();
    // 第二次结算成功:若上一轮累计值没清空,这里会把同一批秒数再加一次,写成 15s。
    act(() => vi.advanceTimersByTime(5000));

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
      days?: Record<string, { readSeconds?: number }>;
    };
    expect(saved.days?.[today()]?.readSeconds).toBe(10);
  });
});
