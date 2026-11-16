import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Chapter } from "../types";
import type { StudyKind } from "../engine";
import { useStudyTimer } from "../studyTimer";
import { cardSummary, groupCardsByUnit } from "../library/search";
import { sanitizeCardHtml } from "../content/cardHtml";
import {
  sectionKeyFor,
  type LearningSection,
} from "../learning/sections";
import {
  localizeChapter,
  sectionTitleForDisplay,
} from "../content/localize";
import { useLocale } from "../i18n/LocaleProvider";

interface Props {
  chapter: Chapter;
  chapterNumber: number;
  /** 指定后阅读范围仅限该小章；不传则保持整章（内部题库/未配置章节）。 */
  section?: LearningSection | null;
  /** 同一章内有卡片的前后小节；只在当前小节首/末张出现衔接入口。 */
  previousSection?: LearningSection | null;
  nextSection?: LearningSection | null;
  initialCardId?: string;
  onBack: () => void;
  onOpenSection?: (sectionId: string, cardId?: string) => void;
  onPracticeChapter: (sectionId?: string) => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
}

export function ReaderView({
  chapter,
  chapterNumber,
  section,
  previousSection,
  nextSection,
  initialCardId,
  onBack,
  onOpenSection,
  onPracticeChapter,
  onStudyTick,
}: Props) {
  const cards = section ? section.cards : chapter.cards;
  const { locale, t } = useLocale();
  const chapterDisplay = useMemo(
    () => localizeChapter(chapter, locale),
    [chapter, locale]
  );
  const cardDisplayById = useMemo(
    () => new Map(chapterDisplay.cards.map((card) => [card.base.id, card])),
    [chapterDisplay]
  );
  const initialIndex = Math.max(
    0,
    initialCardId ? cards.findIndex((c) => c.id === initialCardId) : 0
  );
  const [cardIndex, setCardIndex] = useState(
    cards.length === 0 ? 0 : initialIndex
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const total = cards.length;
  const card = cards[cardIndex];

  useLayoutEffect(() => {
    // 阅读器是独立的整页范围：从首页/讲解库继承的页面滚动会让标题落在
    // 视口之外，进入或更换阅读范围时统一回到顶部。
    // 直接归零 documentElement/body，避免依赖平滑滚动或 jsdom 未实现的
    // window.scrollTo；同时清空阅读器自身的正文滚动。
    const root = document.scrollingElement ?? document.documentElement;
    root.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [chapter.id, section?.id]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [cardIndex]);

  useStudyTimer((s) => onStudyTick?.("read", s));

  const localizedSectionTitle = (target: LearningSection): string =>
    sectionTitleForDisplay(
      chapterDisplay,
      sectionKeyFor(target, chapter.id),
      target.kind === "comprehensive"
        ? t("section.comprehensive")
        : target.title
    );

  if (total === 0) {
    return (
      <div className="reader">
        <div className="reader-header">
          <button
            className="reader-back"
            aria-label={t("common.back")}
            onClick={onBack}
          >
            ←
          </button>
        </div>
        <div className="reader-empty">
          {section ? t("reader.emptySection") : t("reader.emptyChapter")}
        </div>
      </div>
    );
  }

  const cardDisplay = card ? cardDisplayById.get(card.id) : undefined;
  const cardTitle = cardDisplay?.title ?? card?.title ?? "";
  const cardBody = cardDisplay?.body ?? card?.body ?? "";
  const sectionName = section ? localizedSectionTitle(section) : "";

  const progress = ((cardIndex + 1) / Math.max(total, 1)) * 100;
  // 小节阅读范围已由配置决定分组，目录直接跟随正文源序，避免旧 ID 的
  // -uN- 分组把跨章迁入卡前置或把无单元卡挤后。
  const units = section
    ? [
        {
          unit: null,
          cards: cards.map((card, cardIndex) => ({ card, cardIndex })),
        },
      ]
    : groupCardsByUnit(cards);
  const previousCard =
    previousSection && previousSection.cards.length > 0
      ? previousSection.cards[previousSection.cards.length - 1]!
      : null;
  const nextSectionStart =
    nextSection && nextSection.cards.length > 0 ? nextSection.cards[0]! : null;
  // 只在当前小节的首/末张出现小节衔接，中间仍按原来的「上一张/下一张」。
  const previousLink =
    onOpenSection && previousSection && previousCard && cardIndex === 0
      ? { section: previousSection, cardId: previousCard.id, open: onOpenSection }
      : null;
  const nextLink =
    onOpenSection && nextSection && nextSectionStart && cardIndex === total - 1
      ? { section: nextSection, open: onOpenSection }
      : null;

  return (
    <div className="reader">
      <div className="reader-header">
        <button
          className="reader-back"
          aria-label={t("common.back")}
          onClick={onBack}
        >
          ←
        </button>
        <div className="reader-chapter">
          <span className="reader-chapter-title">
            {t("reader.chapterHeading", {
              number: chapterNumber,
              title: chapterDisplay.title,
            })}
          </span>
          {section && (
            <span className="reader-section-name">{sectionName}</span>
          )}
        </div>
        <button
          className="reader-toc-toggle"
          aria-label={t("reader.toc")}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
      </div>
      <div className="reader-progress-row">
        <div
          className="reader-progress-track"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={cardIndex + 1}
          aria-label={t("reader.progress")}
        >
          <div
            className="reader-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="reader-counter">
          {cardIndex + 1}/{total}
        </span>
      </div>

      <div className="reader-body" ref={bodyRef}>
        {previousLink && (
          <button
            className="reader-section-prev"
            type="button"
            aria-label={t("reader.previousSectionAria", {
              title: localizedSectionTitle(previousLink.section),
            })}
            onClick={() =>
              previousLink.open(previousLink.section.id, previousLink.cardId)
            }
          >
            <span className="reader-section-prev-arrow" aria-hidden="true">
              ←
            </span>
            <span className="reader-section-prev-label">
              {t("reader.previousSection")}
            </span>
            <span className="reader-section-prev-title">
              {localizedSectionTitle(previousLink.section)}
            </span>
          </button>
        )}
        <div className="card-title">{cardTitle}</div>
        <div
          className="card-body"
          dangerouslySetInnerHTML={{ __html: sanitizeCardHtml(cardBody) }}
        />
        {nextLink && (
          <div className="reader-section-end">
            <div className="reader-section-end-label">
              {t("reader.sectionEnd")}
            </div>
            <button
              className="reader-section-next"
              type="button"
              aria-label={t("reader.nextSectionAria", {
                title: localizedSectionTitle(nextLink.section),
              })}
              onClick={() => nextLink.open(nextLink.section.id)}
            >
              <span className="reader-section-next-copy">
                <span className="reader-section-next-label">
                  {t("reader.nextSection")}
                </span>
                <span className="reader-section-next-title">
                  {localizedSectionTitle(nextLink.section)}
                </span>
              </span>
              <span className="reader-section-next-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="reader-footer">
        <button
          className="reader-prev"
          disabled={cardIndex === 0}
          onClick={() => setCardIndex((i) => Math.max(0, i - 1))}
        >
          {t("reader.previousCard")}
        </button>
        <button
          className="reader-next"
          disabled={cardIndex === total - 1}
          onClick={() => setCardIndex((i) => Math.min(total - 1, i + 1))}
        >
          {t("reader.nextCard")}
        </button>
        <button
          className="reader-practice"
          onClick={() =>
            section ? onPracticeChapter(section.id) : onPracticeChapter()
          }
        >
          {section ? t("reader.practiceSection") : t("reader.practiceChapter")}
        </button>
      </div>

      {drawerOpen && (
        <div className="reader-drawer">
          <div
            className="reader-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="reader-drawer-panel">
            <div className="reader-drawer-head">
              <div>
                <div className="reader-drawer-title">{t("reader.toc")}</div>
                {section && (
                  <div className="reader-drawer-scope">
                    {t("reader.tocScope", {
                      title: sectionName,
                      count: total,
                    })}
                  </div>
                )}
              </div>
              <button
                className="reader-drawer-close"
                aria-label={t("reader.tocClose")}
                onClick={() => setDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="reader-toc-list">
              {units.map((unit) => (
                <div key={unit.unit ?? "flat"} className="reader-toc-unit">
                  {unit.unit !== null && (
                    <div className="reader-toc-unit-title">
                      {t("section.unit", { unit: unit.unit })}
                    </div>
                  )}
                  {unit.cards.map(({ card: c, cardIndex: idx }) => (
                    <button
                      key={c.id}
                      className={`reader-toc-item ${
                        idx === cardIndex ? "active" : ""
                      }`}
                      aria-current={idx === cardIndex ? "true" : undefined}
                      onClick={() => {
                        setCardIndex(idx);
                        setDrawerOpen(false);
                      }}
                    >
                      <span className="reader-toc-index">{idx + 1}.</span>
                      <span className="reader-toc-title">
                        {cardDisplayById.get(c.id)?.title ?? c.title}
                      </span>
                      <span className="reader-toc-summary">
                        {cardSummary(
                          cardDisplayById.get(c.id)?.body ?? c.body,
                          undefined,
                          40
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
