import { describe, expect, test } from "vitest";
import { CHAPTERS } from "../content";
import type { Chapter, Lesson, Progress } from "../types";
import {
  SECTION_MAP,
  findSectionByCard,
  findSectionByLesson,
  getLearningSections,
  lessonSequenceFor,
  sectionProgress,
  type SectionMap,
} from "./sections";

const isPublic = __FGE_EDITION__ === "public";

const lesson = (id: string, kind: Lesson["kind"] = "lesson"): Lesson => ({
  id,
  title: `关卡 ${id}`,
  kind,
  source: "测试",
  questions: [
    {
      id: `${id}-q1`,
      prompt: "Choisis la bonne réponse.",
      explain: "测试题。",
      type: "choice",
      options: ["A", "B"],
      answer: 0,
    },
  ],
});

const demoChapter: Chapter = {
  id: "demo-sections",
  title: "分区演示章",
  titleFr: "Chapitre de démonstration",
  cards: [
    { id: "demo-card-u1-1", title: "一之一", body: "一之一内容" },
    { id: "demo-card-u1-2", title: "一之二", body: "一之二内容" },
    { id: "demo-card-u2-1", title: "二之一", body: "二之一内容" },
    { id: "demo-card-u2-2", title: "二之二", body: "二之二内容" },
    { id: "demo-card-u3-1", title: "三之一", body: "三之一内容" },
  ],
  lessons: [
    lesson("demo-l1-1"),
    lesson("demo-l1-2"),
    lesson("demo-l2-1"),
    lesson("demo-l2-2"),
    lesson("demo-l3-1"),
  ],
  challenges: [
    lesson("demo-x1", "challenge"),
    lesson("demo-x2", "challenge"),
  ],
};

const demoMap: SectionMap = {
  "demo-sections": {
    sections: [
      {
        key: "one",
        title: "第一主题",
        cardIds: ["demo-card-u1-2", "demo-card-u1-1"],
        lessonIds: ["demo-l1-2", "demo-l1-1"],
      },
      {
        key: "two",
        title: "第二主题",
        cardIds: ["demo-card-u2-1", "demo-card-u2-2"],
        lessonIds: ["demo-l2-2", "demo-l2-1"],
      },
      {
        key: "three",
        title: "第三主题",
        cardIds: ["demo-card-u3-1"],
        lessonIds: ["demo-l3-1"],
      },
    ],
    comprehensive: {
      challengeIds: ["demo-x2", "demo-x1"],
    },
  },
};

