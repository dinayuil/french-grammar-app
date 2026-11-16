import { fr } from "./fr";
import {
  MESSAGES,
  assertMessageCatalogsComplete,
  t,
  type MessageKey,
} from "./messages";
import { zhCN } from "./zh-CN";

const mutableFr = MESSAGES.fr as unknown as Record<string, string>;
const originalFr = { ...fr };

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1]!)
    .sort();
}

function restoreFrench(): void {
  for (const key of Object.keys(mutableFr)) delete mutableFr[key];
  Object.assign(mutableFr, originalFr);
}

afterEach(() => {
  restoreFrench();
});

test("中文与法语目录键完整、非空且占位符一致", () => {
  expect(() => assertMessageCatalogsComplete()).not.toThrow();

  const zhKeys = Object.keys(zhCN) as MessageKey[];
  const frKeys = Object.keys(fr) as MessageKey[];
  expect(frKeys.sort()).toEqual(zhKeys.sort());

  for (const key of zhKeys) {
    expect(zhCN[key].trim().length).toBeGreaterThan(0);
    expect(fr[key].trim().length).toBeGreaterThan(0);
    expect(placeholders(fr[key])).toEqual(placeholders(zhCN[key]));
  }
});

test("两种语言分别返回自己的文案", () => {
  expect(t("zh-CN", "nav.practice")).toBe("练习");
  expect(t("fr", "nav.practice")).toBe("Exercices");
  expect(t("zh-CN", "app.title")).toBe("法语语法练习");
  expect(t("fr", "app.title")).toBe("Exercices de grammaire française");
});

test("插值参数在两种语言中使用相同占位符", () => {
  expect(t("zh-CN", "question.blankHint", { count: 2 })).toBe("第2空");
  expect(t("fr", "question.blankHint", { count: 2 })).toBe("Blanc n° 2");
});

test("学习时长单位使用精确类型键并保留中文原口径", () => {
  expect(t("zh-CN", "duration.minutes", { count: 2 })).toBe("2 分");
  expect(t("fr", "duration.minutes", { count: 2 })).toBe("2 min");
  expect(t("zh-CN", "duration.hours", { count: 1 })).toBe("1 小时");
  expect(t("fr", "duration.hours", { count: 1 })).toBe("1 h");
});

test("法语缺键时抛错而不是静默回退中文", () => {
  delete mutableFr["nav.practice"];

  expect(() => t("fr", "nav.practice")).toThrow(/nav\.practice/);
  expect(() => assertMessageCatalogsComplete()).toThrow(/nav\.practice/);
});

test("占位符集合不一致时完整性校验失败", () => {
  mutableFr["question.blankHint"] = "Blanc n° {count} {extra}";

  expect(() => assertMessageCatalogsComplete()).toThrow(/question\.blankHint/);
});

test("未知键和缺失插值参数都会抛错", () => {
  const translateUnknown = t as unknown as (
    locale: "fr",
    key: string,
  ) => string;
  expect(() => translateUnknown("fr", "missing.key")).toThrow(/missing\.key/);
  // @ts-expect-error 缺少 count 参数必须在运行时失败，不能把 {count} 直接展示给用户。
  expect(() => t("fr", "question.blankHint")).toThrow(/count/);
});
