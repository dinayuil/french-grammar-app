// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { SUPPORTED_LOCALES } from "../src/content";
import { MESSAGES } from "../src/i18n/messages";
import type { Chapter, Question } from "../src/types";
import { contentPlugin, loadBank } from "./content";

const BASE_DIR = mkdtempSync(path.join(tmpdir(), "fge-locales-test-"));
let fixtureCounter = 0;

afterAll(() => {
  rmSync(BASE_DIR, { recursive: true, force: true });
});

// 与 src/i18n/messages.test.ts 相同的受控目录修改法：直接改可变的 fr
// 目录对象，每个用例后恢复，不修改任何 i18n 源文件。
const mutableFrenchCatalog = MESSAGES.fr as unknown as Record<string, string>;
const originalFrenchCatalog = { ...mutableFrenchCatalog };

afterEach(() => {
  for (const key of Object.keys(mutableFrenchCatalog)) {
    delete mutableFrenchCatalog[key];
  }
  Object.assign(mutableFrenchCatalog, originalFrenchCatalog);
});

function makeRoot(label: string): string {
  const dir = path.join(BASE_DIR, `${label}-${fixtureCounter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

interface ChapterOptions {
  sectionTitles?: Record<string, string>;
  questionFr?: Record<string, unknown> | null;
}

function makeChapter(id: string, options: ChapterOptions = {}): Chapter {
  const questionFr =
    options.questionFr === undefined
      ? { prompt: "Choisissez ___", explain: "Explication", options: ["a", "b"] }
      : options.questionFr;
  const question: Question = {
    id: `${id}-q1`,
    prompt: "Choisissez ___",
    explain: "中文解析",
    type: "choice",
    options: ["a", "b"],
    answer: 0,
    ...(questionFr === null ? {} : { locales: { fr: questionFr } }),
  } as Question;

  const chapter: Chapter = {
    id,
    title: "中文章名",
    titleFr: "Titre français",
    cards: [],
    lessons: [
      {
        id: `${id}-l1`,
        title: "中文关卡",
        kind: "lesson",
        source: "原创测试",
        locales: { fr: { title: "Leçon" } },
        questions: [question],
      },
    ],
    challenges: [],
  };
  if (options.sectionTitles) {
    chapter.locales = { fr: { sectionTitles: options.sectionTitles } };
  }
  return chapter;
}

function writeBank(
  root: string,
  chapters: Chapter[],
  manifestPatch: Record<string, unknown> = {}
): void {
  chapters.forEach((chapter, index) => {
    writeJson(path.join(root, "chapters", `ch${index + 1}.json`), chapter);
  });
  writeJson(path.join(root, "manifest.json"), {
    schemaVersion: 1,
    edition: "public",
    chapters: chapters.map((_, index) => `chapters/ch${index + 1}.json`),
    expectedChapterCount: chapters.length,
    expectedQuestionCount: chapters.reduce(
      (total, chapter) =>
        total +
        [...chapter.lessons, ...chapter.challenges].reduce(
          (sum, lesson) => sum + lesson.questions.length,
          0
        ),
      0
    ),
    ...manifestPatch,
  });
}

function loadError(root: string): string {
  try {
    loadBank(root, "public");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("virtual:fge-content locale export", () => {
  it("exports the selected manifest supportedLocales, defaulting to zh-CN", () => {
    const edition = process.env.FGE_EDITION === "internal" ? "internal" : "public";
    const contentRoot =
      process.env[
        edition === "public" ? "FGE_PUBLIC_CONTENT_DIR" : "FGE_INTERNAL_CONTENT_DIR"
      ] ??
      path.resolve(process.cwd(), "..", edition === "public" ? "content-public" : "content-private");
    const manifest = JSON.parse(
      readFileSync(path.join(contentRoot, "manifest.json"), "utf8")
    ) as { supportedLocales?: string[] };
    expect(SUPPORTED_LOCALES).toEqual(manifest.supportedLocales ?? ["zh-CN"]);
  });

  it("emits declared supportedLocales alongside CHAPTERS through the plugin", () => {
    const root = makeRoot("plugin-locales");
    writeBank(root, [makeChapter("synthetic-chapter")], {
      supportedLocales: ["zh-CN", "fr"],
    });
    const plugin = contentPlugin({ edition: "public", root });
    const load = plugin.load as (this: unknown, id: string) => unknown;
    const result = load.call(
      { addWatchFile: () => {} },
      "\0virtual:fge-content"
    ) as { code: string };

    expect(result.code).toContain("export const CHAPTERS = ");
    expect(result.code).toContain(
      'export const SUPPORTED_LOCALES = ["zh-CN","fr"];'
    );
  });
});

describe("loadBank: locale declarations", () => {
  it("loads an old manifest without locale fields as zh-CN only", () => {
    const root = makeRoot("old-manifest");
    writeBank(root, [makeChapter("synthetic-chapter", { questionFr: null })]);

    const bank = loadBank(root, "public");
    expect(bank.supportedLocales).toEqual(["zh-CN"]);
    expect(bank.chapters).toHaveLength(1);
  });

  it("reports gaps but does not block an old Chinese build when fr is not declared", () => {
    const root = makeRoot("undeclared-fr-gaps");
    writeBank(root, [
      makeChapter("synthetic-chapter", {
        questionFr: { prompt: "Choisissez ___", options: ["a", "b"] },
      }),
    ]);

    const bank = loadBank(root, "public");
    expect(bank.supportedLocales).toEqual(["zh-CN"]);
  });

  it("fails when fr is declared and an explain override is missing, locating id and field", () => {
    const root = makeRoot("missing-explain");
    writeBank(
      root,
      [
        makeChapter("synthetic-chapter", {
          questionFr: { prompt: "Choisissez ___", options: ["a", "b"] },
        }),
      ],
      { supportedLocales: ["zh-CN", "fr"] }
    );

    const message = loadError(root);
    expect(message).toMatch(/synthetic-chapter-q1|synthetic-chapter-l1/);
    expect(message).toMatch(/explain/);
    expect(message).toMatch(/supportedLocales|fr/);
  });

  it("fails when a declared fr section title map misses a registered app key", () => {
    const root = makeRoot("missing-section-title");
    writeBank(
      root,
      [
        makeChapter("pub-c01-boundaries", {
          sectionTitles: { all: "Tous les articles" },
        }),
      ],
      { supportedLocales: ["zh-CN", "fr"] }
    );

    const message = loadError(root);
    expect(message).toMatch(/sectionTitles\.spelling/);
    expect(message).toMatch(/pub-c01-boundaries/);
  });

  it("rejects unknown section keys even when fr is not declared", () => {
    const root = makeRoot("unknown-section-title");
    writeBank(root, [
      makeChapter("pub-c01-boundaries", {
        sectionTitles: { bogus: "Section inconnue" },
        questionFr: null,
      }),
    ]);

    expect(loadError(root)).toMatch(/sectionTitles|未知|未注册|bogus/);
  });

  it("rejects unknown, duplicate, or non-array supportedLocales declarations", () => {
    for (const supportedLocales of [
      ["fr"],
      ["zh-CN", "en"],
      ["zh-CN", "fr", "fr"],
      "zh-CN",
    ]) {
      const root = makeRoot("bad-supported-locales");
      writeBank(root, [makeChapter("synthetic-chapter")], { supportedLocales });
      expect(loadError(root), JSON.stringify(supportedLocales)).toMatch(
        /supportedLocales|zh-CN|fr|重复|非法/
      );
    }
  });

  it("does not enable fr from shared-field adjudication alone", () => {
    const root = makeRoot("shared-fields-without-fr");
    writeBank(
      root,
      [
        makeChapter("synthetic-chapter", {
          questionFr: { explain: "Explication", options: ["a", "b"] },
        }),
      ],
      {
        localizationSharedFields: {
          fr: { "synthetic-chapter-q1": ["prompt"] },
        },
      }
    );

    const bank = loadBank(root, "public");
    expect(bank.supportedLocales).toEqual(["zh-CN"]);
  });

  it("allows an explicitly shared pure-French prompt only when complete", () => {
    const root = makeRoot("shared-prompt");
    writeBank(
      root,
      [
        makeChapter("synthetic-chapter", {
          questionFr: { explain: "Explication", options: ["a", "b"] },
        }),
      ],
      {
        supportedLocales: ["zh-CN", "fr"],
        localizationSharedFields: {
          fr: { "synthetic-chapter-q1": ["prompt"] },
        },
      }
    );

    const bank = loadBank(root, "public");
    expect(bank.supportedLocales).toEqual(["zh-CN", "fr"]);
  });

  it("rejects unknown shared entity ids, unknown fields, and shared fields that also have an override", () => {
    const cases: Array<{ label: string; shared: unknown }> = [
      { label: "unknown id", shared: { fr: { "missing-entity": ["prompt"] } } },
      { label: "unknown field", shared: { fr: { "synthetic-chapter-q1": ["source"] } } },
      {
        label: "override conflict",
        shared: { fr: { "synthetic-chapter-q1": ["prompt"] } },
      },
    ];

    for (const item of cases) {
      const root = makeRoot("bad-shared-fields");
      writeBank(root, [makeChapter("synthetic-chapter")], {
        supportedLocales: ["zh-CN", "fr"],
        localizationSharedFields: item.shared,
      });
      expect(loadError(root), item.label).toMatch(
        /localizationSharedFields|未知实体|字段|同时|覆盖|冲突/
      );
    }
  });
});

describe("loadBank: UI message catalog gate", () => {
  it("fails a declared-fr build when the French catalog is missing a key", () => {
    const root = makeRoot("ui-missing-key");
    writeBank(root, [makeChapter("synthetic-chapter")], {
      supportedLocales: ["zh-CN", "fr"],
    });

    delete mutableFrenchCatalog["nav.practice"];

    const message = loadError(root);
    expect(message).toMatch(/nav\.practice/);
    expect(message).toMatch(/Message catalog|missing key/i);
  });

  it("fails a declared-fr build when French placeholders differ from Chinese", () => {
    const root = makeRoot("ui-placeholder-mismatch");
    writeBank(root, [makeChapter("synthetic-chapter")], {
      supportedLocales: ["zh-CN", "fr"],
    });

    mutableFrenchCatalog["question.blankHint"] = "Blanc n° {count} {extra}";

    const message = loadError(root);
    expect(message).toMatch(/question\.blankHint/);
    expect(message).toMatch(/placeholder/i);
  });

  it("validates real UI catalogs even when an old manifest does not declare fr", () => {
    const root = makeRoot("ui-gate-old-manifest");
    writeBank(root, [
      makeChapter("synthetic-chapter", { questionFr: null }),
    ]);

    delete mutableFrenchCatalog["nav.practice"];

    expect(loadError(root)).toMatch(/nav\.practice/);
  });
});
