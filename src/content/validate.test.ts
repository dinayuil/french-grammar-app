import { validateChapter } from "./validate";
import { syntheticChapter } from "../test/fixtures";
import type { Chapter, ChoiceQuestion } from "../types";

const clone = (): Chapter => JSON.parse(JSON.stringify(syntheticChapter)) as Chapter;

const MALFORMED_TEXTS: Array<[string, unknown]> = [
  ["object", { synthetic: "not a string" }],
  ["number", 42],
  ["array", ["not", "a", "string"]],
  ["blank", "   "],
];

function setField(target: unknown, field: string, value: unknown): void {
  (target as Record<string, unknown>)[field] = value;
}

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

  test("章节 title/titleFr 的 object/number/array/blank 均报错", () => {
    for (const field of ["title", "titleFr"]) {
      for (const [label, value] of MALFORMED_TEXTS) {
        const bad = clone();
        setField(bad, field, value);
        expect(() => validateChapter(bad), `${field} ${label}`).not.toThrow();
        expect(
          validateChapter(bad).some((e) => e.includes(field)),
          `${field} ${label}`
        ).toBe(true);
      }
    }
  });

  test("lesson title/source 的 object/number/array/blank 均报错", () => {
    for (const field of ["title", "source"]) {
      for (const [label, value] of MALFORMED_TEXTS) {
        const bad = clone();
        setField(bad.lessons[0], field, value);
        expect(() => validateChapter(bad), `${field} ${label}`).not.toThrow();
        expect(
          validateChapter(bad).some((e) => e.includes(field)),
          `${field} ${label}`
        ).toBe(true);
      }
    }
  });

  test("question prompt 的 object/number/array/blank 均报错", () => {
    for (const [label, value] of MALFORMED_TEXTS) {
      const bad = clone();
      setField(bad.lessons[0].questions[0], "prompt", value);
      expect(() => validateChapter(bad), label).not.toThrow();
      expect(validateChapter(bad).some((e) => e.includes("prompt")), label).toBe(true);
    }
  });

  test("card title/body 的 object/number/array/blank 均报错", () => {
    for (const field of ["title", "body"]) {
      for (const [label, value] of MALFORMED_TEXTS) {
        const bad = clone();
        setField(bad.cards[0], field, value);
        expect(() => validateChapter(bad), `${field} ${label}`).not.toThrow();
        expect(
          validateChapter(bad).some((e) => e.includes(field)),
          `${field} ${label}`
        ).toBe(true);
      }
    }
  });

  test("可选 translation/example 的 object/number/array/blank 均报错", () => {
    for (const field of ["translation", "example"]) {
      for (const [label, value] of MALFORMED_TEXTS) {
        const bad = clone();
        setField(bad.lessons[0].questions[0], field, value);
        expect(() => validateChapter(bad), `${field} ${label}`).not.toThrow();
        expect(
          validateChapter(bad).some((e) => e.includes(field)),
          `${field} ${label}`
        ).toBe(true);
      }
    }
  });

  test("explain 仍允许空字符串", () => {
    const bad = clone();
    bad.lessons[0].questions[0].explain = "";
    expect(validateChapter(bad)).toEqual([]);
  });
});

function withValidLocales(ch: Chapter): void {
  setField(ch, "locales", {
    fr: { sectionTitles: { all: "Tous les articles" } },
  });
  setField(ch.cards[0], "locales", {
    fr: { title: "Carte synthétique", body: "Corps de la carte." },
  });
  setField(ch.lessons[0], "locales", {
    fr: { title: "Leçon synthétique" },
  });
  setField(ch.lessons[0].questions[0], "locales", {
    fr: {
      prompt: "Le ciel est ___ aujourd'hui.",
      example: "ciel — bleu → Le ciel est bleu aujourd'hui.",
      explain: "Accordez l'adjectif avec le sujet.",
      translation: "Le ciel est bleu aujourd'hui.",
    },
  });
  setField(ch.lessons[0].questions[1], "locales", {
    fr: {
      prompt: "La clé est ... la petite table.",
      options: ["sur", "sous"],
    },
  });
}

function choiceOf(ch: Chapter): ChoiceQuestion {
  return ch.lessons[0].questions[1] as ChoiceQuestion;
}