describe("学习小章模型", () => {
  test("按映射建立小章，资源顺序保持题库原顺序且综合区独立", () => {
    const result = getLearningSections(demoChapter, demoMap);
    expect(result).not.toBeNull();
    expect(result!.sections.map((s) => s.title)).toEqual([
      "第一主题",
      "第二主题",
      "第三主题",
    ]);
    expect(result!.sections.map((s) => s.id)).toEqual([
      "demo-sections::one",
      "demo-sections::two",
      "demo-sections::three",
    ]);
    expect(result!.sections[0]!.cards.map((c) => c.id)).toEqual([
      "demo-card-u1-1",
      "demo-card-u1-2",
    ]);
    expect(result!.sections[0]!.lessons.map((l) => l.id)).toEqual([
      "demo-l1-1",
      "demo-l1-2",
    ]);
    expect(result!.comprehensive).not.toBeNull();
    expect(result!.comprehensive!.id).toBe("demo-sections::comprehensive");
    expect(result!.comprehensive!.title).toBe("专题综合挑战");
    expect(result!.comprehensive!.challenges.map((l) => l.id)).toEqual([
      "demo-x1",
      "demo-x2",
    ]);
    expect(result!.comprehensive!.cards).toEqual([]);
    expect(result!.comprehensive!.lessons).toEqual([]);
  });

  test("按卡片或关卡 ID 找回所属小章", () => {
    const result = getLearningSections(demoChapter, demoMap)!;
    expect(findSectionByCard(result, "demo-card-u2-2")?.id).toBe(
      "demo-sections::two"
    );
    expect(findSectionByLesson(result, "demo-l3-1")?.id).toBe(
      "demo-sections::three"
    );
    expect(findSectionByLesson(result, "demo-x2")?.id).toBe(
      "demo-sections::comprehensive"
    );
    expect(findSectionByCard(result, "missing")).toBeNull();
    expect(findSectionByLesson(result, "missing")).toBeNull();
  });

  test("关卡序列限定所属小章或专题综合区", () => {
    const result = getLearningSections(demoChapter, demoMap)!;
    expect(
      lessonSequenceFor(result, "demo-l1-1").map((l) => l.id)
    ).toEqual(["demo-l1-1", "demo-l1-2"]);
    expect(
      lessonSequenceFor(result, "demo-l2-2").map((l) => l.id)
    ).toEqual(["demo-l2-1", "demo-l2-2"]);
    expect(
      lessonSequenceFor(result, "demo-x1").map((l) => l.id)
    ).toEqual(["demo-x1", "demo-x2"]);
    expect(lessonSequenceFor(result, "missing")).toEqual([]);
  });

  test("完成度只统计当前小章关卡，挑战计入综合区", () => {
    const result = getLearningSections(demoChapter, demoMap)!;
    const progress: Progress["lessons"] = {
      "demo-l1-2": { completed: true, stars: 3 },
      "demo-l2-1": { completed: true, stars: 1 },
      "demo-x2": { completed: true, stars: 2 },
    };
    expect(sectionProgress(result.sections[0]!, progress)).toEqual({
      done: 1,
      total: 2,
    });
    expect(sectionProgress(result.sections[1]!, progress)).toEqual({
      done: 1,
      total: 2,
    });
    expect(sectionProgress(result.sections[2]!, progress)).toEqual({
      done: 0,
      total: 1,
    });
    expect(sectionProgress(result.comprehensive!, progress)).toEqual({
      done: 1,
      total: 2,
    });
  });

  test("未配置的章节保持整章回退", () => {
    expect(getLearningSections(demoChapter, {})).toBeNull();
    expect(
      getLearningSections({ ...demoChapter, id: "internal-ch1" }, demoMap)
    ).toBeNull();
  });

  test("重复、未知、遗漏或空小章都会显式失败", () => {
    const clone = (): SectionMap => JSON.parse(JSON.stringify(demoMap));

    const duplicate = clone();
    duplicate["demo-sections"]!.sections[1]!.cardIds!.push("demo-card-u1-1");
    expect(() => getLearningSections(demoChapter, duplicate)).toThrow(
      /重复归属/
    );

    const unknown = clone();
    unknown["demo-sections"]!.sections[0]!.lessonIds!.push("demo-missing");
    expect(() => getLearningSections(demoChapter, unknown)).toThrow(/不存在/);

    const missing = clone();
    missing["demo-sections"]!.sections[2]!.cardIds = [];
    missing["demo-sections"]!.sections[2]!.lessonIds = [];
    expect(() => getLearningSections(demoChapter, missing)).toThrow(
      /没有学习资源/
    );

    const unassigned = clone();
    unassigned["demo-sections"]!.sections[2]!.lessonIds = [];
    expect(() => getLearningSections(demoChapter, unassigned)).toThrow(
      /未归属/
    );

    const noChallenges = clone();
    delete noChallenges["demo-sections"]!.comprehensive;
    expect(() => getLearningSections(demoChapter, noChallenges)).toThrow(
      /挑战未归属/
    );
  });
});

