import { createRoot, type Root } from "react-dom/client";
import { act, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("virtual:fge-content", () => ({
  CHAPTERS: [
    {
      id: "loc-ch",
      title: "本地化测试章",
      titleFr: "Chapitre localisé",
      cards: [
        {
          id: "loc-card",
          title: "测试讲解",
          body: "仅用于多语言行为测试。",
          locales: {
            fr: { title: "Fiche de test", body: "Contenu de test uniquement." },
          },
        },
      ],
      lessons: [
        {
          id: "loc-l1",
          title: "本地化练习",
          kind: "lesson",
          source: "测试",
          questions: [
            {
              id: "loc-q1",
              prompt: "钥匙 ... 桌子。",
              explain: "中文解析。",
              translation: "钥匙在桌子上。",
              example: "中文范例",
              type: "choice",
              options: ["sur", "sous"],
              answer: 0,
              locales: {
                fr: {
                  prompt: "La clé est ... la table.",
                  explain: "Explication française.",
                  example: "Exemple français",
                  translation: "La clé est sur la table.",
                  options: ["sur la table", "sous la table"],
                },
              },
            },
            {
              id: "loc-q2",
              prompt: "改成否定句:Le train arrive tôt.",
              explain: "中文解析二。",
              translation: "火车到得早。",
              type: "tiles",
              answer: ["Le", "train", "n'", "arrive", "pas", "tôt."],
              bank: ["Le", "train", "n'", "arrive", "pas", "tôt.", "vite"],
              locales: {
                fr: {
                  prompt: "Mettez à la forme négative : Le train arrive tôt.",
                  explain: "Explication française II.",
                  translation: "Le train arrive tôt.",
                },
              },
            },
          ],
        },
      ],
      challenges: [
        {
          id: "loc-x1",
          title: "本地化挑战",
          kind: "challenge",
          source: "测试",
          questions: [
            {
              id: "loc-q3",
              prompt: "Choisis la forme correcte: ___ une belle journée.",
              explain: "中文解析三。",
              translation: "今天是个好天气。",
              type: "choice",
              options: ["C'est", "Ce sont"],
              answer: 0,
              locales: {
                fr: {
                  prompt: "Choisis la forme correcte : ___ une belle journée.",
                  explain: "Explication française III.",
                  options: ["C'est", "Ce sont"],
                },
              },
            },
          ],
        },
      ],
    },
  ],
  SUPPORTED_LOCALES: ["zh-CN", "fr"],
}));

import App from "./App";
import { CHAPTERS } from "./content";
import { buildReviewLesson } from "./content/review";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";
import { LessonView } from "./views/LessonView";
import { SettingsView } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";
import { DEFAULT_PROGRESS, today } from "./storage";
import type { StudyKind } from "./engine";
import type {
  Chapter,
  ChoiceQuestion,
  Lesson,
  Progress,
} from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const chapter = CHAPTERS[0];
const lesson = chapter.lessons[0];
const choiceQuestion = lesson.questions[0] as ChoiceQuestion;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  document.documentElement.lang = "zh-CN";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.lang = "zh-CN";
});

const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];

function click(el: Element | null | undefined) {
  if (!el) throw new Error(`要点击的元素不存在`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider supportedLocales={["zh-CN", "fr"]}>{children}</LocaleProvider>
  );
}

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return (
    <>
      <button data-testid="locale-fr" onClick={() => setLocale("fr")}>
        fr
      </button>
      <button data-testid="locale-zh" onClick={() => setLocale("zh-CN")}>
        zh
      </button>
    </>
  );
}

function switchTo(locale: "fr" | "zh") {
  click(container.querySelector(`[data-testid="locale-${locale}"]`));
}

function switchSystemToFrench() {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr-FR"]);
  act(() => {
    window.dispatchEvent(new Event("languagechange"));
  });
}

