import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  cardSummary,
  groupCardsByUnit,
  highlightParts,
  normalizeText,
  searchEntries,
} from "./search";
import type { Chapter } from "../types";

const chapters: Chapter[] = [
  {
    id: "ch-a",
    title: "第一章",
    titleFr: "Chapitre A",
    cards: [
      {
        id: "ch-a-card-u1-1",
        title: "Été",
        body: "En été, il fait chaud.\n第二行。",
      },
      {
        id: "ch-a-card-u1-2",
        title: "否定基础",
        body: "ne … pas 夹住动词。",
      },
      {
        id: "ch-a-card-u2-1",
        title: "冠词",
        body: "à + le → au。",
      },
    ],
    lessons: [],
    challenges: [],
  },
  {
    id: "ch-b",
    title: "第二章",
    titleFr: "Chapitre B",
    cards: [
      {
        id: "ch-b-card-1",
        title: "扁平章节",
        body: "只有第一行。\n第二行不应出现。",
      },
    ],
    lessons: [],
    challenges: [],
  },
];

describe("normalizeText", () => {
  it("lowercases, strips accents and unifies curly apostrophes", () => {
    expect(normalizeText("Été, l’élève")).toBe("ete, l'eleve");
    expect(normalizeText("NE PAS")).toBe("ne pas");
  });

  it("treats all apostrophe variants the same", () => {
    expect(normalizeText("l’élève")).toBe(normalizeText("l'élève"));
    expect(normalizeText("l‘élève")).toBe(normalizeText("l'élève"));
    expect(normalizeText("lʼélève")).toBe(normalizeText("l'élève"));
  });

  it("keeps newlines in place", () => {
    expect(normalizeText("Été\nNE PAS")).toBe("ete\nne pas");
  });
});

describe("buildSearchIndex / searchEntries", () => {
  const index = buildSearchIndex(chapters);

  it("indexes every card in chapter and card order", () => {
    expect(index.map((entry) => entry.card.id)).toEqual([
      "ch-a-card-u1-1",
      "ch-a-card-u1-2",
      "ch-a-card-u2-1",
      "ch-b-card-1",
    ]);
    expect(index.map((entry) => entry.chapterIndex)).toEqual([0, 0, 0, 1]);
    expect(index.map((entry) => entry.cardIndex)).toEqual([0, 1, 2, 0]);
    expect(index[0].chapter).toBe(chapters[0]);
    expect(index[0].normalizedTitle).toBe("ete");
  });

  it("matches accents and case in either title or body", () => {
    expect(searchEntries(index, "ete").map((result) => result.card.id)).toEqual([
      "ch-a-card-u1-1",
    ]);
    expect(searchEntries(index, "NE PAS").map((result) => result.card.id)).toEqual([
      "ch-a-card-u1-2",
    ]);
    expect(searchEntries(index, "zzz")).toEqual([]);
  });

  it("requires every whitespace-separated term (AND)", () => {
    expect(searchEntries(index, "ete chaud").map((result) => result.card.id)).toEqual([
      "ch-a-card-u1-1",
    ]);
    expect(searchEntries(index, "ete pas")).toEqual([]);
    expect(searchEntries(index, "   ")).toEqual([]);
  });

  it("preserves chapter then card order across chapters", () => {
    expect(searchEntries(index, "行").map((result) => result.card.id)).toEqual([
      "ch-a-card-u1-1",
      "ch-b-card-1",
    ]);
  });

  it("attaches a summary to every result", () => {
    const [result] = searchEntries(index, "ete");
    expect(result.summary).toBe("été, il fait chaud.\n第二行。");
  });
});

describe("cardSummary", () => {
  it("returns the first line when there is no query", () => {
    expect(cardSummary("第一行。\n第二行。")).toBe("第一行。");
  });

  it("returns the first line when only the title matches", () => {
    expect(cardSummary("只有第一行。\n第二行不应出现。", "扁平")).toBe("只有第一行。");
  });

  it("starts at the earliest body hit", () => {
    expect(cardSummary("前缀文字 été 后面还有内容。", "ete")).toBe("été 后面还有内容。");
    expect(cardSummary("前缀文字 été 后面还有内容。", "ete", 4)).toBe("été ");
  });

  it("uses the earliest of several query terms", () => {
    expect(cardSummary("前缀文字 été 后面还有内容。", "后面 ete")).toBe(
      "été 后面还有内容。"
    );
  });

  it("handles empty and maxLength boundaries", () => {
    expect(cardSummary("")).toBe("");
    expect(cardSummary("abc\ndef", undefined, 2)).toBe("abc");
    expect(cardSummary("前缀 été", "ete", 0)).toBe("");
  });
});

describe("highlightParts", () => {
  it("keeps the original text and marks the accent-insensitive match", () => {
    const parts = highlightParts("L'été est là", "ete");
    expect(parts.map((part) => part.text).join("")).toBe("L'été est là");
    expect(parts.find((part) => part.match)?.text).toBe("été");
  });

  it("maps matches back through curly apostrophes and combined accents", () => {
    expect(highlightParts("l’élève", "l'eleve")).toEqual([
      { text: "l’élève", match: true },
    ]);
    expect(highlightParts("Été", "ete")).toEqual([{ text: "Été", match: true }]);
  });

  it("is case-insensitive for every term", () => {
    const parts = highlightParts("NE PAS", "ne pas");
    expect(parts.map((part) => part.text).join("")).toBe("NE PAS");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual([
      "NE",
      "PAS",
    ]);
  });

  it("merges overlapping ranges", () => {
    expect(highlightParts("Été", "e te")).toEqual([{ text: "Été", match: true }]);
  });

  it("returns a single unmatched segment when nothing matches", () => {
    expect(highlightParts("bonjour", "zzz")).toEqual([
      { text: "bonjour", match: false },
    ]);
    expect(highlightParts("bonjour", "  ")).toEqual([
      { text: "bonjour", match: false },
    ]);
  });
});

describe("groupCardsByUnit", () => {
  it("groups numbered units in ascending order with original indices", () => {
    expect(groupCardsByUnit(chapters[0].cards)).toEqual([
      {
        unit: 1,
        cards: [
          { card: chapters[0].cards[0], cardIndex: 0 },
          { card: chapters[0].cards[1], cardIndex: 1 },
        ],
      },
      {
        unit: 2,
        cards: [{ card: chapters[0].cards[2], cardIndex: 2 }],
      },
    ]);
  });

  it("falls back to one flat null group when no card has a unit", () => {
    expect(groupCardsByUnit(chapters[1].cards)).toEqual([
      { unit: null, cards: [{ card: chapters[1].cards[0], cardIndex: 0 }] },
    ]);
  });

  it("returns [] for an empty chapter", () => {
    expect(groupCardsByUnit([])).toEqual([]);
  });

  it("keeps unitless cards last in mixed chapters", () => {
    const mixed = [
      { id: "c-u2-1", title: "二单元", body: "" },
      { id: "c-plain", title: "无单元", body: "" },
      { id: "c-u1-1", title: "一单元", body: "" },
    ];
    expect(groupCardsByUnit(mixed)).toEqual([
      { unit: 1, cards: [{ card: mixed[2], cardIndex: 2 }] },
      { unit: 2, cards: [{ card: mixed[0], cardIndex: 0 }] },
      { unit: null, cards: [{ card: mixed[1], cardIndex: 1 }] },
    ]);
  });
});
