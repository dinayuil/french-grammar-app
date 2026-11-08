import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { SettingsView } from "./views/SettingsView";
import { DEFAULT_PROGRESS } from "./storage";

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

describe("SettingsView AI 披露", () => {
  test("底部显示内容说明", () => {
    act(() => root.render(<SettingsView progress={DEFAULT_PROGRESS} onChange={() => {}} />));
    expect(container.textContent).toContain("内容由 AI 参与编写与复核");
    expect(container.textContent).toContain("未经过人工法语审校");
  });
});
