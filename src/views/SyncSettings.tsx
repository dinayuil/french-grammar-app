import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  exportBackup,
  isBackupCancelled,
  type ProgressBackup,
} from "../backup/progressBackup";
import {
  formatUserError,
  normalizeUserFacingError,
  type FormattedUserError,
  type UserFacingError,
} from "../i18n/errors";
import { useLocale } from "../i18n/LocaleProvider";
import type { ClientSyncController } from "../sync/useClientSync";
import type { SyncConfig, SyncSettings, SyncSnapshot } from "../sync/types";
import {
  readSyncRecoveryHistory,
  type SyncRecoveryReason,
  type SyncRecoveryRecord,
} from "../sync/storage";

interface Props {
  /** 网页版没有控制器;传入 null 时整段同步设置不渲染。 */
  controller: ClientSyncController | null;
}

type StatusTone = "neutral" | "active" | "success" | "warning" | "error";

const STATUS_TONE: Record<SyncSnapshot["status"], StatusTone> = {
  disabled: "neutral",
  idle: "neutral",
  syncing: "active",
  synced: "success",
  conflict: "warning",
  error: "error",
};

const STATUS_KEY = {
  disabled: "sync.status.disabled",
  idle: "sync.status.idle",
  syncing: "sync.status.syncing",
  synced: "sync.status.synced",
  conflict: "sync.status.conflict",
  error: "sync.status.error",
} as const;

const RECOVERY_KEY: Record<SyncRecoveryReason, string> = {
  conflict: "sync.recovery.reason.conflict",
  "remote-apply": "sync.recovery.reason.remote_apply",
  "local-overwrite": "sync.recovery.reason.local_overwrite",
  "remote-overwrite": "sync.recovery.reason.remote_overwrite",
};

const DISABLED_SNAPSHOT: SyncSnapshot = {
  status: "disabled",
  config: null,
  message: "",
  error: null,
  notice: null,
  lastSyncedAt: null,
  conflict: null,
};

const noopSubscribe = () => () => {};

/**
 * 设置页里的同步快照订阅。控制器只在原生端存在,网页端不订阅任何接口。
 * getSnapshot 对同一快照保持同一对象身份,满足 useSyncExternalStore 的契约。
 */
function useSyncSnapshot(controller: ClientSyncController | null): SyncSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      controller ? controller.subscribe(listener) : noopSubscribe(),
    [controller]
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : DISABLED_SNAPSHOT),
    [controller]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 统一规范化异常；无码旧错误保留当前操作的本地化上下文。 */
function toUserError(error: unknown, fallbackCode: string): UserFacingError {
  const normalized = normalizeUserFacingError(error);
  if (normalized.code === "errors.unknown") {
    return {
      code: fallbackCode,
      ...(normalized.diagnostic
        ? { diagnostic: normalized.diagnostic }
        : {}),
    };
  }
  return normalized;
}

function snapshotFeedback(
  snapshot: SyncSnapshot,
  locale: "zh-CN" | "fr"
): FormattedUserError | null {
  // 冲突操作中的存储/覆盖失败也带结构化 error;不能按 status 丢弃成普通状态。
  if (snapshot.error) return formatUserError(snapshot.error, locale);
  if (snapshot.status === "error") {
    if (snapshot.message) {
      return formatUserError(
        { code: "sync.error.failed", diagnostic: snapshot.message },
        locale
      );
    }
    return null;
  }
  if (snapshot.notice) return formatUserError(snapshot.notice, locale);
  if (snapshot.message) {
    return formatUserError(
      { code: "sync.message.legacy", diagnostic: snapshot.message },
      locale
    );
  }
  return null;
}

function formatSyncTime(value: string | null, emptyLabel: string): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}

function formatExportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function completedLessons(backup: ProgressBackup): number {
  return Object.values(backup.progress.lessons).filter((record) => record.completed)
    .length;
}

