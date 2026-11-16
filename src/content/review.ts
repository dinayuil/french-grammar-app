import { reviewQueue } from "../engine";
import { CHAPTERS } from "./index";
import type { Lesson, MistakeInfo, Progress, Question } from "../types";

export interface ReviewLessonLabels {
  title: string;
  source: string;
}

/**
 * 从进度里的错题清单组装一关:错得最久的优先,每关最多 10 题;无错题返回 null。
 *
 * 队列只保存基础题目身份，不解析也不冻结任何语言的展示文案；视图渲染时
 * 再按当前 locale 解析题干、选项、解析和译文。labels 只用于应用生成关卡
 * 的标题/来源元数据，切换语言后由调用方以当前语言重新覆盖。
 */
export function buildReviewLesson(
  progress: Progress,
  labels: ReviewLessonLabels
): Lesson | null {
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
    title: labels.title,
    kind: "lesson",
    source: labels.source,
    questions,
  };
}
