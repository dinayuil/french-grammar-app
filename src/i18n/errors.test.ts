import { describe, expect, test } from "vitest";
import {
  formatUserError,
  normalizeUserFacingError,
  type UserFacingError,
} from "./errors";

const NATIVE_CODES = [
  "native.config_invalid",
  "native.credentials_required",
  "native.storage_failed",
  "native.network_failed",
  "native.file_failed",
  "native.unsupported",
  "native.unknown",
];

const CJK = /[\u3400-\u9fff]/;

describe("formatUserError", () => {
  test("按传入语言格式化已知业务错误并保留参数与诊断", () => {
    const error: UserFacingError = {
      code: "backup.unsupported_version",
      params: { version: 2 },
      diagnostic: "raw backend detail",
    };

    const zh = formatUserError(error, "zh-CN");
    const fr = formatUserError(error, "fr");

    expect(zh.message).toContain("2");
    expect(fr.message).toContain("2");
    expect(fr.message).not.toBe(zh.message);
    expect(fr.diagnostic).toBe("raw backend detail");
    expect(zh.diagnostic).toBe("raw backend detail");
  });

  test("同一错误在切换语言后即时得到当前语言", () => {
    const error: UserFacingError = { code: "sync.error.http_auth" };

    const zh = formatUserError(error, "zh-CN").message;
    const fr = formatUserError(error, "fr").message;

    expect(zh).toMatch(CJK);
    expect(fr).not.toMatch(CJK);
    expect(fr.toLowerCase()).toContain("authentification");
  });

  test.each(NATIVE_CODES)("原生错误码 %s 在两种语言下都有可操作提示", (code) => {
    const error: UserFacingError = { code, diagnostic: "native detail" };

    for (const locale of ["zh-CN", "fr"] as const) {
      const formatted = formatUserError(error, locale);
      expect(formatted.message.length).toBeGreaterThan(0);
      expect(formatted.message).not.toContain(code);
      expect(formatted.diagnostic).toBe("native detail");
    }
    expect(formatUserError(error, "fr").message).not.toMatch(CJK);
  });

  test("未知错误码不把码本身当主提示，诊断保留原始码", () => {
    const formatted = formatUserError(
      { code: "sync.error.future_code", diagnostic: "detail" },
      "fr"
    );

    expect(formatted.message).not.toContain("sync.error.future_code");
    expect(formatted.message).not.toMatch(CJK);
    expect(formatted.diagnostic).toContain("sync.error.future_code");
    expect(formatted.diagnostic).toContain("detail");
  });

  test("旧字符串与普通 Error 使用本地化通用主提示，原文只进诊断", () => {
    const legacy = "云端认证失败，请检查用户名与应用密码";
    const fromString = formatUserError(legacy, "fr");
    const fromError = formatUserError(new Error(legacy), "zh-CN");

    expect(fromString.message).not.toBe(legacy);
    expect(fromString.message).not.toMatch(CJK);
    expect(fromString.diagnostic).toBe(legacy);

    expect(fromError.message).not.toBe(legacy);
    expect(fromError.message).toMatch(CJK);
    expect(fromError.diagnostic).toBe(legacy);
  });

  test("已知码缺少参数时不抛错，退回通用提示并保留诊断", () => {
    const formatted = formatUserError(
      { code: "backup.unsupported_version", diagnostic: "version missing" },
      "fr"
    );

    expect(formatted.message).not.toMatch(CJK);
    expect(formatted.diagnostic).toContain("version missing");
    expect(formatted.diagnostic).toContain("backup.unsupported_version");
  });

  test("无输入也返回可展示的通用提示", () => {
    const formatted = formatUserError(undefined, "zh-CN");
    expect(formatted.message).toMatch(CJK);
    expect(formatted.message.length).toBeGreaterThan(0);
  });

  test("法语通用兜底保持法语，不回退中文", () => {
    const fromUndefined = formatUserError(undefined, "fr");
    const fromUnknown = formatUserError(
      { code: "sync.error.future_code" },
      "fr"
    );

    expect(fromUndefined.message).not.toMatch(CJK);
    expect(fromUndefined.message).toBe(
      formatUserError(undefined, "fr").message
    );
    expect(fromUndefined.message).not.toBe(
      formatUserError(undefined, "zh-CN").message
    );
    expect(fromUnknown.message).toBe(fromUndefined.message);
  });

  test("Capacitor 拒绝结构保留 Error.data 中的 params 与 diagnostic", () => {
    const error = Object.assign(new Error("native request failed"), {
      code: "sync.error.http_generic",
      data: {
        params: { status: 503 },
        diagnostic: "native bridge raw detail",
      },
    });

    const fr = formatUserError(error, "fr");

    expect(fr.message).toContain("503");
    expect(fr.diagnostic).toBe("native bridge raw detail");
    expect(fr.message).not.toMatch(CJK);
  });
});

