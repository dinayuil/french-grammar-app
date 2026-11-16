import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, Lesson, Progress } from "../types";
import { today } from "../storage";
import { streakFor } from "../engine";
import { StreakFlame } from "../components/StreakFlame";
import { LevelBar } from "../components/LevelBar";
import {
  BookIcon,
  PlayIcon,
  PlusMinusIcon,
  ReviewIcon,
} from "../components/icons";
import {
  SECTION_MAP,
  findSectionById,
  findSectionByLesson,
  getLearningSections,
  sectionKeyFor,
  sectionProgress,
  type LearningSection,
  type SectionMap,
} from "../learning/sections";
import { localizeChapter, sectionTitleForDisplay, type ChapterDisplay } from "../content/localize";
import { useLocale } from "../i18n/LocaleProvider";
import { formatNumber } from "../i18n/format";

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

function focusQuietly(element: HTMLElement | null): void {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

/** 当前语言下的关卡标题；Id/归属仍由原关卡决定。 */
function lessonTitleForDisplay(
  display: ChapterDisplay,
  lessonId: string,
  fallback: string
): string {
  for (const lesson of display.lessons) {
    if (lesson.base.id === lessonId) return lesson.title;
  }
  for (const challenge of display.challenges) {
    if (challenge.base.id === lessonId) return challenge.title;
  }
  return fallback;
}

interface Props {
  chapters: Chapter[];
  progress: Progress;
  openChapterId?: string;
  openSectionId?: string;
  openLessonId?: string;
  onOpenLesson: (chapterId: string, lessonId: string, sectionId?: string) => void;
  onOpenCards: (chapterId: string, sectionId?: string) => void;
  onOpenReview: () => void;
  sectionMap?: SectionMap;
}

export function HomeView({
  chapters,
  progress,
  openChapterId,
  openSectionId,
  openLessonId,
  onOpenLesson,
  onOpenCards,
  onOpenReview,
  sectionMap = SECTION_MAP,
}: Props) {
  const { locale, t } = useLocale();
  const [openChapter, setOpenChapter] = useState<string | null>(openChapterId ?? null);
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const toggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lessonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sectionHeadingRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const handledOpenChapter = useRef<string | null>(null);
  const handledOpenSection = useRef<string | null>(null);
  const handledOpenLesson = useRef<string | null>(null);

  const sectionSets = useMemo(
    () => chapters.map((chapter) => getLearningSections(chapter, sectionMap)),
    [chapters, sectionMap]
  );
  // 展示模型只影响标题/正文；展开状态、section ID 仍使用原章节对象。
  const chapterDisplays = useMemo(
    () => chapters.map((chapter) => localizeChapter(chapter, locale)),
    [chapters, locale]
  );

  useEffect(() => {
    if (openChapterId === undefined) {
      setOpenChapter(null);
      return;
    }
    const index = chapters.findIndex((ch) => ch.id === openChapterId);
    if (index === -1) {
      setOpenChapter(null);
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    setOpenChapter(openChapterId);
  }, [openChapterId, chapters]);

  // 返回主页后只定位一次:优先刚做过的关卡,其次小节,最后章节卡片。
  // 小节现在随大章一起展开,不再需要先打开小节再重试。
  useEffect(() => {
    if (!openChapterId || openChapter !== openChapterId) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const chapterIndex = chapters.findIndex((ch) => ch.id === openChapterId);
    const set = chapterIndex >= 0 ? sectionSets[chapterIndex] : null;
    const requestedSection = set
      ? (openSectionId ? findSectionById(set, openSectionId) : null) ??
        (openLessonId ? findSectionByLesson(set, openLessonId) : null)
      : null;

    if (openLessonId && handledOpenLesson.current !== openLessonId) {
      const item = lessonRefs.current[openLessonId];
      if (item) {
        item.scrollIntoView?.({ block: "center", behavior });
        handledOpenChapter.current = openChapterId;
        if (requestedSection) handledOpenSection.current = requestedSection.id;
        handledOpenLesson.current = openLessonId;
        // 结算页「返回」卸载后焦点会掉回 <body>;留在刚做过的关卡上。
        focusQuietly(item);
        return;
      }
      // 目标关卡不存在时继续按小节/章节回退,不写 handled,后续仍可重试。
    }

    if (requestedSection && handledOpenSection.current !== requestedSection.id) {
      const sectionCard = sectionRefs.current[requestedSection.id];
      if (sectionCard) {
        sectionCard.scrollIntoView?.({ block: "start", behavior });
        handledOpenChapter.current = openChapterId;
        handledOpenSection.current = requestedSection.id;
        focusQuietly(sectionHeadingRefs.current[requestedSection.id] ?? null);
        return;
      }
    }

    if (handledOpenChapter.current === openChapterId) return;
    const card = chapterRefs.current[openChapterId];
    if (!card) return;
    card.scrollIntoView?.({ block: "start", behavior });
    handledOpenChapter.current = openChapterId;
    focusQuietly(toggleRefs.current[openChapterId] ?? null);
  }, [
    openChapterId,
    openSectionId,
    openLessonId,
    openChapter,
    chapters,
    sectionSets,
  ]);

  const todayKey = today();
  const todayXp = progress.days[todayKey]?.xp ?? 0;
  const dailyGoal = progress.dailyGoal;
  const streak = streakFor(progress.days, dailyGoal, todayKey);
  const goalMet = dailyGoal > 0 && todayXp >= dailyGoal;
  const goalPct = dailyGoal > 0 ? Math.min((todayXp / dailyGoal) * 100, 100) : 0;
  const goalNote =
    dailyGoal <= 0
      ? t("home.goal.unset")
      : goalMet
        ? todayXp > dailyGoal
          ? t("home.goal.over", { xp: formatNumber(locale, todayXp - dailyGoal) })
          : t("home.goal.met")
        : t("home.goal.remaining", { xp: formatNumber(locale, dailyGoal - todayXp) });

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

  const toggleChapter = (chapterId: string) => {
    setOpenChapter(openChapter === chapterId ? null : chapterId);
  };

  const renderLessonItem = (
    ch: Chapter,
    lesson: Lesson,
    display: ChapterDisplay,
    sectionId?: string
  ) => {
    const stars = progress.lessons[lesson.id]?.stars ?? 0;
    return (
      <button
        key={lesson.id}
        className={`lesson-item kind-${lesson.kind}`}
        ref={(el) => {
          lessonRefs.current[lesson.id] = el;
        }}
        onClick={() =>
          sectionId
            ? onOpenLesson(ch.id, lesson.id, sectionId)
            : onOpenLesson(ch.id, lesson.id)
        }
      >
        <span className={`lesson-status${stars > 0 ? " is-done" : " is-play"}`}>
          {stars > 0 ? (
            <span className="lesson-stars">{"★".repeat(stars)}</span>
          ) : (
            <PlayIcon />
          )}
        </span>
        <span className="lesson-title">
          {lessonTitleForDisplay(display, lesson.id, lesson.title)}
        </span>
        {lesson.kind === "challenge" && (
          <span className="lesson-badge">{t("home.challenge")}</span>
        )}
      </button>
    );
  };

  const renderSection = (
    ch: Chapter,
    section: LearningSection,
    display: ChapterDisplay
  ) => {
    const comprehensive = section.kind === "comprehensive";
    const title = sectionTitleForDisplay(
      display,
      sectionKeyFor(section, ch.id),
      comprehensive ? t("section.comprehensive") : section.title
    );
    const { done, total } = sectionProgress(section, progress.lessons);
    const doneText = formatNumber(locale, done);
    const totalText = formatNumber(locale, total);
    const cardCountText = formatNumber(locale, section.cards.length);
    const progressText =
      total > 0
        ? t("section.progress", { done: doneText, total: totalText })
        : comprehensive
          ? t("section.noChallenges")
          : t("section.noLessons");
    const meta = comprehensive
      ? progressText
      : `${t("section.cards", { count: cardCountText })} · ${progressText}`;
    const complete = total > 0 && done === total;

    return (
      <div
        key={section.id}
        className={`section-card is-open${
          comprehensive ? " section-comprehensive" : ""
        }`}
        ref={(el) => {
          sectionRefs.current[section.id] = el;
        }}
      >
        <div className="section-head">
          <span className="section-rail" aria-hidden="true" />
          <div
            className="section-info"
            tabIndex={-1}
            ref={(el) => {
              sectionHeadingRefs.current[section.id] = el;
            }}
          >
            <h3 className="section-title">{title}</h3>
            <span className="section-meta">
              {meta}
              {complete ? ` · ${t("section.complete")}` : ""}
            </span>
          </div>
          {!comprehensive && (
            <button
              className="btn btn-cards section-cards"
              type="button"
              title={t("home.sectionCardsTitle")}
              aria-label={t("home.readCardsAria", { title })}
              disabled={section.cards.length === 0}
              onClick={() => onOpenCards(ch.id, section.id)}
            >
              <BookIcon />
              {t("home.cardsButton")}
            </button>
          )}
        </div>
        <div className="lesson-list">
          {[...section.lessons, ...section.challenges].map((lesson) =>
            renderLessonItem(ch, lesson, display, section.id)
          )}
          {total === 0 && (
            <div className="section-empty">{t("section.noCards")}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="home">
      <div className="home-side">
        <h1 className="home-greeting">
          {t("home.greeting")}
          <em>français</em>
        </h1>

        <div className="home-hero">
          <div className="hero-top">
            <StreakFlame count={streak} />
            <div
              className={`hero-goal${goalMet ? " is-done" : ""}${
                dailyGoal <= 0 ? " is-unset" : ""
              }`}
            >
              <div className="hero-goal-head">
                <span className="hero-goal-label">
                  {dailyGoal > 0 ? t("home.goal.today") : t("home.goal.earned")}
                </span>
                <span className="hero-goal-rule" aria-hidden="true" />
                <span className="hero-goal-value">
                  <b>{formatNumber(locale, todayXp)}</b>
                  {dailyGoal > 0 && (
                    <span className="hero-goal-total">
                      {" "}/ {formatNumber(locale, dailyGoal)}
                    </span>
                  )}
                  <span className="hero-goal-unit"> XP</span>
                </span>
              </div>
              <div className="hero-goal-track" aria-hidden="true">
                <div
                  className="hero-goal-fill"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <span className="hero-goal-note">{goalNote}</span>
            </div>
          </div>
          <LevelBar xp={progress.xp} />
        </div>

        <button
          className="btn btn-review"
          type="button"
          disabled={reviewCount === 0}
          onClick={() => onOpenReview()}
        >
          <ReviewIcon />
          <span>{t("home.review")}</span>
          {reviewCount > 0 && (
            <span className="review-count">
              {formatNumber(locale, reviewCount)}
            </span>
          )}
        </button>
      </div>

      {!hasPlayableContent ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">{t("home.empty")}</div>
        </div>
      ) : (
        <div className="chapter-list">
          {chapters.map((ch, index) => {
            const open = openChapter === ch.id;
            // 编号统一由显示顺序生成,章节标题不得自带「第N章」前缀(两版共用)。
            const all = [...ch.lessons, ...ch.challenges];
            const doneCount = all.filter((l) => (progress.lessons[l.id]?.stars ?? 0) > 0).length;
            const pct = all.length > 0 ? Math.round((doneCount / all.length) * 100) : 0;
            const sectionSet = sectionSets[index];
            const display = chapterDisplays[index]!;
            const heading = display.title;
            return (
              <div
                key={ch.id}
                className={`chapter-card${open ? " is-open" : ""}`}
                ref={(el) => {
                  chapterRefs.current[ch.id] = el;
                }}
              >
                <div className="chapter-head">
                  <button
                    className="chapter-toggle"
                    type="button"
                    aria-expanded={open}
                    aria-label={t("home.chapterAria", {
                      number: formatNumber(locale, index + 1),
                      title: heading,
                      done: formatNumber(locale, doneCount),
                      total: formatNumber(locale, all.length),
                    })}
                    ref={(el) => {
                      toggleRefs.current[ch.id] = el;
                    }}
                    onClick={() => toggleChapter(ch.id)}
                  >
                    <span className="chapter-index" aria-hidden="true">
                      <small>CH.</small>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                    </span>
                    <span className="chapter-copy">
                      <span className="chapter-title">{heading}</span>
                      {locale !== "fr" && (
                        <span className="chapter-title-fr">{ch.titleFr}</span>
                      )}
                      <span className="chapter-progress" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="chapter-meta">
                      <span className="chapter-count">
                        {formatNumber(locale, doneCount)}/
                        {formatNumber(locale, all.length)}
                      </span>
                      <PlusMinusIcon open={open} />
                    </span>
                  </button>
                  {!sectionSet && (
                    <button
                      className="btn btn-cards"
                      type="button"
                      title={t("home.cardsTitle")}
                      onClick={() => onOpenCards(ch.id)}
                    >
                      <BookIcon />
                      {t("home.cardsButton")}
                    </button>
                  )}
                </div>
                {open &&
                  (sectionSet ? (
                    <div className="section-list">
                      {sectionSet.sections.map((section) =>
                        renderSection(ch, section, display)
                      )}
                      {sectionSet.comprehensive &&
                        renderSection(ch, sectionSet.comprehensive, display)}
                    </div>
                  ) : (
                    <div className="lesson-list">
                      {all.map((lesson) =>
                        renderLessonItem(ch, lesson, display)
                      )}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
