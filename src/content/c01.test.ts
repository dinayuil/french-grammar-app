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
});
