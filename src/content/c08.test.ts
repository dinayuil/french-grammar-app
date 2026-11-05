// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C08 imperative and emphasis", () => {
  test("C08 follows C07 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 8).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
      "pub-c07-negation-questions",
      "pub-c08-imperative-emphasis",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(
      expect.arrayContaining(["pub-predication", "pub-articles", "pub-agreement"]),
    );
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c08-imperative-emphasis");
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
    ["l1-q2", "ferme", "fermes"],
    ["l1-q5", "finis", "finit"],
    ["l1-q10", "va", "vas"],
    ["l1-q13", "dites", "disez"],
    ["l1-q16", "recevez", "recevons"],
    ["l1-q20", "soyez", "êtes"],
    ["l1-q22", "aie", "as"],
    ["l2-q2", "parle", "parles"],
    ["l3-q6", "sont", "êtes"],
    ["l3-q7", "est", "es"],
    ["l4-q5", "avez", "avons"],
    ["l5-q6", "allons", "allez"],
    ["x1-q5", "Offrez", "Offres"],
    ["x1-q6", "Prends", "Prend"],
    ["x1-q7", "Soyez", "Soyes"],
    ["x2-q10", "arrivent", "arrivez"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c08-imperative-emphasis");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c08-imperative-emphasis-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
