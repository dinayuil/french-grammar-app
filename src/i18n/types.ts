/**
 * 首期产品可选的界面与辅助内容语言。
 *
 * 顺序即语言菜单顺序；课程目标语言固定为法语，不随此列表变化。
 * 新增产品语言必须同时补齐界面文案与内容覆盖门槛。
 */
export const UI_LOCALES = ["zh-CN", "fr"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/**
 * 首期允许出现在内容 `locales` 映射中的语言。
 *
 * 原字段代表中文，因此内容映射不登记 `zh-CN`。未来英语等语言只有在
 * 显式注册并通过完整性校验后才可加入；测试夹具不会自动成为产品选项。
 */
export const CONTENT_LOCALES = ["fr"] as const;

export type ContentLocale = (typeof CONTENT_LOCALES)[number];