describe("normalizeUserFacingError", () => {
  test("coded Error 无 diagnostic 时回退 Error.message", () => {
    const error = Object.assign(new Error("coded error message"), {
      code: "sync.error.http_auth",
    });

    const normalized = normalizeUserFacingError(error);
    const fr = formatUserError(error, "fr");

    expect(normalized.code).toBe("sync.error.http_auth");
    expect(normalized.diagnostic).toBe("coded error message");
    expect(fr.diagnostic).toBe("coded error message");
    expect(fr.message).not.toMatch(CJK);
  });

  test("data.message 作为无 diagnostic 时的回退", () => {
    const normalized = normalizeUserFacingError({
      code: "native.network_failed",
      data: { message: "bridge data message" },
    });

    expect(normalized.code).toBe("native.network_failed");
    expect(normalized.diagnostic).toBe("bridge data message");
  });

  test("顶层 params/diagnostic 优先于 data", () => {
    const normalized = normalizeUserFacingError({
      code: "sync.error.http_generic",
      params: { status: 401 },
      diagnostic: "top diagnostic",
      data: {
        params: { status: 500 },
        diagnostic: "data diagnostic",
      },
    });

    expect(normalized.params).toEqual({ status: 401 });
    expect(normalized.diagnostic).toBe("top diagnostic");
  });

  test("顶层 params 非法时回退 data.params，只保留标量", () => {
    const normalized = normalizeUserFacingError({
      code: "backup.unsupported_version",
      params: { version: { nested: true } },
      data: { params: { version: 2, skip: false } },
    });

    expect(normalized.params).toEqual({ version: 2 });
  });

  test("未知 code 保留，由本地化通用主提示呈现", () => {
    const normalized = normalizeUserFacingError({
      code: "future.unknown_code",
      message: "future raw",
    });
    const fr = formatUserError(
      { code: "future.unknown_code", diagnostic: "future raw" },
      "fr"
    );

    expect(normalized.code).toBe("future.unknown_code");
    expect(normalized.diagnostic).toBe("future raw");
    expect(fr.message).not.toMatch(CJK);
    expect(fr.message).not.toContain("future.unknown_code");
    expect(fr.diagnostic).toContain("future.unknown_code");
  });

  test("旧字符串使用通用码并保留原文诊断", () => {
    const normalized = normalizeUserFacingError("legacy failure text");

    expect(normalized.code).toBe("errors.unknown");
    expect(normalized.diagnostic).toBe("legacy failure text");
  });

  test("支持 backup.userError 嵌套结构", () => {
    const error = Object.assign(new Error("outer message"), {
      userError: {
        code: "backup.unsupported_version",
        params: { version: 2 },
      },
    });

    const normalized = normalizeUserFacingError(error);

    expect(normalized.code).toBe("backup.unsupported_version");
    expect(normalized.params).toEqual({ version: 2 });
    expect(normalized.diagnostic).toBe("outer message");
  });

  test("无输入返回通用码，不伪造诊断", () => {
    const normalized = normalizeUserFacingError(undefined);

    expect(normalized.code).toBe("errors.unknown");
    expect(normalized.diagnostic).toBeUndefined();
  });
});
