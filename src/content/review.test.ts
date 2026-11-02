import { buildReviewLesson } from "./review";
import { CHAPTERS } from "./index";
import type { Progress } from "../types";

function allQuestionIds(): string[] {
  const ids = new Set<string>();
  for (const ch of CHAPTERS) {
    for (const l of [...ch.lessons, ...ch.challenges]) {
      for (const q of l.questions) ids.add(q.id);
    }
  }
  return [...ids];
}

const validIds = allQuestionIds();

const progressWith = (mistakes: Progress["mistakes"]): Progress =>
  ({ mistakes }) as Progress;

describe("buildReviewLesson(错题回顾)", () => {
  test("陈旧错题不占名额:12 条中仅 7 条有效 → 只返回 7 道有效题", () => {
    const selected = validIds.slice(0, 7);
    expect(selected).toHaveLength(7);

    const mistakes: Progress["mistakes"] = {};
    for (let i = 1; i <= 5; i++) {
      mistakes[`deleted-q${i}`] = { lastWrong: `2025-01-0${i}`, count: 1 };
    }
    selected.forEach((qid, i) => {
      mistakes[qid] = { lastWrong: `2026-02-${String(i + 1).padStart(2, "0")}`, count: 1 };
    });

    const lesson = buildReviewLesson(progressWith(mistakes));

    expect(lesson).not.toBeNull();
    expect(lesson!.questions).toHaveLength(7);
    expect(lesson!.questions.map((q) => q.id)).toEqual(selected);
    expect(lesson!.questions.every((q) => validIds.includes(q.id))).toBe(true);
    expect(lesson!.questions.some((q) => q.id.startsWith("deleted-q"))).toBe(false);
  });

  test("错题全部失效 → 返回 null", () => {
    const mistakes: Progress["mistakes"] = {
      "deleted-q1": { lastWrong: "2025-01-01", count: 1 },
      "deleted-q2": { lastWrong: "2025-02-01", count: 3 },
    };

    expect(buildReviewLesson(progressWith(mistakes))).toBeNull();
  });

  test("两道有效错题 → 按 lastWrong 由早到晚返回", () => {
    const [older, newer] = validIds;
    expect(older).toBeDefined();
    expect(newer).toBeDefined();

    const lesson = buildReviewLesson(
      progressWith({
        [newer]: { lastWrong: "2025-05-01", count: 1 },
        [older]: { lastWrong: "2025-04-01", count: 2 },
      })
    );

    expect(lesson).not.toBeNull();
    expect(lesson!.title).toBe("错题回顾");
    expect(lesson!.source).toBe("错题本");
    expect(lesson!.questions.map((q) => q.id)).toEqual([older, newer]);
  });
});
