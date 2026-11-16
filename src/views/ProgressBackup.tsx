import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { formatUserError, type UserFacingError } from "../i18n/errors";
import { useLocale } from "../i18n/LocaleProvider";
import type { Progress } from "../types";
import {
  BackupError,
  exportBackup,
  isBackupCancelled,
  loadRecoveryBackup,
  parseBackup,
  restoreBackup,
  type ProgressBackup,
} from "../backup/progressBackup";
import "../backup-ui.css";

interface Props {
  progress: Progress;
  onChange: (progress: Progress) => void;
}

type Busy = "export" | "import" | "restore" | null;

interface Preview {
  backup: ProgressBackup;
  source: "file" | "recovery";
}

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const BUSY_KEY = {
  export: "backup.busy.export",
  import: "backup.busy.import",
  restore: "backup.busy.restore",
} as const;

function countCompletedLessons(progress: Progress): number {
  return Object.values(progress.lessons).filter((record) => record.completed).length;
}

function displayDate(exportedAt: string): string {
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) return exportedAt;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  // 按本地日期显示;ISO 时间戳的 UTC 日期在凌晨可能显示成"昨天"。
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 已知业务错误保留其结构化码；旧/未知异常只保留诊断，主提示使用当前操作
 * 对应的本地化通用文案，避免把中文原文当作界面主文案。
 */
function panelError(error: unknown, fallbackCode: string): UserFacingError {
  if (error instanceof BackupError) {
    return error.userError;
  }
  const formatted = formatUserError(error, "zh-CN");
  return formatted.diagnostic
    ? { code: fallbackCode, diagnostic: formatted.diagnostic }
    : { code: fallbackCode };
}

function probeRecovery(): boolean {
  try {
    return loadRecoveryBackup() !== null;
  } catch {
    return false;
  }
}

/**
 * 学习进度备份:导出 JSON,读取后先预览摘要,确认才替换当前进度。
 * 恢复与回退都走 restoreBackup,由核心模块负责先写入并保留被替换记录。
 */
