// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C03 adjectives", () => {
  test("C03 follows C02 in the public chapter order", () => {
    expect(CHAPTERS.slice(0, 3).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries", "pub-c02-noun-phrases", "pub-c03-adjectives",
    ]);
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c03-adjectives");
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
      const dashesBefore = (question.prompt.match(/—/g) ?? []).length;
      const dashesAfter = (completed.match(/—/g) ?? []).length;
      if (/___|\.\.\.|\s{2,}/.test(completed) || dashesAfter !== dashesBefore) {
        problems.push(`${question.id}: 补全题干残留占位符或双空格 ${JSON.stringify(completed)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test.each([
    ["l1-q1", "grande", "grand"],
    ["l1-q2", "petite", "petit"],
    ["l1-q3", "jolie", "joli"],
    ["l1-q4", "calme", "calmee"],
    ["l1-q5", "rapide", "rapidee"],
    ["l2-q1", "première", "premiere"],
    ["l2-q2", "complète", "complete"],
    ["l2-q3", "muette", "muete"],
    ["l2-q4", "fraîche", "fraiche"],
    ["l3-q1", "blanche", "blance"],
    ["l3-q2", "publique", "publice"],
    ["l3-q3", "longue", "longe"],
    ["l4-q1", "neuve", "neuf"],
    ["l4-q2", "brève", "breve"],
    ["l4-q3", "heureuse", "heureuxe"],
    ["l4-q4", "meilleure", "meilleurse"],
    ["l5-q1", "gentille", "gentile"],
    ["l5-q2", "bonne", "bone"],
    ["l5-q3", "jalouse", "jalouxe"],
    ["l5-q4", "grise", "grisse"],
    ["l5-q5", "grosse", "grose"],
    ["l5-q6", "douce", "douse"],
    ["l5-q7", "fausse", "fauce"],
    ["l6-q1", "petits", "petit"],
    ["l6-q2", "heureux", "heureuxs"],
    ["l6-q3", "heureuses", "heureux"],
    ["l8-q1", "nationaux", "nationals"],
    ["l8-q2", "nouveaux", "nouveaus"],
    ["l9-q1", "belle", "bele"],
    ["l9-q2", "beaux", "beaus"],
    ["l9-q3", "nouvelle", "nouvel"],
    ["l9-q4", "vieille", "vielle"],
    ["l9-q5", "vieilles", "vieux"],
    ["l9-q6", "bel", "beau"],
    ["l9-q7", "nouvel", "nouveau"],
    ["l9-q8", "vieil", "vieux"],
  ])("%s accepts the target adjective form and rejects the morphology error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c03-adjectives");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c03-adjectives-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });

  test("l11-q1 choice uses de or d' before the plural adjective", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c03-adjectives");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === "pub-c03-adjectives-l11-q1");
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("choice");
    if (question.type !== "choice") return;
    const correctOption = question.options[question.answer];
    expect(correctOption).toBeDefined();
    expect(correctOption.startsWith("de ") || correctOption.startsWith("d'")).toBe(true);
    expect(judge(question, question.answer)).toBe(true);
  });
});
