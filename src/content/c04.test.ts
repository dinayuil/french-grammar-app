// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C04 determiners", () => {
  test("C04 follows C03 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 4).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(
      expect.arrayContaining(["pub-predication", "pub-articles", "pub-agreement"]),
    );
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c04-determiners");
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
    ["l1-q5", "cet", "ce"],
    ["l1-q9", "ces", "ce"],
    ["l3-q1", "sa", "son"],
    ["l3-q5", "ma", "mon"],
    ["l4-q1", "notre", "nos"],
    ["l4-q3", "nos", "notre"],
    ["l4-q9", "son", "sa"],
    ["l6-q2", "chaque", "chaques"],
    ["l7-q4", "plupart", "pluspart"],
    ["l8-q1", "toute", "tout"],
    ["l8-q7", "mêmes", "mème"],
    ["l8-q9", "d'autres", "d'autre"],
    ["l9-q5", "ces", "ses"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c04-determiners");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c04-determiners-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });

  test("la plupart 作主语时动词取复数", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c04-determiners");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === "pub-c04-determiners-l7-q1");
    expect(question).toBeDefined();
    if (!question || question.type !== "choice") throw new Error("l7-q1 应为 choice");
    const correctOption = question.options[question.answer];
    expect(correctOption).toBeDefined();
    expect(correctOption).toContain("sont");
    expect(judge(question, question.answer)).toBe(true);
  });

  test("ces/ses 同音辨义：正确项与干扰项拼写不同", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c04-determiners");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === "pub-c04-determiners-l9-q1");
    expect(question).toBeDefined();
    if (!question || question.type !== "choice") throw new Error("l9-q1 应为 choice");
    const correctOption = question.options[question.answer];
    expect(correctOption).toBeDefined();
    expect(/ces|ses/.test(correctOption)).toBe(true);
    expect(judge(question, question.answer)).toBe(true);
  });
});
