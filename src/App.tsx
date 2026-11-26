import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadProgress, saveProgress, today } from "./storage";
import { addStudySeconds, markSharePrompted, type StudyKind } from "./engine";
import { CHAPTERS, SUPPORTED_LOCALES } from "./content";
import { buildReviewLesson } from "./content/review";
import { HomeView } from "./views/HomeView";
import { LessonView } from "./views/LessonView";
import { ReaderView } from "./views/ReaderView";
import { LibraryView } from "./views/LibraryView";
import { StatsView } from "./views/StatsView";
import { SettingsView } from "./views/SettingsView";
import { GoalReachedDialog } from "./components/GoalReachedDialog";
import { NavIcon } from "./components/icons";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";
import type { UiLocale } from "./i18n/types";
import { shareStatsCard, type ShareResult } from "./share/shareStats";
import {
  SECTION_MAP,
  allLearningSections,
  findSectionByCard,
  findSectionById,
  findSectionByLesson,
  getLearningSections,
  lessonSequenceFor,
  type SectionMap,
} from "./learning/sections";
import type { Chapter, Lesson, Progress } from "./types";
import { useClientSync } from "./sync/useClientSync";
import { useClientUpdates } from "./native/useClientUpdates";
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

/** 页面本身的滚动位置；阅读器正文是内部滚动，不能拿来当目录位置。 */
function pageScrollTop(): number {
  const root = document.scrollingElement ?? document.documentElement;
  return Math.max(window.scrollY || 0, root?.scrollTop ?? 0);
}

/**
 * 旧测试或尚未声明语言的构建可能只注入 CHAPTERS；与旧 manifest 语义一致，
 * 缺失时按仅支持中文处理，绝不因此默认开启法语。
 */
const FALLBACK_SUPPORTED_LOCALES: readonly UiLocale[] = ["zh-CN"];

/**
 * 上面一层只负责提供稳定的语言上下文。内容状态全部留在 AppContent 内，
 * 切换语言不会重挂载页面或重置当前作答/浏览状态。
 */
export default function App({ sectionMap = SECTION_MAP }: { sectionMap?: SectionMap } = {}) {
  const declared = SUPPORTED_LOCALES as readonly UiLocale[] | undefined;
  const supportedLocales =
    declared && declared.length > 0 ? declared : FALLBACK_SUPPORTED_LOCALES;

  return (
    <LocaleProvider supportedLocales={supportedLocales}>
      <AppContent sectionMap={sectionMap} />
    </LocaleProvider>
  );
}

