import { useEffect, useRef, useState } from "react";
import type { Progress } from "../types";
import type { ShareResult } from "../share/shareStats";
import { useLocale } from "../i18n/LocaleProvider";
import {
  formatUserError,
  normalizeUserFacingError,
  type UserFacingError,
} from "../i18n/errors";
import { formatNumber } from "../i18n/format";

interface Props {
  progress: Progress;
  onShare: () => Promise<ShareResult>;
  onClose: () => void;
  /** 自动弹出时 document.activeElement 是 body;由调用方提供结算页应恢复焦点的操作按钮。 */
  returnFocusTo?: () => HTMLElement | null;
}

type ShareStatus = "idle" | "downloaded" | "cancelled" | "error";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function GoalReachedDialog({
  progress,
  onShare,
  onClose,
  returnFocusTo,
}: Props) {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusToRef = useRef(returnFocusTo);
  const aliveRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>("idle");
  // 只保存原始结构化错误，主提示与详情在渲染时按当前语言生成。
  const [shareError, setShareError] = useState<UserFacingError | null>(null);

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
    setShareError(null);

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
      } else if (result.status === "cancelled") {
        setStatus("cancelled");
      } else {
        setStatus("error");
        setShareError(
          result.error ?? normalizeUserFacingError(result.message)
        );
      }
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus("error");
      setShareError(normalizeUserFacingError(error));
    }
    if (aliveRef.current) setBusy(false);
  };

  const formattedError =
    status === "error" && shareError
      ? formatUserError(shareError, locale)
      : null;

  const message =
    status === "downloaded"
      ? t("goal.downloaded")
      : status === "cancelled"
        ? t("goal.cancelled")
        : status === "error"
          ? (formattedError?.message ?? t("stats.retry"))
          : "";

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
          {t("goal.title")}
        </h2>
        <p className="goal-dialog-body">
          {t("goal.body", { goal: formatNumber(locale, progress.dailyGoal) })}
        </p>
        <div className="goal-dialog-actions">
          <button
            ref={primaryRef}
            className="btn btn-primary"
            aria-busy={busy}
            disabled={busy}
            onClick={handleShare}
          >
            {busy
              ? t("goal.busy")
              : status === "error"
                ? t("goal.retry")
                : t("goal.share")}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("goal.later")}
          </button>
        </div>
        <div
          className={`goal-dialog-status${status === "error" ? " is-error" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{message}</span>
          {formattedError?.diagnostic && (
            <details className="goal-dialog-details">
              <summary>{t("errors.details")}</summary>
              <span>{formattedError.diagnostic}</span>
            </details>
          )}
        </div>
        <button
          className="goal-dialog-close"
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
