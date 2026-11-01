import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { LettersQuestion } from "./components/LettersQuestion";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const q = {
  id: "t-q1",
  prompt: "测试题",
  explain: "",
  type: "letters" as const,
  answer: "bleu",
  alternatives: ["bleu clair"],
  accentKeys: ["é", "è", "ç"],
};

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

const $$ = (s: string) => [...container.querySelectorAll(s)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function render(resp = "", onResponse: (s: string) => void = () => {}, disabled = false) {
  act(() => {
    root.render(<LettersQuestion q={q} response={resp} onResponse={onResponse} disabled={disabled} />);
  });
}

test("重音键:点击把重音字母加进答案", () => {
  let latest = "";
  render("", (s) => (latest = s));
  const accent = $$(".tile.accent").find((t) => t.textContent === "é")!;
  click(accent);
  expect(latest).toBe("é");
});

test("disabled 时全部输入不可用", () => {
  let latest = "";
  render("ble", (s) => (latest = s), true);
  click($$(".tile.accent")[0]!);
  const tiles = $$(".letter-tiles .tile") as HTMLButtonElement[];
  expect(tiles.every((t) => t.disabled)).toBe(true);
  expect(latest).toBe("");
  // 退格/清空也不生效
  click($$(".btn-small")[0]!);
  expect(latest).toBe("");
});

test("退格与清空按钮存在", () => {
  render();
  const btns = $$(".btn-small").map((b) => b.textContent);
  expect(btns.some((t) => t?.includes("退格"))).toBe(true);
  expect(btns.some((t) => t?.includes("清空"))).toBe(true);
});
