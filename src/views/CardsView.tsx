import { useState } from "react";
import type { Chapter } from "../types";

export function CardsView({ chapter, onExit }: { chapter: Chapter; onExit: () => void }) {
  const [cardIndex, setCardIndex] = useState(0);
  const card = chapter.cards[cardIndex];
  const last = cardIndex === chapter.cards.length - 1;

  return (
    <div className="lesson">
      <div className="lesson-header">
        <button className="btn btn-ghost" onClick={onExit}>✕</button>
        <div className="lesson-progress-track">
          <div
            className="lesson-progress-fill"
            style={{ width: `${((cardIndex + 1) / Math.max(chapter.cards.length, 1)) * 100}%` }}
          />
        </div>
        <span className="lesson-counter">
          {cardIndex + 1}/{chapter.cards.length}
        </span>
      </div>
      <div className="card-view">
        <div className="card-title">{card.title}</div>
        <div className="card-body">{card.body}</div>
      </div>
      <div className="quiz-footer">
        <div className="row-actions">
          {cardIndex > 0 && (
            <button className="btn btn-secondary" onClick={() => setCardIndex(cardIndex - 1)}>
              上一张
            </button>
          )}
          {!last ? (
            <button className="btn btn-primary" onClick={() => setCardIndex(cardIndex + 1)}>
              下一张
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onExit}>
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
