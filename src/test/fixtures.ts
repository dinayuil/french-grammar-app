import type { Chapter, Question } from "../types";

const placeholderQuestion: Question = {
  id: "placeholder-q",
  prompt: "Placeholder",
  explain: "Placeholder explain.",
  type: "choice",
  options: ["A", "B"],
  answer: 0,
};

/**
 * 通用测试专用的合成章节。
 *
 * 这里的法语内容全部为测试而原创,不对应任何正式题库;正式内容入口
 * (src/content/index.ts)不得 import 本文件。三种题型、范例、翻译、
 * alternatives 与干扰项都在此覆盖,供 UI/行为测试使用。
 */
export const syntheticChapter: Chapter = {
  id: "synth-ch1",
  title: "合成测试章",
  titleFr: "Chapitre synthétique",
  cards: [
    {
      id: "synth-ch1-c1",
      title: "合成卡片一",
      body: "这是第一张合成测试卡片,仅用于界面行为验证。",
    },
    {
      id: "synth-ch1-c2",
      title: "合成卡片二",
      body: "这是第二张合成测试卡片,用于验证翻页与完成按钮。",
    },
  ],
  lessons: [
    {
      id: "synth-ch1-l1",
      title: "合成练习一",
      kind: "lesson",
      source: "原创测试",
      questions: [
        {
          id: "synth-ch1-l1-q1",
          prompt: "Le ciel est ___ aujourd'hui.",
          explain: "形容词与单数主语配合,填 bleu。",
          example: "ciel — bleu → Le ciel est bleu aujourd'hui.",
          translation: "今天天空是蓝色的。",
          type: "letters",
          answer: "bleu",
          alternatives: ["bleu clair"],
          accentKeys: ["é", "è", "ç"],
          decoys: ["a", "u"],
        },
        {
          id: "synth-ch1-l1-q2",
          prompt: "La clé est ... la petite table.",
          explain: "表示位置用 sur。",
          example: "clé — table → La clé est sur la petite table.",
          translation: "钥匙在小桌子上。",
          type: "choice",
          options: ["sur", "sous"],
          answer: 0,
          alternatives: [1],
        },
        {
          id: "synth-ch1-l1-q3",
          prompt: "改成否定句:Le train arrive tôt.",
          explain: "否定用 ne … pas 包住动词。",
          example: "肯定 → 否定:Le train arrive tôt. → Le train n'arrive pas tôt.",
          translation: "火车到得早。",
          type: "tiles",
          answer: ["Le", "train", "n'", "arrive", "pas", "tôt."],
          alternatives: [["Le", "train", "n'", "arrive", "pas", "tôt"]],
          bank: ["Le", "train", "n'", "arrive", "pas", "tôt.", "vite", "gare"],
        },
      ],
    },
    {
      id: "synth-ch1-l2",
      title: "合成练习二",
      kind: "lesson",
      source: "原创测试",
      questions: [
        {
          id: "synth-ch1-l2-q1",
          prompt: "Nous ___ prêts pour le départ.",
          explain: "主语 nous 用 sommes。",
          example: "départ — prêt → Nous sommes prêts pour le départ.",
          translation: "我们准备好出发了。",
          type: "letters",
          answer: "sommes",
          accentKeys: ["é", "ê"],
        },
      ],
    },
  ],
  challenges: [
    {
      id: "synth-ch1-x1",
      title: "合成挑战一",
      kind: "challenge",
      source: "原创测试",
      questions: [
        {
          id: "synth-ch1-x1-q1",
          prompt: "Choisis la forme correcte: ___ une belle journée.",
          explain: "天气表达用 C'est。",
          translation: "今天是个好天气。",
          type: "choice",
          options: ["C'est", "Ce sont"],
          answer: 0,
        },
      ],
    },
  ],
};

export const libraryChapters: Chapter[] = [
  {
    id: "lib-ch1",
    title: "第一讲解章",
    titleFr: "Chapitre d'explication I",
    cards: [
      {
        id: "lib-ch1-card-u1-1",
        title: "Été 与季节",
        body: "En été, il fait chaud.\n第二行。",
      },
      {
        id: "lib-ch1-card-u1-2",
        title: "否定基础",
        body: "ne … pas 夹住动词。",
      },
      {
        id: "lib-ch1-card-u2-1",
        title: "冠词与缩合",
        body: "à + le → au。",
      },
    ],
    lessons: [
      {
        id: "lib-ch1-l1",
        title: "第一讲解章练习",
        kind: "lesson",
        source: "测试",
        questions: [placeholderQuestion],
      },
    ],
    challenges: [],
  },
  {
    id: "lib-ch2",
    title: "第二讲解章",
    titleFr: "Chapitre d'explication II",
    cards: [
      {
        id: "lib-ch2-card-1",
        title: "扁平卡片",
        body: "只有第一行。\n第二行不应出现。",
      },
    ],
    lessons: [
      {
        id: "lib-ch2-l1",
        title: "第二讲解章练习",
        kind: "lesson",
        source: "测试",
        questions: [placeholderQuestion],
      },
    ],
    challenges: [],
  },
];
