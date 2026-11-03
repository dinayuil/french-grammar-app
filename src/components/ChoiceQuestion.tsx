import type { ChoiceQuestion } from "../types";
import { acceptedChoiceIndices } from "../engine";

interface Props {
  q: ChoiceQuestion;
  response: number | null;
  onResponse: (n: number) => void;
  disabled: boolean;
  /** 判分后标出正确答案和选错的选项 */
  judged: boolean;
}

export function ChoiceQuestion({ q, response, onResponse, disabled, judged }: Props) {
  // answer 与 alternatives 都是合法正确答案:全部标绿/✓,选中任一都不算错。
  const accepted = acceptedChoiceIndices(q);

  return (
    <div className="choice-options">
      {q.options.map((opt, i) => {
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
              correct ? `${opt}，正确答案` : wrong ? `${opt}，所选答案错误` : undefined
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
