import { useEffect, useRef, useState } from "react";
import type { Chapter, Progress } from "../types";
import { today } from "../storage";
import { streakFor } from "../engine";
import { GoalRing } from "../components/GoalRing";
import { StreakFlame } from "../components/StreakFlame";
import { LevelBar } from "../components/LevelBar";

/** 减少动效偏好;缺少 matchMedia 或查询异常时按不减少处理。 */
function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface Props {
  chapters: Chapter[];
  progress: Progress;
  openChapterId?: string;
  onOpenLesson: (chapterId: string, lessonId: string) => void;
  onOpenCards: (chapterId: string) => void;
  onOpenReview: () => void;
}

export function HomeView({
  chapters,
  progress,
  openChapterId,
  onOpenLesson,
  onOpenCards,
  onOpenReview,
}: Props) {
  const [openChapter, setOpenChapter] = useState<string | null>(openChapterId ?? null);
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const toggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const handledOpenChapter = useRef<string | null>(null);

  useEffect(() => {
    if (openChapterId === undefined) {
      setOpenChapter(null);
      return;
    }
    if (!chapters.some((ch) => ch.id === openChapterId)) {
      setOpenChapter(null);
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    setOpenChapter(openChapterId);
  }, [openChapterId, chapters]);

  // 只对本次 openChapterId 执行一次滚动/聚焦;用户手动折叠后再展开不会重复拉回。
  useEffect(() => {
    if (!openChapterId || openChapter !== openChapterId) return;
    if (handledOpenChapter.current === openChapterId) return;
    handledOpenChapter.current = openChapterId;

    const card = chapterRefs.current[openChapterId];
    card?.scrollIntoView?.({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });

    const toggle = toggleRefs.current[openChapterId];
    if (toggle) {
      try {
        toggle.focus({ preventScroll: true });
      } catch {
        toggle.focus();
      }
    }
  }, [openChapterId, openChapter]);

  const t = today();
  const todayXp = progress.days[t]?.xp ?? 0;
  const streak = streakFor(progress.days, progress.dailyGoal, t);

  // 只统计当前题库中实际存在的可玩题目;空题库或仅有旧错题时禁用练习/复习
  const playableQuestionIds = new Set<string>();
  for (const ch of chapters) {
    for (const l of [...ch.lessons, ...ch.challenges]) {
      for (const q of l.questions) {
        playableQuestionIds.add(q.id);
      }
    }
  }
  const hasPlayableContent = playableQuestionIds.size > 0;
  const reviewCount = Object.keys(progress.mistakes).filter((qid) =>
    playableQuestionIds.has(qid)
  ).length;

  return (
    <div className="home">
      <div className="home-hero">
        <StreakFlame count={streak} />
        <GoalRing done={todayXp} goal={progress.dailyGoal} />
        <LevelBar xp={progress.xp} />
      </div>

      <button
        className="btn btn-review"
        disabled={reviewCount === 0}
        onClick={() => onOpenReview()}
      >
        🔁 复习错题
        {reviewCount > 0 && <span className="review-count">{reviewCount}</span>}
      </button>

      {!hasPlayableContent ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">原创题库正在准备中</div>
        </div>
      ) : (
        <div className="chapter-list">
          {chapters.map((ch, index) => {
            const open = openChapter === ch.id;
            // 编号统一由显示顺序生成,章节标题不得自带「第N章」前缀(两版共用)。
            const all = [...ch.lessons, ...ch.challenges];
            const doneCount = all.filter((l) => (progress.lessons[l.id]?.stars ?? 0) > 0).length;
            return (
              <div
                key={ch.id}
                className="chapter-card"
                ref={(el) => {
                  chapterRefs.current[ch.id] = el;
                }}
              >
                <div className="chapter-head">
                  <button
                    className="chapter-toggle"
                    tabIndex={-1}
                    ref={(el) => {
                      toggleRefs.current[ch.id] = el;
                    }}
                    onClick={() => setOpenChapter(open ? null : ch.id)}
                  >
                    <div>
                      <div className="chapter-title">
                        <span className="chapter-number">第{index + 1}章</span>{" "}
                        {ch.title}
                      </div>
                      <div className="chapter-title-fr">{ch.titleFr}</div>
                    </div>
                    <div className="chapter-meta">
                      <span>
                        {doneCount}/{all.length}
                      </span>
                      <span className="chapter-arrow">{open ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  <button
                    className="btn btn-cards"
                    title="知识讲解"
                    onClick={() => onOpenCards(ch.id)}
                  >
                    📚 讲解
                  </button>
                </div>
                {open && (
                  <div className="lesson-list">
                    {all.map((l) => {
                      const stars = progress.lessons[l.id]?.stars ?? 0;
                      return (
                        <button
                          key={l.id}
                          className={`lesson-item kind-${l.kind}`}
                          onClick={() => onOpenLesson(ch.id, l.id)}
                        >
                          <span className="lesson-status">
                            {stars > 0 ? "★".repeat(stars) : "▶"}
                          </span>
                          <span className="lesson-title">{l.title}</span>
                          {l.kind === "challenge" && <span className="lesson-badge">挑战</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
