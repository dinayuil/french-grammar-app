import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadProgress, saveProgress, today } from "./storage";
import { addStudySeconds, markSharePrompted, type StudyKind } from "./engine";
import { CHAPTERS } from "./content";
import { buildReviewLesson } from "./content/review";
import { HomeView } from "./views/HomeView";
import { LessonView } from "./views/LessonView";
import { ReaderView } from "./views/ReaderView";
import { LibraryView } from "./views/LibraryView";
import { StatsView } from "./views/StatsView";
import { SettingsView } from "./views/SettingsView";
import { GoalReachedDialog } from "./components/GoalReachedDialog";
import { NavIcon } from "./components/icons";
import { shareStatsCard, type ShareResult } from "./share/shareStats";
import {
  SECTION_MAP,
  findSectionByCard,
  findSectionById,
  findSectionByLesson,
  getLearningSections,
  lessonSequenceFor,
  type SectionMap,
} from "./learning/sections";
import type { Chapter, Progress } from "./types";
import {
  applyTheme,
  getSystemPrefersDark,
  loadThemeChoice,
  resolveTheme,
  saveThemeChoice,
  watchSystemTheme,
  type ThemeChoice,
} from "./theme";

type View =
  | {
      name: "home";
      openChapterId?: string;
      openSectionId?: string;
      openLessonId?: string;
    }
  | { name: "lesson"; chapterId: string; lessonId: string; sectionId?: string }
  | {
      name: "reader";
      chapterId: string;
      sectionId?: string;
      cardId?: string;
      from: "library" | "home";
    }
  | { name: "library" }
  | { name: "review" }
  | { name: "stats" }
  | { name: "settings" };

/** spec 4.2:弹窗关闭后焦点回到结算页的「下一关」;没有下一关时回到「返回」。 */
function findSettlementAction(): HTMLElement | null {
  const next = document.querySelector<HTMLElement>(".settlement-actions .btn-primary");
  if (next) return next;
  const secondary = document.querySelectorAll<HTMLElement>(
    ".settlement-actions .btn-secondary"
  );
  return secondary[secondary.length - 1] ?? null;
}

