import type { ChoiceQuestion } from "../types";

interface Props {
  q: ChoiceQuestion;
  response: number | null;
  onResponse: (n: number) => void;
  disabled: boolean;
}

export function ChoiceQuestion({ q, response, onResponse, disabled }: Props) {
  return (
    <div className="choice-options">
      {q.options.map((opt, i) => (
        <button
          key={i}
          className={`option-btn ${response === i ? "selected" : ""}`}
          disabled={disabled}
          onClick={() => onResponse(i)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
