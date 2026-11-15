import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Progress } from "../types";
import {
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

const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  export: "正在导出备份…",
  import: "正在读取备份文件…",
  restore: "正在恢复学习进度…",
};

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

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
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
  const [busy, setBusy] = useState<Busy>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
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
    setError("");
    setStatus("");
    setBusy("export");
    try {
      await exportBackup(progress);
      if (!mountedRef.current) return;
      setStatus("备份文件已生成。");
    } catch (exportError) {
      if (!mountedRef.current) return;
      if (isBackupCancelled(exportError)) {
        setStatus("已取消导出。");
      } else {
        setError(`导出失败：${errorText(exportError, "请重试。")}`);
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
    setError("");
    setStatus("");

    if (file.size > MAX_BACKUP_BYTES) {
      setError("文件超过 5 MB，无法导入。");
      return;
    }

    setBusy("import");
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        if (mountedRef.current) setError("读取备份文件失败，请重试。");
        return;
      }
      if (!mountedRef.current) return;

      try {
        const backup = parseBackup(text);
        if (!mountedRef.current) return;
        setPreview({ backup, source: "file" });
        setStatus("备份已读取，请确认是否恢复。");
      } catch (parseError) {
        if (!mountedRef.current) return;
        setError(errorText(parseError, "备份文件无法识别，请检查后重试。"));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleRecovery = () => {
    if (busy) return;
    setError("");
    setStatus("");
    try {
      const backup = loadRecoveryBackup();
      if (!backup) {
        setRecoveryAvailable(false);
        setError("没有可恢复的上次导入前记录。");
        return;
      }
      setPreview({ backup, source: "recovery" });
    } catch {
      setError("读取上次导入前的记录失败，请重试。");
    }
  };

  const handleConfirm = () => {
    if (!preview || busy) return;
    const { backup, source } = preview;

    setError("");
    setStatus("");
    setBusy("restore");

    try {
      // 核心模块先完成持久化;失败时滚动恢复,界面保持原进度。
      restoreBackup(backup, progress);
    } catch (restoreError) {
      setBusy(null);
      setError(`恢复失败：${errorText(restoreError, "现有学习记录未被替换，请重试。")}`);
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
      setStatus("已恢复学习进度；但后续自动保存失败，之后的学习记录可能无法保存。");
    } else if (source === "recovery") {
      setStatus("已恢复上次导入前的学习记录。");
    } else {
      setStatus("已恢复学习进度。");
    }
  };

  const handleCancel = () => {
    if (busy) return;
    setPreview(null);
    setError("");
    setStatus("");
  };

  const date = preview ? displayDate(preview.backup.exportedAt) : "";
  const completed = preview ? countCompletedLessons(preview.backup.progress) : 0;

  return (
    <section className="backup-panel" aria-labelledby="backup-panel-title">
      <h2 className="settings-title backup-title" id="backup-panel-title">
        学习进度备份
      </h2>
      <p className="backup-intro">
        把学习记录和练习设置保存为 JSON 文件，可在其他设备导入恢复。
      </p>

      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-primary backup-export"
          onClick={handleExport}
          disabled={busy !== null}
          aria-busy={busy === "export" ? "true" : undefined}
        >
          {busy === "export" ? "正在导出…" : "导出备份"}
        </button>
        <label
          className={`btn btn-secondary backup-file-btn${busy !== null ? " is-disabled" : ""}`}
          aria-disabled={busy !== null ? "true" : undefined}
        >
          {busy === "import" ? "正在读取…" : "导入备份"}
          <input
            type="file"
            aria-label="选择学习进度备份文件"
            className="backup-file-input"
            accept=".json,application/json"
            onChange={handleFileChange}
            disabled={busy !== null}
          />
        </label>
      </div>
      <p className="backup-hint">仅支持本应用导出的 .json 备份，文件不超过 5 MB。</p>

      {recoveryAvailable && !preview && (
        <button
          type="button"
          className="backup-recovery-btn"
          onClick={handleRecovery}
          disabled={busy !== null}
        >
          恢复上次导入前的记录
        </button>
      )}

      {error ? (
        <p className="backup-status backup-error" role="alert">
          {error}
        </p>
      ) : busy || status ? (
        <p className="backup-status" role="status" aria-live="polite">
          {busy ? BUSY_TEXT[busy] : status}
        </p>
      ) : null}

      {preview && (
        <div
          className={`backup-preview${preview.source === "recovery" ? " is-recovery" : ""}`}
        >
          <div className="backup-preview-title">
            {preview.source === "recovery" ? "上次导入前的学习记录" : "备份内容确认"}
          </div>
          <dl className="backup-summary">
            <div>
              <dt>导出日期</dt>
              <dd>{date}</dd>
            </div>
            <div>
              <dt>累计 XP</dt>
              <dd>{preview.backup.progress.xp} XP</dd>
            </div>
            <div>
              <dt>已完成关卡</dt>
              <dd>{completed} 个</dd>
            </div>
          </dl>
          <p className="backup-warning">
            恢复将替换当前学习记录，并覆盖每日目标、音效和翻译设置。主题设置不会迁移。
          </p>
          <div className="backup-preview-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={busy !== null}
              aria-busy={busy === "restore" ? "true" : undefined}
            >
              {busy === "restore" ? "正在恢复…" : "确认恢复"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={busy !== null}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
