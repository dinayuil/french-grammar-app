import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { vi, describe, expect, test, beforeEach, afterEach } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { libraryChapters } = await import("./test/fixtures");
  return { CHAPTERS: libraryChapters };
});

import App from "./App";
import { CHAPTERS } from "./content";
import { LibraryView } from "./views/LibraryView";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeQuery(value: string) {
  const input = $$(".library-search")[0] as HTMLInputElement | undefined;
  if (!input) throw new Error("search input not found");
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function Harness({ initial = "" }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  return (
    <LibraryView
      chapters={CHAPTERS}
      query={query}
      onQueryChange={setQuery}
      onOpenCard={() => {}}
    />
  );
}

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
  vi.restoreAllMocks();
});

describe("App 底部导航与讲解库目录", () => {
  test("底部导航四项，讲解打开 library 并高亮", () => {
    act(() => root.render(<App />));
    expect($$(".nav-item").map((el) => el.textContent)).toEqual(["练习", "讲解", "统计", "设置"]);

    const libraryNav = $$(".nav-item").find((el) => el.textContent === "讲解")!;
    click(libraryNav);
    expect($$(".library").length).toBe(1);
    expect($$(".nav-item.active")[0]!.textContent).toBe("讲解");
  });

  test("默认目录折叠，展开后按单元分组，点击卡片进入阅读器", () => {
    act(() => root.render(<App />));
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);

    expect($$(".library-chapter").length).toBe(2);
    expect(container.textContent).toContain("3 张讲解");
    expect($$(".library-card-item").length).toBe(0);

    click($$(".library-chapter-toggle")[0]!);
    expect($$(".library-card-item").length).toBe(3);
    expect($$(".library-unit-title").map((el) => el.textContent)).toEqual(["第1单元", "第2单元"]);
    expect(container.textContent).toContain("En été, il fait chaud.");

    click($$(".library-card-item")[0]!);
    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");

    click($$(".reader-back")[0]!);
    expect($$(".library").length).toBe(1);
  });

  test("展开第二章后仍为扁平列表，总卡片数正确", () => {
    act(() => root.render(<App />));
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);

    click($$(".library-chapter-toggle")[0]!);
    click($$(".library-chapter-toggle")[1]!);
    expect($$(".library-unit-title").length).toBe(2);
    expect($$(".library-card-item").length).toBe(4);
  });

  test("开始阅读打开该章第一张卡", () => {
    act(() => root.render(<App />));
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);
    click($$(".library-start")[0]!);
    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");
  });
});

describe("LibraryView 搜索", () => {
  test("搜索 ete 命中 Été，结果替换目录，清除后恢复", () => {
    act(() => root.render(<Harness />));
    expect($$(".library-chapter").length).toBe(2);

    typeQuery("ete");
    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("Été 与季节");
    expect(container.querySelector("mark")?.textContent).toBe("Été");
    expect($$(".library-card-item").length).toBe(0);

    typeQuery("NE PAS");
    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("否定基础");

    typeQuery("冠词");
    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("à + le → au。");

    typeQuery("zzz");
    expect(container.textContent).toContain("未找到「zzz」相关讲解");
    click($$(".library-clear")[0]!);
    expect(($$(".library-search")[0] as HTMLInputElement).value).toBe("");
    expect($$(".library-chapter").length).toBe(2);
  });
});

describe("App 搜索词保留", () => {
  test("从阅读器返回讲解库后保留搜索词与结果", () => {
    act(() => root.render(<App />));
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);
    typeQuery("ete");
    click($$(".library-result-item")[0]!);
    expect($$(".reader").length).toBe(1);

    click($$(".reader-back")[0]!);
    expect(($$(".library-search")[0] as HTMLInputElement).value).toBe("ete");
    expect(container.textContent).toContain("找到 1 条结果");
  });
});