function typeLibraryQuery(value: string) {
  const input = container.querySelector<HTMLInputElement>(".library-search");
  if (!input) throw new Error("library search not found");
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function chapterFor(target: Lesson): Chapter {
  return {
    ...chapter,
    lessons: [target],
    challenges: [],
  };
}

function LessonHarness({
  initial = DEFAULT_PROGRESS,
  target = lesson,
  onWrite,
  onStudyTick,
}: {
  initial?: Progress;
  target?: Lesson;
  onWrite?: (progress: Progress) => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
}) {
  const [progress, setProgress] = useState(initial);
  return (
    <Providers>
      <LocaleSwitch />
      <output data-testid="translation-pref">
        {progress.translationEnabled ? "on" : "off"}:{progress.translationTiming}
      </output>
      <output data-testid="xp">{progress.xp}</output>
      <LessonView
        chapter={chapterFor(target)}
        lesson={target}
        progress={progress}
        onProgress={(next) => {
          setProgress(next);
          onWrite?.(next);
        }}
        onExit={() => {}}
        onNextLesson={() => {}}
        onFinish={() => {}}
        onStudyTick={onStudyTick}
      />
    </Providers>
  );
}

function SettingsHarness({
  initial = DEFAULT_PROGRESS,
  onChange,
}: {
  initial?: Progress;
  onChange?: (progress: Progress) => void;
}) {
  const [progress, setProgress] = useState(initial);
  return (
    <Providers>
      <LocaleSwitch />
      <output data-testid="translation-pref">
        {progress.translationEnabled ? "on" : "off"}:{progress.translationTiming}
      </output>
      <SettingsView
        progress={progress}
        onChange={(next) => {
          setProgress(next);
          onChange?.(next);
        }}
      />
    </Providers>
  );
}

function StatsHarness({ progress }: { progress: Progress }) {
  return (
    <Providers>
      <LocaleSwitch />
      <StatsView progress={progress} onShare={async () => ({ status: "error", message: "网络错误" })} />
    </Providers>
  );
}

describe("练习与设置语言切换", () => {
  test("切换语言保留选择、题号、反馈与 XP，不额外写进度", () => {
    const writes: Progress[] = [];
    const oneQuestion: Lesson = { ...lesson, questions: [choiceQuestion] };
    act(() => root.render(<LessonHarness target={oneQuestion} onWrite={(p) => writes.push(p)} />));

    expect($(".quiz-prompt")?.textContent).toBe(choiceQuestion.prompt);
    expect($$(".option-btn").map((b) => b.textContent)).toEqual(["sur", "sous"]);

    click($$(".option-btn")[0]);
    expect($$(".option-btn")[0].className).toContain("selected");
    expect($(".lesson-counter")?.textContent).toBe("1/1");
    expect(writes).toHaveLength(0);

    switchTo("fr");
    expect($(".quiz-prompt")?.textContent).toBe("La clé est ... la table.");
    expect($$(".option-btn").map((b) => b.textContent)).toEqual([
      "sur la table",
      "sous la table",
    ]);
    expect($$(".option-btn")[0].className).toContain("selected");
    expect($$(".option-btn")[1].className).not.toContain("selected");
    expect($(".lesson-counter")?.textContent).toBe("1/1");
    expect($(".lesson-counter")?.getAttribute("aria-label")).toBe("Question 1 sur 1");
    expect($$('[data-testid="xp"]')[0].textContent).toBe("0");
    expect(writes).toHaveLength(0);

    click($(".btn-wide"));
    expect($(".feedback")?.textContent).toContain("Correct");
    expect($(".explain")?.textContent).toContain("Explication française.");
    const xpAfterJudge = Number($$('[data-testid="xp"]')[0].textContent);
    expect(xpAfterJudge).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);

    switchTo("zh");
    expect($(".feedback")?.textContent).toContain("正确");
    expect($$('[data-testid="xp"]')[0].textContent).toBe(String(xpAfterJudge));
    expect(writes).toHaveLength(1);
  });

  test("多空 choice 判分前显示本地化空位提示，且不重复中文旧标记", () => {
    const blankChoices: ChoiceQuestion[] = [
      {
        id: "blank-q1",
        prompt: "Choisis le bon mot (第1空): La clé est ... la table ... le salon.",
        explain: "解析一。",
        type: "choice",
        options: ["sur", "sous"],
        answer: 0,
        blankTarget: 1,
        locales: {
          fr: {
            prompt: "Choisis le bon mot : La clé est ... la table ... le salon.",
            explain: "Explication I.",
          },
        },
      },
      {
        id: "blank-q2",
        prompt: "Choisis le bon mot (第2空): La clé est ... la table ... le salon.",
        explain: "解析二。",
        type: "choice",
        options: ["dans", "sous"],
        answer: 0,
        blankTarget: 2,
        locales: {
          fr: {
            prompt: "Choisis le bon mot : La clé est ... la table ... le salon.",
            explain: "Explication II.",
          },
        },
      },
    ];
    const blankLesson: Lesson = { ...lesson, questions: blankChoices };
    act(() => root.render(<LessonHarness target={blankLesson} />));

    // 中文原题干已携带旧标记时不重复显示独立提示。
    expect($(".quiz-prompt")?.textContent).toContain("第1空");
    expect($(".quiz-blank-hint")).toBeNull();

    switchTo("fr");
    expect($(".quiz-prompt")?.textContent).not.toContain("第1空");
    expect($(".quiz-blank-hint")?.textContent).toContain("Blanc n° 1");

    click($$(".option-btn")[0]);
    click($(".btn-wide"));
    expect($(".quiz-blank-hint")).toBeNull();
    click($(".btn-wide"));

    expect($(".quiz-prompt")?.textContent).not.toContain("第2空");
    expect($(".quiz-blank-hint")?.textContent).toContain("Blanc n° 2");

    switchTo("zh");
    expect($(".quiz-prompt")?.textContent).toContain("第2空");
    expect($(".quiz-blank-hint")).toBeNull();
  });

  test("切语言时计时连续，不重复记时", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00"));
    const ticks: number[] = [];
    const oneQuestion: Lesson = { ...lesson, questions: [choiceQuestion] };
    act(() =>
      root.render(
        <LessonHarness
          target={oneQuestion}
          onStudyTick={(_kind, seconds) => ticks.push(seconds)}
        />
      )
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(ticks).toEqual([5, 5]);

    switchTo("fr");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(ticks).toEqual([5, 5, 5]);

    switchTo("zh");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(ticks).toEqual([5, 5, 5, 5]);
  });

  test("结算与重做阶段切换语言保留阶段、队列与 XP，不重复奖励", () => {
    const writes: Progress[] = [];
    const oneQuestion: Lesson = { ...lesson, questions: [choiceQuestion] };
    act(() => root.render(<LessonHarness target={oneQuestion} onWrite={(p) => writes.push(p)} />));

    click($$(".option-btn")[1]);
    click($(".btn-wide"));
    click($(".btn-wide"));

    expect($(".settlement-title")?.textContent).toBe("练习完成!");
    const settledXp = Number($$('[data-testid="xp"]')[0].textContent);
    const writesAtSettlement = writes.length;

    switchTo("fr");
    expect($(".settlement-title")?.textContent).toBe("Exercice terminé !");
    expect(
      $$(".settlement-actions button").some(
        (button) => button.textContent === "Refaire les erreurs"
      )
    ).toBe(true);
    expect($$('[data-testid="xp"]')[0].textContent).toBe(String(settledXp));
    expect(writes).toHaveLength(writesAtSettlement);

    click(
      $$(".settlement-actions button").find(
        (button) => button.textContent === "Refaire les erreurs"
      )
    );
    expect($(".quiz-prompt")?.textContent).toBe("La clé est ... la table.");
    switchTo("zh");
    expect($(".quiz-prompt")?.textContent).toBe(choiceQuestion.prompt);
    expect($(".lesson-counter")?.textContent).toBe("1/1");

    click($$(".option-btn")[0]);
    click($(".btn-wide"));
    click($(".btn-wide"));
    expect($(".settlement-title")?.textContent).toBe("练习完成!");
    expect($(".settlement-sub")?.textContent).toBe("全对!零失误!");
    const redoneXp = Number($$('[data-testid="xp"]')[0].textContent);
    const writesAfterRedo = writes.length;

    switchTo("fr");
    expect($(".settlement-sub")?.textContent).toBe("Tout juste ! Aucune erreur !");
    expect($$('[data-testid="xp"]')[0].textContent).toBe(String(redoneXp));
    expect(writes).toHaveLength(writesAfterRedo);
  });

  test("法语隐藏译文但保留解析；切回中文恢复译文且不改偏好", () => {
    const beforeProgress: Progress = {
      ...DEFAULT_PROGRESS,
      translationEnabled: true,
      translationTiming: "before",
    };
    const oneQuestion: Lesson = { ...lesson, questions: [choiceQuestion] };
    act(() => root.render(<LessonHarness target={oneQuestion} initial={beforeProgress} />));

    expect($(".quiz-translation")?.textContent).toBe("钥匙在桌子上。");
    switchTo("fr");
    expect($(".quiz-translation")).toBeNull();

    click($$(".option-btn")[0]);
    click($(".btn-wide"));
    expect($(".explain")?.textContent).toBe("Explication française.");
    expect($(".quiz-translation")).toBeNull();
    expect($('[data-testid="translation-pref"]')?.textContent).toBe("on:before");

    switchTo("zh");
    expect($(".quiz-translation")?.textContent).toBe("钥匙在桌子上。");
    expect($('[data-testid="translation-pref"]')?.textContent).toBe("on:before");
  });

  test("法语隐藏翻译设置且不修改 Progress，切回中文恢复", () => {
    const onChange = vi.fn();
    act(() => root.render(<SettingsHarness onChange={onChange} />));

    expect(
      $$(".option-btn").some((button) => button.textContent === "开启翻译")
    ).toBe(true);
    expect(
      $$(".option-btn").some((button) => button.textContent === "答题前显示")
    ).toBe(true);

    switchTo("fr");
    expect(
      $$(".option-btn").some(
        (button) =>
          button.textContent === "Activer la traduction" ||
          button.textContent === "Désactiver la traduction"
      )
    ).toBe(false);
    expect(
      $$(".option-btn").some(
        (button) => button.textContent === "Afficher avant de répondre"
      )
    ).toBe(false);
    expect($('[data-testid="translation-pref"]')?.textContent).toBe("on:after");
    expect(onChange).not.toHaveBeenCalled();

    switchTo("zh");
    expect(
      $$(".option-btn").some((button) => button.textContent === "开启翻译")
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("统计页随语言切换并保留分享错误状态", async () => {
    const date = today();
    const progress: Progress = {
      ...DEFAULT_PROGRESS,
      days: {
        [date]: {
          xp: 40,
          earnedQids: [],
          bonusIds: [],
          readSeconds: 600,
          practiceSeconds: 300,
        },
      },
    };
    act(() => root.render(<StatsHarness progress={progress} />));

    expect(container.textContent).toContain("累计 XP");
    expect(container.textContent).toContain("最近 7 天");
    expect(container.textContent).toContain("累计学习时长");

    switchTo("fr");
    expect(container.textContent).toContain("XP cumulés");
    expect(container.textContent).toContain("7 derniers jours");
    expect(container.textContent).toMatch(/15\s?min/);

    click($(".stats-share-btn"));
    await act(async () => {
      await Promise.resolve();
    });
    expect($(".stats-share-status > span")?.textContent).toBe("L'opération a échoué. Veuillez réessayer.");
    expect($(".stats-share-status details")?.textContent).toContain("网络错误");
    expect($(".stats-share-status summary")?.textContent).toBe("Détails techniques");

    switchTo("zh");
    expect(container.textContent).toContain("累计 XP");
    expect($(".stats-share-status > span")?.textContent).toBe("操作失败，请重试。");
    expect($(".stats-share-status details")?.textContent).toContain("网络错误");
    expect($(".stats-share-status summary")?.textContent).toBe("技术详情");
  });
});

describe("复习与 App 中央接线", () => {
  test("复习队列冻结基础题目身份，切换语言只更新展示", () => {
    const progress: Progress = {
      ...DEFAULT_PROGRESS,
      mistakes: {
        "loc-q1": { lastWrong: "2026-01-01", count: 1 },
        "loc-q2": { lastWrong: "2026-02-01", count: 1 },
      },
    };
    const review = buildReviewLesson(progress, {
      title: "错题回顾",
      source: "错题本",
    });
    expect(review).not.toBeNull();
    const ids = review!.questions.map((question) => question.id);
    const baseRefs = [...review!.questions];

    act(() =>
      root.render(
        <Providers>
          <LocaleSwitch />
          <LessonView
            chapter={chapterFor(review!)}
            lesson={review!}
            progress={progress}
            onProgress={() => {}}
            onExit={() => {}}
            onNextLesson={() => {}}
            onFinish={() => {}}
          />
        </Providers>
      )
    );

    expect($(".quiz-prompt")?.textContent).toBe(choiceQuestion.prompt);
    switchTo("fr");
    expect($(".quiz-prompt")?.textContent).toBe("La clé est ... la table.");
    expect(review!.questions.map((question) => question.id)).toEqual(ids);
    expect(review!.questions.every((question, i) => question === baseRefs[i])).toBe(true);
  });

  test("语言切换清空讲解查询并停留在讲解页", () => {
    act(() => root.render(<App />));
    const libraryNav = $$(".bottom-nav .nav-item").find(
      (button) => button.textContent?.trim() === "讲解"
    );
    click(libraryNav);
    expect($(".library")).not.toBeNull();

    typeLibraryQuery("bleu");
    expect(
      container.querySelector<HTMLInputElement>(".library-search")?.value
    ).toBe("bleu");

    switchSystemToFrench();

    expect(container.querySelector<HTMLInputElement>(".library-search")?.value).toBe("");
    expect($(".library")).not.toBeNull();
    expect(document.documentElement.lang).toBe("fr");
  });

  test("在阅读器内切语言后返回目录，App 已清空讲解查询", () => {
    act(() => root.render(<App />));
    const libraryNav = $$(".bottom-nav .nav-item").find(
      (button) => button.textContent?.trim() === "讲解"
    );
    click(libraryNav);

    typeLibraryQuery("测试");
    const result = $(".library-result-item");
    expect(result).not.toBeNull();
    click(result);
    expect($(".reader-back")).not.toBeNull();
    expect($(".library")).toBeNull();

    switchSystemToFrench();

    click($(".reader-back"));
    expect($(".library")).not.toBeNull();
    // LibraryView 在切语言时已卸载，只有 App 中央查询被清空才会得到空输入。
    expect(container.querySelector<HTMLInputElement>(".library-search")?.value).toBe("");
    expect(container.textContent).not.toContain("找到");
  });
});
