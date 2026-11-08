import { useEffect, useRef, useState } from "react";
import type { Chapter } from "../types";
import type { StudyKind } from "../engine";
import { useStudyTimer } from "../studyTimer";
import { cardSummary, groupCardsByUnit } from "../library/search";
import { sanitizeCardHtml } from "../content/cardHtml";

interface Props {
  chapter: Chapter;
  chapterNumber: number;
  initialCardId?: string;
  onBack: () => void;
  onPracticeChapter: () => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
}

export function ReaderView({
  chapter,
  chapterNumber,
  initialCardId,
  onBack,
  onPracticeChapter,
  onStudyTick,
}: Props) {
  const initialIndex = Math.max(
    0,
    initialCardId ? chapter.cards.findIndex((c) => c.id === initialCardId) : 0
  );
  const [cardIndex, setCardIndex] = useState(
    chapter.cards.length === 0 ? 0 : initialIndex
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const total = chapter.cards.length;
  const card = chapter.cards[cardIndex];

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
        <div className="reader-empty">本章暂无讲解</div>
      </div>
    );
  }

  const progress = ((cardIndex + 1) / Math.max(total, 1)) * 100;
  const units = groupCardsByUnit(chapter.cards);

  return (
    <div className="reader">
      <div className="reader-header">
        <button className="reader-back" aria-label="返回" onClick={onBack}>
          ←
        </button>
        <div className="reader-chapter">
          第{chapterNumber}章 · {chapter.title}
        </div>
        <div className="reader-progress-track">
          <div
            className="reader-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="reader-counter">
          {cardIndex + 1}/{total}
        </span>
        <button
          className="reader-toc-toggle"
          aria-label="目录"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
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
        <button className="reader-practice" onClick={onPracticeChapter}>
          练习本章
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
              <div className="reader-drawer-title">目录</div>
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
