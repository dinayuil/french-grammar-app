import { reviewQueue } from "../engine";
import { CHAPTERS } from "./index";
import type { Lesson, MistakeInfo, Progress, Question } from "../types";

/** 从进度里的错题清单组装一关:错得最久的优先,每关最多 10 题;无错题返回 null。 */
export function buildReviewLesson(progress: Progress): Lesson | null {
  const index = new Map<string, Question>();
  for (const ch of CHAPTERS) {
    for (const l of [...ch.lessons, ...ch.challenges]) {
      for (const q of l.questions) index.set(q.id, q);
    }
  }
  // 先剔除已被删除的题目,避免陈旧错题占满 10 个名额。
  const currentMistakes: Record<string, MistakeInfo> = {};
  for (const [qid, info] of Object.entries(progress.mistakes)) {
    if (index.has(qid)) currentMistakes[qid] = info;
  }
  const qids = reviewQueue(currentMistakes);
  if (qids.length === 0) return null;
  const questions = qids
    .map((qid) => index.get(qid))
    .filter((q): q is Question => q !== undefined);
  if (questions.length === 0) return null;
  return {
    id: "review",
    title: "错题回顾",
    kind: "lesson",
    source: "错题本",
    questions,
  };
}