function AppContent({ sectionMap }: { sectionMap: SectionMap }) {
  const { locale, t } = useLocale();
  const [view, setView] = useState<View>({ name: "home" });
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const progressRef = useRef(progress);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryExpanded, setLibraryExpanded] = useState<Set<string>>(
    () => new Set()
  );
  const libraryScrollTop = useRef(0);
  const previousLocaleRef = useRef(locale);

  // 语言切换后讲解搜索索引与结果都属于旧语言：只清空查询，保留路由、目录
  // 展开、阅读位置和练习/作答状态；阅读器内部查询由阅读页按同一事件清理。
  useEffect(() => {
    if (previousLocaleRef.current === locale) return;
    previousLocaleRef.current = locale;
    setLibraryQuery("");
  }, [locale]);
  const [goalDialogProgress, setGoalDialogProgress] = useState<Progress | null>(null);
  /** 同步控制器就绪后,把本地学习变更登记为待同步;远端应用不经过这里。 */
  const notifyLocalChangeRef = useRef<(() => void) | null>(null);

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
    const changed = p !== progressRef.current;
    progressRef.current = p;
    setProgress(p);
    saveProgress(p);
    // 只有真正落盘成功的本地修改才通知同步;远端应用走 applyRemoteProgress。
    if (changed) {
      try {
        notifyLocalChangeRef.current?.();
      } catch {
        // 同步调度异常不能影响学习记录的保存与显示。
      }
    }
  };

  /**
   * 云端进度:必须先成功写入本机存储,再更新 ref 与界面。控制器在回调成功返回
   * 后才确认共同基线;这里绝不通知 dirty,避免把下载结果再上传成新变更。
   */
  const applyRemoteProgress = (remote: Progress) => {
    saveProgress(remote);
    progressRef.current = remote;
    setProgress(remote);
  };

  const { controller: syncController } = useClientSync({
    getProgress: () => progressRef.current,
    applyProgress: applyRemoteProgress,
    interactionActive:
      view.name === "lesson" || view.name === "review" || view.name === "reader",
  });

  // 原生容器启动时检查一次更新;网页版返回 null,首页和设置页都不显示入口。
  const clientUpdates = useClientUpdates();

  useEffect(() => {
    notifyLocalChangeRef.current = syncController
      ? () => syncController.notifyLocalChange()
      : null;
    return () => {
      notifyLocalChangeRef.current = null;
    };
  }, [syncController]);

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
    const result = await shareStatsCard(progressRef.current, date, locale);
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
        expanded={libraryExpanded}
        onExpandedChange={setLibraryExpanded}
        restoreScrollTop={libraryScrollTop.current}
        onQueryChange={setLibraryQuery}
        onOpenCard={(chapterId, cardId, sectionId) => {
          // 先记下目录位置：阅读器挂载时会把页面滚到顶部，返回时要靠它复位。
          libraryScrollTop.current = pageScrollTop();
          setView({ name: "reader", chapterId, sectionId, cardId, from: "library" });
        }}
      />
    );
  } else if (view.name === "reader") {
    const chapterIndex = CHAPTERS.findIndex((c) => c.id === view.chapterId);
    const ch = CHAPTERS[chapterIndex];
    const sectionSet = ch ? getLearningSections(ch, sectionMap) : null;
    // 卡片 ID 是搜索/清单进入阅读器时最可靠的归属依据；只有不带卡片时才用
    // sectionId 从专题开读。
    const section = sectionSet
      ? (view.cardId ? findSectionByCard(sectionSet, view.cardId) : null) ??
        (view.sectionId ? findSectionById(sectionSet, view.sectionId) : null)
      : null;
    // 阅读器只在同一章内衔接有卡片的小节；专题综合区不参与翻页。
    const cardSections = sectionSet
      ? allLearningSections(sectionSet).filter((item) => item.cards.length > 0)
      : [];
    const sectionIndex = section
      ? cardSections.findIndex((item) => item.id === section.id)
      : -1;
    const previousSection = sectionIndex > 0 ? cardSections[sectionIndex - 1]! : null;
    const nextSection =
      sectionIndex >= 0 && sectionIndex < cardSections.length - 1
        ? cardSections[sectionIndex + 1]!
        : null;
    body = ch ? (
      <ReaderView
        key={`${ch.id}:${section?.id ?? "chapter"}`}
        chapter={ch}
        chapterNumber={chapterIndex + 1}
        section={section}
        previousSection={previousSection}
        nextSection={nextSection}
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
        onOpenSection={(sectionId, cardId) =>
          setView({
            name: "reader",
            chapterId: ch.id,
            sectionId,
            cardId,
            from: view.from,
          })
        }
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
            {t("common.back")}
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
        syncController={syncController}
        clientUpdates={clientUpdates}
      />
    );
  }

  const isPractice = view.name === "home" || view.name === "lesson" || view.name === "review";
  const isLibrary = view.name === "library" || view.name === "reader";

  return (
    <div className="app">
      <nav className="bottom-nav" aria-label={t("nav.label")}>
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
          <span>{t("nav.practice")}</span>
        </button>
        <button
          className={`nav-item ${isLibrary ? "active" : ""}`}
          type="button"
          aria-current={isLibrary ? "page" : undefined}
          onClick={() => setView({ name: "library" })}
        >
          <NavIcon name="library" />
          <span>{t("nav.library")}</span>
        </button>
        <button
          className={`nav-item ${view.name === "stats" ? "active" : ""}`}
          type="button"
          aria-current={view.name === "stats" ? "page" : undefined}
          onClick={() => setView({ name: "stats" })}
        >
          <NavIcon name="stats" />
          <span>{t("nav.stats")}</span>
        </button>
        <button
          className={`nav-item ${view.name === "settings" ? "active" : ""}`}
          type="button"
          aria-current={view.name === "settings" ? "page" : undefined}
          onClick={() => setView({ name: "settings" })}
        >
          <NavIcon name="settings" />
          <span>{t("nav.settings")}</span>
        </button>
      </nav>
      <div className="content">
        {view.name === "home" &&
          clientUpdates?.status === "available" &&
          clientUpdates.latestVersion && (
            <button
              type="button"
              className="btn update-callout"
              onClick={() => {
                setView({ name: "settings" });
                window.scrollTo({ top: 0, left: 0 });
              }}
            >
              <span>
                {t("update.home.available", {
                  version: clientUpdates.latestVersion,
                })}
              </span>
              <span>
                {t("update.home.action")}
                <span aria-hidden="true"> →</span>
              </span>
            </button>
          )}
        {body}
      </div>
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
  const { t } = useLocale();
  // 题目只冻结基础身份与队列；标题等应用生成文字在渲染时取当前语言。
  const [baseLesson] = useState(() =>
    buildReviewLesson(progress, {
      title: t("review.title"),
      source: t("review.source"),
    })
  );
  const chapter: Chapter = {
    id: "review",
    title: t("review.title"),
    titleFr: t("review.title"),
    cards: [],
    lessons: [],
    challenges: [],
  };
  if (!baseLesson) {
    return <div className="placeholder-view">{t("review.empty")}</div>;
  }
  const lesson: Lesson = {
    ...baseLesson,
    title: t("review.title"),
    source: t("review.source"),
  };
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
