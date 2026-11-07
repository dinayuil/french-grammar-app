// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C05 present tense", () => {
  test("C05 follows C04 in the public chapter order", () => {
    expect(CHAPTERS.slice(0, 5).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
    ]);
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c05-present");
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
    ["l1-q2", "êtes", "etes"],
    ["l1-q4", "ai", "as"],
    ["l1-q8", "ont", "on"],
    ["l1-q12", "avons", "avez"],
    ["l1-q15", "vieilles", "vieux"],
    ["l1-q19", "nouvelles", "nouveaux"],
    ["l2-q2", "chantes", "chanté"],
    ["l2-q3", "habitent", "habite"],
    ["l2-q16", "préfère", "préfere"],
    ["l2-q19", "écoute", "écoutes"],
    ["l3-q10", "essuies", "essuie"],
    ["l4-q2", "finis", "fini"],
    ["l5-q15", "achètent", "achète"],
    ["l5-q18", "écoute", "écoutes"],
    ["l6-q7", "sont", "est"],
    ["l7-q5", "pleut", "pleuvent"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c05-present");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c05-present-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });

  test("无人称动词与主谓一致：正确项与干扰项形式不同", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c05-present");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === "pub-c05-present-x2-q1");
    expect(question).toBeDefined();
    if (!question || question.type !== "choice") throw new Error("x2-q1 应为 choice");
    const correctOption = question.options[question.answer];
    expect(correctOption).toBeDefined();
    expect(correctOption).toContain("pleut");
    expect(judge(question, question.answer)).toBe(true);
  });
});