describe("validateChapter locales 与 blankTarget", () => {
  test("合法 fr 覆盖通过校验", () => {
    const ch = clone();
    withValidLocales(ch);
    expect(validateChapter(ch)).toEqual([]);
  });

  test("章节 locales.fr.title 不允许，法语章名继续使用 titleFr", () => {
    const ch = clone();
    setField(ch, "locales", { fr: { title: "Titre interdit" } });
    expect(
      validateChapter(ch).some(
        (e) => e.includes("locales.fr.title") && e.includes("titleFr")
      )
    ).toBe(true);
  });

  test("未知本地化字段、空字符串和错误类型均报错", () => {
    const ch = clone();
    withValidLocales(ch);
    setField(ch.lessons[0], "locales", { fr: { title: "Leçon", source: "x" } });
    setField(ch.lessons[0].questions[0], "locales", {
      fr: { explain: "   " },
    });
    setField(ch.cards[0], "locales", { fr: { body: 42 } });
    const errs = validateChapter(ch);
    expect(errs.some((e) => e.includes("locales") && e.includes("source"))).toBe(
      true
    );
    expect(errs.some((e) => e.includes("locales") && e.includes("explain"))).toBe(
      true
    );
    expect(errs.some((e) => e.includes("locales") && e.includes("body"))).toBe(
      true
    );
  });

  test("小章标题映射的空标题报错", () => {
    const ch = clone();
    setField(ch, "locales", {
      fr: { sectionTitles: { all: "" } },
    });
    expect(
      validateChapter(ch).some(
        (e) => e.includes("sectionTitles") && e.includes("非空")
      )
    ).toBe(true);
  });

  test("非法或未注册语言值（fr-FR、zh-CN、en）均报错", () => {
    for (const locale of ["fr-FR", "zh-CN", "en"]) {
      const ch = clone();
      setField(choiceOf(ch), "locales", {
        [locale]: { options: ["sur", "sous"] },
      });
      expect(validateChapter(ch).some((e) => e.includes(locale)), locale).toBe(
        true
      );
    }
  });

  test("choice 本地化 options 长度必须与原 options 一致", () => {
    const ch = clone();
    setField(choiceOf(ch), "locales", { fr: { options: ["sur"] } });
    expect(
      validateChapter(ch).some(
        (e) => e.includes("locales") && e.includes("options") && e.includes("长度")
      )
    ).toBe(true);
  });

  test("本地化题干必须保留原空位标记的数量与顺序", () => {
    const ch = clone();
    setField(choiceOf(ch), "locales", {
      fr: { prompt: "La clé est ___ la petite table." },
    });
    expect(
      validateChapter(ch).some(
        (e) => e.includes("locales") && e.includes("prompt") && e.includes("空位")
      )
    ).toBe(true);
  });

  test("本地化题干不得残留旧（第N空）标记", () => {
    const ch = clone();
    setField(choiceOf(ch), "locales", {
      fr: { prompt: "La clé est ... la petite table.(第1空)" },
    });
    expect(
      validateChapter(ch).some(
        (e) =>
          e.includes("locales") &&
          e.includes("prompt") &&
          (e.includes("第N空") || e.includes("第1空"))
      )
    ).toBe(true);
  });

  test("letters 本地化题干必须保留可识别补全锚点", () => {
    const missing = clone();
    missing.lessons[0].questions[0].prompt =
      "Conjuguez être : Le livre (être) neuf.";
    setField(missing.lessons[0].questions[0], "locales", {
      fr: { prompt: "Conjuguez être : Le livre neuf." },
    });
    expect(
      validateChapter(missing).some(
        (e) => e.includes("locales") && e.includes("prompt") && e.includes("锚点")
      )
    ).toBe(true);

    const good = clone();
    good.lessons[0].questions[0].prompt =
      "Conjuguez être : Le livre (être) neuf.";
    setField(good.lessons[0].questions[0], "locales", {
      fr: { prompt: "Conjuguez le verbe : Le livre (être) neuf." },
    });
    expect(validateChapter(good)).toEqual([]);
  });

  test("非 choice 或非法的 blankTarget 均报错", () => {
    const letter = clone();
    setField(letter.lessons[0].questions[0], "blankTarget", 1);
    expect(
      validateChapter(letter).some(
        (e) => e.includes("blankTarget") && e.includes("choice")
      )
    ).toBe(true);

    for (const target of [0, -1, 1.5, 3, "2"]) {
      const bad = clone();
      setField(choiceOf(bad), "blankTarget", target);
      expect(
        validateChapter(bad).some((e) => e.includes("blankTarget")),
        String(target)
      ).toBe(true);
    }
  });

  test("blankTarget 与原题干旧（第N空）标记不一致或相等时分别处理", () => {
    const good = clone();
    const goodQ = choiceOf(good);
    goodQ.prompt = "Nous allons ... marché et ... piscine.(第2空)";
    goodQ.blankTarget = 2;
    expect(validateChapter(good)).toEqual([]);

    const bad = clone();
    const badQ = choiceOf(bad);
    badQ.prompt = "Nous allons ... marché et ... piscine.(第2空)";
    badQ.blankTarget = 1;
    expect(
      validateChapter(bad).some(
        (e) => e.includes("blankTarget") && e.includes("第2空")
      )
    ).toBe(true);
  });

  test("blankTarget 不得超过题干空位数量", () => {
    const bad = clone();
    const q = choiceOf(bad);
    q.blankTarget = 2; // 原题干只有一个 ...
    expect(
      validateChapter(bad).some((e) => e.includes("blankTarget") && e.includes("空位"))
    ).toBe(true);
  });

  test("未来语言显式注册后可通过，默认生产注册仍拒绝英语夹具", () => {
    const ch = clone();
    setField(choiceOf(ch), "locales", {
      en: {
        prompt: "The key is ... the small table.",
        translation: "The key is on the small table.",
      },
    });

    expect(validateChapter(ch).some((e) => e.includes("en"))).toBe(true);
    expect(
      validateChapter(ch, { contentLocales: ["fr", "en"] })
    ).toEqual([]);
  });
});
