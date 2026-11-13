import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Chapter } from "../types";
import type { StudyKind } from "../engine";
import { useStudyTimer } from "../studyTimer";
import { cardSummary, groupCardsByUnit } from "../library/search";
import { sanitizeCardHtml } from "../content/cardHtml";
import type { LearningSection } from "../learning/sections";

interface Props {
  chapter: Chapter;
  chapterNumber: number;
  /** 指定后阅读范围仅限该小章；不传则保持整章（内部题库/未配置章节）。 */
  section?: LearningSection | null;
  initialCardId?: string;
  onBack: () => void;
  onPracticeChapter: (sectionId?: string) => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
}

export function ReaderView({
  chapter,
  chapterNumber,
  section,
  initialCardId,
  onBack,
  onPracticeChapter,
  onStudyTick,
}: Props) {
  const cards = section ? section.cards : chapter.cards;
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

  if (total === 0) {
    return (
      <div className="reader">
        <div className="reader-header">
          <button className="reader-back" aria-label="返回" onClick={onBack}>
            ←
          </button>
        </div>
        <div className="reader-empty">
          {section ? "本小节暂无讲解" : "本章暂无讲解"}
        </div>
      </div>
    );
  }

  const progress = ((cardIndex + 1) / Math.max(total, 1)) * 100;
  const units = groupCardsByUnit(cards);

  return (
    <div className="reader">
      <div className="reader-header">
        <button className="reader-back" aria-label="返回" onClick={onBack}>
          ←
        </button>
        <div className="reader-chapter">
          <span className="reader-chapter-title">
            第{chapterNumber}章 · {chapter.title}
          </span>
          {section && <span className="reader-section-name">{section.title}</span>}
        </div>
        <button
          className="reader-toc-toggle"
          aria-label="目录"
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
          aria-label="阅读进度"
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
        <div className="card-title">{card.title}</div>
        <div
          className="card-body"
          dangerouslySetInnerHTML={{ __html: sanitizeCardHtml(card.body) }}
        />
      </div>

      <div className="reader-footer">
        <button
          className="reader-prev"
          disabled={cardIndex === 0}
          onClick={() => setCardIndex((i) => Math.max(0, i - 1))}
        >
          上一张
        </button>
        <button
          className="reader-next"
          disabled={cardIndex === total - 1}
          onClick={() => setCardIndex((i) => Math.min(total - 1, i + 1))}
        >
          下一张
        </button>
        <button
          className="reader-practice"
          onClick={() =>
            section ? onPracticeChapter(section.id) : onPracticeChapter()
          }
        >
          {section ? "练习本节" : "练习本章"}
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
                <div className="reader-drawer-title">目录</div>
                {section && (
                  <div className="reader-drawer-scope">
                    {section.title} · {total} 张
                  </div>
                )}
              </div>
              <button
                className="reader-drawer-close"
                aria-label="关闭目录"
                onClick={() => setDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="reader-toc-list">
              {units.map((unit) => (
                <div key={unit.unit ?? "flat"} className="reader-toc-unit">
                  {unit.unit !== null && (
                    <div className="reader-toc-unit-title">第{unit.unit}单元</div>
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
                      <span className="reader-toc-title">{c.title}</span>
                      <span className="reader-toc-summary">
                        {cardSummary(c.body, undefined, 40)}
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
