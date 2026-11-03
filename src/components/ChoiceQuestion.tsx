import type { ChoiceQuestion } from "../types";

interface Props {
  q: ChoiceQuestion;
  response: number | null;
  onResponse: (n: number) => void;
  disabled: boolean;
  /** 判分后标出正确答案和选错的选项 */
  judged: boolean;
}

export function ChoiceQuestion({ q, response, onResponse, disabled, judged }: Props) {
  const accepted = new Set([q.answer, ...(q.alternatives ?? [])]);

  return (
    <div className="choice-options">
      {q.options.map((opt, i) => {
        const correct = judged && accepted.has(i);
        const wrong = judged && response === i && !correct;
        return (
          <button
            key={i}
            className={`option-btn ${response === i ? "selected" : ""} ${
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
                {" "}
                ✓
              </span>
            )}
            {wrong && (
              <span className="option-mark" aria-hidden="true">
                {" "}
                ✗
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
