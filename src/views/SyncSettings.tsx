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

const STATUS_TEXT: Record<
  SyncSnapshot["status"],
  { label: string; tone: StatusTone }
> = {
  disabled: { label: "同步未启用", tone: "neutral" },
  idle: { label: "等待同步", tone: "neutral" },
  syncing: { label: "正在同步", tone: "active" },
  synced: { label: "已同步", tone: "success" },
  conflict: { label: "需要处理冲突", tone: "warning" },
  error: { label: "同步失败", tone: "error" },
};

const RECOVERY_REASON: Record<SyncRecoveryReason, string> = {
  conflict: "冲突时保存",
  "remote-apply": "应用云端前保存",
  "local-overwrite": "覆盖云端前保存",
  "remote-overwrite": "替换本机前保存",
};

const DISABLED_SNAPSHOT: SyncSnapshot = {
  status: "disabled",
  config: null,
  message: "",
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

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function formatSyncTime(value: string | null): string {
  if (!value) return "暂无";
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
): string {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return "请填写 WebDAV 目录地址。";

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return "WebDAV 地址格式不正确，请填写完整的 HTTPS 地址。";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "WebDAV 地址必须以 http:// 或 https:// 开头。";
  }
  if (parsed.username || parsed.password) {
    return "请不要把用户名或密码写在地址里。";
  }
  if (parsed.search || parsed.hash) {
    return "WebDAV 地址不能包含查询参数或片段。";
  }
  if (!username.trim()) return "请填写 WebDAV 用户名。";
  if (!canReusePassword && !password) {
    return "请输入应用密码。";
  }
  return "";
}