export default function App({ sectionMap = SECTION_MAP }: { sectionMap?: SectionMap } = {}) {
  const [view, setView] = useState<View>({ name: "home" });
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const progressRef = useRef(progress);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [goalDialogProgress, setGoalDialogProgress] = useState<Progress | null>(null);

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => loadThemeChoice());
  const [systemDark, setSystemDark] = useState(() => getSystemPrefersDark());
  const resolvedTheme = resolveTheme(themeChoice, systemDark);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => watchSystemTheme(() => setSystemDark(getSystemPrefersDark())), []);

  const changeTheme = (choice: ThemeChoice) => {
    setThemeChoice(choice);
    saveThemeChoice(choice);
  };

  const updateProgress = (p: Progress) => {
    progressRef.current = p;
    setProgress(p);
    saveProgress(p);
  };

  const handleStudyTick = (kind: StudyKind, seconds: number) => {
    try {
      updateProgress(addStudySeconds(progressRef.current, today(), kind, seconds));
    } catch {
      // 本地存储写入失败(配额/隐私模式)不能中断计时器结算:updateProgress 已先更新内存进度,
      // 计时器也已在本轮清空累计值,下一轮不会重复计入。
    }
  };

  const handleSettlement = (np: Progress) => {
    const date = today();
    const day = np.days[date];
    if (np.dailyGoal > 0 && (day?.xp ?? 0) >= np.dailyGoal && !day?.sharePrompted) {
      const marked = markSharePrompted(np, date);
      // 先展示弹窗:标记持久化失败不能阻塞达标提醒(spec 4.2)。
      setGoalDialogProgress(marked);
      try {
        updateProgress(marked);
      } catch {
        // updateProgress 已先更新内存状态;仅本次会话内不再重复提醒。
      }
    }
  };

  const shareStats = async (): Promise<ShareResult> => {
    const date = today();
    const result = await shareStatsCard(progressRef.current, date);
    if (result.status === "shared" || result.status === "downloaded") {
      const current = progressRef.current;
      if (!current.days[date]?.sharePrompted) {
        updateProgress(markSharePrompted(current, date));
      }
    }
    return result;
  };

  let body: ReactNode;
  if (view.name === "home") {
    body = (
      <HomeView
        chapters={CHAPTERS}
        progress={progress}
        openChapterId={view.openChapterId}
        openSectionId={view.openSectionId}
        openLessonId={view.openLessonId}
        sectionMap={sectionMap}
        onOpenLesson={(chapterId, lessonId, sectionId) =>
          setView({ name: "lesson", chapterId, lessonId, sectionId })
        }
        onOpenCards={(chapterId, sectionId) =>
          setView({ name: "reader", chapterId, sectionId, from: "home" })
        }
        onOpenReview={() => setView({ name: "review" })}
      />
    );
  } else if (view.name === "library") {
    body = (
      <LibraryView
        chapters={CHAPTERS}
        query={libraryQuery}
        sectionMap={sectionMap}
        onQueryChange={setLibraryQuery}
        onOpenCard={(chapterId, cardId, sectionId) =>
          setView({ name: "reader", chapterId, sectionId, cardId, from: "library" })
        }
      />
    );
  } else if (view.name === "reader") {
    const chapterIndex = CHAPTERS.findIndex((c) => c.id === view.chapterId);
    const ch = CHAPTERS[chapterIndex];
    const sections = ch ? getLearningSections(ch, sectionMap) : null;
    // 卡片 ID 是搜索/清单进入阅读器时最可靠的归属依据；只有不带卡片时才用
    // sectionId 从专题开读。
    const section = sections
      ? (view.cardId ? findSectionByCard(sections, view.cardId) : null) ??
        (view.sectionId ? findSectionById(sections, view.sectionId) : null)
      : null;
    body = ch ? (
      <ReaderView
        key={`${ch.id}:${section?.id ?? "chapter"}`}
        chapter={ch}
        chapterNumber={chapterIndex + 1}
        section={section}
        initialCardId={view.cardId}
        onBack={() => {
          if (view.from === "library") {
            setView({ name: "library" });
          } else if (section) {
            setView({
              name: "home",
              openChapterId: ch.id,
              openSectionId: section.id,
            });
          } else {
            setView({ name: "home" });
          }
        }}
        onPracticeChapter={(sectionId) =>
          setView({
            name: "home",
            openChapterId: ch.id,
            openSectionId: sectionId,
          })
        }
        onStudyTick={handleStudyTick}
      />
    ) : null;
  } else if (view.name === "review") {
    body = (
      <ReviewLessonView
        progress={progress}
        onProgress={updateProgress}
        onSettlement={handleSettlement}
        onHome={() => setView({ name: "home" })}
        onStudyTick={handleStudyTick}
      />
    );
  } else if (view.name === "lesson") {
    const ch = CHAPTERS.find((c) => c.id === view.chapterId);
    const lesson = ch
      ? [...ch.lessons, ...ch.challenges].find((l) => l.id === view.lessonId)
      : undefined;
    if (ch && lesson) {
      const sections = getLearningSections(ch, sectionMap);
      // 归属一律由关卡 ID 重新解析，不信任路由里可能过期的 sectionId。
      const section = sections
        ? findSectionByLesson(sections, lesson.id) ??
          (view.sectionId ? findSectionById(sections, view.sectionId) : null)
        : null;
      const sequence = sections
        ? lessonSequenceFor(sections, lesson.id)
        : [...ch.lessons, ...ch.challenges];
      const index = sequence.findIndex((item) => item.id === lesson.id);
      const next = index >= 0 ? sequence[index + 1] : undefined;
      body = (
        <LessonView
          key={lesson.id}
          chapter={ch}
          lesson={lesson}
          progress={progress}
          onProgress={updateProgress}
          onSettlement={handleSettlement}
          nextLessonId={next?.id ?? null}
          onExit={() =>
            setView({
              name: "home",
              openChapterId: ch.id,
              openSectionId: section?.id,
              openLessonId: lesson.id,
            })
          }
          onNextLesson={() => {
            if (!next) return;
            setView({
              name: "lesson",
              chapterId: ch.id,
              lessonId: next.id,
              sectionId: section?.id,
            });
          }}
          onFinish={() => {}}
          onStudyTick={handleStudyTick}
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
    body = <StatsView progress={progress} onShare={shareStats} />;
  } else {
    body = (
      <SettingsView
        progress={progress}
        onChange={updateProgress}
        themeChoice={themeChoice}
        onThemeChange={changeTheme}
      />
    );
  }

  const isPractice = view.name === "home" || view.name === "lesson" || view.name === "review";
  const isLibrary = view.name === "library" || view.name === "reader";

  return (
    <div className="app">
      <div className="content">{body}</div>
      <nav className="bottom-nav">
        <button
          className={`nav-item ${isPractice ? "active" : ""}`}
          type="button"
          aria-current={isPractice ? "page" : undefined}
          onClick={() => {
            // 首页仍然挂载时点击「练习」会折叠章节,这里同时把窗口拉回顶部,
            // 避免列表深处的滚动位置留在原地。
            setView({ name: "home" });
            window.scrollTo({ top: 0, left: 0 });
          }}
        >
          <NavIcon name="practice" />
          <span>练习</span>
        </button>
        <button
          className={`nav-item ${isLibrary ? "active" : ""}`}
          type="button"
          aria-current={isLibrary ? "page" : undefined}
          onClick={() => setView({ name: "library" })}
        >
          <NavIcon name="library" />
          <span>讲解</span>
        </button>
        <button
          className={`nav-item ${view.name === "stats" ? "active" : ""}`}
          type="button"
          aria-current={view.name === "stats" ? "page" : undefined}
          onClick={() => setView({ name: "stats" })}
        >
          <NavIcon name="stats" />
          <span>统计</span>
        </button>
        <button
          className={`nav-item ${view.name === "settings" ? "active" : ""}`}
          type="button"
          aria-current={view.name === "settings" ? "page" : undefined}
          onClick={() => setView({ name: "settings" })}
        >
          <NavIcon name="settings" />
          <span>设置</span>
        </button>
      </nav>
      {goalDialogProgress && (
        <GoalReachedDialog
          progress={goalDialogProgress}
          onShare={shareStats}
          onClose={() => setGoalDialogProgress(null)}
          returnFocusTo={findSettlementAction}
        />
      )}
    </div>
  );
}

/** 复习关:进入时把错题清单冻结成一门关;答题过程中错题本的变化不影响本关。 */
function ReviewLessonView({
  progress,
  onProgress,
  onSettlement,
  onHome,
  onStudyTick,
}: {
  progress: Progress;
  onProgress: (p: Progress) => void;
  onSettlement?: (progress: Progress) => void;
  onHome: () => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
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
      onSettlement={onSettlement}
      onExit={onHome}
      onNextLesson={onHome}
      onFinish={() => {}}
      onStudyTick={onStudyTick}
    />
  );
}
