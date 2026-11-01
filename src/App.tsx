import { useState, type ReactNode } from "react";
import { loadProgress, saveProgress } from "./storage";
import { CHAPTERS } from "./content";
import { buildReviewLesson } from "./content/review";
import { HomeView } from "./views/HomeView";
import { LessonView } from "./views/LessonView";
import { CardsView } from "./views/CardsView";
import { StatsView } from "./views/StatsView";
import { SettingsView } from "./views/SettingsView";
import type { Chapter, Progress } from "./types";

type View =
  | { name: "home" }
  | { name: "lesson"; chapterId: string; lessonId: string }
  | { name: "cards"; chapterId: string }
  | { name: "review" }
  | { name: "stats" }
  | { name: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [progress, setProgress] = useState<Progress>(() => loadProgress());

  const updateProgress = (p: Progress) => {
    setProgress(p);
    saveProgress(p);
  };

  let body: ReactNode;
  if (view.name === "home") {
    body = (
      <HomeView
        chapters={CHAPTERS}
        progress={progress}
        onOpenLesson={(chapterId, lessonId) => setView({ name: "lesson", chapterId, lessonId })}
        onOpenCards={(chapterId) => setView({ name: "cards", chapterId })}
        onOpenReview={() => setView({ name: "review" })}
      />
    );
  } else if (view.name === "cards") {
    const ch = CHAPTERS.find((c) => c.id === view.chapterId);
    body = ch ? <CardsView chapter={ch} onExit={() => setView({ name: "home" })} /> : null;
  } else if (view.name === "review") {
    body = <ReviewLessonView progress={progress} onProgress={updateProgress} onHome={() => setView({ name: "home" })} />;
  } else if (view.name === "lesson") {
    const ch = CHAPTERS.find((c) => c.id === view.chapterId);
    const lesson = ch
      ? [...ch.lessons, ...ch.challenges].find((l) => l.id === view.lessonId)
      : undefined;
    if (ch && lesson) {
      body = (
        <LessonView
          key={lesson.id}
          chapter={ch}
          lesson={lesson}
          progress={progress}
          onProgress={updateProgress}
          onExit={() => setView({ name: "home" })}
          onNextLesson={() => {
            const all = [...ch.lessons, ...ch.challenges];
            const next = all[all.findIndex((l) => l.id === view.lessonId) + 1];
            if (next) setView({ name: "lesson", chapterId: ch.id, lessonId: next.id });
          }}
          onFinish={() => {}}
        />
      );
    } else {
      body = (
        <div className="lesson-placeholder">
          <button className="btn btn-secondary" onClick={() => setView({ name: "home" })}>
            返回
          </button>
        </div>
      );
    }
  } else if (view.name === "stats") {
    body = <StatsView progress={progress} />;
  } else {
    body = <SettingsView progress={progress} onChange={updateProgress} />;
  }

  return (
    <div className="app">
      <div className="content">{body}</div>
      <nav className="bottom-nav">
        <button
          className={`nav-item ${view.name === "home" || view.name === "lesson" ? "active" : ""}`}
          onClick={() => setView({ name: "home" })}
        >
          练习
        </button>
        <button className={`nav-item ${view.name === "stats" ? "active" : ""}`} onClick={() => setView({ name: "stats" })}>
          统计
        </button>
        <button
          className={`nav-item ${view.name === "settings" ? "active" : ""}`}
          onClick={() => setView({ name: "settings" })}
        >
          设置
        </button>
      </nav>
    </div>
  );
}

/** 复习关:进入时把错题清单冻结成一门关;答题过程中错题本的变化不影响本关。 */
function ReviewLessonView({
  progress,
  onProgress,
  onHome,
}: {
  progress: Progress;
  onProgress: (p: Progress) => void;
  onHome: () => void;
}) {
  const [lesson] = useState(() => buildReviewLesson(progress));
  const chapter: Chapter = {
    id: "review",
    title: "错题回顾",
    titleFr: "Révision",
    cards: [],
    lessons: [],
    challenges: [],
  };
  if (!lesson) return <div className="placeholder-view">没有错题,太棒了!</div>;
  return (
    <LessonView
      key="review"
      chapter={chapter}
      lesson={lesson}
      progress={progress}
      onProgress={onProgress}
      onExit={onHome}
      onNextLesson={onHome}
      onFinish={() => {}}
    />
  );
}