export function ProgressBackup({ progress, onChange }: Props) {
  const { locale, t } = useLocale();
  const [busy, setBusy] = useState<Busy>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<UserFacingError | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setRecoveryAvailable(probeRecovery());
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleExport = async () => {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy("export");
    try {
      await exportBackup(progress, locale);
      if (!mountedRef.current) return;
      setStatus({ code: "backup.status.exported" });
    } catch (exportError) {
      if (!mountedRef.current) return;
      if (isBackupCancelled(exportError)) {
        setStatus({ code: "backup.status.cancelled" });
      } else {
        setError(panelError(exportError, "backup.error.export_failed"));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // 每次选择后清空 value,同一文件再次选择也会触发 change。
    input.value = "";

    if (!file || busy) return;

    setPreview(null);
    setError(null);
    setStatus(null);

    if (file.size > MAX_BACKUP_BYTES) {
      setError({
        code: "backup.error.too_large",
        params: { limit: MAX_BACKUP_BYTES / 1024 / 1024 },
      });
      return;
    }

    setBusy("import");
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        if (mountedRef.current) {
          setError({ code: "backup.error.file_read_failed" });
        }
        return;
      }
      if (!mountedRef.current) return;

      try {
        const backup = parseBackup(text);
        if (!mountedRef.current) return;
        setPreview({ backup, source: "file" });
        setStatus({ code: "backup.status.import_ready" });
      } catch (parseError) {
        if (!mountedRef.current) return;
        setError(panelError(parseError, "backup.error.invalid_backup"));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleRecovery = () => {
    if (busy) return;
    setError(null);
    setStatus(null);
    try {
      const backup = loadRecoveryBackup();
      if (!backup) {
        setRecoveryAvailable(false);
        setError({ code: "backup.error.no_recovery" });
        return;
      }
      setPreview({ backup, source: "recovery" });
    } catch {
      setError({ code: "backup.error.recovery_read_failed" });
    }
  };

  const handleConfirm = () => {
    if (!preview || busy) return;
    const { backup, source } = preview;

    setError(null);
    setStatus(null);
    setBusy("restore");

    try {
      // 核心模块先完成持久化;失败时滚动恢复,界面保持原进度。
      restoreBackup(backup, progress);
    } catch (restoreError) {
      setBusy(null);
      setError(panelError(restoreError, "backup.error.restore_failed"));
      return;
    }

    // restoreBackup 已成功落盘。App 的 onChange 还会再保存一次,这次额外写入失败
    // 不应把已完成的恢复说成失败,只需提醒后续保存可能不可用。
    let extraSaveFailed = false;
    try {
      onChange(backup.progress);
    } catch {
      extraSaveFailed = true;
    }

    setBusy(null);
    setPreview(null);
    setRecoveryAvailable(probeRecovery());
    if (extraSaveFailed) {
      setStatus({ code: "backup.status.extra_save_failed" });
    } else if (source === "recovery") {
      setStatus({ code: "backup.status.restored_recovery" });
    } else {
      setStatus({ code: "backup.status.restored" });
    }
  };

  const handleCancel = () => {
    if (busy) return;
    setPreview(null);
    setError(null);
    setStatus(null);
  };

  const date = preview ? displayDate(preview.backup.exportedAt) : "";
  const completed = preview ? countCompletedLessons(preview.backup.progress) : 0;
  const formattedError = error ? formatUserError(error, locale) : null;

  return (
    <section className="backup-panel" aria-labelledby="backup-panel-title">
      <h2 className="settings-title backup-title" id="backup-panel-title">
        {t("backup.title")}
      </h2>
      <p className="backup-intro">{t("backup.intro")}</p>

      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-primary backup-export"
          onClick={handleExport}
          disabled={busy !== null}
          aria-busy={busy === "export" ? "true" : undefined}
        >
          {busy === "export" ? t("backup.exporting") : t("backup.export")}
        </button>
        <label
          className={`btn btn-secondary backup-file-btn${busy !== null ? " is-disabled" : ""}`}
          aria-disabled={busy !== null ? "true" : undefined}
        >
          {busy === "import" ? t("backup.importing") : t("backup.import")}
          <input
            type="file"
            aria-label={t("backup.choose_file")}
            className="backup-file-input"
            accept=".json,application/json"
            onChange={handleFileChange}
            disabled={busy !== null}
          />
        </label>
      </div>
      <p className="backup-hint">{t("backup.hint")}</p>

      {recoveryAvailable && !preview && (
        <button
          type="button"
          className="backup-recovery-btn"
          onClick={handleRecovery}
          disabled={busy !== null}
        >
          {t("backup.recovery_button")}
        </button>
      )}

      {formattedError ? (
        <div className="backup-status backup-error" role="alert">
          <span>{formattedError.message}</span>
          {formattedError.diagnostic && (
            <details className="backup-error-details">
              <summary>{t("errors.details")}</summary>
              <span>{formattedError.diagnostic}</span>
            </details>
          )}
        </div>
      ) : busy || status ? (
        <p className="backup-status" role="status" aria-live="polite">
          {busy
            ? t(BUSY_KEY[busy])
            : formatUserError(status, locale).message}
        </p>
      ) : null}

      {preview && (
        <div
          className={`backup-preview${preview.source === "recovery" ? " is-recovery" : ""}`}
        >
          <div className="backup-preview-title">
            {preview.source === "recovery"
              ? t("backup.preview.recovery_title")
              : t("backup.preview.title")}
          </div>
          <dl className="backup-summary">
            <div>
              <dt>{t("backup.preview.date")}</dt>
              <dd>{date}</dd>
            </div>
            <div>
              <dt>{t("backup.preview.xp")}</dt>
              <dd>{preview.backup.progress.xp} XP</dd>
            </div>
            <div>
              <dt>{t("backup.preview.lessons")}</dt>
              <dd>
                {t("backup.preview.lessons_value", { count: completed })}
              </dd>
            </div>
          </dl>
          <p className="backup-warning">{t("backup.preview.warning")}</p>
          <div className="backup-preview-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={busy !== null}
              aria-busy={busy === "restore" ? "true" : undefined}
            >
              {busy === "restore"
                ? t("backup.preview.restoring")
                : t("backup.preview.confirm")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={busy !== null}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
