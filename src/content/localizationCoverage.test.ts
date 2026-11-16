import { describe, expect, test } from "vitest";
import type { Card, Chapter, Lesson, Question } from "../types";
import { collectLocalizationGaps } from "./localizationCoverage";

const SECTION_KEYS = { "synthetic-chapter": ["s1"] } as const;

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    prompt: "Choisissez ___",
    explain: "中文解析",
    example: "中文例句",
    translation: "中文译文",
    type: "choice",
    options: ["a", "b"],
    answer: 0,
    ...overrides,
  } as Question;
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    title: "中文关卡",
    kind: "lesson",
    source: "原创测试",
    questions: [makeQuestion()],
    ...overrides,
  } as Lesson;
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    title: "中文卡片标题",
    body: "中文卡片正文",
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "synthetic-chapter",
    title: "中文章名",
    titleFr: "Titre synthétique",
    cards: [makeCard()],
    lessons: [makeLesson()],
    challenges: [],
    ...overrides,
  };
}

function fullyLocalizedChapter(): Chapter {
  return makeChapter({
    locales: { fr: { sectionTitles: { s1: "Section une" } } },
    cards: [
      makeCard({
        locales: { fr: { title: "Titre de carte", body: "Corps de carte" } },
      }),
    ],
    lessons: [
      makeLesson({
        locales: { fr: { title: "Leçon" } },
        questions: [
          makeQuestion({
            locales: {
              fr: {
                prompt: "Choisissez ___",
                explain: "Explication",
                example: "Exemple",
                options: ["a", "b"],
              },
            },
          }),
        ],
      }),
    ],
  });
}

function gapKeys(chapter: Chapter, options = {}) {
  return collectLocalizationGaps([chapter], "fr", SECTION_KEYS, options).map(
    (gap) =>
      `${gap.entityType}:${gap.entityId}:${gap.field}:${gap.reason}`
  );
}

describe("collectLocalizationGaps", () => {
  test("reports every translatable field by entity/field without guessing from characters", () => {
    const gaps = collectLocalizationGaps([makeChapter()], "fr", SECTION_KEYS);

    expect(
      gaps.map((gap) => ({
        entityType: gap.entityType,
        entityId: gap.entityId,
        field: gap.field,
      }))
    ).toEqual([
      { entityType: "chapter", entityId: "synthetic-chapter", field: "sectionTitles.s1" },
      { entityType: "card", entityId: "card-1", field: "title" },
      { entityType: "card", entityId: "card-1", field: "body" },
      { entityType: "lesson", entityId: "l1", field: "title" },
      { entityType: "question", entityId: "q1", field: "prompt" },
      { entityType: "question", entityId: "q1", field: "explain" },
      { entityType: "question", entityId: "q1", field: "example" },
      { entityType: "question", entityId: "q1", field: "options" },
    ]);
    expect(gaps.every((gap) => gap.chapterId === "synthetic-chapter")).toBe(true);
    expect(gaps.every((gap) => gap.locale === "fr")).toBe(true);
    expect(gaps.some((gap) => gap.field === "translation")).toBe(false);
  });

  test("accepts a complete French chapter and treats fr translation as exempt", () => {
    expect(gapKeys(fullyLocalizedChapter())).toEqual([]);
  });

  test("accepts explicitly adjudicated shared base fields and rejects unknown ids/fields/conflicts", () => {
    const chapter = makeChapter({
      locales: { fr: { sectionTitles: { s1: "Section une" } } },
      cards: [
        makeCard({
          locales: { fr: { body: "Corps de carte" } },
        }),
      ],
      lessons: [
        makeLesson({
          locales: { fr: { title: "Leçon" } },
          questions: [
            makeQuestion({
              locales: {
                fr: {
                  explain: "Explication",
                  example: "Exemple",
                  options: ["a", "b"],
                },
              },
            }),
          ],
        }),
      ],
    });

    expect(
      gapKeys(chapter, { sharedFields: { "card-1": ["title"], q1: ["prompt"] } })
    ).toEqual([]);

    expect(() =>
      collectLocalizationGaps([chapter], "fr", SECTION_KEYS, {
        sharedFields: { "missing-entity": ["prompt"] },
      })
    ).toThrow(/未知实体|missing-entity/);

    expect(() =>
      collectLocalizationGaps([chapter], "fr", SECTION_KEYS, {
        sharedFields: { q1: ["source"] },
      })
    ).toThrow(/字段|source/);

    expect(() =>
      collectLocalizationGaps([chapter], "fr", SECTION_KEYS, {
        sharedFields: { q1: ["explain"] },
      })
    ).toThrow(/同时|覆盖|冲突|explain/);

    const letters = makeChapter({
      id: "letters-chapter",
      cards: [],
      lessons: [
        makeLesson({
          id: "letters-lesson",
          questions: [
            {
              id: "letters-q1",
              prompt: "Complétez : ___",
              explain: "中文解析",
              type: "letters",
              answer: "le",
            } as Question,
          ],
        }),
      ],
    });
    const lettersGaps = collectLocalizationGaps([letters], "fr", {
      "letters-chapter": [],
    });
    expect(lettersGaps.some((gap) => gap.field === "options")).toBe(false);
    expect(() =>
      collectLocalizationGaps([letters], "fr", { "letters-chapter": [] }, {
        sharedFields: { "letters-q1": ["options"] },
      })
    ).toThrow(/字段|options/);
  });

  test("rejects unknown section keys and reports missing registered keys", () => {
    const unknownKey = makeChapter({
      locales: { fr: { sectionTitles: { bogus: "Section inconnue" } } },
    });
    expect(() =>
      collectLocalizationGaps([unknownKey], "fr", SECTION_KEYS)
    ).toThrow(/sectionTitles|未知|未注册|bogus/);

    const missingKey = makeChapter({
      locales: { fr: { sectionTitles: { s1: "Section une" } } },
    });
    expect(
      collectLocalizationGaps([missingKey], "fr", {
        "synthetic-chapter": ["s1", "s2"],
      }).map((gap) => gap.field)
    ).toContain("sectionTitles.s2");

    const noRegisteredSections = makeChapter({
      id: "other-chapter",
      locales: { fr: { sectionTitles: { s1: "Section une" } } },
    });
    expect(() =>
      collectLocalizationGaps([noRegisteredSections], "fr", SECTION_KEYS)
    ).toThrow(/sectionTitles|未知|未注册|s1/);
  });

  test("uses the explicit test registry for additional content locales", () => {
    expect(() =>
      collectLocalizationGaps([makeChapter()], "en", SECTION_KEYS)
    ).toThrow(/未注册|locale|en/);

    const gaps = collectLocalizationGaps([makeChapter()], "en", SECTION_KEYS, {
      contentLocales: ["fr", "en"],
    });
    expect(gaps.some((gap) => gap.entityType === "chapter" && gap.field === "title")).toBe(
      true
    );
    expect(gaps.some((gap) => gap.field === "translation")).toBe(true);
  });
});
