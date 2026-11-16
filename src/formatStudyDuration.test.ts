import { describe, expect, test } from "vitest";
import { formatStudyDuration } from "./formatStudyDuration";

describe("formatStudyDuration", () => {
  test("不足一小时按四舍五入的分钟显示", () => {
    expect(formatStudyDuration(0)).toBe("0 分");
    expect(formatStudyDuration(29)).toBe("0 分");
    expect(formatStudyDuration(30)).toBe("1 分");
    expect(formatStudyDuration(90)).toBe("2 分");
    expect(formatStudyDuration(3599)).toBe("1 小时");
  });

  test("满一小时显示小时与剩余分钟", () => {
    expect(formatStudyDuration(3600)).toBe("1 小时");
    expect(formatStudyDuration(3630)).toBe("1 小时 1 分");
    expect(formatStudyDuration(5400)).toBe("1 小时 30 分");
    expect(formatStudyDuration(7200)).toBe("2 小时");
    expect(formatStudyDuration(9990)).toBe("2 小时 47 分");
  });

  test("大值继续按小时显示", () => {
    expect(formatStudyDuration(360000)).toBe("100 小时");
    expect(formatStudyDuration(1111111110)).toBe("308641 小时 59 分");
  });

  test("缺失、负数与非有限值按零处理", () => {
    expect(formatStudyDuration(-5)).toBe("0 分");
    expect(formatStudyDuration(Number.NaN)).toBe("0 分");
    expect(formatStudyDuration(Number.POSITIVE_INFINITY)).toBe("0 分");
  });

  test("法语委托统一时长文案，使用紧凑单位", () => {
    expect(formatStudyDuration(90, "fr")).toBe("2 min");
    expect(formatStudyDuration(3600, "fr")).toBe("1 h");
    expect(formatStudyDuration(3660, "fr")).toBe("1 h 1 min");
    expect(formatStudyDuration(7200, "fr")).toBe("2 h");
    expect(formatStudyDuration(9990, "fr")).toBe("2 h 47 min");
    expect(formatStudyDuration(-5, "fr")).toBe("0 min");
  });

  test("显式中文仍使用卡片原有紧凑单位", () => {
    expect(formatStudyDuration(90, "zh-CN")).toBe("2 分");
    expect(formatStudyDuration(3660, "zh-CN")).toBe("1 小时 1 分");
  });
});
