import { createRoot, type Root } from "react-dom/client";
import { act, useState, type ReactNode } from "react";
import { vi } from "vitest";
import { LanguageMenu } from "./LanguageMenu";
import type { UiLocale } from "../i18n/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(ui: ReactNode) {
  act(() => {
    root.render(ui);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function press(target: Element | Document, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });
}

function trigger(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(".language-menu__trigger");
  if (!el) throw new Error("语言按钮不存在");
  return el;
}

function listbox(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="listbox"]');
}

function options(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function optionByName(name: string): HTMLElement {
  const el = options().find((option) => option.textContent?.trim() === name);
  if (!el) throw new Error(`语言选项不存在: ${name}`);
  return el;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("少于两种语言或只有重复语言时不渲染", () => {
  const noop = vi.fn();
  render(<LanguageMenu locale="zh-CN" supportedLocales={[]} onChange={noop} />);
  expect(container.innerHTML).toBe("");

  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN"]} onChange={noop} />
  );
  expect(container.innerHTML).toBe("");

  render(<LanguageMenu locale="fr" supportedLocales={["fr", "fr"]} onChange={noop} />);
  expect(container.innerHTML).toBe("");
});

test("中文按钮显示 Français,法语显示简体中文,极窄屏缩写不牺牲完整可访问名称", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  expect(trigger().textContent).toContain("Français");
  expect(trigger().querySelector(".language-menu__label--short")?.textContent).toBe("FR");
  expect(trigger().getAttribute("aria-label")).toContain("Français");
  expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(trigger().getAttribute("aria-controls")).toBeNull();
  expect(listbox()).toBeNull();

  render(
    <LanguageMenu locale="fr" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  expect(trigger().textContent).toContain("简体中文");
  expect(trigger().querySelector(".language-menu__label--short")?.textContent).toBe("中");
  expect(trigger().getAttribute("aria-label")).toContain("简体中文");
  expect(trigger().getAttribute("aria-label")).toContain("Changer de langue");

  click(trigger());
  expect(container.querySelector(".language-menu__caption")?.textContent).toBe(
    "Langue de l'interface"
  );
});

test("打开菜单显示两种语言的自称、当前选中项和 aria 关联,焦点落在选中项", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  click(trigger());

  const box = listbox();
  expect(box).not.toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(trigger().getAttribute("aria-controls")).toBe(box!.id);

  const items = options();
  expect(items).toHaveLength(2);
  expect(items.map((item) => item.textContent?.trim())).toEqual(["简体中文", "Français"]);
  expect(items.map((item) => item.getAttribute("lang"))).toEqual(["zh-CN", "fr"]);
  expect(items[0]!.getAttribute("aria-selected")).toBe("true");
  expect(items[1]!.getAttribute("aria-selected")).toBe("false");

  const caption = container.querySelector<HTMLElement>(".language-menu__caption");
  expect(caption).not.toBeNull();
  expect(caption!.textContent).toBe("界面语言");
  expect(box!.getAttribute("aria-labelledby")).toBe(caption!.id);
  expect(document.activeElement).toBe(items[0]);
  expect(noop).not.toHaveBeenCalled();
});

test("选择法语只通知语言变化:菜单关闭、回焦、现有页面状态不变", () => {
  const onPick = vi.fn();

  function Harness() {
    const [view] = useState("home");
    const [locale, setLocale] = useState<UiLocale>("zh-CN");
    return (
      <>
        <span data-view>{view}</span>
        <LanguageMenu
          locale={locale}
          supportedLocales={["zh-CN", "fr"]}
          onChange={(next) => {
            onPick(next);
            setLocale(next);
          }}
        />
      </>
    );
  }

  render(<Harness />);
  act(() => trigger().focus());
  click(trigger());
  click(optionByName("Français"));

  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith("fr");
  expect(container.querySelector("[data-view]")?.textContent).toBe("home");
  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(trigger().getAttribute("aria-controls")).toBeNull();
  expect(trigger().getAttribute("aria-label")).toContain("简体中文");
});

test("选择当前语言也关闭并回焦,不重复通知", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  act(() => trigger().focus());
  click(trigger());
  click(optionByName("简体中文"));

  expect(noop).not.toHaveBeenCalled();
  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test("Escape 关闭菜单并回焦,不触发语言变化", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  click(trigger());
  expect(document.activeElement).toBe(options()[0]);

  press(document, "Escape");

  expect(listbox()).toBeNull();
  expect(noop).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger());
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

test("外部点击关闭菜单并回焦", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  click(trigger());
  expect(listbox()).not.toBeNull();

  act(() => {
    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
  });

  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  expect(noop).not.toHaveBeenCalled();
});

test("键盘:ArrowDown 打开并可上下移动、Home/End 跳转、Enter 选择", () => {
  const onPick = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={onPick} />
  );

  act(() => trigger().focus());
  press(trigger(), "ArrowDown");

  expect(listbox()).not.toBeNull();
  expect(document.activeElement).toBe(options()[0]);

  press(document.activeElement!, "ArrowDown");
  expect(document.activeElement).toBe(options()[1]);

  press(document.activeElement!, "ArrowDown");
  expect(document.activeElement).toBe(options()[0]);

  press(document.activeElement!, "End");
  expect(document.activeElement).toBe(options()[1]);

  press(document.activeElement!, "Home");
  expect(document.activeElement).toBe(options()[0]);

  press(document.activeElement!, "ArrowDown");
  press(document.activeElement!, "Enter");

  expect(onPick).toHaveBeenCalledWith("fr");
  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test("键盘:ArrowUp 打开落在末项并可在首项回绕;Space 可打开", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  act(() => trigger().focus());
  press(trigger(), "ArrowUp");

  expect(listbox()).not.toBeNull();
  expect(document.activeElement).toBe(options()[1]);

  press(document.activeElement!, "ArrowUp");
  expect(document.activeElement).toBe(options()[0]);

  press(document, "Escape");
  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());

  press(trigger(), " ");
  expect(listbox()).not.toBeNull();
  expect(document.activeElement).toBe(options()[0]);
});

test("键盘:Enter 可打开菜单", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );

  act(() => trigger().focus());
  press(trigger(), "Enter");

  expect(listbox()).not.toBeNull();
  expect(document.activeElement).toBe(options()[0]);
});

test("非模态:焦点离开菜单时关闭且不夺回焦点", () => {
  const noop = vi.fn();
  render(
    <>
      <LanguageMenu
        locale="zh-CN"
        supportedLocales={["zh-CN", "fr"]}
        onChange={noop}
      />
      <button type="button">其他操作</button>
    </>
  );

  click(trigger());
  const outside = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "其他操作"
  )!;

  act(() => outside.focus());

  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test("支持列表降为一种语言时卸载;恢复后不会残留展开状态", () => {
  const noop = vi.fn();
  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );
  click(trigger());
  expect(listbox()).not.toBeNull();

  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN"]} onChange={noop} />
  );
  expect(container.innerHTML).toBe("");

  render(
    <LanguageMenu locale="zh-CN" supportedLocales={["zh-CN", "fr"]} onChange={noop} />
  );
  expect(listbox()).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
