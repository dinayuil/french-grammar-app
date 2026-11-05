// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C06 irregular verbs", () => {
  test("C06 follows C05 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 6).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(
      expect.arrayContaining(["pub-predication", "pub-articles", "pub-agreement"]),
    );
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c06-verbs");
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
    ["l1-q2", "vont", "va"],
    ["l1-q5", "allez", "allons"],
    ["l1-q7", "viens", "vient"],
    ["l1-q13", "veulent", "veut"],
    ["l1-q18", "doivent", "doit"],
    ["l1-q21", "savons", "savez"],
    ["l1-q23", "font", "faisons"],
    ["l1-q28", "dites", "dis"],
    ["l2-q2", "prennent", "prend"],
    ["l2-q7", "mettez", "mettons"],
    ["l2-q10", "mettent", "met"],
    ["l2-q12", "ouvrent", "ouvre"],
    ["l2-q17", "conduisent", "conduit"],
    ["l2-q22", "écrivent", "écrit"],
    ["l2-q27", "lit", "lis"],
    ["l3-q2", "connaissent", "connaît"],
    ["l3-q7", "reconnaissez", "reconnaissons"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c06-verbs");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c06-verbs-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
