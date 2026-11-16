import {
  localizeChapter,
  localizeQuestion,
  sectionTitleForDisplay,
  translationForDisplay,
} from "./localize";
import type { Chapter, ChoiceQuestion } from "../types";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

const choice: ChoiceQuestion = {
  id: "loc-q1",
  prompt: "Nous allons ___ marché et ___ piscine.",
  explain: "用 au 和 à la 表达去某地。",
  example: "aller au marché / aller à la piscine",
  translation: "我们去市场，然后去游泳池。",
  type: "choice",
  options: ["au", "à la"],
  answer: 1,
  blankTarget: 2,
  locales: {
    fr: {
      prompt: "Nous allons ___ marché et ___ piscine.",
      explain: "Employez au et à la pour indiquer le lieu.",
      example: "aller au marché / aller à la piscine",
      translation: "Nous allons au marché et à la piscine.",
      options: ["au marché", "à la piscine"],
    },
    en: {
      prompt: "We are going ___ the market and ___ the pool.",
      explain: "Use the contracted forms to indicate place.",
      example: "go to the market / go to the pool",
      translation: "We are going to the market and to the pool.",
    },
  },
};

const baseChapter: Chapter = {
  id: "loc-ch1",
  title: "方位表达",
  titleFr: "Exprimer le lieu",
  cards: [
    {
      id: "loc-c1",
      title: "去某地",
      body: "au marché / à la piscine",
      locales: {
        fr: { title: "Aller quelque part", body: "au marché / à la piscine" },
      },
    },
  ],
  lessons: [
    {
      id: "loc-l1",
      title: "方位练习",
      kind: "lesson",
      source: "原创测试",
      locales: { fr: { title: "Exercice sur le lieu" } },
      questions: [choice],
    },
  ],
  challenges: [],
  locales: {
    fr: { sectionTitles: { s1: "Les articles", s2: "Les lieux" } },
  },
};

describe("localize display models", () => {
  test("preserves_base_and_answer_identity", () => {
    const chapter = deepFreeze(baseChapter);
    const before = JSON.stringify(chapter);

    const display = localizeChapter(chapter, "fr");
    const lesson = display.lessons[0]!;
    const question = lesson.questions[0]!;

    expect(display.base).toBe(chapter);
    expect(lesson.base).toBe(chapter.lessons[0]);
    expect(question.base).toBe(chapter.lessons[0].questions[0]);
    expect(question.base.answer).toBe(1);
    expect(question.options).toEqual(["au marché", "à la piscine"]);
    expect(chapter.lessons[0].questions[0]).toBe(choice);
    expect(choice.options).toEqual(["au", "à la"]);
    expect(JSON.stringify(chapter)).toBe(before);
  });

  test("hides_fr_translation_but_keeps_french_explain", () => {
    const display = localizeQuestion(choice, "fr");

    expect(display.translation).toBeNull();
    expect(display.base.translation).toBe("我们去市场，然后去游泳池。");
    expect(display.base.locales?.fr?.translation).toBe(
      "Nous allons au marché et à la piscine."
    );
    expect(display.explain).toBe(
      "Employez au et à la pour indiquer le lieu."
    );
    expect(display.prompt).toBe("Nous allons ___ marché et ___ piscine.");
    expect(display.example).toBe("aller au marché / aller à la piscine");
    expect(
      translationForDisplay(
        display,
        { enabled: true, timing: "before" },
        false
      )
    ).toBeNull();
  });

  test("fr_translation_hidden_even_when_fr_not_registered", () => {
    const display = localizeQuestion(choice, "fr", {
      contentLocales: ["en"],
    });

    expect(display.translation).toBeNull();
    expect(display.base.translation).toBe("我们去市场，然后去游泳池。");
    expect(display.base.locales?.fr?.translation).toBe(
      "Nous allons au marché et à la piscine."
    );
  });

  test("restores_zh_translation_timing", () => {
    const display = localizeQuestion(choice, "zh-CN");
    const preference = { enabled: true, timing: "after" as const };

    expect(display.translation).toBe("我们去市场，然后去游泳池。");
    expect(translationForDisplay(display, preference, false)).toBeNull();
    expect(translationForDisplay(display, preference, true)).toBe(
      "我们去市场，然后去游泳池。"
    );
    expect(
      translationForDisplay(
        display,
        { enabled: true, timing: "before" },
        false
      )
    ).toBe("我们去市场，然后去游泳池。");
    expect(
      translationForDisplay(
        display,
        { enabled: false, timing: "before" },
        true
      )
    ).toBeNull();
  });

  test("uses_titleFr_and_localized_section_titles_with_chinese_fallback", () => {
    const fr = localizeChapter(baseChapter, "fr");

    expect(fr.title).toBe("Exprimer le lieu");
    expect(fr.sectionTitles).toEqual({
      s1: "Les articles",
      s2: "Les lieux",
    });
    expect(sectionTitleForDisplay(fr, "s1", "冠词")).toBe("Les articles");
    expect(sectionTitleForDisplay(fr, "unknown", "冠词")).toBe("冠词");

    const zh = localizeChapter(baseChapter, "zh-CN");
    expect(zh.title).toBe("方位表达");
    expect(zh.sectionTitles).toEqual({});
    expect(sectionTitleForDisplay(zh, "s1", "冠词")).toBe("冠词");
  });

  test("localizes_card_and_lesson_copy", () => {
    const display = localizeChapter(baseChapter, "fr");

    expect(display.cards[0]!.title).toBe("Aller quelque part");
    expect(display.cards[0]!.body).toBe("au marché / à la piscine");
    expect(display.lessons[0]!.title).toBe("Exercice sur le lieu");
  });

  test("future_english_fixture_uses_registered_locale_without_leaking_chinese", () => {
    const registered = localizeQuestion(choice, "en", {
      contentLocales: ["fr", "en"],
    });
    expect(registered.prompt).toBe(
      "We are going ___ the market and ___ the pool."
    );
    expect(registered.translation).toBe(
      "We are going to the market and to the pool."
    );

    const noEnglishTranslation: ChoiceQuestion = {
      ...choice,
      id: "loc-q2",
      locales: { fr: choice.locales!.fr! },
    };
    const missing = localizeQuestion(noEnglishTranslation, "en", {
      contentLocales: ["fr", "en"],
    });
    expect(missing.translation).toBeNull();
    expect(missing.base.translation).toBe("我们去市场，然后去游泳池。");

    // 未注册 en 时按不支持的语言回退中文，英语夹具不会成为产品语言。
    const unregistered = localizeQuestion(choice, "en");
    expect(unregistered.prompt).toBe(choice.prompt);
    expect(unregistered.translation).toBe(choice.translation);
  });

  test("exposes_normalized_blank_target_for_localized_prompts", () => {
    const display = localizeQuestion(choice, "fr");
    expect(display.blankTarget).toBe(2);
    expect(display.prompt).not.toContain("第2空");

    const legacy: ChoiceQuestion = {
      ...choice,
      id: "loc-q3",
      blankTarget: undefined,
      prompt: "Nous allons ... marché et ... piscine.(第2空)",
      locales: {
        fr: { prompt: "Nous allons ... marché et ... piscine." },
      },
    };
    expect(localizeQuestion(legacy, "fr").blankTarget).toBe(2);
  });

  test("rejects_localized_options_with_changed_length_at_parse_time", () => {
    const invalid: ChoiceQuestion = {
      ...choice,
      id: "loc-q4",
      locales: {
        fr: {
          options: ["au marché"],
        },
      },
    };
    expect(() => localizeQuestion(invalid, "fr")).toThrow(/options/);
  });
});
