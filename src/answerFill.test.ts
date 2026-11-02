import { completedQuestion } from "./answerFill";
import type { ChoiceQuestion, LettersQuestion, TilesQuestion } from "./types";

const choice = (over: Partial<ChoiceQuestion>): ChoiceQuestion => ({
  id: "c",
  prompt: "",
  explain: "",
  type: "choice",
  options: ["sur", "sous"],
  answer: 0,
  ...over,
});

const letters = (over: Partial<LettersQuestion>): LettersQuestion => ({
  id: "l",
  prompt: "",
  explain: "",
  type: "letters",
  answer: "",
  ...over,
});

const tiles = (over: Partial<TilesQuestion>): TilesQuestion => ({
  id: "t",
  prompt: "",
  explain: "",
  type: "tiles",
  answer: [],
  bank: [],
  ...over,
});

test("choice:单个 ... 填入正确选项", () => {
  expect(completedQuestion(choice({ prompt: "La clé est ... la table." }))).toEqual({
    prompt: "La clé est sur la table.",
    target: null,
  });
});

test("choice:多空位组答按顺序逐空填入选项各部分", () => {
  expect(
    completedQuestion(
      choice({ prompt: "① ___ sac. ② la porte ___ garage.", options: ["le / du", "un / du"], answer: 1 })
    )
  ).toEqual({
    prompt: "① un sac. ② la porte du garage.",
    target: null,
  });
});

test("choice:多空位中 — 表示不加词并收拢空格", () => {
  expect(
    completedQuestion(
      choice({
        prompt: "① J'ai beaucoup ___ livres. ② J'ai deux ___ livres.",
        options: ["de / de", "de / —"],
        answer: 1,
      })
    )
  ).toEqual({
    prompt: "① J'ai beaucoup de livres. ② J'ai deux livres.",
    target: null,
  });
});

test("choice:单空位含' / '的选项仍整体填入", () => {
  expect(
    completedQuestion(choice({ prompt: "C'est ___ belle journée.", options: ["un / une", "une"], answer: 0 }))
  ).toEqual({
    prompt: "C'est un / une belle journée.",
    target: null,
  });
});

test("choice:双空题只填指定空并去掉标记", () => {
  expect(
    completedQuestion(
      choice({ prompt: "Nous allons ... marché et ... piscine.(第1空)", options: ["au", "à la"], answer: 0 })
    )
  ).toEqual({
    prompt: "Nous allons au marché et ... piscine.",
    target: null,
  });
  expect(
    completedQuestion(
      choice({ prompt: "Nous allons ... marché et ... piscine.(第2空)", options: ["au", "à la"], answer: 1 })
    )
  ).toEqual({
    prompt: "Nous allons ... marché et à la piscine.",
    target: null,
  });
});

test("letters:___ 填入答案", () => {
  expect(completedQuestion(letters({ prompt: "La fleur est ___.", answer: "rose" }))).toEqual({
    prompt: "La fleur est rose.",
    target: null,
  });
});

test("letters:... 词尾题拼回完整单词", () => {
  expect(completedQuestion(letters({ prompt: "C'est une mont ... .", answer: "agne" }))).toEqual({
    prompt: "C'est une montagne.",
    target: null,
  });
  expect(completedQuestion(letters({ prompt: "C'est une rich ... .", answer: "esse" }))).toEqual({
    prompt: "C'est une richesse.",
    target: null,
  });
});

test("letters:(être) 替换为变位", () => {
  expect(completedQuestion(letters({ prompt: "Le livre (être) neuf.", answer: "est" }))).toEqual({
    prompt: "Le livre est neuf.",
    target: null,
  });
});

test("letters:(avoir) 替换并处理 je → j' 省音", () => {
  expect(completedQuestion(letters({ prompt: "Je (avoir) un vélo.", answer: "ai" }))).toEqual({
    prompt: "J'ai un vélo.",
    target: null,
  });
  expect(completedQuestion(letters({ prompt: "C' (être) une idée.", answer: "est" }))).toEqual({
    prompt: "C'est une idée.",
    target: null,
  });
});

test("tiles:题干不变,返回完整目标句", () => {
  expect(
    completedQuestion(
      tiles({
        prompt: "改成否定句:La pluie tombe.",
        answer: ["La", "pluie", "ne", "tombe", "pas."],
        bank: ["La", "pluie", "ne", "tombe", "pas."],
      })
    )
  ).toEqual({
    prompt: "改成否定句:La pluie tombe.",
    target: "La pluie ne tombe pas.",
  });
});
