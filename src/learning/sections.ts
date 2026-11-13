import type { Card, Chapter, Lesson, Progress } from "../types";

/**
 * 章节内的小章配置。章节根容器、卡片/关卡 ID 与内容顺序都不变，本文件只
 * 声明学习组织层：每张卡、每个练习恰好属于一个小章，挑战可留在专题综合区。
 *
 * `key` 只需在章节内稳定；对外暴露的小章 id 会自动加上章节前缀，避免跨专题
 * 冲突。未在本表配置的章节（内部题库、测试章节）整章回退。
 */
export interface SectionBlueprint {
  key: string;
  title: string;
  cardIds?: string[];
  lessonIds?: string[];
  challengeIds?: string[];
  /** 按卡片 id 的 -uN- 约定收卡（C03 的 card-x 资源另行显式列出）。 */
  cardUnits?: number[];
  /** 按关卡 id 的 -lN-/-lN-M 约定收关。 */
  lessonGroups?: number[];
  /** 按挑战 id 的 -xN-/-xN-M 约定收挑战。 */
  challengeGroups?: number[];
}

export interface ComprehensiveBlueprint {
  /** 默认“专题综合挑战” */
  title?: string;
  challengeIds?: string[];
  challengeGroups?: number[];
  /** 收下尚未归入小章的全部挑战（跨小章综合挑战的常用写法）。 */
  allChallenges?: boolean;
}

export interface ChapterSectionBlueprint {
  sections: SectionBlueprint[];
  /** 跨小章的挑战保留在专题综合区，不塞进尚未覆盖知识的小章。 */
  comprehensive?: ComprehensiveBlueprint;
}

export type SectionMap = Record<string, ChapterSectionBlueprint>;

export interface LearningSection {
  id: string;
  title: string;
  kind: "section" | "comprehensive";
  cards: Card[];
  lessons: Lesson[];
  challenges: Lesson[];
}

export interface ChapterSections {
  chapterId: string;
  sections: LearningSection[];
  /** 专题综合区独立表示；没有综合挑战时为 null。 */
  comprehensive: LearningSection | null;
}

export const COMPREHENSIVE_TITLE = "专题综合挑战";

const COMPREHENSIVE_KEY = "comprehensive";

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

function section(
  key: string,
  title: string,
  units: number[],
  lessons: number[],
  extra: Partial<SectionBlueprint> = {}
): SectionBlueprint {
  return { key, title, cardUnits: units, lessonGroups: lessons, ...extra };
}

/** 跨小章挑战的常用写法：收下所有尚未归入小章的挑战。 */
const remainingChallenges: ComprehensiveBlueprint = { allChallenges: true };

/**
 * 公开题库的显式语义映射。仅 public 章节 id 在此登记；内部题库与未登记
 * 章节不套用分区，保持原有整章行为。小章顺序即首页与讲解库的展示顺序，
 * 资源在同一个小章内仍按题库原始顺序排列。
 */