describe.skipIf(!isPublic)("公开题库小章映射", () => {
  test("25 个专题都有小章映射，所有资源恰好归属一次", () => {
    expect(CHAPTERS.length).toBe(25);
    for (const chapter of CHAPTERS) {
      const result = getLearningSections(chapter);
      expect(result, `缺少小章映射: ${chapter.id}`).not.toBeNull();

      const cardIds: string[] = [];
      const lessonIds: string[] = [];
      const challengeIds: string[] = [];
      for (const section of [...result!.sections, ...(result!.comprehensive ? [result!.comprehensive] : [])]) {
        expect(section.id.startsWith(`${chapter.id}::`)).toBe(true);
        expect(section.title.trim()).not.toBe("");
        cardIds.push(...section.cards.map((card) => card.id));
        lessonIds.push(...section.lessons.map((item) => item.id));
        challengeIds.push(...section.challenges.map((item) => item.id));
      }

      expect(cardIds.slice().sort(), `卡片归属不完整: ${chapter.id}`).toEqual(
        chapter.cards.map((card) => card.id).sort()
      );
      expect(
        lessonIds.slice().sort(),
        `练习归属不完整: ${chapter.id}`
      ).toEqual(chapter.lessons.map((item) => item.id).sort());
      expect(
        challengeIds.slice().sort(),
        `挑战归属不完整: ${chapter.id}`
      ).toEqual(chapter.challenges.map((item) => item.id).sort());
      expect(new Set(cardIds).size).toBe(cardIds.length);
      expect(new Set(lessonIds).size).toBe(lessonIds.length);
      expect(new Set(challengeIds).size).toBe(challengeIds.length);
    }
  });

  test("公开题库总量与小章数量符合映射核对值", () => {
    const cards = CHAPTERS.reduce((sum, chapter) => sum + chapter.cards.length, 0);
    const lessons = CHAPTERS.reduce(
      (sum, chapter) => sum + chapter.lessons.length,
      0
    );
    const challenges = CHAPTERS.reduce(
      (sum, chapter) => sum + chapter.challenges.length,
      0
    );
    const questions = CHAPTERS.reduce(
      (sum, chapter) =>
        sum +
        [...chapter.lessons, ...chapter.challenges].reduce(
          (count, item) => count + item.questions.length,
          0
        ),
      0
    );
    expect({ cards, lessons, challenges, questions }).toEqual({
      cards: 672,
      lessons: 399,
      challenges: 75,
      questions: 3846,
    });

    const sets = CHAPTERS.map((chapter) => getLearningSections(chapter)!);
    expect(
      sets.reduce((sum, set) => sum + set.sections.length, 0)
    ).toBe(75);
    expect(
      sets.reduce(
        (sum, set) => sum + (set.comprehensive ? 1 : 0),
        0
      )
    ).toBe(21);
  });

  test("C09 与 C10 的小章卡片数符合核对边界", () => {
    const counts = (chapterId: string) =>
      getLearningSections(CHAPTERS.find((chapter) => chapter.id === chapterId)!)!
        .sections.map((section) => section.cards.length);
    expect(counts("pub-c09-past-tenses")).toEqual([13, 7, 6, 15, 8]);
    expect(counts("pub-c10-object-pronouns")).toEqual([19, 8, 8, 7]);
  });

  test("映射键只对应公开题库的专题，且小章 ID 不重复", () => {
    const chapterIds = new Set(CHAPTERS.map((chapter) => chapter.id));
    for (const key of Object.keys(SECTION_MAP)) {
      expect(chapterIds.has(key), `映射包含未知专题: ${key}`).toBe(true);
    }
    const sectionIds = new Set<string>();
    for (const chapter of CHAPTERS) {
      const result = getLearningSections(chapter)!;
      for (const section of result.sections) {
        expect(sectionIds.has(section.id), `重复小章 ID: ${section.id}`).toBe(
          false
        );
        sectionIds.add(section.id);
      }
    }
  });

  test("C09 与 C10 分成多个有主题的小章，挑战留在专题综合区", () => {
    for (const chapterId of [
      "pub-c09-past-tenses",
      "pub-c10-object-pronouns",
    ]) {
      const chapter = CHAPTERS.find((item) => item.id === chapterId)!;
      const result = getLearningSections(chapter)!;
      expect(result.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of result.sections) {
        expect(section.cards.length, `空讲解小章: ${section.id}`).toBeGreaterThan(0);
        expect(section.lessons.length, `空练习小章: ${section.id}`).toBeGreaterThan(0);
        expect(section.title.trim()).not.toBe("");
      }
      expect(result.comprehensive?.challenges.length).toBe(
        chapter.challenges.length
      );
      expect(result.sections.every((section) => section.challenges.length === 0)).toBe(
        true
      );
    }
  });

  test("C01 与 C25 是单小章专题", () => {
    for (const chapterId of [
      "pub-c01-boundaries",
      "pub-c25-integration-review",
    ]) {
      const chapter = CHAPTERS.find((item) => item.id === chapterId)!;
      const result = getLearningSections(chapter)!;
      expect(result.sections.length).toBe(1);
      expect(result.sections[0]!.cards.length).toBe(chapter.cards.length);
      expect(result.sections[0]!.lessons.length).toBe(chapter.lessons.length);
      expect(result.sections[0]!.challenges.length).toBe(
        chapter.challenges.length
      );
      expect(result.comprehensive).toBeNull();
    }
  });

  test("内部题库和未知章节不套用公开映射", () => {
    const internalLike: Chapter = {
      ...CHAPTERS[0]!,
      id: "ch1",
      cards: CHAPTERS[0]!.cards.map((card) => ({
        ...card,
        id: card.id.replace(CHAPTERS[0]!.id, "ch1"),
      })),
    };
    expect(getLearningSections(internalLike)).toBeNull();
    expect(
      getLearningSections({ ...CHAPTERS[0]!, id: "pub-unknown" })
    ).toBeNull();
  });
});
