// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C02 noun phrases", () => {
  test("C02 follows C01 in the public chapter order", () => {
    expect(CHAPTERS.slice(0, 2).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries", "pub-c02-noun-phrases",
    ]);
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c02-noun-phrases");
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
      // 少数题干在说明文字里自有「—」(如“— 表示不加任何词”),补全既不能新增
      // 也不能误删这些说明破折号,因此要求补全前后数量严格相等。
      const dashesBefore = (question.prompt.match(/—/g) ?? []).length;
      const dashesAfter = (completed.match(/—/g) ?? []).length;
      if (/___|\.\.\.|\s{2,}/.test(completed) || dashesAfter !== dashesBefore) {
        problems.push(`${question.id}: 补全题干残留占位符或双空格 ${JSON.stringify(completed)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test.each([
    ["l2-q1", "voisine", "voisin"],
    ["l2-q2", "boulangère", "boulangere"],
    ["l2-q3", "musicienne", "musiciene"],
    ["l2-q4", "chatte", "chate"],
    ["l5-q1", "travaux", "travails"],
    ["l5-q2", "détails", "détaux"],
    ["l5-q3", "festivals", "festivaux"],
    ["l5-q4", "nez", "nezs"],
    ["l5-q5", "yeux", "œils"],
    ["l5-q6", "bureaux", "bureaus"],
  ])("%s accepts the target noun form and rejects the morphology error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c02-noun-phrases");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c02-noun-phrases-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
