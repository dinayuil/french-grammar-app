import { useState } from "react";
import type { TilesQuestion as TilesQ } from "../types";
import { tilesBank } from "../engine";

interface Props {
  q: TilesQ;
  response: string[];
  onResponse: (tokens: string[]) => void;
  disabled: boolean;
}

export function TilesQuestion({ q, response, onResponse, disabled }: Props) {
  // 词库按题 id 确定性洗牌;挂载时算一次,重渲染不抖动
  const [bank] = useState(() => tilesBank(q));
  // bank 是多重集:每个词可出现的次数 = bank 中的出现次数,上屏后计数减一
  const used: boolean[] = [];
  const pool = bank.map((w) => w);
  const respCopy = [...response];
  for (let i = 0; i < pool.length; i++) {
    const idx = respCopy.indexOf(pool[i]);
    if (idx >= 0) {
      used[i] = true;
      respCopy.splice(idx, 1);
    } else {
      used[i] = false;
    }
  }

  const pick = (w: string, bankIndex: number) => {
    if (disabled || used[bankIndex]) return;
    onResponse([...response, w]);
  };

  const unpick = (respIndex: number) => {
    if (disabled) return;
    onResponse(response.filter((_, i) => i !== respIndex));
  };

  return (
    <div className="tiles-box">
      <div className="response-row tiles-response">
        {response.length === 0 && <span className="ph" />}
        {response.map((w, i) => (
          <button key={i} className="tile placed" disabled={disabled} onClick={() => unpick(i)}>
            {w}
          </button>
        ))}
      </div>
      <div className="letter-tiles">
        {bank.map((w, i) => (
          <button
            key={i}
            className={`tile ${used[i] ? "used" : ""}`}
            disabled={disabled || used[i]}
            onClick={() => pick(w, i)}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
