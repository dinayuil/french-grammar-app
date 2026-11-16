import type { Card, Chapter, Lesson, Question } from "../types";
import { CONTENT_LOCALES } from "../i18n/types";

/**
 * 一个可定位的法语（或其他内容语言）缺失项。
 *
 * `field` 使用基础字段名；小章标题使用 `sectionTitles.<sectionKey>`。
 * 仅报告缺少显式覆盖或缺少已注册小章标题的项；manifest 已裁定的
 * 共用基础字段不进入报告，法语 `translation` 按显示策略豁免。
 */
export type LocalizationEntityType = "chapter" | "card" | "lesson" | "question";

export type LocalizationGapReason =
  | "missing-override"
  | "missing-section-title";

export interface LocalizationGap {
  locale: string;
  chapterId: string;
  entityType: LocalizationEntityType;
  entityId: string;
  field: string;
  reason: LocalizationGapReason;
}

/** 章 ID → app 注册的小章 key（`SECTION_MAP` 的普通小章，不含综合区）。 */
export type SectionKeyRegistry = Readonly<Record<string, readonly string[]>>;

/** manifest `localizationSharedFields[locale]`：实体 ID → 显式复用基础字段。 */
export type SharedFieldRegistry = Readonly<Record<string, readonly string[]>>;

export interface LocalizationCoverageOptions {
  /**
   * 每版 manifest 中该语言的显式复用裁定。只有列出的字段可以复用基础
   * 字段；未列出且没有覆盖的需翻译字段才进入缺失报告。
   */
  sharedFields?: SharedFieldRegistry;
  /**
   * 内容语言注册表。默认产品注册表（首期仅 `fr`）；未来语言测试可显式
   * 扩展，但测试夹具不会进入产品选项。
   */
  contentLocales?: readonly string[];
}

type Entity = Chapter | Card | Lesson | Question;

interface EntityEntry {
  type: LocalizationEntityType;
  chapterId: string;
  entity: Entity;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function localeFields(
  entity: Entity,
  locale: string
): Record<string, unknown> | undefined {
  const locales = entity.locales as Record<string, unknown> | undefined;
  const fields = locales?.[locale];
  return isPlainObject(fields) ? fields : undefined;
}

function nonEmptyOptions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  );
}

function indexEntities(
  chapters: readonly Chapter[]
): Map<string, EntityEntry> {
  const index = new Map<string, EntityEntry>();
  const claim = (entity: Entity, type: LocalizationEntityType, chapterId: string) => {
    const previous = index.get(entity.id);
    if (previous) {
      throw new Error(
        `内容实体 ID 重复：${JSON.stringify(entity.id)}（${previous.type} 与 ${type}）；无法确定共用字段裁定所属实体`
      );
    }
    index.set(entity.id, { type, chapterId, entity });
  };

  for (const chapter of chapters) {
    claim(chapter, "chapter", chapter.id);
    for (const card of chapter.cards) claim(card, "card", chapter.id);
    for (const lesson of [...chapter.lessons, ...chapter.challenges]) {
      claim(lesson, "lesson", chapter.id);
      for (const question of lesson.questions) {
        claim(question, "question", chapter.id);
      }
    }
  }
  return index;
}

/**
 * 本实体可从基础字段复用的展示字段。法语章名固定使用 `titleFr`，
 * 因此 chapter 在 `fr` 下没有可复用字段；小章标题没有基础字段可复用。
 */
function reusableFields(entry: EntityEntry, locale: string): readonly string[] {
  switch (entry.type) {
    case "chapter":
      return locale === "fr" ? [] : ["title"];
    case "card":
      return ["title", "body"];
    case "lesson":
      return ["title"];
    case "question": {
      const question = entry.entity as Question;
      const fields = ["prompt", "example", "explain"];
      if (locale !== "fr") fields.push("translation");
      if (question.type === "choice") fields.push("options");
      return fields;
    }
  }
}

/**
 * 校验显式复用裁定并返回 `entityId\0field` 豁免集合。
 * 未知实体、未知/不可复用字段、重复字段、已另存覆盖的字段都直接报错，
 * 不能静默忽略；该映射只裁定复用，不声明语言可用性。
 */
function adjudicatedFields(
  chapters: readonly Chapter[],
  locale: string,
  sharedFields: SharedFieldRegistry
): Set<string> {
  const index = indexEntities(chapters);
  const exempt = new Set<string>();

  for (const [entityId, fields] of Object.entries(sharedFields)) {
    const entry = index.get(entityId);
    if (!entry) {
      throw new Error(
        `localizationSharedFields.${locale}: 未知实体 ID ${JSON.stringify(entityId)}`
      );
    }
    if (!Array.isArray(fields)) {
      throw new Error(
        `localizationSharedFields.${locale}.${entityId}: 字段列表必须是数组`
      );
    }
    const allowed = new Set(reusableFields(entry, locale));
    const seen = new Set<string>();
    for (const field of fields) {
      if (!isNonEmptyString(field) || !allowed.has(field)) {
        throw new Error(
          `localizationSharedFields.${locale}.${entityId}: 未知或不可复用字段 ${JSON.stringify(field)}`
        );
      }
      if (seen.has(field)) {
        throw new Error(
          `localizationSharedFields.${locale}.${entityId}: 重复字段 ${JSON.stringify(field)}`
        );
      }
      seen.add(field);
      const overrides = localeFields(entry.entity, locale);
      if (overrides && hasOwn(overrides, field)) {
        throw new Error(
          `localizationSharedFields.${locale}.${entityId}.${field}: 同时存在显式覆盖，不能重复裁定复用`
        );
      }
      exempt.add(`${entityId}\u0000${field}`);
    }
  }
  return exempt;
}

