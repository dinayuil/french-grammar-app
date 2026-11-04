import { useEffect, useRef, useState } from "react";
import type { Progress } from "../types";
import type { ShareResult } from "../share/shareStats";

interface Props {
  progress: Progress;
  onShare: () => Promise<ShareResult>;
  onClose: () => void;
  /** 自动弹出时 document.activeElement 是 body;由调用方提供结算页应恢复焦点的操作按钮。 */
  returnFocusTo?: () => HTMLElement | null;
}

type ShareStatus = "idle" | "downloaded" | "cancelled" | "error";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function detailFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "请重试";
}

function failureText(detail: string): string {
  return detail.includes("分享失败") ? detail : `分享失败：${detail || "请重试"}`;
}

export function GoalReachedDialog({
  progress,
  onShare,
  onClose,
  returnFocusTo,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusToRef = useRef(returnFocusTo);
  const aliveRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusToRef.current = returnFocusTo;
  }, [onClose, returnFocusTo]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? focusables.indexOf(active) : -1;

      if (index === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && index === 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && index === focusables.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const previous = previousFocus.current;
      // 弹窗在结算页自动打开时原焦点已是 body;此时回到调用方解析出的结算操作按钮。
      let target: HTMLElement | null = null;
      if (previous && previous !== document.body && previous.isConnected) {
        target = previous;
      } else {
        try {
          target = returnFocusToRef.current?.() ?? null;
        } catch {
          target = null;
        }
      }
      target?.focus();
    };
  }, []);

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("idle");
    setMessage("");

    try {
      const result = await onShare();
      // 弹窗已卸载后迟到的结果不能关闭之后重新打开的弹窗。
      if (!aliveRef.current) return;
      if (result.status === "shared") {
        setBusy(false);
        onClose();
        return;
      }
      if (result.status === "downloaded") {
        setStatus("downloaded");
        setMessage("图片已保存到本地，可手动分享");
      } else if (result.status === "cancelled") {
        setStatus("cancelled");
        setMessage("已取消");
      } else {
        setStatus("error");
        setMessage(failureText(result.message));
      }
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus("error");
      setMessage(failureText(detailFor(error)));
    }
    if (aliveRef.current) setBusy(false);
  };

  return (
    <div
      className="goal-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        className="goal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="goal-dialog-title" id="reminder-title">
          今日目标达成 🎉
        </h2>
        <p className="goal-dialog-body">
          已完成今日 {progress.dailyGoal} XP 目标，分享打卡记录鼓励自己吧！
        </p>
        <div className="goal-dialog-actions">
          <button
            ref={primaryRef}
            className="btn btn-primary"
            aria-busy={busy}
            disabled={busy}
            onClick={handleShare}
          >
            {busy ? "生成中…" : status === "error" ? "重试" : "分享打卡"}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            稍后再说
          </button>
        </div>
        <div
          className={`goal-dialog-status${status === "error" ? " is-error" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </div>
        <button
          className="goal-dialog-close"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
