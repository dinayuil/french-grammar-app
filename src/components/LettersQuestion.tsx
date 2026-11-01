import { useState } from "react";
import type { LettersQuestion as LettersQ } from "../types";
import { lettersBank, pickDecoys } from "../engine";

interface Props {
  q: LettersQ;
  response: string;
  onResponse: (s: string) => void;
  disabled: boolean;
}

export function LettersQuestion({ q, response, onResponse, disabled }: Props) {
  const [used, setUsed] = useState<number[]>([]); // 已用掉的 bank 字母下标
  // 干扰字母:挂载时随机抽取一次,本关内保持稳定(重做本关会重新抽取)
  const [decoys] = useState(() => pickDecoys(q.answer, Math.random));

  const bank = lettersBank({ ...q, decoys });

  const put = (ch: string, bankIndex: number) => {
    if (disabled || used.includes(bankIndex)) return;
    setUsed([...used, bankIndex]);
    onResponse(response + ch);
  };

  const addAccent = (ch: string) => {
    if (disabled) return;
    onResponse(response + ch);
  };

  const backspace = () => {
    if (disabled || response.length === 0) return;
    const last = response[response.length - 1];
    // 从已用下标里撤回最后一个匹配的字母
    const idx = [...used].reverse().find((i) => bank[i] === last);
    if (idx !== undefined) setUsed(used.filter((u) => u !== idx));
    onResponse(response.slice(0, -1));
  };

  const clear = () => {
    if (disabled) return;
    setUsed([]);
    onResponse("");
  };

  return (
    <div className="letters-box">
      <div className="response-row letters-response">{response || <span className="ph" />}</div>
      <div className="letter-tiles">
        {bank.map((ch, i) => (
          <button
            key={i}
            className={`tile ${used.includes(i) ? "used" : ""}`}
            disabled={disabled || used.includes(i)}
            onClick={() => put(ch, i)}
          >
            {ch}
          </button>
        ))}
      </div>
      {q.accentKeys && (
        <div className="accent-keys">
          {q.accentKeys.map((k) => (
            <button key={k} className="tile accent" disabled={disabled} onClick={() => addAccent(k)}>
              {k}
            </button>
          ))}
        </div>
      )}
      <div className="row-actions">
        <button className="btn btn-secondary btn-small" disabled={disabled} onClick={backspace}>
          ⌫ 退格
        </button>
        <button className="btn btn-secondary btn-small" disabled={disabled} onClick={clear}>
          清空
        </button>
      </div>
    </div>
  );
}
