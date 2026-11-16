import type { ChoiceQuestion, LettersQuestion, Question, TilesQuestion } from "./types";

export interface CompletedQuestion {
  /** 判分后展示的题干:填空题已补全;组句题为当前展示题干 */
  prompt: string;
  /** 组句/改写题的完整目标句;填空题为 null */
  target: string | null;
}

/** 从原始中文题干的旧兼容标记 `(第N空)` 读取目标空位（1-based）。 */
export function parseLegacyBlankTarget(prompt: string): number | null {
  const match = prompt.match(/\(第(\d+)空\)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 题目的有效补全目标空位：优先使用顶层 `blankTarget`，旧题回退到原始
 * 题干兼容标记。只在原题干解析标记，不依赖本地化题干的措辞。
 */
export function resolveBlankTarget(q: ChoiceQuestion): number | null {
  if (
    typeof q.blankTarget === "number" &&
    Number.isInteger(q.blankTarget) &&
    q.blankTarget > 0
  ) {
    return q.blankTarget;
  }
  return parseLegacyBlankTarget(q.prompt);
}

/** 统一空白与法语标点前的空格,并修复 C' est / J' ai 这类撇号空格。 */
function tidy(s: string): string {
  return s
    .replace(/([A-Za-zÀ-ÿ])' ([a-zà-ÿ])/g, "$1'$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,;!?])(?!\.)/g, "$1")
    .trim();
}

function fillChoice(q: ChoiceQuestion, displayPrompt: string): string {
  // 评分始终消费原答案与原选项下标；displayPrompt 只用于展示文字。
  const value = q.options[q.answer];
  const blanks = displayPrompt.match(/___|\.\.\./g) ?? [];
  const parts = value.split(" / ");
  const target = resolveBlankTarget(q);
  // 多空位组答题:选项按 " / " 分隔各空答案,按出现顺序逐空填入;— 表示不加任何词。
  if (target === null && blanks.length > 1 && parts.length === blanks.length) {
    let i = 0;
    return tidy(
      displayPrompt.replace(/(___|\.\.\.)/g, () => {
        const part = parts[i++];
        return part === "—" ? "" : part;
      }),
    );
  }
  const n = target ?? 1;
  let count = 0;
  const filled = displayPrompt.replace(/(___|\.\.\.)/g, (blank) => {
    count += 1;
    return count === n ? value : blank;
  });
  return tidy(filled.replace(/\s*\(第\d+空\)\s*/, ""));
}

function fillLetters(q: LettersQuestion, displayPrompt: string): string {
  const value = q.answer;
  let filled = displayPrompt;
  if (filled.includes("___")) {
    filled = filled.replace(/___/, value);
  } else if (filled.includes("...")) {
    filled = filled.replace(/\s*\.\.\./, value);
  } else if (/\((être|avoir)\)/.test(filled)) {
    filled = filled.replace(/\((être|avoir)\)/, value);
    // 统一 je 与元音开头变位之间的省音,规范为 J'ai / j'ai(不改变判定逻辑)
    filled = filled.replace(/\b[Jj]e ai\b/g, (m) => (m[0] === "J" ? "J'ai" : "j'ai"));
  }
  return tidy(filled);
}

function fillTiles(q: TilesQuestion, displayPrompt: string): CompletedQuestion {
  return { prompt: displayPrompt, target: q.answer.join(" ") };
}

/**
 * 判分后生成要展示的题干/目标句;不判分时调用方直接用原题干。
 *
 * `displayPrompt` 为当前语言的只读展示题干（如法语覆盖）；省略时保持
 * 原有调用方式。补全仍使用题目原答案与原选项下标，展示文案不参与判分。
 */
export function completedQuestion(
  q: Question,
  displayPrompt: string = q.prompt,
): CompletedQuestion {
  if (q.type === "choice") return { prompt: fillChoice(q, displayPrompt), target: null };
  if (q.type === "letters") return { prompt: fillLetters(q, displayPrompt), target: null };
  return fillTiles(q, displayPrompt);
}
