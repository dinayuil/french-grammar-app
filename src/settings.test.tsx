import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { SettingsView } from "./views/SettingsView";
import { DEFAULT_PROGRESS } from "./storage";
import type { Progress } from "./types";

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

function renderSettings(progress: Progress, onChange: (p: Progress) => void = () => {}) {
  act(() => root.render(<SettingsView progress={progress} onChange={onChange} />));
}

function shareContentButtons(): HTMLButtonElement[] {
  const group = container.querySelector<HTMLElement>(
    '[role="radiogroup"][aria-label="分享卡内容"]'
  );
  if (!group) throw new Error("分享卡内容设置组未找到");
  return Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SettingsView AI 披露", () => {
  test("底部显示内容说明", () => {
    renderSettings(DEFAULT_PROGRESS);
    expect(container.textContent).toContain("内容由 AI 参与编写与复核");
    expect(container.textContent).toContain("未经过人工法语审校");
  });
});

describe("SettingsView 分享卡内容", () => {
  test("标题为分享卡内容,选项严格为经验、时间、都有", () => {
    renderSettings({ ...DEFAULT_PROGRESS, shareCardContent: "both" });

    expect(container.textContent).toContain("分享卡内容");
    expect(shareContentButtons().map((button) => button.textContent)).toEqual([
      "经验",
      "时间",
      "都有",
    ]);
    expect(container.textContent).not.toContain("经验（XP）");
    expect(container.textContent).not.toContain("经验(XP)");
  });

  test("默认都有选中", () => {
    renderSettings({ ...DEFAULT_PROGRESS, shareCardContent: "both" });

    const buttons = shareContentButtons();
    expect(buttons.find((button) => button.textContent === "都有")?.getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(buttons.find((button) => button.textContent === "经验")?.getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(buttons.find((button) => button.textContent === "时间")?.getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  test("点击时间通过 onChange 保存模式并保留其他进度字段", () => {
    const progress = {
      ...DEFAULT_PROGRESS,
      xp: 120,
      dailyGoal: 60,
      shareCardContent: "xp" as const,
    };
    const onChange = vi.fn();
    renderSettings(progress, onChange);

    click(shareContentButtons().find((button) => button.textContent === "时间")!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...progress, shareCardContent: "time" });
  });

  test("旧进度对象缺少 shareCardContent 时按都有显示", () => {
    const legacy = { ...DEFAULT_PROGRESS } as Partial<Progress>;
    delete legacy.shareCardContent;
    renderSettings(legacy as Progress);

    expect(shareContentButtons().find((button) => button.textContent === "都有")?.getAttribute(
      "aria-checked"
    )).toBe("true");
  });

  test("选择后重新渲染仍保持选中", () => {
    function Harness() {
      const [progress, setProgress] = useState<Progress>({
        ...DEFAULT_PROGRESS,
        shareCardContent: "both",
      });
      return <SettingsView progress={progress} onChange={setProgress} />;
    }

    act(() => root.render(<Harness />));
    click(shareContentButtons().find((button) => button.textContent === "时间")!);

    const buttons = shareContentButtons();
    expect(buttons.find((button) => button.textContent === "时间")?.getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(buttons.find((button) => button.textContent === "都有")?.getAttribute("aria-checked")).toBe(
      "false"
    );
  });
});
