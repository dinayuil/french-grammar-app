import { validateChapter } from "./validate";
import { syntheticChapter } from "../test/fixtures";
import type { Chapter } from "../types";

const clone = (): Chapter => JSON.parse(JSON.stringify(syntheticChapter)) as Chapter;

describe("validateChapter", () => {
  test("合法合成章节 → 空错误列表", () => {
    expect(validateChapter(syntheticChapter)).toEqual([]);
  });

  test("非对象输入 → 明确错误而不是抛异常", () => {
    expect(() => validateChapter(null as unknown as Chapter)).not.toThrow();
    expect(validateChapter(null as unknown as Chapter)).toEqual(["章节数据不是对象"]);
  });

  test("缺 id → 报错", () => {
    const bad = clone();
    delete (bad.lessons[0] as unknown as Record<string, unknown>).id;
    expect(validateChapter(bad).length).toBeGreaterThan(0);
  });

  test("choice answer 越界 → 报错", () => {
    const bad = clone();
    (bad.lessons[0].questions[1] as { answer: number }).answer = 5;
    expect(validateChapter(bad).some((e) => e.includes("下标"))).toBe(true);
  });

  test("tiles answer 含 bank 外的词 → 报错", () => {
    const bad = clone();
    bad.lessons[0].questions[2] = {
      id: "synth-ch1-l1-q3",
      prompt: "拼句",
      explain: "",
      type: "tiles",
      answer: ["je", "magique"],
      bank: ["je"],
    };
    expect(validateChapter(bad).some((e) => e.includes("bank"))).toBe(true);
  });

  test("questions 为空 → 报错", () => {
    const bad = clone();
    bad.lessons[0].questions = [];
    expect(validateChapter(bad).some((e) => e.includes("synth-ch1-l1"))).toBe(true);
  });

  test("card title/body 为空 → 报错", () => {
    const bad = clone();
    bad.cards[0].title = "";
    bad.cards[0].body = "  ";
    expect(validateChapter(bad).some((e) => e.includes("synth-ch1-c1"))).toBe(true);
  });

  test("translation 为空 → 报错", () => {
    const bad = clone();
    bad.lessons[0].questions[0].translation = "  ";
    expect(validateChapter(bad).some((e) => e.includes("translation"))).toBe(true);
  });

  test("example 为空 → 报错", () => {
    const bad = clone();
    bad.lessons[0].questions[0].example = "  ";
    expect(validateChapter(bad).some((e) => e.includes("example"))).toBe(true);
  });

  test("id 重复 → 报错", () => {
    const bad = clone();
    bad.lessons[0].questions[0] = { ...bad.lessons[0].questions[0], id: "synth-ch1-l1-q2" };
    expect(validateChapter(bad).some((e) => e.includes("重复"))).toBe(true);
  });

  test("kind 非法 → 报错", () => {
    const bad = clone();
    (bad.lessons[0] as unknown as Record<string, unknown>).kind = "boss";
    expect(validateChapter(bad).some((e) => e.includes("kind"))).toBe(true);
  });

  test("source 为空 → 使用通用来源措辞,不再出现页码说法", () => {
    const bad = clone();
    bad.lessons[0].source = "";
    const errs = validateChapter(bad);
    expect(errs.some((e) => e.includes("source") && e.includes("来源"))).toBe(true);
    expect(errs.some((e) => e.includes("页码"))).toBe(false);
  });

  test("lesson 为 null → 明确错误而不是抛异常", () => {
    const bad = clone();
    bad.lessons[0] = null as unknown as (typeof bad.lessons)[number];
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("lesson"))).toBe(true);
  });

  test("question 为 null → 明确错误而不是抛异常", () => {
    const bad = clone();
    bad.lessons[0].questions[0] = null as unknown as (typeof bad.lessons)[number]["questions"][number];
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("question"))).toBe(true);
  });

  test("choice 缺 options → 报错而不是抛异常", () => {
    const bad = clone();
    delete (bad.lessons[0].questions[1] as unknown as Record<string, unknown>).options;
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("options"))).toBe(true);
  });

  test("choice options 非数组 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[1] as unknown as Record<string, unknown>).options = "sur";
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("options"))).toBe(true);
  });

  test("choice alternatives 非数组 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[1] as unknown as Record<string, unknown>).alternatives = 5;
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("alternatives"))).toBe(true);
  });

  test("letters alternatives 含非字符串 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[0] as unknown as Record<string, unknown>).alternatives = [1];
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("alternatives"))).toBe(true);
  });

  test("letters accentKeys 非数组 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[0] as unknown as Record<string, unknown>).accentKeys = "é";
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("accentKeys"))).toBe(true);
  });

  test("letters decoys 含非字符串 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[0] as unknown as Record<string, unknown>).decoys = [1];
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("decoys"))).toBe(true);
  });

  test("tiles bank 非数组 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[2] as unknown as Record<string, unknown>).bank = 5;
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("bank"))).toBe(true);
  });

  test("tiles 缺 bank → 报错而不是抛异常", () => {
    const bad = clone();
    delete (bad.lessons[0].questions[2] as unknown as Record<string, unknown>).bank;
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("bank"))).toBe(true);
  });

  test("tiles alternatives 结构非法 → 报错而不是抛异常", () => {
    const bad = clone();
    (bad.lessons[0].questions[2] as unknown as Record<string, unknown>).alternatives = ["mot"];
    expect(() => validateChapter(bad)).not.toThrow();
    expect(validateChapter(bad).some((e) => e.includes("alternatives"))).toBe(true);
  });
});