/**
 * 汇总一个内容语言在给定题库中的缺失项。返回空数组表示该语言已达到
 * 显式覆盖门槛；manifest 未声明该语言时调用方只报告、不阻断。
 */
export function collectLocalizationGaps(
  chapters: readonly Chapter[],
  locale: string,
  sectionKeys: SectionKeyRegistry = {},
  options: LocalizationCoverageOptions = {}
): LocalizationGap[] {
  const registered = options.contentLocales ?? CONTENT_LOCALES;
  if (!registered.includes(locale)) {
    throw new Error(
      `内容语言 ${JSON.stringify(locale)} 未注册；只允许 ${registered.join(", ")}`
    );
  }

  const exempt = adjudicatedFields(
    chapters,
    locale,
    options.sharedFields ?? {}
  );
  const gaps: LocalizationGap[] = [];
  const addGap = (
    chapterId: string,
    entityType: LocalizationEntityType,
    entityId: string,
    field: string,
    reason: LocalizationGapReason
  ) => {
    gaps.push({ locale, chapterId, entityType, entityId, field, reason });
  };
  const isExempt = (entityId: string, field: string) =>
    exempt.has(`${entityId}\u0000${field}`);
  const missing = (entity: Entity, field: string): boolean => {
    const fields = localeFields(entity, locale);
    return !isNonEmptyString(fields?.[field]);
  };

  for (const chapter of chapters) {
    const fields = localeFields(chapter, locale);

    if (locale !== "fr" && !isExempt(chapter.id, "title") && missing(chapter, "title")) {
      addGap(chapter.id, "chapter", chapter.id, "title", "missing-override");
    }

    const sectionTitles = fields?.sectionTitles;
    if (sectionTitles !== undefined && !isPlainObject(sectionTitles)) {
      throw new Error(
        `章节 ${chapter.id}: locales.${locale}.sectionTitles 必须是对象`
      );
    }
    const titles: Record<string, unknown> =
      sectionTitles === undefined
        ? {}
        : (sectionTitles as Record<string, unknown>);
    const registeredKeys = sectionKeys[chapter.id] ?? [];
    for (const key of Object.keys(titles)) {
      if (!registeredKeys.includes(key)) {
        throw new Error(
          `章节 ${chapter.id}: locales.${locale}.sectionTitles 含未注册小章 key ${JSON.stringify(key)}`
        );
      }
    }
    for (const key of registeredKeys) {
      if (!isNonEmptyString(titles[key])) {
        addGap(
          chapter.id,
          "chapter",
          chapter.id,
          `sectionTitles.${key}`,
          "missing-section-title"
        );
      }
    }

    for (const card of chapter.cards) {
      for (const field of ["title", "body"] as const) {
        if (!isExempt(card.id, field) && missing(card, field)) {
          addGap(chapter.id, "card", card.id, field, "missing-override");
        }
      }
    }

    for (const lesson of [...chapter.lessons, ...chapter.challenges]) {
      if (!isExempt(lesson.id, "title") && missing(lesson, "title")) {
        addGap(chapter.id, "lesson", lesson.id, "title", "missing-override");
      }
      for (const question of lesson.questions) {
        for (const field of ["prompt", "explain"] as const) {
          if (!isExempt(question.id, field) && missing(question, field)) {
            addGap(chapter.id, "question", question.id, field, "missing-override");
          }
        }
        if (
          question.example !== undefined &&
          !isExempt(question.id, "example") &&
          missing(question, "example")
        ) {
          addGap(chapter.id, "question", question.id, "example", "missing-override");
        }
        if (
          locale !== "fr" &&
          !isExempt(question.id, "translation") &&
          missing(question, "translation")
        ) {
          addGap(chapter.id, "question", question.id, "translation", "missing-override");
        }
        if (
          question.type === "choice" &&
          !isExempt(question.id, "options") &&
          !nonEmptyOptions(localeFields(question, locale)?.options)
        ) {
          addGap(chapter.id, "question", question.id, "options", "missing-override");
        }
      }
    }
  }

  return gaps;
}

/** 稳定的单行定位文本，供构建错误和测试报告复用。 */
export function formatLocalizationGap(gap: LocalizationGap): string {
  if (gap.reason === "missing-section-title") {
    return `[${gap.chapterId}] 小章 ${gap.field.slice("sectionTitles.".length)}: 缺少 locales.${gap.locale}.${gap.field}`;
  }
  return `[${gap.chapterId}] ${gap.entityType} ${gap.entityId}: 缺少 locales.${gap.locale}.${gap.field}`;
}