export function SyncSettings({ controller }: Props) {
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
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
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

  const status = STATUS_TEXT[snapshot.status];
  const connected = config !== null;
  const displayStatus = !connected && snapshot.status === "idle"
    ? { label: "尚未连接", tone: "neutral" as StatusTone }
    : status;
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
    setFormError("");
    setNotice("");
  };

  const markEdited = () => {
    if (formError) setFormError("");
    if (notice) setNotice("");
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
          `保存连接失败：${latest.message || "同步配置未保存，请重试。"}`
        );
        return;
      }
      // 保存成功后不保留任何密码输入,控制器只暴露 hasPassword。
      setPasswordInput("");
      // 配置已保存但首次同步可能失败,不能把同步结果说成连接失败或连接成功。
      setNotice(
        latest.status === "error"
          ? "连接设置已保存，但首次同步未完成，请查看上方提示。"
          : "连接设置已保存。"
      );
    } catch (error) {
      setFormError(
        `保存连接失败：${errorText(
          error,
          "请检查地址、用户名和应用密码后重试。"
        )}`
      );
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
      setFormError(`同步失败：${errorText(error, "请稍后重试。")}`);
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
        setFormError(`断开连接失败：${latest.message || "请稍后重试。"}`);
        return;
      }
      setUrl("");
      setUsername("");
      setPasswordInput("");
      setAutoSync(true);
      setNotice("已断开同步。本机学习进度和云端文件都保留。");
    } catch (error) {
      setFormError(`断开失败：${errorText(error, "请稍后重试。")}`);
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
        if (!latest.message) {
          setFormError("冲突尚未处理，请稍后重试。");
        }
        return;
      }
      setNotice(
        choice === "local"
          ? "已使用本机进度覆盖云端。"
          : "已使用云端进度替换本机。"
      );
    } catch (error) {
      setFormError(
        `处理冲突失败：${errorText(error, "两份记录都未改变，请重试。")}`
      );
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
      await exportBackup(copy.progress);
      setNotice(
        which === "local" ? "已导出本机旧记录。" : "已导出云端旧记录。"
      );
    } catch (error) {
      if (isBackupCancelled(error)) {
        setNotice("已取消导出。");
      } else {
        setFormError(`导出恢复副本失败：${errorText(error, "请重试。")}`);
      }
    } finally {
      setExporting(null);
    }
  };

  return (
    <section className="sync-panel" aria-labelledby="sync-panel-title">
      <div className="sync-head">
        <h2 className="settings-title backup-title" id="sync-panel-title">
          跨设备同步
        </h2>
        <span
          className={`sync-badge sync-badge-${displayStatus.tone}`}
          aria-hidden="true"
        >
          {displayStatus.label}
        </span>
      </div>
      <p className="backup-intro">
        用你自己的 WebDAV 服务，在 Windows、Android 和鸿蒙设备间同步学习进度。
        只同步学习进度，不包含主题设置。
      </p>

      <div className={`sync-status sync-status-${displayStatus.tone}`}>
        <div className="sync-status-row">
          <span className="sync-dot" aria-hidden="true" />
          <span className="sync-status-label">{displayStatus.label}</span>
          <span className="sync-status-time">
            上次同步：{formatSyncTime(snapshot.lastSyncedAt)}
          </span>
        </div>
        {snapshot.message && (
          <p
            className={snapshot.status === "error" ? "sync-error" : "sync-message"}
            role={snapshot.status === "error" ? "alert" : "status"}
          >
            {snapshot.message}
          </p>
        )}
      </div>

      {conflict && !conflictHidden && (
        <div className="sync-conflict" role="region" aria-label="同步冲突">
          <div className="sync-conflict-head">
            本机与云端的进度不一致
          </div>
          <p className="sync-conflict-intro">
            选择前两份记录都会保留，不会自动覆盖；覆盖前也会保留旧版本的副本。
          </p>
          <div className="sync-compare">
            <div className="sync-compare-card is-local">
              <div className="sync-compare-label">本机</div>
              <dl>
                <div>
                  <dt>累计经验</dt>
                  <dd>{conflict.local.progress.xp} XP</dd>
                </div>
                <div>
                  <dt>已完成关卡</dt>
                  <dd>{completedLessons(conflict.local)} 关</dd>
                </div>
                <div>
                  <dt>记录日期</dt>
                  <dd>{formatExportDate(conflict.local.exportedAt)}</dd>
                </div>
              </dl>
            </div>
            <div className="sync-compare-card is-remote">
              <div className="sync-compare-label">云端</div>
              <dl>
                <div>
                  <dt>累计经验</dt>
                  <dd>{conflict.remote.progress.xp} XP</dd>
                </div>
                <div>
                  <dt>已完成关卡</dt>
                  <dd>{completedLessons(conflict.remote)} 关</dd>
                </div>
                <div>
                  <dt>记录日期</dt>
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
              用本机覆盖云端
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleResolve("remote")}
              disabled={busy}
              aria-busy={resolving === "remote" ? "true" : undefined}
            >
              用云端替换本机
            </button>
            <button
              type="button"
              className="sync-conflict-cancel"
              onClick={handlePostponeConflict}
              disabled={busy}
            >
              暂不处理
            </button>
          </div>
          {resolving && (
            <p className="sync-notice" role="status">
              正在处理冲突，请稍候…
            </p>
          )}
        </div>
      )}

      {conflict && conflictHidden && (
        <div className="sync-conflict-pending">
          <span>有未处理的同步冲突，两份记录都还保留着。</span>
          <button
            type="button"
            className="backup-recovery-btn"
            onClick={() => setConflictHidden(false)}
          >
            查看冲突
          </button>
        </div>
      )}

      {recoveries.length > 0 && (
        <section className="sync-recovery" aria-labelledby="sync-recovery-title">
          <div className="sync-recovery-head">
            <h3 className="sync-recovery-title" id="sync-recovery-title">
              最近的同步前副本
            </h3>
            <span className="sync-recovery-saved">
              最多保留 3 份 · 最新在前
            </span>
          </div>
          <p className="sync-recovery-intro">
            同步覆盖或发现冲突前，会自动在本机保留旧记录。副本只包含学习进度，
            不含账号密码；可以导出为备份文件，不会自动替换当前进度。
          </p>
          <div className="sync-recovery-records">
            {recoveries.map((record, index) => {
              const isLatest = index === 0;
              const exportState =
                exporting?.index === index ? exporting.which : null;
              return (
                <div
                  className={`sync-recovery-record${isLatest ? " is-latest" : ""}`}
                  role="group"
                  aria-label={`${formatSyncTime(record.savedAt)} ${RECOVERY_REASON[record.reason]}`}
                  key={`${record.savedAt}-${index}`}
                >
                  <div className="sync-recovery-record-head">
                    <span className="sync-recovery-record-date">
                      {formatSyncTime(record.savedAt)}
                    </span>
                    {isLatest && (
                      <span className="sync-recovery-latest">最新</span>
                    )}
                    <span className="sync-recovery-record-reason">
                      {RECOVERY_REASON[record.reason]}
                    </span>
                  </div>
                  <div
                    className={`sync-recovery-copies${record.remote ? "" : " is-single"}`}
                  >
                    <div className="sync-recovery-card">
                      <div className="sync-recovery-label">本机旧记录</div>
                      <div className="sync-recovery-meta">
                        <span>
                          {record.local.progress.xp} XP ·{" "}
                          {completedLessons(record.local)} 关
                        </span>
                        <span className="sync-recovery-copy-date">
                          记录 {formatExportDate(record.local.exportedAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary sync-recovery-export"
                        onClick={() => handleExportRecovery(index, "local")}
                        disabled={busy}
                        aria-busy={exportState === "local" ? "true" : undefined}
                        aria-label={`导出 ${formatSyncTime(record.savedAt)} 的本机旧记录`}
                      >
                        {exportState === "local" ? "正在导出…" : "导出本机"}
                      </button>
                    </div>
                    {record.remote && (
                      <div className="sync-recovery-card">
                        <div className="sync-recovery-label">云端旧记录</div>
                        <div className="sync-recovery-meta">
                          <span>
                            {record.remote.progress.xp} XP ·{" "}
                            {completedLessons(record.remote)} 关
                          </span>
                          <span className="sync-recovery-copy-date">
                            记录 {formatExportDate(record.remote.exportedAt)}
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
                          aria-label={`导出 ${formatSyncTime(record.savedAt)} 的云端旧记录`}
                        >
                          {exportState === "remote" ? "正在导出…" : "导出云端"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="backup-hint">
            需要恢复其中一份时，可在上方「学习进度备份」中导入刚导出的文件；导入前会再次确认。
          </p>
        </section>
      )}

      <form className="sync-form" onSubmit={handleSave} noValidate>
        <div className="sync-fields">
          <label className="sync-field" htmlFor="sync-url">
            <span className="sync-label">WebDAV 根地址</span>
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
            填写 WebDAV 根地址，http:// 和 https:// 都支持，局域网和自建服务也可以用。
            应用会自动创建 FrenchGrammarExercise/ 文件夹存放同步文件，不需要提前建目录。
          </p>

          <div className="sync-folder">
            <div className="sync-folder-head">
              <span className="sync-label">应用文件夹</span>
              <span className="sync-folder-fixed">自动创建 · 固定不可编辑</span>
            </div>
            <div className="sync-folder-path">FrenchGrammarExercise/</div>
          </div>

          <label className="sync-field" htmlFor="sync-username">
            <span className="sync-label">用户名</span>
            <input
              id="sync-username"
              className="sync-input"
              type="text"
              value={username}
              placeholder="WebDAV 用户名"
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
            <span className="sync-label">应用密码</span>
            <input
              id="sync-password"
              className="sync-input"
              type="password"
              value={password}
              placeholder={
                canReusePassword ? "已保存；留空保持不变" : "请输入应用密码"
              }
              autoComplete="off"
              aria-label="应用密码"
              aria-describedby="sync-password-hint"
              onChange={(event) => {
                setPasswordInput(event.currentTarget.value);
                markEdited();
              }}
            />
          </label>
          <p className="backup-hint" id="sync-password-hint">
            密码只保存在本机的系统安全存储中，不会写入学习进度备份。修改地址或用户名后需要重新输入密码。
          </p>
        </div>

        <label className="sync-auto" htmlFor="sync-auto">
          <input
            id="sync-auto"
            type="checkbox"
            checked={autoSync}
            aria-label="自动同步"
            aria-describedby="sync-auto-hint"
            onChange={(event) => {
              setAutoSync(event.currentTarget.checked);
              markEdited();
            }}
          />
          <span className="sync-auto-track" aria-hidden="true" />
          <span className="sync-auto-copy">
            <strong>自动同步</strong>
            <span id="sync-auto-hint">
              启动、回到前台或学习记录变化后自动尝试同步，随连接设置保存。
            </span>
          </span>
        </label>

        {formError && (
          <p className="sync-error sync-form-error" role="alert">
            {formError}
          </p>
        )}
        {notice && !formError && (
          <p className="sync-notice" role="status">
            {notice}
          </p>
        )}

        <div className="sync-form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy}
            aria-busy={saving ? "true" : undefined}
          >
            {saving ? "正在保存…" : "保存连接"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={!connected || busy}
            aria-busy={syncing || snapshot.status === "syncing" ? "true" : undefined}
          >
            立即同步
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
            {disconnecting ? "正在断开…" : "断开连接"}
          </button>
          <p className="backup-hint">
            只清除本机保存的连接和同步记录，不删除学习进度或云端文件。
          </p>
        </div>
      )}
    </section>
  );
}
