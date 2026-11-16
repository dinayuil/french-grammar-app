import { fr } from "./fr";
import { zhCN } from "./zh-CN";
import type { UiLocale } from "./types";

/** 中文目录是键的唯一来源；新增文案必须先加入中文目录。 */
export type MessageKey = keyof typeof zhCN;

/** 每种 UI 语言必须提供与中文完全一致的键集合。 */
export type MessageCatalog = Record<MessageKey, string>;

export const MESSAGE_KEYS = Object.keys(zhCN) as readonly MessageKey[];

export const MESSAGES: Readonly<Record<UiLocale, MessageCatalog>> = Object.freeze({
  "zh-CN": zhCN,
  fr,
});

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** 每个键在中文目录中的插值参数名，例如 `{count}` -> `count`。 */
export type MessagePlaceholder<K extends MessageKey> = Placeholders<(typeof zhCN)[K]>;

/** 无占位符的键不得传第三个参数；有占位符的键必须完整传入参数。 */
export type MessageArgs<K extends MessageKey> = [MessagePlaceholder<K>] extends [never]
  ? []
  : [params: Record<MessagePlaceholder<K>, string | number>];

/** 由 Provider 暴露的、已绑定当前语言的翻译函数。 */
export type Translate = <K extends MessageKey>(
  key: K,
  ...args: MessageArgs<K>
) => string;

function formatMessage(
  locale: UiLocale,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const catalog = MESSAGES[locale];
  if (!catalog) throw new Error(`Unsupported UI locale "${String(locale)}"`);

  const template = catalog[key];
  if (typeof template !== "string") {
    // 法语缺键必须暴露为构建/运行错误，不能静默显示中文。
    throw new Error(`Missing message "${locale}:${key}"`);
  }

  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for message "${locale}:${key}"`);
    }
    return String(value);
  });
}

/**
 * 取当前语言的文案并完成 `{name}` 插值。
 *
 * 键是中文目录的联合类型；参数名由中文模板推导。法语目录缺键或缺少参数
 * 都会抛错，不会回退到中文。
 */
export function t<K extends MessageKey>(
  locale: UiLocale,
  key: K,
  ...args: MessageArgs<K>
): string {
  return formatMessage(
    locale,
    key,
    args[0] as Readonly<Record<string, string | number>> | undefined,
  );
}

/** 生成绑定到单一语言的翻译函数，供 React Context 使用。 */
export function createTranslator(locale: UiLocale): Translate {
  const translate: Translate = (key, ...args) =>
    formatMessage(
      locale,
      key,
      args[0] as Readonly<Record<string, string | number>> | undefined,
    );
  return translate;
}

function placeholderNames(template: string): Set<string> {
  return new Set(
    [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string),
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * 构建期接线入口：两种语言必须键完全一致、文案非空、占位符集合完全一致。
 *
 * 任务 2 的构建检查可调用此函数；本任务不修改构建脚本。发现问题时抛出
 * 带语言与键定位的错误。
 */
export function assertMessageCatalogsComplete(): void {
  const reference = MESSAGES["zh-CN"];
  const referenceKeys = Object.keys(reference) as MessageKey[];

  for (const locale of Object.keys(MESSAGES) as UiLocale[]) {
    const catalog = MESSAGES[locale];

    for (const key of referenceKeys) {
      if (!(key in catalog)) {
        throw new Error(`Message catalog "${locale}" is missing key "${key}"`);
      }
    }
    for (const key of Object.keys(catalog)) {
      if (!(key in reference)) {
        throw new Error(`Message catalog "${locale}" has unknown key "${key}"`);
      }
    }

    for (const key of referenceKeys) {
      const template = catalog[key];
      if (typeof template !== "string" || template.trim().length === 0) {
        throw new Error(`Message catalog "${locale}" has an empty value for "${key}"`);
      }
      if (
        !setsEqual(
          placeholderNames(reference[key]),
          placeholderNames(template),
        )
      ) {
        throw new Error(
          `Message catalog "${locale}" has inconsistent placeholders for "${key}"`,
        );
      }
    }
  }
}
