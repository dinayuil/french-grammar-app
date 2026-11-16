import { MESSAGES, t } from "./messages";
import type { UiLocale } from "./types";

/**
 * 服务层与原生桥接共享的用户可见错误。
 * `code` 是稳定标识，`params` 只放可安全插值的内容，`diagnostic` 保留原始技术原因。
 */
export interface UserFacingError {
  code: string;
  params?: Record<string, string | number>;
  diagnostic?: string;
}

export interface FormattedUserError {
  message: string;
  diagnostic?: string;
}

const CATALOG_KEYS = new Set<string>(Object.keys(MESSAGES["zh-CN"]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeParams(
  value: unknown
): Record<string, string | number> | undefined {
  if (!isRecord(value)) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number") {
      params[key] = item;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/**
 * 把任意服务/桥接异常规范化为统一用户错误。
 *
 * 优先级：顶层 code/params/diagnostic → data.params/diagnostic →
 * message/data.message/字符串作为诊断。未知 code 原样保留，由
 * `formatUserError` 用当前语言通用主提示呈现；不根据中文字符串猜码。
 */
export function normalizeUserFacingError(error: unknown): UserFacingError {
  const outer = recordOf(error);
  const nested = outer ? recordOf(outer.userError) : null;
  const candidate = nested ?? outer;
  const source = candidate;
  const data = source
    ? recordOf(source.data) ?? recordOf(outer?.data)
    : null;

  const code = nonEmptyString(source?.code) ?? "errors.unknown";
  const params =
    sanitizeParams(source?.params) ?? sanitizeParams(data?.params);

  const diagnostic =
    nonEmptyString(source?.diagnostic) ??
    nonEmptyString(data?.diagnostic) ??
    nonEmptyString(source?.message) ??
    nonEmptyString(outer?.message) ??
    nonEmptyString(data?.message) ??
    nonEmptyString(error);

  return {
    code,
    ...(params ? { params } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}

function lookupMessage(
  locale: UiLocale,
  code: string,
  params?: Record<string, string | number>
): string | null {
  if (!CATALOG_KEYS.has(code)) return null;
  try {
    const translate = t as unknown as (
      locale: UiLocale,
      key: string,
      params?: Record<string, string | number>
    ) => string;
    return translate(locale, code, params);
  } catch {
    // 缺参数或目录异常时不能把技术异常抛到界面。
    return null;
  }
}

function genericMessage(locale: UiLocale): string {
  // 目录完整性由 messages 的构建检查保证；此处不再回退中文，避免 fr 偷换语言。
  return t(locale, "errors.unknown");
}

/**
 * 把结构化错误、旧字符串或异常对象格式化为当前语言的用户提示。
 * 已知 `code` 使用中法目录；未知码或旧字符串只显示本地化通用主提示，
 * 原始内容放进可展开的诊断，绝不把中文原文当作主要提示。
 */
export function formatUserError(
  error: unknown,
  locale: UiLocale
): FormattedUserError {
  const normalized = normalizeUserFacingError(error);
  if (CATALOG_KEYS.has(normalized.code)) {
    const message = lookupMessage(locale, normalized.code, normalized.params);
    if (message !== null) {
      return normalized.diagnostic
        ? { message, diagnostic: normalized.diagnostic }
        : { message };
    }
  }

  const diagnostic = [normalized.diagnostic, normalized.code]
    .filter(Boolean)
    .join(" — ");
  return diagnostic
    ? { message: genericMessage(locale), diagnostic }
    : { message: genericMessage(locale) };
}
