import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { TilesQuestion } from "./components/TilesQuestion";
import { tilesBank } from "./engine";
import { syntheticChapter } from "./test/fixtures";
import type { TilesQuestion as TilesQ } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const q = syntheticChapter.lessons[0].questions[2] as TilesQ;

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

test("词块按 tilesBank 顺序渲染,不是原始答案顺序", () => {
  act(() =>
    root.render(
      <TilesQuestion q={q} response={[]} onResponse={() => {}} disabled={false} />
    )
  );
  const tiles = [...container.querySelectorAll(".letter-tiles .tile")].map((t) => t.textContent);
  expect(tiles).toEqual(tilesBank(q));
  expect(tiles).not.toEqual(q.bank);
});
