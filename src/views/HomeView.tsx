import { useState } from "react";
import type { Chapter, Progress } from "../types";
import { today } from "../storage";
import { streakFor } from "../engine";
import { GoalRing } from "../components/GoalRing";
import { StreakFlame } from "../components/StreakFlame";
import { LevelBar } from "../components/LevelBar";

interface Props {
  chapters: Chapter[];
  progress: Progress;
  onOpenLesson: (chapterId: string, lessonId: string) => void;
  onOpenCards: (chapterId: string) => void;
  onOpenReview: () => void;
}

export function HomeView({ chapters, progress, onOpenLesson, onOpenCards, onOpenReview }: Props) {
  const [openChapter, setOpenChapter] = useState<string | null>(null);
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
          {chapters.map((ch) => {
            const open = openChapter === ch.id;
            const all = [...ch.lessons, ...ch.challenges];
            const doneCount = all.filter((l) => (progress.lessons[l.id]?.stars ?? 0) > 0).length;
            return (
              <div key={ch.id} className="chapter-card">
                <div className="chapter-head">
                  <button className="chapter-toggle" onClick={() => setOpenChapter(open ? null : ch.id)}>
                    <div>
                      <div className="chapter-title">{ch.title}</div>
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
