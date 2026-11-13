import type { Chapter, Lesson } from "../types";
import type { SectionMap } from "../learning/sections";

function choiceLesson(
  id: string,
  title: string,
  prompt: string,
  kind: Lesson["kind"] = "lesson"
): Lesson {
  return {
    id,
    title,
    kind,
    source: "原创测试",
    questions: [
      {
        id: `${id}-q1`,
        prompt,
        explain: "选择正确答案。",
        type: "choice",
        options: ["bonne", "mauvaise"],
        answer: 0,
      },
    ],
  };
}

export const sectionedChapter: Chapter = {
  id: "sec-demo",
  title: "分区演示专题",
  titleFr: "Dossier de démonstration",
  cards: [
    {
      id: "sec-demo-card-u1-1",
      title: "主题一讲解一",
      body: "主题一的第一张讲解。",
    },
    {
      id: "sec-demo-card-u1-2",
      title: "主题一讲解二",
      body: "主题一的第二张讲解。",
    },
    {
      id: "sec-demo-card-u2-1",
      title: "主题二讲解一",
      body: "主题二的第一张讲解。",
    },
    {
      id: "sec-demo-card-u2-2",
      title: "主题二讲解二",
      body: "主题二的第二张讲解。",
    },
    {
      id: "sec-demo-card-u2-3",
      title: "主题二讲解三",
      body: "主题二的第三张讲解。",
    },
  ],
  lessons: [
    choiceLesson(
      "sec-demo-l1-1",
      "主题一练习一",
      "Première question du thème un."
    ),
    choiceLesson(
      "sec-demo-l1-2",
      "主题一练习二",
      "Deuxième question du thème un."
    ),
    choiceLesson(
      "sec-demo-l2-1",
      "主题二练习一",
      "Question du thème deux."
    ),
  ],
  challenges: [
    choiceLesson(
      "sec-demo-x1",
      "综合挑战一",
      "Premier défi global.",
      "challenge"
    ),
    choiceLesson(
      "sec-demo-x2",
      "综合挑战二",
      "Deuxième défi global.",
      "challenge"
    ),
  ],
};

export const legacyChapter: Chapter = {
  id: "legacy-demo",
  title: "整章回退专题",
  titleFr: "Dossier sans sections",
  cards: [
    {
      id: "legacy-demo-card-1",
      title: "整章讲解",
      body: "未配置小章时仍按整章显示。",
    },
  ],
  lessons: [
    choiceLesson(
      "legacy-demo-l1",
      "整章练习一",
      "Question du dossier complet un."
    ),
    choiceLesson(
      "legacy-demo-l2",
      "整章练习二",
      "Question du dossier complet deux."
    ),
  ],
  challenges: [
    choiceLesson(
      "legacy-demo-x1",
      "整章挑战",
      "Défi du dossier complet.",
      "challenge"
    ),
  ],
};

export const sectionedChapters: Chapter[] = [sectionedChapter, legacyChapter];

export const sectionedMap: SectionMap = {
  [sectionedChapter.id]: {
    sections: [
      {
        key: "basics",
        title: "主题一 · 基础",
        cardIds: ["sec-demo-card-u1-1", "sec-demo-card-u1-2"],
        lessonIds: ["sec-demo-l1-1", "sec-demo-l1-2"],
      },
      {
        key: "advanced",
        title: "主题二 · 进阶",
        cardIds: [
          "sec-demo-card-u2-1",
          "sec-demo-card-u2-2",
          "sec-demo-card-u2-3",
        ],
        lessonIds: ["sec-demo-l2-1"],
      },
    ],
    comprehensive: {
      challengeIds: ["sec-demo-x1", "sec-demo-x2"],
    },
  },
};
