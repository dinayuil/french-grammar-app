import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";

import { useStudyTimer } from "./studyTimer";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onFlush }: { onFlush: (seconds: number) => void }) {
  useStudyTimer(onFlush);
  return null;
}

let container: HTMLDivElement;
let root: Root | null = null;
let hidden = false;

function renderHarness(onFlush: (seconds: number) => void) {
  root = createRoot(container);
  act(() => root!.render(<Harness onFlush={onFlush} />));
}

function unmountHarness() {
  const current = root;
  root = null;
  if (current) act(() => current.unmount());
}

function setHidden(value: boolean) {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = null;
});

afterEach(() => {
  unmountHarness();
  container.remove();
  Reflect.deleteProperty(document, "hidden");
  vi.useRealTimers();
});

describe("useStudyTimer", () => {
  test("每 5 秒回调一次累计秒数", () => {
    const onFlush = vi.fn();
    renderHarness(onFlush);
    act(() => vi.advanceTimersByTime(5000));
    expect(onFlush).toHaveBeenCalledWith(5);
  });

  test("卸载时结算剩余秒数", () => {
    const onFlush = vi.fn();
    renderHarness(onFlush);
    act(() => vi.advanceTimersByTime(2000));
    unmountHarness();
    expect(onFlush).toHaveBeenCalledWith(2);
  });

  test("单次结算最多 10 秒（睡眠后恢复不暴增）", () => {
    const onFlush = vi.fn();
    renderHarness(onFlush);
    // 模拟睡眠:系统时间前进 1 小时,但睡眠期间定时器没有运行
    act(() => vi.setSystemTime(Date.now() + 3600000));
    act(() => vi.advanceTimersByTime(5000));
    expect(onFlush).toHaveBeenCalledWith(10);
  });

  test("隐藏时暂停并结算，恢复后重新计时", () => {
    const onFlush = vi.fn();
    renderHarness(onFlush);
    act(() => vi.advanceTimersByTime(5000));
    setHidden(true);
    act(() => vi.advanceTimersByTime(60000));
    expect(onFlush).toHaveBeenCalledTimes(1);
    setHidden(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(onFlush).toHaveBeenLastCalledWith(5);
  });
});
