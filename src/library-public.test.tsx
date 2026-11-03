import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { LibraryView } from "./views/LibraryView";
import { CHAPTERS } from "./content";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

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
});

const c03 = CHAPTERS.find((ch) => ch.id === "pub-c03-adjectives");

describe.skipIf(__FGE_EDITION__ !== "public")("公开版 C03 讲解库目录验收", () => {
  test("34 张卡按 12 个单元分组", () => {
    if (!c03) throw new Error("C03 chapter not found");
    act(() =>
      root.render(
        <LibraryView
          chapters={[c03]}
          query=""
          onQueryChange={() => {}}
          onOpenCard={() => {}}
        />
      )
    );
    click($$(".library-chapter-toggle")[0]!);
    expect($$(".library-card-item").length).toBe(34);
    expect($$(".library-unit-title").length).toBe(12);
    expect($$(".library-unit-title")[0]!.textContent).toBe("第1单元");
  });
});
