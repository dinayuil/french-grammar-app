// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C02 noun phrases", () => {
  test("C02 follows C01 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 2).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries", "pub-c02-noun-phrases",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(expect.arrayContaining([
      "pub-predication", "pub-articles", "pub-agreement",
    ]));
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
