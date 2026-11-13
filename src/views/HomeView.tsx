import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, Lesson, Progress } from "../types";
import { today } from "../storage";
import { streakFor } from "../engine";
import { GoalRing } from "../components/GoalRing";
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
  sectionProgress,
  type LearningSection,
  type SectionMap,
} from "../learning/sections";

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
  const [openChapter, setOpenChapter] = useState<string | null>(openChapterId ?? null);
  const [openSection, setOpenSection] = useState<string | null>(openSectionId ?? null);
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const toggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lessonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sectionToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const handledOpenChapter = useRef<string | null>(null);
  const handledOpenSection = useRef<string | null>(null);
  const handledOpenLesson = useRef<string | null>(null);

  const sectionSets = useMemo(
    () => chapters.map((chapter) => getLearningSections(chapter, sectionMap)),
    [chapters, sectionMap]
  );

  useEffect(() => {
    if (openChapterId === undefined) {
      setOpenChapter(null);
      setOpenSection(null);
      return;
    }
    const index = chapters.findIndex((ch) => ch.id === openChapterId);
    if (index === -1) {
      setOpenChapter(null);
      setOpenSection(null);
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    setOpenChapter(openChapterId);

    const set = sectionSets[index];
    if (!set) {
      setOpenSection(null);
      return;
    }
    const requested =
      (openSectionId ? findSectionById(set, openSectionId) : null) ??
      (openLessonId ? findSectionByLesson(set, openLessonId) : null);
    // 只有单一小章的专题没有选择成本，展开时直接显示它的练习。
    setOpenSection(
      requested?.id ?? (set.sections.length === 1 ? set.sections[0]!.id : null)
    );
  }, [openChapterId, openSectionId, openLessonId, chapters, sectionSets]);

  // 返回主页后只定位一次:优先刚做过的关卡,其次小章,最后章节卡片。
  // 用户手动折叠后再展开、或同一目标重复渲染,都不会再次拉动页面。
  useEffect(() => {
    if (!openChapterId || openChapter !== openChapterId) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const chapterIndex = chapters.findIndex((ch) => ch.id === openChapterId);
    const set = chapterIndex >= 0 ? sectionSets[chapterIndex] : null;
    const requestedSection = set
      ? (openSectionId ? findSectionById(set, openSectionId) : null) ??
        (openLessonId ? findSectionByLesson(set, openLessonId) : null)
      : null;

    if (
      requestedSection &&
      openSection !== requestedSection.id &&
      handledOpenSection.current !== requestedSection.id &&
      handledOpenLesson.current !== openLessonId
    ) {
      setOpenSection(requestedSection.id);
      return;
    }

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
      // 目标关卡尚未渲染:先展开小章,不写 handled,后续渲染仍可重试。
    }

    if (requestedSection && handledOpenSection.current !== requestedSection.id) {
      const sectionCard = sectionRefs.current[requestedSection.id];
      if (sectionCard) {
        sectionCard.scrollIntoView?.({ block: "start", behavior });
        handledOpenChapter.current = openChapterId;
        handledOpenSection.current = requestedSection.id;
        focusQuietly(sectionToggleRefs.current[requestedSection.id] ?? null);
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
    openSection,
    chapters,
    sectionSets,
  ]);

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

  const toggleChapter = (chapterId: string, chapterIndex: number) => {
    const next = openChapter === chapterId ? null : chapterId;
    setOpenChapter(next);
    if (next === openChapter) return;
    // 多小章专题先展示紧凑的小章选择；单一小章直接打开，少一次点击。
    const set = sectionSets[chapterIndex];
    setOpenSection(
      set && set.sections.length === 1 ? set.sections[0]!.id : null
    );
  };

  const renderLessonItem = (
    ch: Chapter,
    lesson: Lesson,
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
        <span className="lesson-title">{lesson.title}</span>
        {lesson.kind === "challenge" && <span className="lesson-badge">挑战</span>}
      </button>
    );
  };

  const renderSection = (ch: Chapter, section: LearningSection) => {
    const comprehensive = section.kind === "comprehensive";
    const open = openSection === section.id;
    const { done, total } = sectionProgress(section, progress.lessons);
    const progressText =
      total > 0 ? `${done}/${total} 关` : comprehensive ? "暂无挑战" : "暂无练习";
    const meta = comprehensive
      ? progressText
      : `${section.cards.length} 张讲解 · ${progressText}`;
    const complete = total > 0 && done === total;

    return (
      <div
        key={section.id}
        className={`section-card${open ? " is-open" : ""}${
          comprehensive ? " section-comprehensive" : ""
        }`}
        ref={(el) => {
          sectionRefs.current[section.id] = el;
        }}
      >
        <div className="section-head">
          <button
            className="section-toggle"
            type="button"
            aria-expanded={open}
            aria-label={`${section.title}：${meta}${complete ? "，已完成" : ""}`}
            ref={(el) => {
              sectionToggleRefs.current[section.id] = el;
            }}
            onClick={() => setOpenSection(open ? null : section.id)}
          >
            <span className="section-rail" aria-hidden="true" />
            <span className="section-info">
              <span className="section-title">{section.title}</span>
              <span className="section-meta">
                {meta}
                {complete ? " · 已完成" : ""}
              </span>
            </span>
          </button>
          {!comprehensive && (
            <button
              className="btn btn-cards section-cards"
              type="button"
              title="本节知识讲解"
              aria-label={`阅读讲解：${section.title}`}
              disabled={section.cards.length === 0}
              onClick={() => onOpenCards(ch.id, section.id)}
            >
              <BookIcon />
              讲解
            </button>
          )}
          <button
            className="section-fold"
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "收起" : "展开"}：${section.title}`}
            onClick={() => setOpenSection(open ? null : section.id)}
          >
            <PlusMinusIcon open={open} />
          </button>
        </div>
        {open && (
          <div className="lesson-list">
            {[...section.lessons, ...section.challenges].map((lesson) =>
              renderLessonItem(ch, lesson, section.id)
            )}
            {total === 0 && <div className="section-empty">本节暂无练习</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="home">
      <h1 className="home-greeting">
        Bonjour，今天练一点 <em>français</em>
      </h1>

      <div className="home-hero">
        <StreakFlame count={streak} />
        <GoalRing done={todayXp} goal={progress.dailyGoal} />
        <LevelBar xp={progress.xp} />
      </div>

      <button
        className="btn btn-review"
        type="button"
        disabled={reviewCount === 0}
        onClick={() => onOpenReview()}
      >
        <ReviewIcon />
        <span>复习错题</span>
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
            const pct = all.length > 0 ? Math.round((doneCount / all.length) * 100) : 0;
            const sectionSet = sectionSets[index];
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
                    aria-label={`第${index + 1}章 ${ch.title}，已完成 ${doneCount}/${all.length}`}
                    ref={(el) => {
                      toggleRefs.current[ch.id] = el;
                    }}
                    onClick={() => toggleChapter(ch.id, index)}
                  >
                    <span className="chapter-index" aria-hidden="true">
                      <small>CH.</small>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                    </span>
                    <span className="chapter-copy">
                      <span className="chapter-title">{ch.title}</span>
                      <span className="chapter-title-fr">{ch.titleFr}</span>
                      <span className="chapter-progress" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="chapter-meta">
                      <span className="chapter-count">
                        {doneCount}/{all.length}
                      </span>
                      <PlusMinusIcon open={open} />
                    </span>
                  </button>
                  {!sectionSet && (
                    <button
                      className="btn btn-cards"
                      type="button"
                      title="知识讲解"
                      onClick={() => onOpenCards(ch.id)}
                    >
                      <BookIcon />
                      讲解
                    </button>
                  )}
                </div>
                {open &&
                  (sectionSet ? (
                    <div className="section-list">
                      {sectionSet.sections.map((section) =>
                        renderSection(ch, section)
                      )}
                      {sectionSet.comprehensive &&
                        renderSection(ch, sectionSet.comprehensive)}
                    </div>
                  ) : (
                    <div className="lesson-list">
                      {all.map((lesson) => renderLessonItem(ch, lesson))}
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
