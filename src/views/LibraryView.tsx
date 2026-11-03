import { useMemo, useState } from "react";
import type { Chapter } from "../types";
import {
  buildSearchIndex,
  cardSummary,
  groupCardsByUnit,
  highlightParts,
  searchEntries,
  type SearchResult,
} from "../library/search";

interface Props {
  chapters: Chapter[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenCard: (chapterId: string, cardId: string) => void;
}

export function LibraryView({ chapters, query, onQueryChange, onOpenCard }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const activeQuery = query.trim();

  const searchIndex = useMemo(() => buildSearchIndex(chapters), [chapters]);
  const results = useMemo(
    () => (activeQuery ? searchEntries(searchIndex, activeQuery) : []),
    [searchIndex, activeQuery]
  );

  const groupedResults = useMemo(() => {
    const map = new Map<
      string,
      { chapter: Chapter; results: SearchResult[] }
    >();
    for (const result of results) {
      const existing = map.get(result.chapter.id);
      if (existing) {
        existing.results.push(result);
      } else {
        map.set(result.chapter.id, { chapter: result.chapter, results: [result] });
      }
    }
    return map;
  }, [results]);

  const toggleChapter = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderHighlighted = (text: string, keyPrefix: string) =>
    highlightParts(text, activeQuery).map((part, i) =>
      part.match ? (
        <mark key={`${keyPrefix}-${i}`}>{part.text}</mark>
      ) : (
        <span key={`${keyPrefix}-${i}`}>{part.text}</span>
      )
    );

  return (
    <div className="library">
      <div className="library-header">
        <h1>讲解</h1>
        <input
          className="library-search"
          type="search"
          value={query}
          placeholder="搜索所有章节的讲解…"
          aria-label="搜索所有章节的讲解…"
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {activeQuery ? (
        <div className="library-results">
          <div className="library-result-count">找到 {results.length} 条结果</div>
          {results.length === 0 ? (
            <div className="library-empty">
              <p>未找到「{activeQuery}」相关讲解</p>
              <button
                className="library-clear btn btn-secondary"
                onClick={() => onQueryChange("")}
              >
                清除搜索
              </button>
            </div>
          ) : (
            [...groupedResults.values()].map(({ chapter, results: group }) => (
              <div key={chapter.id} className="library-result-group">
                <div className="library-result-chapter">{chapter.title}</div>
                {group.map((result) => (
                  <button
                    key={result.card.id}
                    className="library-result-item"
                    onClick={() => onOpenCard(chapter.id, result.card.id)}
                  >
                    <div className="library-result-title">
                      {renderHighlighted(result.card.title, `${result.card.id}-t`)}
                    </div>
                    <div className="library-result-summary">
                      {renderHighlighted(result.summary, `${result.card.id}-s`)}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="library-chapters">
          {chapters.map((chapter, chapterIndex) => {
            const isOpen = expanded.has(chapter.id);
            const units = groupCardsByUnit(chapter.cards);
            const hasCards = chapter.cards.length > 0;
            return (
              <div key={chapter.id} className="library-chapter">
                <div className="library-chapter-head">
                  <button
                    className="library-chapter-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggleChapter(chapter.id)}
                  >
                    <span className="library-chapter-number">第{chapterIndex + 1}章</span>
                    <span className="library-chapter-title">{chapter.title}</span>
                    <span className="library-chapter-count">
                      {chapter.cards.length} 张讲解
                    </span>
                    <span className="library-chapter-arrow">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  <button
                    className="library-start btn btn-small btn-primary"
                    disabled={!hasCards}
                    onClick={() => onOpenCard(chapter.id, chapter.cards[0].id)}
                  >
                    开始阅读
                  </button>
                </div>
                {isOpen && (
                  <div className="library-card-list">
                    {units.map((unit) => (
                      <div key={unit.unit ?? "flat"} className="library-unit">
                        {unit.unit !== null && (
                          <div className="library-unit-title">第{unit.unit}单元</div>
                        )}
                        {unit.cards.map(({ card, cardIndex }) => (
                          <button
                            key={card.id}
                            className="library-card-item"
                            onClick={() => onOpenCard(chapter.id, card.id)}
                          >
                            <span className="library-card-index">{cardIndex + 1}.</span>
                            <span className="library-card-title">{card.title}</span>
                            <span className="library-card-summary">
                              {cardSummary(card.body, undefined, 40)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
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
