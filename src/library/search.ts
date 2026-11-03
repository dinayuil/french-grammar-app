import type { Card, Chapter } from "../types";

export interface SearchEntry {
  chapter: Chapter;
  chapterIndex: number;
  card: Card;
  cardIndex: number;
  normalizedTitle: string;
  normalizedBody: string;
}

export interface SearchResult extends SearchEntry {
  summary: string;
}

export interface CardUnit {
  unit: number | null;
  cards: Array<{ card: Card; cardIndex: number }>;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

interface NormalizedText {
  normalized: string;
  /** normalized index -> original index; one entry per normalized code unit */
  map: number[];
}

const UNIT_PATTERN = /-u(\d+)-/i;

/**
 * Normalize text for search: lowercase, strip combining marks and unify the
 * curly apostrophe variants. The returned map lets callers translate ranges
 * in the normalized string back to the original string.
 */
function normalizeWithMap(value: string): NormalizedText {
  let normalized = "";
  const map: number[] = [];

  for (let originalIndex = 0; originalIndex < value.length; ) {
    const codePoint = value.codePointAt(originalIndex);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const stripped = char
      .toLowerCase()
      .replace(/[’‘ʼ]/g, "'")
      .normalize("NFD")
      .replace(/\p{M}/gu, "");

    for (let i = 0; i < stripped.length; i += 1) {
      map.push(originalIndex);
    }
    normalized += stripped;
    originalIndex += char.length;
  }

  return { normalized, map };
}

export function normalizeText(value: string): string {
  return normalizeWithMap(value).normalized;
}

function queryTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => normalizeText(term))
    .filter((term) => term.length > 0);
}

export function buildSearchIndex(chapters: Chapter[]): SearchEntry[] {
  const entries: SearchEntry[] = [];

  chapters.forEach((chapter, chapterIndex) => {
    chapter.cards.forEach((card, cardIndex) => {
      entries.push({
        chapter,
        chapterIndex,
        card,
        cardIndex,
        normalizedTitle: normalizeText(card.title),
        normalizedBody: normalizeText(card.body),
      });
    });
  });

  return entries;
}

export function searchEntries(
  entries: SearchEntry[],
  query: string
): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return entries
    .filter((entry) =>
      terms.every(
        (term) =>
          entry.normalizedTitle.includes(term) ||
          entry.normalizedBody.includes(term)
      )
    )
    .map((entry) => ({
      ...entry,
      summary: cardSummary(entry.card.body, query, 60),
    }));
}

function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0].trim();
}

/**
 * First line when no query is given or the body has no hit; otherwise a
 * slice starting at the earliest body hit, mapped back to original text.
 */
export function cardSummary(
  body: string,
  query?: string,
  maxLength = 60
): string {
  if (query) {
    const terms = queryTerms(query);
    if (terms.length > 0) {
      const { normalized, map } = normalizeWithMap(body);
      let earliest = -1;

      for (const term of terms) {
        const matchIndex = normalized.indexOf(term);
        if (matchIndex === -1) continue;
        const originalIndex = map[matchIndex];
        if (earliest === -1 || originalIndex < earliest) {
          earliest = originalIndex;
        }
      }

      if (earliest !== -1) {
        if (maxLength <= 0) return "";
        return body.slice(earliest, earliest + maxLength);
      }
    }
  }

  return firstLine(body);
}

/**
 * Split original text into React-safe segments, marking accent- and
 * case-insensitive matches of every query term. Overlapping ranges merge.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || text.length === 0) {
    return [{ text, match: false }];
  }

  const { normalized, map } = normalizeWithMap(text);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const term of terms) {
    let from = 0;
    while (from <= normalized.length - term.length) {
      const matchIndex = normalized.indexOf(term, from);
      if (matchIndex === -1) break;

      const start = map[matchIndex];
      const endIndex = matchIndex + term.length;
      const end = endIndex < map.length ? map[endIndex] : text.length;
      ranges.push({ start, end });
      from = matchIndex + 1;
    }
  }

  if (ranges.length === 0) {
    return [{ text, match: false }];
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), match: false });
    }
    if (range.end > range.start) {
      parts.push({ text: text.slice(range.start, range.end), match: true });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }

  return parts;
}

/**
 * Group cards by the `-uN-` id convention. Chapters without any unit id keep
 * one flat null group; mixed chapters put unassigned cards last.
 */
export function groupCardsByUnit(cards: Card[]): CardUnit[] {
  if (cards.length === 0) return [];

  const groups = new Map<number, CardUnit>();
  const unassigned: CardUnit = { unit: null, cards: [] };
  let hasUnit = false;

  cards.forEach((card, cardIndex) => {
    const match = UNIT_PATTERN.exec(card.id);
    if (!match) {
      unassigned.cards.push({ card, cardIndex });
      return;
    }

    hasUnit = true;
    const unit = Number(match[1]);
    let group = groups.get(unit);
    if (!group) {
      group = { unit, cards: [] };
      groups.set(unit, group);
    }
    group.cards.push({ card, cardIndex });
  });

  if (!hasUnit) {
    return [
      {
        unit: null,
        cards: cards.map((card, cardIndex) => ({ card, cardIndex })),
      },
    ];
  }

  const result = [...groups.values()].sort(
    (a, b) => (a.unit ?? 0) - (b.unit ?? 0)
  );
  if (unassigned.cards.length > 0) result.push(unassigned);
  return result;
}
