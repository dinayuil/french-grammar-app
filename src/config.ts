// XP 与激励数值(设计文档「激励数值」节);改数值只改这里
export const XP_PER_CORRECT = 2;
export const XP_REDO_CORRECT = 1;
export const XP_LESSON_BONUS = 5;
export const XP_PERFECT_BONUS = 5;
export const XP_CHALLENGE_BONUS = 10;
export const XP_PER_LEVEL = 100;

export const GOAL_PRESETS = [30, 60, 120] as const;
export const DEFAULT_GOAL: number = GOAL_PRESETS[0];

export const STORAGE_KEY: string =
  __FGE_EDITION__ === "internal" ? "fge.progress.v2" : "fge.public.progress.v2";
/** 旧版数据键:仅 internal 保留自动迁移;public 为 null,绝不读取内部键。 */
export const LEGACY_STORAGE_KEY: string | null =
  __FGE_EDITION__ === "internal" ? "fge.progress.v1" : null;
