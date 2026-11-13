import { useMemo, useState } from "react";
import type { Card, Chapter } from "../types";
import {
  buildSearchIndex,
  cardSummary,
  groupCardsByUnit,
  highlightParts,
  searchEntries,
  type SearchResult,
} from "../library/search";
import {
  SECTION_MAP,
  findSectionByCard,
  getLearningSections,
  type LearningSection,
  type SectionMap,
} from "../learning/sections";
import { PlusMinusIcon, SearchIcon } from "../components/icons";

interface Props {
  chapters: Chapter[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenCard: (chapterId: string, cardId: string, sectionId?: string) => void;
  sectionMap?: SectionMap;
}

export function LibraryView({
  chapters,
  query,
  onQueryChange,
  onOpenCard,
  sectionMap = SECTION_MAP,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const activeQuery = query.trim();

  const sectionSets = useMemo(
    () => chapters.map((chapter) => getLearningSections(chapter, sectionMap)),
    [chapters, sectionMap]
  );
  const searchIndex = useMemo(() => buildSearchIndex(chapters), [chapters]);
  const results = useMemo(
    () => (activeQuery ? searchEntries(searchIndex, activeQuery) : []),
    [searchIndex, activeQuery]
  );

  const groupedResults = useMemo(() => {
    const map = new Map<
      string,
      {
        chapter: Chapter;
        section: LearningSection | null;
        results: SearchResult[];
      }
    >();
    for (const result of results) {
      const chapterIndex = chapters.findIndex(
        (chapter) => chapter.id === result.chapter.id
      );
      const set = chapterIndex >= 0 ? sectionSets[chapterIndex] : null;
      const section = set ? findSectionByCard(set, result.card.id) : null;
      const key = `${result.chapter.id}::${section?.id ?? ""}`;
      const existing = map.get(key);
      if (existing) {
        existing.results.push(result);
      } else {
        map.set(key, { chapter: result.chapter, section, results: [result] });
      }
    }
    return map;
  }, [results, chapters, sectionSets]);

  const toggleChapter = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCard = (chapterId: string, cardId: string, sectionId?: string) =>
    sectionId
      ? onOpenCard(chapterId, cardId, sectionId)
      : onOpenCard(chapterId, cardId);

  const renderHighlighted = (text: string, keyPrefix: string) =>
    highlightParts(text, activeQuery).map((part, i) =>
      part.match ? (
        <mark key={`${keyPrefix}-${i}`}>{part.text}</mark>
      ) : (
        <span key={`${keyPrefix}-${i}`}>{part.text}</span>
      )
    );

  const renderCardList = (
    cards: Card[],
    chapterId: string,
    sectionId?: string
  ) => {
    const units = groupCardsByUnit(cards);
    return (
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
                onClick={() => openCard(chapterId, card.id, sectionId)}
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
    );
  };

  return (
    <div className="library">
      <div className="library-header">
        <h1>讲解库</h1>
        <div className="library-search-field">
          <SearchIcon />
          <input
            className="library-search"
            type="search"
            value={query}
            placeholder="搜索所有章节的讲解…"
            aria-label="搜索所有章节的讲解…"
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
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
            [...groupedResults.values()].map(({ chapter, section, results: group }) => (
              <div key={`${chapter.id}::${section?.id ?? ""}`} className="library-result-group">
                <div className="library-result-chapter">
                  {chapter.title}
                  {section && (
                    <span className="library-result-section"> · {section.title}</span>
                  )}
                </div>
                {group.map((result) => (
                  <button
                    key={result.card.id}
                    className="library-result-item"
                    onClick={() =>
                      openCard(chapter.id, result.card.id, section?.id)
                    }
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
            const hasCards = chapter.cards.length > 0;
            const sectionSet = sectionSets[chapterIndex];
            const firstSection = sectionSet
              ? sectionSet.sections.find((section) => section.cards.length > 0) ?? null
              : null;
            const startCard = firstSection?.cards[0] ?? chapter.cards[0];
            return (
              <div
                key={chapter.id}
                className={`library-chapter${isOpen ? " is-open" : ""}`}
              >
                <div className="library-chapter-head">
                  <button
                    className="library-chapter-toggle"
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`第${chapterIndex + 1}章 ${chapter.title}，${chapter.cards.length} 张讲解`}
                    onClick={() => toggleChapter(chapter.id)}
                  >
                    <span className="library-chapter-index" aria-hidden="true">
                      <small>CH.</small>
                      <b>{String(chapterIndex + 1).padStart(2, "0")}</b>
                    </span>
                    <span className="library-chapter-copy">
                      <span className="library-chapter-title">{chapter.title}</span>
                      <span className="library-chapter-fr">{chapter.titleFr}</span>
                      <span className="library-chapter-count">
                        {chapter.cards.length} 张讲解
                      </span>
                    </span>
                    <PlusMinusIcon open={isOpen} />
                  </button>
                </div>
                <div className="library-chapter-actions">
                  <button
                    className="library-start btn btn-small"
                    type="button"
                    disabled={!hasCards || !startCard}
                    onClick={() =>
                      startCard &&
                      openCard(chapter.id, startCard.id, firstSection?.id)
                    }
                  >
                    开始阅读
                  </button>
                </div>
                {isOpen &&
                  (sectionSet ? (
                    <div className="library-section-list">
                      {sectionSet.sections
                        .filter((section) => section.cards.length > 0)
                        .map((section) => (
                          <div key={section.id} className="library-section">
                            <div className="library-section-head">
                              <span className="library-section-title">
                                {section.title}
                              </span>
                              <span className="library-section-count">
                                {section.cards.length} 张讲解
                              </span>
                              <button
                                className="library-section-start btn btn-small btn-secondary"
                                aria-label={`开始阅读：${section.title}`}
                                onClick={() =>
                                  openCard(
                                    chapter.id,
                                    section.cards[0]!.id,
                                    section.id
                                  )
                                }
                              >
                                阅读
                              </button>
                            </div>
                            {renderCardList(
                              section.cards,
                              chapter.id,
                              section.id
                            )}
                          </div>
                        ))}
                    </div>
                  ) : (
                    renderCardList(chapter.cards, chapter.id)
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
