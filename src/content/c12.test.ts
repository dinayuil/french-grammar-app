// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C12 demonstrative, possessive and indefinite pronouns", () => {
  test("C12 follows C11 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 12).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
      "pub-c07-negation-questions",
      "pub-c08-imperative-emphasis",
      "pub-c09-past-tenses",
      "pub-c10-object-pronouns",
      "pub-c11-pronominal-verbs",
      "pub-c12-demonstrative-possessive-indefinite",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(
      expect.arrayContaining(["pub-predication", "pub-articles", "pub-agreement"]),
    );
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find(
      (item) => item.id === "pub-c12-demonstrative-possessive-indefinite",
    );
    expect(chapter).toBeDefined();
    if (!chapter) return;
    const multiBlank = [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .filter((item): item is ChoiceQuestion => {
        if (item.type !== "choice") return false;
        return (item.prompt.match(/___|\.\.\./g) ?? []).length > 1;
      });
    expect(multiBlank.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const question of multiBlank) {
      const blanks = (question.prompt.match(/___|\.\.\./g) ?? []).length;
      for (const option of question.options) {
        const parts = option.split(" / ").length;
        if (parts !== blanks) {
          problems.push(`${question.id}: 选项「${option}」分槽 ${parts} ≠ 空数 ${blanks}`);
        }
      }
      const completed = completedQuestion(question).prompt;
      if (/___|\.\.\.|\s{2,}/.test(completed)) {
        problems.push(`${question.id}: 补全题干残留占位符或双空格 ${JSON.stringify(completed)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test.each([
    ["l1-q7", "celles", "celui"],
    ["l2-q2", "tien", "tienne"],
    ["l3-q9", "autres", "autre"],
    ["l4-q2", "chacun", "chacune"],
    ["l5-q2", "personne", "personnes"],
    ["l6-q3", "ça", "ca"],
    ["x1-q3", "nôtre", "notre"],
    ["x2-q5", "d'autres", "d'autre"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find(
      (item) => item.id === "pub-c12-demonstrative-possessive-indefinite",
    );
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c12-demonstrative-possessive-indefinite-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
