import type { ChoiceQuestion } from "../types";
import { acceptedChoiceIndices } from "../engine";
import { useLocale } from "../i18n/LocaleProvider";

interface Props {
  /** 原始题目：判分与进度始终消费原对象和原选项下标。 */
  q: ChoiceQuestion;
  /** 当前语言的展示选项；与 q.options 等长同序，点击仍提交原下标。 */
  displayOptions?: readonly string[];
  response: number | null;
  onResponse: (n: number) => void;
  disabled: boolean;
  /** 判分后标出正确答案和选错的选项 */
  judged: boolean;
}

export function ChoiceQuestion({
  q,
  displayOptions,
  response,
  onResponse,
  disabled,
  judged,
}: Props) {
  const { t } = useLocale();
  // answer 与 alternatives 都是合法正确答案:全部标绿/✓,选中任一都不算错。
  const accepted = acceptedChoiceIndices(q);
  // 展示文案可以本地化；选项下标、正确下标和提交值都来自原题目。
  const options = displayOptions ?? q.options;

  return (
    <div className="choice-options">
      {options.map((opt, i) => {
        const selected = !judged && response === i;
        const correct = judged && accepted.has(i);
        const wrong = judged && response === i && !correct;
        return (
          <button
            key={i}
            className={`option-btn ${selected ? "selected" : ""} ${
              correct ? "correct" : ""
            } ${wrong ? "wrong" : ""}`}
            disabled={disabled}
            aria-label={
              correct
                ? t("question.correctOption", { option: opt })
                : wrong
                  ? t("question.wrongOption", { option: opt })
                  : undefined
            }
            onClick={() => onResponse(i)}
          >
            {opt}
            {correct && (
              <span className="option-mark" aria-hidden="true">
                ✓
              </span>
            )}
            {wrong && (
              <span className="option-mark" aria-hidden="true">
                ✗
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
