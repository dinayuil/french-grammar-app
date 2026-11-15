// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C01 word boundaries", () => {
  test("the new first chapter is loaded first in the public bank", () => {
    expect(CHAPTERS[0]?.id).toBe("pub-c01-boundaries");
  });

  test.each([
    ["l2-q1", "l'", "le"], // hôtel: mute h
    ["l2-q2", "le", "l'"], // héros: aspirated h
    ["l3-q1", "au", "à le"],
    ["l4-q1", "des", "de les"],
    ["l6-q1", "j'écoute", "je écoute"],
    ["l7-q1", "d'attendre", "de attendre"],
  ])("%s accepts the grammatical form and rejects the boundary error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c01-boundaries-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });

  test.each([
    ["l7-q1", "Il est difficile d'attendre."],
    ["l7-q2", "Il est utile d'écouter."],
    ["x3-q4", "Il est difficile d'attendre."],
  ])("%s renders the completed target without duplicating the lexical cue", (suffix, target) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c01-boundaries-${suffix}`);
    expect(question).toBeDefined();
    if (question) expect(completedQuestion(question).prompt.split("→").slice(-1)[0]?.trim()).toBe(target);
  });

  test("the habiter exercise accepts the valid variant without a preposition", () => {
    const question = CHAPTERS.find((chapter) => chapter.id === "pub-c01-boundaries")
      ?.lessons.find((lesson) => lesson.id === "pub-c01-boundaries-l6")
      ?.questions.find((item) => item.id === "pub-c01-boundaries-l6-q5");
    expect(question).toBeDefined();
    if (question) expect(judge(question, ["J'habite", "Lyon."])).toBe(true);
  });

  test("chapter title names articles and basic spelling", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    expect(chapter?.title).toBe("冠词与基本拼写规则");
    expect(chapter?.titleFr).toBe("Articles et règles de base de l'écriture");
  });

  test("cards follow the approved article-then-spelling sequence", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    expect(chapter?.cards.map((card) => card.id)).toEqual([
      "pub-c01-boundaries-card-gender-number",
      "pub-c02-noun-phrases-card-u6-1",
      "pub-c01-boundaries-card-1",
      "pub-c02-noun-phrases-card-u6-2",
      "pub-c02-noun-phrases-card-u6-3",
      "pub-c01-boundaries-card-2",
      "pub-c01-boundaries-card-3",
      "pub-c01-boundaries-card-4",
      "pub-c01-boundaries-card-du-des",
      "pub-c01-boundaries-card-5",
      "pub-c01-boundaries-card-6",
      "pub-c01-boundaries-card-7",
    ]);
    expect(chapter?.cards.map((card) => card.id)).not.toContain(
      "pub-c01-boundaries-card-8"
    );
  });

  test("moved C02 article lessons sit after the spelling lessons and keep their IDs", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    expect(chapter?.lessons.map((lesson) => lesson.id)).toEqual([
      "pub-c01-boundaries-l1",
      "pub-c01-boundaries-l2",
      "pub-c01-boundaries-l3",
      "pub-c01-boundaries-l4",
      "pub-c01-boundaries-l5",
      "pub-c02-noun-phrases-l6-1",
      "pub-c02-noun-phrases-l6-2",
      "pub-c01-boundaries-l6",
      "pub-c01-boundaries-l7",
      "pub-c01-boundaries-l8",
    ]);
    expect(chapter?.challenges.map((item) => item.id)).toEqual([
      "pub-c01-boundaries-x1",
      "pub-c01-boundaries-x2",
      "pub-c01-boundaries-x3",
    ]);
  });

  test("moved C02 lessons keep original question IDs and stay judgeable", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    const moved = chapter?.lessons.filter((lesson) =>
      lesson.id.startsWith("pub-c02-noun-phrases-l6-")
    );
    expect(moved?.map((lesson) => lesson.id)).toEqual([
      "pub-c02-noun-phrases-l6-1",
      "pub-c02-noun-phrases-l6-2",
    ]);
    expect(moved?.map((lesson) => lesson.questions.length)).toEqual([6, 6]);
    expect(moved?.map((lesson) => lesson.questions.map((question) => question.id))).toEqual([
      [
        "pub-c02-noun-phrases-l6-q1",
        "pub-c02-noun-phrases-l6-q2",
        "pub-c02-noun-phrases-l6-q3",
        "pub-c02-noun-phrases-l6-q4",
        "pub-c02-noun-phrases-l6-q5",
        "pub-c02-noun-phrases-l6-q6",
      ],
      [
        "pub-c02-noun-phrases-l6-q7",
        "pub-c02-noun-phrases-l6-q8",
        "pub-c02-noun-phrases-l6-q9",
        "pub-c02-noun-phrases-l6-q10",
        "pub-c02-noun-phrases-l6-q11",
        "pub-c02-noun-phrases-l6-q12",
      ],
    ]);

    for (const lesson of moved ?? []) {
      for (const question of lesson.questions) {
        expect(
          judge(question, question.answer),
          `${question.id} 的原答案应判为正确`
        ).toBe(true);
        expect(
          completedQuestion(question).prompt.trim(),
          `${question.id} 应能生成完成题干`
        ).not.toBe("");
      }
    }
  });

  test("C01 cards no longer reference deleted cards or old numeric card/unit labels", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c01-boundaries");
    const bodies = chapter?.cards.map((card) => card.body ?? "").join("\n") ?? "";
    expect(bodies).not.toMatch(/局部综合/);
    expect(bodies).not.toMatch(/第\s*\d+\s*(张|单元)/);
  });
});
