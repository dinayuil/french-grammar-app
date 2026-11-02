import type { ChoiceQuestion, LettersQuestion, Question, TilesQuestion } from "./types";

export interface CompletedQuestion {
  /** 判分后展示的题干:填空题已补全;组句题为原始题干 */
  prompt: string;
  /** 组句/改写题的完整目标句;填空题为 null */
  target: string | null;
}

/** 统一空白与法语标点前的空格,并修复 C' est / J' ai 这类撇号空格。 */
function tidy(s: string): string {
  return s
    .replace(/([A-Za-zÀ-ÿ])' ([a-zà-ÿ])/g, "$1'$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,;!?])(?!\.)/g, "$1")
    .trim();
}

function fillChoice(q: ChoiceQuestion): string {
  const value = q.options[q.answer];
  const blanks = q.prompt.match(/___|\.\.\./g) ?? [];
  const parts = value.split(" / ");
  // 多空位组答题:选项按 " / " 分隔各空答案,按出现顺序逐空填入;— 表示不加任何词。
  if (!/\(第(\d+)空\)/.test(q.prompt) && blanks.length > 1 && parts.length === blanks.length) {
    let i = 0;
    return tidy(
      q.prompt.replace(/(___|\.\.\.)/g, () => {
        const part = parts[i++];
        return part === "—" ? "" : part;
      }),
    );
  }
  const marker = q.prompt.match(/\(第(\d+)空\)/);
  const n = marker ? Number(marker[1]) : 1;
  let count = 0;
  const filled = q.prompt.replace(/(___|\.\.\.)/g, (blank) => {
    count += 1;
    return count === n ? value : blank;
  });
  return tidy(filled.replace(/\s*\(第\d+空\)\s*/, ""));
}

function fillLetters(q: LettersQuestion): string {
  const value = q.answer;
  let filled = q.prompt;
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

function fillTiles(q: TilesQuestion): CompletedQuestion {
  return { prompt: q.prompt, target: q.answer.join(" ") };
}

/** 判分后生成要展示的题干/目标句;不判分时调用方直接用原题干。 */
export function completedQuestion(q: Question): CompletedQuestion {
  if (q.type === "choice") return { prompt: fillChoice(q), target: null };
  if (q.type === "letters") return { prompt: fillLetters(q), target: null };
  return fillTiles(q);
}