export const SECTION_MAP: SectionMap = {
  "pub-c01-boundaries": {
    sections: [
      section("all", "冠词、省音与缩合", [], [], {
        cardIds: range(1, 8).map((index) => `pub-c01-boundaries-card-${index}`),
        lessonGroups: range(1, 8),
        challengeGroups: [1, 2, 3],
      }),
    ],
  },

  "pub-c02-noun-phrases": {
    sections: [
      section("s1", "名词性数与阴性词形基础", [1, 2], [1, 2]),
      section("s2", "阴性词尾与不规则、复合名词", [3, 4], [3, 4]),
      section("s3", "复数、冠词与数量表达", [5, 6, 7], [5, 6, 7]),
      section("s4", "名词补语与单复数转换", [8, 9], [8, 9]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c03-adjectives": {
    sections: [
      section("s1", "配合对象与规则阴性", [1, 2], [1, 2]),
      section("s2", "特殊阴性词尾与词条判断", [3, 4, 5], [3, 4, 5], {
        cardIds: ["pub-c03-adjectives-card-x1-1"],
      }),
      section("s3", "复数规则与特殊复数", [6, 7, 8, 9], [6, 7, 8, 9], {
        cardIds: ["pub-c03-adjectives-card-x1-2"],
      }),
      section("s4", "位置、des 变 de 与语义", [10, 11, 12], [10, 11, 12], {
        cardIds: [
          "pub-c03-adjectives-card-x2-1",
          "pub-c03-adjectives-card-x2-2",
        ],
        challengeGroups: [2],
      }),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c04-determiners": {
    sections: [
      section("s1", "指示限定词", [1, 2], [1, 2]),
      section("s2", "主有限定词与连用", [3, 4, 5], [3, 4, 5]),
      section("s3", "数量限定词与 la plupart", [6, 7], [6, 7]),
      section("s4", "tout、même、autre 与 ces/ses", [8, 9], [8, 9]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c05-present": {
    sections: [
      section("s1", "être/avoir 与第一组现在时", [1, 2], [1, 2]),
      section("s2", "拼写调整与 -ir 动词", [3, 4], [3, 4]),
      section("s3", "主谓一致与泛指主语", [5, 6], [5, 6]),
      section("s4", "现在时用法与不定式词干", [7, 8], [7, 8]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c06-verbs": {
    sections: [
      section("s1", "aller、faire 与常见不规则动词", [1, 2], [1, 2]),
      section("s2", "-dre、voir/croire 与其他不规则词族", [3, 4], [3, 4]),
      section("s3", "être 系表、avoir 与存在/归属", [5, 6, 7], [5, 6, 7]),
      section("s4", "être/avoir 选择与直接宾语", [8, 9], [8, 9]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c07-negation-questions": {
    sections: [
      section("s1", "否定形式、范围与冠词", [1, 2, 3], [1, 2, 3]),
      section("s2", "疑问句结构与疑问词", [4, 5], [4, 5]),
      section("s3", "主宾语疑问、否定疑问与否定词位置", [6, 7, 8], [6, 7, 8]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c08-imperative-emphasis": {
    sections: [
      section("s1", "命令式形式与否定", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "c'est / il est 与强调句", [3, 4], [3, 4]),
      section("s3", "语域与句式改写", [5], [5]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c09-past-tenses": {
    sections: [
      section("s1", "过去分词与助动词", [1, 2], [1, 2]),
      section("s2", "复合过去时：构成、否定与疑问", [3], [3]),
      section("s3", "现在分词与副动词", [4], [4]),
      section("s4", "未完成过去时", [5, 6], [5, 6]),
      section("s5", "愈过去时与基础叙事", [7, 8], [7, 8]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c10-object-pronouns": {
    sections: [
      section("s1", "宾语代词选择：直接/间接、en、y", [1, 2, 3], [1, 2, 3]),
      section("s2", "单代词位置与双代词顺序", [4, 5], [4, 5]),
      section("s3", "命令式中的宾语代词", [6], [6]),
      section("s4", "前置宾语配合与复合时态", [7, 8], [7, 8]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c11-pronominal-verbs": {
    sections: [
      section("s1", "代词式动词构成、意义与简单时态", [1, 2], [1, 2]),
      section("s2", "复合时态与过去分词配合", [3, 4], [3, 4]),
      section("s3", "不定式/命令式与自反代词角色", [5, 6], [5, 6]),
      section("s4", "重读代词、on 与泛指", [7, 8], [7, 8], {
        challengeGroups: [2],
      }),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c12-demonstrative-possessive-indefinite": {
    sections: [
      section("s1", "指示代词与主有代词", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "autre 与不定代词", [3, 4], [3, 4]),
      section("s3", "否定代词与中性指代", [5, 6], [5, 6]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c13-future-conditional": {
    sections: [
      section("s1", "最近将来/过去与简单将来时", [1, 2], [1, 2]),
      section("s2", "将来时意义与条件式现在时", [3, 4], [3, 4]),
      section("s3", "条件式过去、si 假设与过去将来", [5, 6, 7], [5, 6, 7], {
        challengeGroups: [2],
      }),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c14-relative-clauses": {
    sections: [
      section("s1", "qui、que、où、dont", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "介词+关系词、复合形式与 ce 系列", [3, 4], [3, 4]),
      section("s3", "指示代词与关系从句、配合及分词替代", [5], [5]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c15-comparison-adverbs": {
    sections: [
      section("s1", "副词构成与比较级", [1, 2], [1, 2]),
      section("s2", "最高级、不规则比较与数量比较", [3, 4], [3, 4]),
      section("s3", "副词位置与程度", [5], [5]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c16-time-space-prepositions": {
    sections: [
      section("s1", "空间方位与地理名称", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "日期钟点与时间介词", [3, 4], [3, 4]),
      section("s3", "方式、材料、分配与抽象引申", [5, 6], [5, 6]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c17-passive-voice": {
    sections: [
      section("s1", "被动构成、转换与时态", [1, 2], [1, 2], {
        challengeGroups: [2],
      }),
      section("s2", "施动者与被动/状态辨别", [3, 4], [3, 4]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c18-verb-complements": {
    sections: [
      section("s1", "宾语与介词支配", [1, 2], [1, 2]),
      section("s2", "动词/名词/形容词 + 不定式", [3], [3]),
      section("s3", "使役、感知与无人称结构", [4, 5], [4, 5], {
        challengeGroups: [2],
      }),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c19-subjunctive": {
    sections: [
      section("s1", "虚拟式现在时与过去时形式", [1, 2], [1, 2]),
      section("s2", "虚拟式触发与语气对照", [3, 4], [3, 4]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c20-complex-sentences": {
    sections: [
      section("s1", "并列与时间从句", [1, 2], [1, 2]),
      section("s2", "原因、目的与结果", [3], [3]),
      section("s3", "让步、对照与 sans 结构", [4, 5], [4, 5]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c21-reported-speech": {
    sections: [
      section("s1", "陈述、疑问与命令的转述", [1, 2, 3], [1, 2, 3]),
      section("s2", "指称转换与直接引语还原", [4, 5], [4, 5], {
        challengeGroups: [2],
      }),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c22-aspect-modality": {
    sections: [
      section("s1", "复合过去/未完成/愈过去体貌", [1, 2], [1, 2]),
      section("s2", "条件式过去与传闻/推测", [3, 4], [3, 4]),
      section("s3", "叙事现在、近过去/近将来与 ce 情态", [5, 6], [5, 6]),
    ],
    comprehensive: remainingChallenges,
  },

  "pub-c23-discourse-markers": {
    sections: [
      section("s1", "顺序、转折、后果与列举", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "否定细节与副动词", [3, 4], [3, 4], {
        challengeGroups: [2],
      }),
    ],
  },

  "pub-c24-lexical-constructions": {
    sections: [
      section("s1", "派生、反义与 avoir 搭配", [1, 2], [1, 2], {
        challengeGroups: [1],
      }),
      section("s2", "词汇化短语、比喻与谚语", [3, 4], [3, 4], {
        challengeGroups: [2],
      }),
    ],
  },

  "pub-c25-integration-review": {
    sections: [
      section("all", "综合表达与回顾", [1, 2], [1, 2], {
        challengeGroups: [1, 2],
      }),
    ],
  },
};

function fail(chapterId: string, message: string): never {
  throw new Error(`[learning-sections] ${chapterId}: ${message}`);
}

interface ClaimState {
  cards: Map<string, string>;
  lessons: Map<string, string>;
  challenges: Map<string, string>;
}

function claimId(
  chapterId: string,
  claimed: Map<string, string>,
  id: string,
  kind: string,
  location: string
): void {
  const previous = claimed.get(id);
  if (previous) {
    fail(chapterId, `${kind} ${id} 重复归属：${previous} 与 ${location}`);
  }
  claimed.set(id, location);
}

function requireKnown(
  chapterId: string,
  known: Set<string>,
  id: string,
  kind: string,
  location: string
): void {
  if (!known.has(id)) {
    fail(chapterId, `${kind} ${id} 在章节中不存在（${location}）`);
  }
}

function selectResources<T extends { id: string }>(
  chapterId: string,
  all: T[],
  ids: string[],
  claimed: Map<string, string>,
  kind: string,
  location: string
): T[] {
  const known = new Set(all.map((item) => item.id));
  const selected = new Set<string>();
  for (const id of ids) {
    requireKnown(chapterId, known, id, kind, location);
    claimId(chapterId, claimed, id, kind, location);
    selected.add(id);
  }
  return all.filter((item) => selected.has(item.id));
}

/**
 * 把 -uN-、-lN-、-xN- 分组写法展开成真实资源 id。显式 id 与分组可同时使用，
 * 最终仍由 selectResources 检查未知、重复与遗漏。
 */
function resolveIds<T extends { id: string }>(
  all: T[],
  groups: number[] | undefined,
  explicit: string[] | undefined,
  marker: "u" | "l" | "x"
): string[] {
  const ids: string[] = [];
  if (Array.isArray(groups) && groups.length > 0) {
    const patterns = groups.map(
      (group) => new RegExp(`-${marker}${group}(?:-|$)`)
    );
    for (const item of all) {
      if (patterns.some((pattern) => pattern.test(item.id))) ids.push(item.id);
    }
  }
  if (Array.isArray(explicit)) ids.push(...explicit);
  return ids;
}

function assertNoMissing<T extends { id: string }>(
  chapterId: string,
  all: T[],
  claimed: Map<string, string>,
  label: string
): void {
  const missing = all.filter((item) => !claimed.has(item.id));
  if (missing.length > 0) {
    fail(
      chapterId,
      `以下${label}未归属：${missing.map((item) => item.id).join("、")}`
    );
  }
}

function buildSection(
  chapter: Chapter,
  blueprint: SectionBlueprint,
  state: ClaimState,
  seenKeys: Set<string>
): LearningSection {
  const key = typeof blueprint.key === "string" ? blueprint.key.trim() : "";
  if (key === "") {
    fail(chapter.id, "小章 key 不能为空");
  }
  if (key === COMPREHENSIVE_KEY) {
    fail(chapter.id, `小章 key 不能使用保留值 ${COMPREHENSIVE_KEY}`);
  }
  if (seenKeys.has(key)) {
    fail(chapter.id, `小章 key 重复：${key}`);
  }
  seenKeys.add(key);

  const title = typeof blueprint.title === "string" ? blueprint.title.trim() : "";
  if (title === "") {
    fail(chapter.id, `小章 ${key} 缺少标题`);
  }

  const location = `小章 ${key}`;
  const cards = selectResources(
    chapter.id,
    chapter.cards,
    resolveIds(chapter.cards, blueprint.cardUnits, blueprint.cardIds, "u"),
    state.cards,
    "卡片",
    location
  );
  const lessons = selectResources(
    chapter.id,
    chapter.lessons,
    resolveIds(chapter.lessons, blueprint.lessonGroups, blueprint.lessonIds, "l"),
    state.lessons,
    "练习",
    location
  );
  const challenges = selectResources(
    chapter.id,
    chapter.challenges,
    resolveIds(
      chapter.challenges,
      blueprint.challengeGroups,
      blueprint.challengeIds,
      "x"
    ),
    state.challenges,
    "挑战",
    location
  );

  if (cards.length === 0 && lessons.length === 0 && challenges.length === 0) {
    fail(chapter.id, `小章 ${key} 没有学习资源`);
  }

  return {
    id: `${chapter.id}::${key}`,
    title,
    kind: "section",
    cards,
    lessons,
    challenges,
  };
}

function buildComprehensive(
  chapter: Chapter,
  blueprint: ComprehensiveBlueprint,
  state: ClaimState
): LearningSection | null {
  const title =
    typeof blueprint.title === "string" && blueprint.title.trim() !== ""
      ? blueprint.title.trim()
      : COMPREHENSIVE_TITLE;
  const ids = resolveIds(
    chapter.challenges,
    blueprint.challengeGroups,
    blueprint.challengeIds,
    "x"
  );
  if (blueprint.allChallenges) {
    for (const challenge of chapter.challenges) {
      if (!state.challenges.has(challenge.id)) ids.push(challenge.id);
    }
  }
  const challenges = selectResources(
    chapter.id,
    chapter.challenges,
    ids,
    state.challenges,
    "挑战",
    "专题综合区"
  );

  if (challenges.length === 0) return null;

  return {
    id: `${chapter.id}::${COMPREHENSIVE_KEY}`,
    title,
    kind: "comprehensive",
    cards: [],
    lessons: [],
    challenges,
  };
}

function buildSections(
  chapter: Chapter,
  blueprint: ChapterSectionBlueprint
): ChapterSections {
  const state: ClaimState = {
    cards: new Map(),
    lessons: new Map(),
    challenges: new Map(),
  };
  const seenKeys = new Set<string>();
  const sections = (Array.isArray(blueprint.sections) ? blueprint.sections : []).map(
    (section) => buildSection(chapter, section, state, seenKeys)
  );

  if (sections.length === 0) {
    fail(chapter.id, "分区配置没有小章");
  }

  const comprehensive = blueprint.comprehensive
    ? buildComprehensive(chapter, blueprint.comprehensive, state)
    : null;

  assertNoMissing(chapter.id, chapter.cards, state.cards, "卡片");
  assertNoMissing(chapter.id, chapter.lessons, state.lessons, "练习");
  assertNoMissing(chapter.id, chapter.challenges, state.challenges, "挑战");

  return {
    chapterId: chapter.id,
    sections,
    comprehensive,
  };
}

/**
 * 读取章节的小章分区。没有显式映射时返回 null，由调用方保持整章行为；
 * 有映射但资源重复、缺失或不存在时抛错，绝不静默丢弃内容。
 */
export function getLearningSections(
  chapter: Chapter,
  map: SectionMap = SECTION_MAP
): ChapterSections | null {
  if (!Object.prototype.hasOwnProperty.call(map, chapter.id)) return null;
  return buildSections(chapter, map[chapter.id]!);
}

export function allLearningSections(set: ChapterSections): LearningSection[] {
  return set.comprehensive ? [...set.sections, set.comprehensive] : [...set.sections];
}

export function findSectionById(
  set: ChapterSections,
  sectionId: string
): LearningSection | null {
  return allLearningSections(set).find((section) => section.id === sectionId) ?? null;
}

export function findSectionByCard(
  set: ChapterSections,
  cardId: string
): LearningSection | null {
  return (
    allLearningSections(set).find((section) =>
      section.cards.some((card) => card.id === cardId)
    ) ?? null
  );
}

export function findSectionByLesson(
  set: ChapterSections,
  lessonId: string
): LearningSection | null {
  return (
    allLearningSections(set).find(
      (section) =>
        section.lessons.some((item) => item.id === lessonId) ||
        section.challenges.some((item) => item.id === lessonId)
    ) ?? null
  );
}

/**
 * 当前关卡在所属小章（或专题综合区）内的完整序列。首页的“下一关”与
 * LessonView 的 hasNext 共用这一结果，避免一处跨小章、另一处不跨。
 */
export function lessonSequenceFor(
  set: ChapterSections,
  lessonId: string
): Lesson[] {
  const section = findSectionByLesson(set, lessonId);
  if (!section) return [];
  if (section.kind === "comprehensive") return section.challenges;
  return [...section.lessons, ...section.challenges];
}

export function sectionProgress(
  section: LearningSection,
  records: Progress["lessons"]
): { done: number; total: number } {
  const exercises = [...section.lessons, ...section.challenges];
  const done = exercises.filter(
    (item) => (records[item.id]?.stars ?? 0) > 0
  ).length;
  return { done, total: exercises.length };
}