/** 只读取非敏感副本历史,不触发同步或写入。 */
function readRecoveryHistory(
  storage: Storage | null,
  account: { url: string; username: string }
): SyncRecoveryRecord[] {
  return readSyncRecoveryHistory(storage, account).slice(0, 3);
}

function configMatches(
  config: SyncConfig | null,
  settings: SyncSettings
): boolean {
  return (
    config !== null &&
    config.url === settings.url &&
    config.username === settings.username &&
    config.autoSync === settings.autoSync &&
    config.hasPassword
  );
}

function validateConnection(
  url: string,
  username: string,
  password: string,
  canReusePassword: boolean
): UserFacingError | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { code: "sync.validation.url_required" };

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return { code: "sync.validation.url_invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { code: "sync.validation.url_protocol" };
  }
  if (parsed.username || parsed.password) {
    return { code: "sync.validation.url_credentials" };
  }
  if (parsed.search || parsed.hash) {
    return { code: "sync.validation.url_query" };
  }
  if (!username.trim()) return { code: "sync.validation.username_required" };
  if (!canReusePassword && !password) {
    return { code: "sync.validation.password_required" };
  }
  return null;
}

export function SyncSettings({ controller }: Props) {
  const { locale, t } = useLocale();
  const snapshot = useSyncSnapshot(controller);
  const config = snapshot.config;

  const [url, setUrl] = useState(config?.url ?? "");
  const [username, setUsername] = useState(config?.username ?? "");
  const [password, setPasswordInput] = useState("");
  const [autoSync, setAutoSync] = useState(config?.autoSync ?? true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resolving, setResolving] = useState<"local" | "remote" | null>(null);
  const [formError, setFormError] = useState<UserFacingError | null>(null);
  const [notice, setNotice] = useState<UserFacingError | null>(null);
  const [conflictHidden, setConflictHidden] = useState(false);
  const [recoveries, setRecoveries] = useState<SyncRecoveryRecord[]>([]);
  const [exporting, setExporting] = useState<{
    index: number;
    which: "local" | "remote";
  } | null>(null);

  const configKey = config
    ? `${config.url}\n${config.username}\n${config.autoSync}\n${config.hasPassword}`
    : "";
  const lastConfigKey = useRef(configKey);

  useEffect(() => {
    if (configKey === lastConfigKey.current) return;
    lastConfigKey.current = configKey;
    setUrl(config?.url ?? "");
    setUsername(config?.username ?? "");
    setPasswordInput("");
    setAutoSync(config?.autoSync ?? true);
  }, [config, configKey]);

  const conflict = snapshot.conflict;
  const conflictEtag = conflict?.remoteEtag ?? "";
  useEffect(() => {
    setConflictHidden(false);
  }, [conflictEtag]);

  const configUrl = config?.url ?? "";
  const configUsername = config?.username ?? "";
  useEffect(() => {
    if (!configUrl || !configUsername) {
      setRecoveries([]);
      return;
    }
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    setRecoveries(
      readRecoveryHistory(storage, {
        url: configUrl,
        username: configUsername,
      })
    );
  }, [
    configUrl,
    configUsername,
    snapshot.status,
    snapshot.lastSyncedAt,
    conflictEtag,
  ]);

  if (!controller) return null;

  const statusTone = STATUS_TONE[snapshot.status];
  const connected = config !== null;
  const displayStatus =
    !connected && snapshot.status === "idle"
      ? { label: t("sync.status.not_connected"), tone: "neutral" as StatusTone }
      : { label: t(STATUS_KEY[snapshot.status]), tone: statusTone };
  const busy =
    saving ||
    syncing ||
    disconnecting ||
    exporting !== null ||
    resolving !== null ||
    snapshot.status === "syncing";
  const accountChanged =
    !config ||
    config.url !== url.trim() ||
    config.username !== username.trim();
  const canReusePassword = config?.hasPassword === true && !accountChanged;

  const clearFeedback = () => {
    setFormError(null);
    setNotice(null);
  };

  const markEdited = () => {
    if (formError) setFormError(null);
    if (notice) setNotice(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    clearFeedback();

    const problem = validateConnection(
      url,
      username,
      password,
      canReusePassword
    );
    if (problem) {
      setFormError(problem);
      return;
    }

    setSaving(true);
    try {
      const settings: SyncSettings = {
        url: url.trim(),
        username: username.trim(),
        autoSync,
      };
      await controller.configure(
        settings,
        password ? password : undefined
      );
      const latest = controller.getSnapshot();
      if (!configMatches(latest.config, settings)) {
        // 控制器可能吞掉原生错误并只更新 snapshot;只有配置真正落盘才算保存成功。
        setFormError(
          latest.error ?? {
            code: "sync.error.config_save_failed",
            diagnostic: latest.message || undefined,
          }
        );
        return;
      }
      // 保存成功后不保留任何密码输入,控制器只暴露 hasPassword。
      setPasswordInput("");
      // 配置已保存但首次同步可能失败,不能把同步结果说成连接失败或连接成功。
      setNotice({
        code:
          latest.status === "error"
            ? "sync.notice.saved_sync_failed"
            : "sync.notice.saved",
      });
    } catch (error) {
      setFormError(toUserError(error, "sync.action.save_unknown"));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!connected || busy) return;
    clearFeedback();
    setSyncing(true);
    try {
      await controller.sync();
    } catch (error) {
      setFormError(toUserError(error, "sync.action.sync_unknown"));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (disconnecting) return;
    clearFeedback();
    setDisconnecting(true);
    try {
      await controller.disconnect();
      const latest = controller.getSnapshot();
      if (latest.config !== null) {
        // 断开失败时保留已填写的配置与密码状态,不回显密码但也不清空。
        setFormError(
          latest.error ?? {
            code: "sync.error.disconnect_failed",
            diagnostic: latest.message || undefined,
          }
        );
        return;
      }
      setUrl("");
      setUsername("");
      setPasswordInput("");
      setAutoSync(true);
      setNotice({ code: "sync.notice.disconnected" });
    } catch (error) {
      setFormError(toUserError(error, "sync.action.disconnect_unknown"));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleResolve = async (choice: "local" | "remote") => {
    if (resolving) return;
    clearFeedback();
    setResolving(choice);
    try {
      await controller.resolveConflict(choice);
      const latest = controller.getSnapshot();
      const resolved =
        latest.status === "synced" && latest.conflict === null;
      if (!resolved) {
        // 冲突可能被延后、再次出现或失败;保留控制器消息,不宣布覆盖成功。
        if (!snapshotFeedback(latest, locale)) {
          setFormError({ code: "sync.action.resolve_unhandled" });
        }
        return;
      }
      setNotice({
        code:
          choice === "local"
            ? "sync.notice.overwrote_cloud"
            : "sync.notice.replaced_local",
      });
    } catch (error) {
      setFormError(toUserError(error, "sync.action.resolve_unknown"));
    } finally {
      setResolving(null);
    }
  };

  const handlePostponeConflict = () => {
    clearFeedback();
    setConflictHidden(true);
  };

  const handleExportRecovery = async (index: number, which: "local" | "remote") => {
    if (exporting !== null) return;
    const record = recoveries[index];
    if (!record) return;
    const copy = which === "local" ? record.local : record.remote;
    if (!copy) return;
    clearFeedback();
    setExporting({ index, which });
    try {
      // 只导出文件;不恢复、不覆盖当前学习进度,也不写任何同步状态。
      await exportBackup(copy.progress, locale);
      setNotice({
        code:
          which === "local"
            ? "sync.notice.export_local"
            : "sync.notice.export_remote",
      });
    } catch (error) {
      if (isBackupCancelled(error)) {
        setNotice({ code: "sync.notice.cancelled" });
      } else {
        setFormError(
          toUserError(error, "sync.action.export_recovery_unknown")
        );
      }
    } finally {
      setExporting(null);
    }
  };

  const feedback = snapshotFeedback(snapshot, locale);
  const formErrorText = formError ? formatUserError(formError, locale) : null;
  const noticeText = notice ? formatUserError(notice, locale).message : "";
  const emptyTime = t("sync.last_synced_none");

  return (
    <section className="sync-panel" aria-labelledby="sync-panel-title">
      <div className="sync-head">
        <h2 className="settings-title backup-title" id="sync-panel-title">
          {t("sync.title")}
        </h2>
        <span
          className={`sync-badge sync-badge-${displayStatus.tone}`}
          aria-hidden="true"
        >
          {displayStatus.label}
        </span>
      </div>
      <p className="backup-intro">{t("sync.intro")}</p>

      <div className={`sync-status sync-status-${displayStatus.tone}`}>
        <div className="sync-status-row">
          <span className="sync-dot" aria-hidden="true" />
          <span className="sync-status-label">{displayStatus.label}</span>
          <span className="sync-status-time">
            {t("sync.last_synced", {
              time: formatSyncTime(snapshot.lastSyncedAt, emptyTime),
            })}
          </span>
        </div>
        {feedback && (
          <div
            className={
              snapshot.error || snapshot.status === "error"
                ? "sync-error"
                : "sync-message"
            }
            role={snapshot.error || snapshot.status === "error" ? "alert" : "status"}
          >
            <span>{feedback.message}</span>
            {feedback.diagnostic && (
              <details className="sync-error-details">
                <summary>{t("errors.details")}</summary>
                <span>{feedback.diagnostic}</span>
              </details>
            )}
          </div>
        )}
      </div>

      {conflict && !conflictHidden && (
        <div
          className="sync-conflict"
          role="region"
          aria-label={t("sync.conflict.region")}
        >
          <div className="sync-conflict-head">{t("sync.conflict.title")}</div>
          <p className="sync-conflict-intro">{t("sync.conflict.intro")}</p>
          <div className="sync-compare">
            <div className="sync-compare-card is-local">
              <div className="sync-compare-label">{t("sync.local")}</div>
              <dl>
                <div>
                  <dt>{t("sync.xp")}</dt>
                  <dd>{conflict.local.progress.xp} XP</dd>
                </div>
                <div>
                  <dt>{t("sync.lessons")}</dt>
                  <dd>
                    {t("sync.lessons_value", {
                      count: completedLessons(conflict.local),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("sync.record_date")}</dt>
                  <dd>{formatExportDate(conflict.local.exportedAt)}</dd>
                </div>
              </dl>
            </div>
            <div className="sync-compare-card is-remote">
              <div className="sync-compare-label">{t("sync.remote")}</div>
              <dl>
                <div>
                  <dt>{t("sync.xp")}</dt>
                  <dd>{conflict.remote.progress.xp} XP</dd>
                </div>
                <div>
                  <dt>{t("sync.lessons")}</dt>
                  <dd>
                    {t("sync.lessons_value", {
                      count: completedLessons(conflict.remote),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("sync.record_date")}</dt>
                  <dd>{formatExportDate(conflict.remote.exportedAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="sync-conflict-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleResolve("local")}
              disabled={busy}
              aria-busy={resolving === "local" ? "true" : undefined}
            >
              {t("sync.overwrite_cloud")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleResolve("remote")}
              disabled={busy}
              aria-busy={resolving === "remote" ? "true" : undefined}
            >
              {t("sync.replace_local")}
            </button>
            <button
              type="button"
              className="sync-conflict-cancel"
              onClick={handlePostponeConflict}
              disabled={busy}
            >
              {t("sync.postpone")}
            </button>
          </div>
          {resolving && (
            <p className="sync-notice" role="status">
              {t("sync.resolving")}
            </p>
          )}
        </div>
      )}

      {conflict && conflictHidden && (
        <div className="sync-conflict-pending">
          <span>{t("sync.conflict_pending")}</span>
          <button
            type="button"
            className="backup-recovery-btn"
            onClick={() => setConflictHidden(false)}
          >
            {t("sync.view_conflict")}
          </button>
        </div>
      )}

      {recoveries.length > 0 && (
        <section className="sync-recovery" aria-labelledby="sync-recovery-title">
          <div className="sync-recovery-head">
            <h3 className="sync-recovery-title" id="sync-recovery-title">
              {t("sync.recovery.title")}
            </h3>
            <span className="sync-recovery-saved">
              {t("sync.recovery.limit")}
            </span>
          </div>
          <p className="sync-recovery-intro">{t("sync.recovery.intro")}</p>
          <div className="sync-recovery-records">
            {recoveries.map((record, index) => {
              const isLatest = index === 0;
              const exportState =
                exporting?.index === index ? exporting.which : null;
              const reason = t(
                RECOVERY_KEY[record.reason] as
                  | "sync.recovery.reason.conflict"
                  | "sync.recovery.reason.remote_apply"
                  | "sync.recovery.reason.local_overwrite"
                  | "sync.recovery.reason.remote_overwrite"
              );
              return (
                <div
                  className={`sync-recovery-record${isLatest ? " is-latest" : ""}`}
                  role="group"
                  aria-label={`${formatSyncTime(record.savedAt, emptyTime)} ${reason}`}
                  key={`${record.savedAt}-${index}`}
                >
                  <div className="sync-recovery-record-head">
                    <span className="sync-recovery-record-date">
                      {formatSyncTime(record.savedAt, emptyTime)}
                    </span>
                    {isLatest && (
                      <span className="sync-recovery-latest">{t("sync.latest")}</span>
                    )}
                    <span className="sync-recovery-record-reason">{reason}</span>
                  </div>
                  <div
                    className={`sync-recovery-copies${record.remote ? "" : " is-single"}`}
                  >
                    <div className="sync-recovery-card">
                      <div className="sync-recovery-label">
                        {t("sync.recovery.local_old")}
                      </div>
                      <div className="sync-recovery-meta">
                        <span>
                          {t("sync.recovery.meta", {
                            xp: record.local.progress.xp,
                            count: completedLessons(record.local),
                          })}
                        </span>
                        <span className="sync-recovery-copy-date">
                          {t("sync.recovery.record_date", {
                            date: formatExportDate(record.local.exportedAt),
                          })}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary sync-recovery-export"
                        onClick={() => handleExportRecovery(index, "local")}
                        disabled={busy}
                        aria-busy={exportState === "local" ? "true" : undefined}
                        aria-label={t("sync.recovery.export_local_aria", {
                          time: formatSyncTime(record.savedAt, emptyTime),
                        })}
                      >
                        {exportState === "local"
                          ? t("sync.exporting")
                          : t("sync.export_local")}
                      </button>
                    </div>
                    {record.remote && (
                      <div className="sync-recovery-card">
                        <div className="sync-recovery-label">
                          {t("sync.recovery.remote_old")}
                        </div>
                        <div className="sync-recovery-meta">
                          <span>
                            {t("sync.recovery.meta", {
                              xp: record.remote.progress.xp,
                              count: completedLessons(record.remote),
                            })}
                          </span>
                          <span className="sync-recovery-copy-date">
                            {t("sync.recovery.record_date", {
                              date: formatExportDate(record.remote.exportedAt),
                            })}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary sync-recovery-export"
                          onClick={() => handleExportRecovery(index, "remote")}
                          disabled={busy}
                          aria-busy={
                            exportState === "remote" ? "true" : undefined
                          }
                          aria-label={t("sync.recovery.export_remote_aria", {
                            time: formatSyncTime(record.savedAt, emptyTime),
                          })}
                        >
                          {exportState === "remote"
                            ? t("sync.exporting")
                            : t("sync.export_remote")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="backup-hint">{t("sync.recovery.hint")}</p>
        </section>
      )}

      <form className="sync-form" onSubmit={handleSave} noValidate>
        <div className="sync-fields">
          <label className="sync-field" htmlFor="sync-url">
            <span className="sync-label">{t("sync.form.url_label")}</span>
            <input
              id="sync-url"
              className="sync-input"
              type="url"
              inputMode="url"
              value={url}
              placeholder="https://example.com/dav"
              autoComplete="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="sync-url-hint"
              onChange={(event) => {
                setUrl(event.currentTarget.value);
                markEdited();
              }}
            />
          </label>
          <p className="backup-hint" id="sync-url-hint">
            {t("sync.form.url_hint")}
          </p>

          <div className="sync-folder">
            <div className="sync-folder-head">
              <span className="sync-label">{t("sync.form.folder")}</span>
              <span className="sync-folder-fixed">
                {t("sync.form.folder_fixed")}
              </span>
            </div>
            <div className="sync-folder-path">FrenchGrammarExercise/</div>
          </div>

          <label className="sync-field" htmlFor="sync-username">
            <span className="sync-label">{t("sync.form.username")}</span>
            <input
              id="sync-username"
              className="sync-input"
              type="text"
              value={username}
              placeholder={t("sync.form.username_placeholder")}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setUsername(event.currentTarget.value);
                markEdited();
              }}
            />
          </label>

          <label className="sync-field" htmlFor="sync-password">
            <span className="sync-label">
              {t("sync.form.password")}
            </span>
            <input
              id="sync-password"
              className="sync-input"
              type="password"
              value={password}
              placeholder={
                canReusePassword
                  ? t("sync.form.password_saved_placeholder")
                  : t("sync.form.password_placeholder")
              }
              autoComplete="off"
              aria-label={t("sync.form.password")}
              aria-describedby="sync-password-hint"
              onChange={(event) => {
                setPasswordInput(event.currentTarget.value);
                markEdited();
              }}
            />
          </label>
          <p className="backup-hint" id="sync-password-hint">
            {t("sync.form.password_hint")}
          </p>
        </div>

        <label className="sync-auto" htmlFor="sync-auto">
          <input
            id="sync-auto"
            type="checkbox"
            checked={autoSync}
            aria-label={t("sync.form.auto")}
            aria-describedby="sync-auto-hint"
            onChange={(event) => {
              setAutoSync(event.currentTarget.checked);
              markEdited();
            }}
          />
          <span className="sync-auto-track" aria-hidden="true" />
          <span className="sync-auto-copy">
            <strong>{t("sync.form.auto")}</strong>
            <span id="sync-auto-hint">{t("sync.form.auto_hint")}</span>
          </span>
        </label>

        {formErrorText && (
          <div className="sync-error sync-form-error" role="alert">
            <span>{formErrorText.message}</span>
            {formErrorText.diagnostic && (
              <details className="sync-error-details">
                <summary>{t("errors.details")}</summary>
                <span>{formErrorText.diagnostic}</span>
              </details>
            )}
          </div>
        )}
        {noticeText && !formErrorText && (
          <p className="sync-notice" role="status">
            {noticeText}
          </p>
        )}

        <div className="sync-form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy}
            aria-busy={saving ? "true" : undefined}
          >
            {saving ? t("sync.form.saving") : t("sync.form.save")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={!connected || busy}
            aria-busy={syncing || snapshot.status === "syncing" ? "true" : undefined}
          >
            {t("sync.form.sync_now")}
          </button>
        </div>
      </form>

      {connected && (
        <div className="sync-disconnect-row">
          <button
            type="button"
            className="sync-disconnect"
            onClick={handleDisconnect}
            disabled={busy}
          >
            {disconnecting
              ? t("sync.form.disconnecting")
              : t("sync.form.disconnect")}
          </button>
          <p className="backup-hint">{t("sync.form.disconnect_hint")}</p>
        </div>
      )}
    </section>
  );
}
