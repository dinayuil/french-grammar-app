import { useState } from "react";
import type { Progress } from "../types";
import { shiftDate, today } from "../storage";
import { levelFor, streakFor, studyTotals } from "../engine";
import type { ShareResult } from "../share/shareStats";

type ShareStatus = "idle" | ShareResult["status"];

function detailFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "请重试";
}

function failureText(detail: string): string {
  return detail.includes("分享失败") ? detail : `分享失败：${detail || "请重试"}`;
}

function statusText(result: ShareResult): string {
  switch (result.status) {
    case "shared":
      return "已打开分享";
    case "downloaded":
      return "图片已保存到本地，可手动分享";
    case "cancelled":
      return "已取消";
    case "error":
      return failureText(result.message);
  }
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export function StatsView({
  progress,
  onShare,
}: {
  progress: Progress;
  onShare?: () => Promise<ShareResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [message, setMessage] = useState("");

  const handleShare = async () => {
    if (!onShare || busy) return;
    setBusy(true);
    setStatus("idle");
    setMessage("");
    try {
      const result = await onShare();
      setStatus(result.status);
      setMessage(statusText(result));
    } catch (error) {
      setStatus("error");
      setMessage(failureText(detailFor(error)));
    } finally {
      setBusy(false);
    }
  };

  const t = today();
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(t, -(6 - i)));
  const max = Math.max(...last7.map((d) => progress.days[d]?.xp ?? 0), 1);
  const study7 = last7.map((d) => {
    const day = progress.days[d];
    const read = typeof day?.readSeconds === "number" ? day.readSeconds : 0;
    const practice = typeof day?.practiceSeconds === "number" ? day.practiceSeconds : 0;
    return { read, practice, total: read + practice };
  });
  const maxStudy = Math.max(...study7.map((s) => s.total), 1);
  const totals = studyTotals(progress.days);

  return (
    <div className="stats">
      <div className="stats-top">
        <div className="stat-box">
          <div className="stat-num">{progress.xp}</div>
          <div className="stat-label">累计 XP</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{levelFor(progress.xp)}</div>
          <div className="stat-label">等级</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{streakFor(progress.days, progress.dailyGoal, t)}</div>
          <div className="stat-label">连击</div>
        </div>
      </div>

      <div className="stats-title">最近 7 天</div>
      <div className="bars">
        {last7.map((d) => {
          const xp = progress.days[d]?.xp ?? 0;
          const isToday = d === t;
          return (
            <div key={d} className="bar-col">
              <div className="bar-num">{xp > 0 ? xp : ""}</div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${isToday ? "bar-today" : ""}`}
                  style={{ height: `${(xp / max) * 100}%` }}
                />
              </div>
              <div className={`bar-label ${isToday ? "bar-label-today" : ""}`}>
                {d.slice(5)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="stats-title">最近 7 天学习时长（分钟）</div>
      <div className="bars study-bars">
        {last7.map((d, i) => {
          const { read, practice, total } = study7[i];
          const isToday = d === t;
          const minutes = Math.round(total / 60);
          return (
            <div key={d} className="bar-col">
              <div className="bar-num">{minutes > 0 ? minutes : ""}</div>
              <div className="bar-track">
                <div
                  className="study-seg study-practice"
                  style={{ height: `${(practice / maxStudy) * 100}%` }}
                />
                <div
                  className="study-seg study-read"
                  style={{ height: `${(read / maxStudy) * 100}%` }}
                />
              </div>
              <div className={`bar-label ${isToday ? "bar-label-today" : ""}`}>
                {d.slice(5)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="study-legend">
        <span className="study-legend-item">
          <span className="study-dot study-read" />
          看讲解
        </span>
        <span className="study-legend-item">
          <span className="study-dot study-practice" />
          做练习
        </span>
      </div>

      <div className="study-total">
        累计学习时长 {formatDuration(totals.total)}（看讲解 {formatDuration(totals.read)} /
        做练习 {formatDuration(totals.practice)}）
      </div>

      {onShare && (
        <div className="stats-share">
          <button
            className="btn btn-small btn-primary stats-share-btn"
            aria-label="分享今日打卡图片"
            aria-busy={busy}
            disabled={busy}
            onClick={handleShare}
          >
            <span aria-hidden="true">⬆</span>{" "}
            {busy ? "生成中…" : status === "error" ? "分享失败，点击重试" : "分享今日打卡"}
          </button>
          {message && (
            <div
              className={`stats-share-status${status === "error" ? " is-error" : ""}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
