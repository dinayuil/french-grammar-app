import { createBackup } from "../backup/progressBackup";
import type { ProgressBackup } from "../backup/progressBackup";
import {
  formatUserError,
  normalizeUserFacingError,
  type UserFacingError,
} from "../i18n/errors";
import type { Progress } from "../types";
import {
  clearSyncBaseline,
  readSyncBaseline,
  writeSyncBaseline,
  writeSyncRecovery,
} from "./storage";
import {
  buildGetRequest,
  buildMkcolRequest,
  buildPropfindRequest,
  buildPutRequest,
  getStrongEtag,
  hasLearningProgress,
  isDavCollectionPropfind,
  parseSyncDocument,
  sameProgress,
} from "./webdav";
import type {
  SyncAdapter,
  SyncConfig,
  SyncConflict,
  SyncSettings,
  SyncSnapshot,
} from "./types";

/** 本机变更后的合并延迟;学习计时每 5 秒变更也不能把它无限推后。 */
export const LOCAL_CHANGE_DELAY_MS = 15_000;
/** 412/条件失败后最多重新比较的次数,避免极端竞争下热循环。 */
const MAX_COMPARE_ATTEMPTS = 3;

export interface SyncControllerOptions {
  adapter: SyncAdapter;
  getProgress: () => Progress;
  applyProgress: (progress: Progress) => void;
  canApplyRemote?: () => boolean;
  storage?: Storage;
}

export interface SyncController {
  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void;
  getSnapshot(): SyncSnapshot;
  initialize(): Promise<void>;
  configure(settings: SyncSettings, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  resolveConflict(choice: "local" | "remote"): Promise<void>;
  notifyLocalChange(): void;
  dispose(): void;
}

interface SyncAccount {
  url: string;
  username: string;
}

type UploadResult = "ok" | "retry" | "failed";

function diagnosticOf(error: unknown): string | undefined {
  return normalizeUserFacingError(error).diagnostic;
}

function zhMessage(error: UserFacingError): string {
  return formatUserError(error, "zh-CN").message;
}

function nowIso(): string {
  return new Date().toISOString();
}

function httpError(status: number): UserFacingError {
  if (status === 401 || status === 403) {
    return { code: "sync.error.http_auth" };
  }
  if (status === 404) {
    return { code: "sync.error.http_not_found" };
  }
  if (status >= 300 && status < 400) {
    return { code: "sync.error.http_redirect" };
  }
  if (status === 412) {
    return { code: "sync.error.http_conflict" };
  }
  if (status === 507) {
    return { code: "sync.error.http_storage_full" };
  }
  return { code: "sync.error.http_generic", params: { status } };
}

function isSuccess(status: number): boolean {
  return status === 200 || status === 201 || status === 204;
}

export function createSyncController(
  options: SyncControllerOptions
): SyncController {
  const storage: Storage | null =
    options.storage ??
    (() => {
      try {
        return typeof localStorage === "undefined" ? null : localStorage;
      } catch {
        return null;
      }
    })();

  let snapshot: SyncSnapshot = {
    status: "disabled",
    config: null,
    message: "",
    error: null,
    notice: null,
    lastSyncedAt: null,
    conflict: null,
  };
  const listeners = new Set<(snapshot: SyncSnapshot) => void>();
  let generation = 0;
  let disposed = false;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let queueTail: Promise<void> = Promise.resolve();
  /** 原生写入/断开按调用顺序串行,保证最后一次配置操作最终生效。 */
  let configTail: Promise<void> = Promise.resolve();
  /** 配置/断开进行中:禁止旧 snapshot 发起任何新同步。 */
  let configTransition = 0;
  /** 基线清理失败后 fail closed,重置成功前不再同步。 */
  let baselineBlocked = false;
  /** 原生配置已写入但未能确认/发布新配置时,禁止用旧 snapshot 发起网络。 */
  let configBlocked = false;
  /** 应用目录已为哪个 generation 成功创建/验证;换配置必须重新准备。 */
  let preparedGeneration: number | null = null;
  /** disconnect 后必须重新建立基线,即使随后重连的是同一个账号。 */
  let reconnectRequired = false;
  /** 云端有更新但当前学习视图不允许应用;避免学习计时不断触发请求。 */
  let deferred = false;
  let initializePromise: Promise<void> | null = null;

  function emit(): void {
    if (disposed) return;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // 单个订阅者异常不影响同步状态机。
      }
    }
  }

  /** 只有字段真正变化才替换快照对象,满足 useSyncExternalStore 的稳定身份要求。 */
  function commit(changes: Partial<SyncSnapshot>): void {
    if (disposed) return;
    let changed = false;
    for (const key of Object.keys(changes) as (keyof SyncSnapshot)[]) {
      if (!Object.is(snapshot[key], changes[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...changes };
    emit();
  }

  function fail(
    code: string,
    params?: Record<string, string | number>,
    diagnostic?: string
  ): void {
    const error: UserFacingError = {
      code,
      ...(params ? { params } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
    commit({
      status: "error",
      message: zhMessage(error),
      error,
      notice: null,
    });
  }

  function notice(
    code: string,
    params?: Record<string, string | number>
  ): UserFacingError {
    return {
      code,
      ...(params ? { params } : {}),
    };
  }

  /** 优先保留原生稳定错误码；旧桥字符串仍落到本层 fallback 业务码。 */
  function failFrom(error: unknown, fallbackCode: string): void {
    const normalized = normalizeUserFacingError(error);
    if (normalized.code.startsWith("native.")) {
      commit({
        status: "error",
        message: zhMessage(normalized),
        error: normalized,
        notice: null,
      });
      return;
    }
    fail(fallbackCode, undefined, normalized.diagnostic);
  }

  function clearLocalTimer(): void {
    if (localTimer !== null) {
      clearTimeout(localTimer);
      localTimer = null;
    }
  }

  function isCurrent(token: number): boolean {
    return !disposed && token === generation;
  }

  function canApplyRemote(): boolean {
    if (!options.canApplyRemote) return true;
    try {
      return options.canApplyRemote();
    } catch {
      return false;
    }
  }

  function readLocalBackup(): ProgressBackup | null {
    try {
      return createBackup(options.getProgress());
    } catch {
      return null;
    }
  }

  function localStillMatches(expected: ProgressBackup): boolean {
    try {
      return sameProgress(expected.progress, options.getProgress());
    } catch {
      return false;
    }
  }

  /** 保存基线成功返回同步时间;失败已写入 error 快照并返回 null。 */
  function saveBaseline(
    account: SyncAccount,
    progress: Progress,
    etag: string
  ): string | null {
    const syncedAt = nowIso();
    try {
      writeSyncBaseline(storage, account, { etag, progress, syncedAt });
      return syncedAt;
    } catch (error) {
      fail("sync.error.baseline_save_failed", undefined, diagnosticOf(error));
      return null;
    }
  }

  function saveRecovery(
    account: SyncAccount,
    local: ProgressBackup,
    remote: ProgressBackup | null,
    reason: "conflict" | "remote-apply" | "local-overwrite" | "remote-overwrite"
  ): boolean {
    try {
      writeSyncRecovery(storage, account, {
        savedAt: nowIso(),
        reason,
        local,
        remote,
      });
      return true;
    } catch (error) {
      fail("sync.error.recovery_save_failed", undefined, diagnosticOf(error));
      return false;
    }
  }

  function recordConflict(
    account: SyncAccount,
    local: ProgressBackup,
    remote: ProgressBackup,
    remoteEtag: string
  ): void {
    const conflict: SyncConflict = { local, remote, remoteEtag };
    const baseMessage = zhMessage({ code: "sync.message.conflict" });
    let message = baseMessage;
    let recoveryDiagnostic: string | undefined;
    try {
      writeSyncRecovery(storage, account, {
        savedAt: nowIso(),
        reason: "conflict",
        local,
        remote,
      });
    } catch {
      recoveryDiagnostic = "恢复副本保存失败，请先导出备份";
      message += `（${recoveryDiagnostic}）`;
    }
    deferred = false;
    commit({
      status: "conflict",
      message,
      error: null,
      notice: {
        code: "sync.message.conflict",
        ...(recoveryDiagnostic ? { diagnostic: recoveryDiagnostic } : {}),
      },
      conflict,
    });
  }

  async function requestGet(token: number): Promise<
    | { kind: "ok"; response: Awaited<ReturnType<SyncAdapter["request"]>> }
    | { kind: "error" }
  > {
    try {
      return { kind: "ok", response: await options.adapter.request(buildGetRequest()) };
    } catch (error) {
      if (isCurrent(token)) failFrom(error, "sync.error.network_failed");
      return { kind: "error" };
    }
  }

  /**
   * 覆盖已完成但服务器未在 PUT 响应中给出强 ETag:再 GET 一次确认版本。
   * 内容已被其他设备改写时返回 retry,让调用方重新比较。
   */
  async function confirmWrite(
    expected: ProgressBackup,
    token: number
  ): Promise<string | null | "retry"> {
    const result = await requestGet(token);
    if (!isCurrent(token)) return null;
    if (result.kind === "error") return null;
    const response = result.response;
    if (response.status !== 200) {
      fail("sync.error.upload_unconfirmed");
      return null;
    }
    let remote: ProgressBackup;
    try {
      remote = parseSyncDocument(response.body);
    } catch (error) {
      fail("sync.error.upload_invalid", undefined, diagnosticOf(error));
      return null;
    }
    const etag = getStrongEtag(response.headers);
    if (!etag) {
      fail("sync.error.etag_missing_upload");
      return null;
    }
    if (!sameProgress(remote.progress, expected.progress)) return "retry";
    return etag;
  }

  async function upload(
    account: SyncAccount,
    local: ProgressBackup,
    condition: { ifMatch: string } | { ifNoneMatch: "*" },
    token: number
  ): Promise<UploadResult> {
    if (!isCurrent(token)) return "failed";
    let response;
    try {
      response = await options.adapter.request(
        buildPutRequest(local, condition)
      );
    } catch (error) {
      if (isCurrent(token)) {
        failFrom(error, "sync.error.upload_failed");
      }
      return "failed";
    }
    if (!isCurrent(token)) return "failed";
    if (response.status === 412) return "retry";
    if (!isSuccess(response.status)) {
      if (isCurrent(token)) {
        const http = httpError(response.status);
        fail(http.code, http.params);
      }
      return "failed";
    }

    let etag = getStrongEtag(response.headers);
    if (!etag) {
      const confirmed = await confirmWrite(local, token);
      if (!isCurrent(token)) return "failed";
      if (confirmed === "retry") return "retry";
      if (!confirmed) return "failed";
      etag = confirmed;
    }

    const syncedAt = saveBaseline(account, local.progress, etag);
    if (!syncedAt) return "failed";
    const messageCode = localStillMatches(local)
      ? "sync.message.synced"
      : "sync.message.uploaded_local_changes";
    deferred = false;
    commit({
      status: "synced",
      message: zhMessage({ code: messageCode }),
      error: null,
      notice: notice(messageCode),
      lastSyncedAt: syncedAt,
      conflict: null,
    });
    return "ok";
  }

  function applyRemote(
    account: SyncAccount,
    localBefore: ProgressBackup,
    remote: ProgressBackup,
    etag: string,
    reason: "remote-apply" | "remote-overwrite",
    token: number
  ): void {
    if (!isCurrent(token)) return;
    if (!localStillMatches(localBefore)) {
      commit({
        status: "idle",
        message: zhMessage({ code: "sync.message.local_changed" }),
        error: null,
        notice: notice("sync.message.local_changed"),
      });
      return;
    }
    if (!canApplyRemote()) {
      deferred = true;
      commit({
        status: snapshot.conflict ? "conflict" : "idle",
        message: zhMessage({ code: "sync.message.busy_learning" }),
        error: null,
        notice: notice("sync.message.busy_learning"),
      });
      return;
    }
    if (!saveRecovery(account, localBefore, remote, reason)) return;
    try {
      options.applyProgress(remote.progress);
    } catch {
      fail("sync.error.apply_failed");
      return;
    }
    const syncedAt = saveBaseline(account, remote.progress, etag);
    if (!syncedAt) {
      fail("sync.error.apply_baseline_failed");
      return;
    }
    deferred = false;
    commit({
      status: "synced",
      message: zhMessage({ code: "sync.message.remote_applied" }),
      error: null,
      notice: notice("sync.message.remote_applied"),
      lastSyncedAt: syncedAt,
      conflict: null,
    });
  }

  /**
   * 每个确认的配置 generation 只准备一次应用目录:MKCOL 201 成功;
   * 405 必须再用 Depth:0 PROPFIND 验证 207 collection。失败即停止本次同步,
   * 绝不对用户根目录执行 GET/PUT。
   */
  async function ensureDirectory(token: number): Promise<boolean> {
    if (preparedGeneration === token) return true;
    if (!isCurrent(token) || configTransition > 0 || configBlocked) {
      return false;
    }

    let mkcol;
    try {
      mkcol = await options.adapter.request(buildMkcolRequest());
    } catch (error) {
      if (isCurrent(token)) {
        failFrom(error, "sync.error.mkdir_failed");
      }
      return false;
    }
    if (!isCurrent(token) || configTransition > 0 || configBlocked) {
      return false;
    }
    if (mkcol.status === 201) {
      preparedGeneration = token;
      return true;
    }
    if (mkcol.status !== 405) {
      fail("sync.error.mkdir_http", { status: mkcol.status });
      return false;
    }

    let propfind;
    try {
      propfind = await options.adapter.request(buildPropfindRequest());
    } catch (error) {
      if (isCurrent(token)) {
        failFrom(error, "sync.error.dir_verify_failed");
      }
      return false;
    }
    if (!isCurrent(token) || configTransition > 0 || configBlocked) {
      return false;
    }
    if (
      propfind.status === 207 &&
      isDavCollectionPropfind(propfind.body)
    ) {
      preparedGeneration = token;
      return true;
    }

    fail("sync.error.dir_invalid");
    return false;
  }

  async function performSync(): Promise<void> {
    const token = generation;
    if (!isCurrent(token)) return;
    // 配置/断开期间,旧 snapshot 绝不能发起网络请求。
    if (configTransition > 0) return;
    if (configBlocked) {
      fail("sync.error.config_pending");
      return;
    }
    if (baselineBlocked) {
      fail("sync.error.baseline_blocked");
      return;
    }
    const config = snapshot.config;
    if (!config) {
      commit({
        status: "disabled",
        message: zhMessage({ code: "sync.message.not_configured" }),
        error: null,
        notice: notice("sync.message.not_configured"),
      });
      return;
    }
    if (!storage) {
      fail("sync.error.storage_unsupported");
      return;
    }
    if (!config.hasPassword) {
      fail("sync.error.credentials_required");
      return;
    }

    deferred = false;
    commit({
      status: "syncing",
      message: zhMessage({ code: "sync.message.syncing" }),
      error: null,
      notice: notice("sync.message.syncing"),
    });

    const account: SyncAccount = { url: config.url, username: config.username };
    let local = readLocalBackup();
    if (!local) {
      fail("sync.error.local_read_failed");
      return;
    }

    if (!(await ensureDirectory(token))) return;
    if (!isCurrent(token)) return;

    for (let attempt = 0; attempt < MAX_COMPARE_ATTEMPTS; attempt += 1) {
      if (!isCurrent(token)) return;

      const result = await requestGet(token);
      if (!isCurrent(token)) return;
      if (result.kind === "error") return;

      const response = result.response;

      if (response.status === 404) {
        const baseline = readSyncBaseline(storage, account);
        if (baseline) {
          fail("sync.error.remote_missing_auto");
          return;
        }
        if (!localStillMatches(local)) {
          commit({
            status: "idle",
            message: zhMessage({ code: "sync.message.local_changed" }),
            error: null,
            notice: notice("sync.message.local_changed"),
          });
          return;
        }
        if (!hasLearningProgress(local.progress)) {
          commit({
            status: "idle",
            message: zhMessage({ code: "sync.message.remote_missing" }),
            error: null,
            notice: notice("sync.message.remote_missing"),
          });
          return;
        }
        const uploaded = await upload(
          account,
          local,
          { ifNoneMatch: "*" },
          token
        );
        if (uploaded === "retry") continue;
        return;
      }

      if (response.status !== 200) {
        const http = httpError(response.status);
        fail(http.code, http.params);
        return;
      }

      let remote: ProgressBackup;
      try {
        remote = parseSyncDocument(response.body);
      } catch (error) {
        fail("sync.error.remote_invalid", undefined, diagnosticOf(error));
        return;
      }
      const remoteEtag = getStrongEtag(response.headers);
      if (!remoteEtag) {
        fail("sync.error.etag_missing_auto");
        return;
      }

      if (!localStillMatches(local)) {
        commit({
          status: "idle",
          message: zhMessage({ code: "sync.message.local_changed" }),
          error: null,
          notice: notice("sync.message.local_changed"),
        });
        return;
      }

      const baseline = readSyncBaseline(storage, account);

      if (baseline) {
        const baselineHasProgress = hasLearningProgress(baseline.progress);
        const localHasProgress = hasLearningProgress(local.progress);
        const remoteHasProgress = hasLearningProgress(remote.progress);
        const localChanged = !sameProgress(local.progress, baseline.progress);
        const remoteChanged = !sameProgress(remote.progress, baseline.progress);

        if (!localHasProgress && baselineHasProgress) {
          if (remoteChanged && remoteHasProgress) {
            // 本机被重置为空、云端也有新进度:交给用户选择,绝不自动推送空进度。
            recordConflict(account, local, remote, remoteEtag);
            return;
          }
          fail("sync.error.local_empty");
          return;
        }

        if (!remoteHasProgress && baselineHasProgress) {
          if (localChanged) {
            recordConflict(account, local, remote, remoteEtag);
            return;
          }
          fail("sync.error.remote_empty");
          return;
        }

        if (!localChanged && !remoteChanged) {
          const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
          if (!syncedAt) return;
          commit({
            status: "synced",
            message: zhMessage({ code: "sync.message.remote_current" }),
            error: null,
            notice: notice("sync.message.remote_current"),
            lastSyncedAt: syncedAt,
            conflict: null,
          });
          return;
        }

        if (localChanged && !remoteChanged) {
          const uploaded = await upload(
            account,
            local,
            { ifMatch: remoteEtag },
            token
          );
          if (uploaded === "retry") continue;
          return;
        }

        if (!localChanged && remoteChanged) {
          if (!remoteHasProgress && !localHasProgress) {
            const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
            if (!syncedAt) return;
            commit({
              status: "synced",
              message: zhMessage({ code: "sync.message.both_empty" }),
              error: null,
              notice: notice("sync.message.both_empty"),
              lastSyncedAt: syncedAt,
              conflict: null,
            });
            return;
          }
          applyRemote(account, local, remote, remoteEtag, "remote-apply", token);
          return;
        }

        if (sameProgress(local.progress, remote.progress)) {
          const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
          if (!syncedAt) return;
          commit({
            status: "synced",
            message: zhMessage({ code: "sync.message.in_sync" }),
            error: null,
            notice: notice("sync.message.in_sync"),
            lastSyncedAt: syncedAt,
            conflict: null,
          });
          return;
        }

        recordConflict(account, local, remote, remoteEtag);
        return;
      }

      // 首次连接(没有共同基线)。
      if (sameProgress(local.progress, remote.progress)) {
        const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
        if (!syncedAt) return;
        commit({
          status: "synced",
          message: zhMessage({ code: "sync.message.in_sync" }),
          error: null,
          notice: notice("sync.message.in_sync"),
          lastSyncedAt: syncedAt,
          conflict: null,
        });
        return;
      }

      const localHasProgress = hasLearningProgress(local.progress);
      const remoteHasProgress = hasLearningProgress(remote.progress);

      if (!localHasProgress && remoteHasProgress) {
        applyRemote(account, local, remote, remoteEtag, "remote-apply", token);
        return;
      }

      if (localHasProgress && !remoteHasProgress) {
        const uploaded = await upload(
          account,
          local,
          { ifMatch: remoteEtag },
          token
        );
        if (uploaded === "retry") continue;
        return;
      }

      if (!localHasProgress && !remoteHasProgress) {
        const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
        if (!syncedAt) return;
        commit({
          status: "synced",
          message: zhMessage({ code: "sync.message.both_empty" }),
          error: null,
          notice: notice("sync.message.both_empty"),
          lastSyncedAt: syncedAt,
          conflict: null,
        });
        return;
      }

      recordConflict(account, local, remote, remoteEtag);
      return;
    }

    fail("sync.error.too_many_changes");
  }

  function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
    const run = queueTail.then(task, task);
    queueTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function enqueueConfigTask<T>(task: () => Promise<T>): Promise<T> {
    const run = configTail.then(task, task);
    configTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function enqueueSync(): Promise<void> {
    return enqueueTask(async () => {
      if (disposed) return;
      const token = generation;
      try {
        await performSync();
      } catch (error) {
        if (isCurrent(token)) {
          failFrom(error, "sync.error.failed");
        }
      }
    });
  }

  /** 配置/断开后旧请求立即失效,新同步不等待可能超时的旧网络请求。 */
  function resetQueue(): void {
    queueTail = Promise.resolve();
  }

  async function doInitialize(): Promise<void> {
    const token = generation;
    let loaded: SyncConfig | null;
    try {
      loaded = await options.adapter.readConfig();
    } catch (error) {
      if (isCurrent(token)) failFrom(error, "sync.error.config_read_failed");
      return;
    }
    if (!isCurrent(token)) return;

    if (!loaded) {
      commit({
        status: "disabled",
        config: null,
        message: zhMessage({ code: "sync.message.not_configured" }),
        error: null,
        notice: notice("sync.message.not_configured"),
        conflict: null,
      });
      return;
    }

    commit({
      status: "idle",
      config: loaded,
      message: "",
      error: null,
      notice: null,
      conflict: null,
    });
    if (loaded.autoSync) {
      await enqueueSync();
    }
  }

  async function configure(
    settings: SyncSettings,
    password?: string
  ): Promise<void> {
    if (disposed) return;
    generation += 1;
    const token = generation;
    clearLocalTimer();
    resetQueue();
    configTransition += 1;
    preparedGeneration = null;
    const previous = snapshot.config;
    let shouldSync = false;

    try {
      await enqueueConfigTask(async () => {
        if (!isCurrent(token)) return;
        try {
          await options.adapter.writeConfig(settings, password);
        } catch (error) {
          if (isCurrent(token)) {
            failFrom(error, "sync.error.config_save_failed");
          }
          return;
        }
        // 原生写入已成功;即使随后被新操作取代,旧 snapshot 也不得再用于网络。
        configBlocked = true;
        if (!isCurrent(token)) return;

        // 使用原生写回并校验/规范化后的配置,不要依赖 UI 原始字符串。
        let loaded: SyncConfig | null;
        try {
          loaded = await options.adapter.readConfig();
        } catch (error) {
          if (isCurrent(token)) failFrom(error, "sync.error.config_read_failed");
          return;
        }
        if (!isCurrent(token)) return;
        if (!loaded) {
          fail("sync.error.config_readback_failed");
          return;
        }
        configBlocked = false;

        const sameAccount =
          previous !== null &&
          previous.url === loaded.url &&
          previous.username === loaded.username;
        const mustResetBaseline =
          reconnectRequired || baselineBlocked || !sameAccount;

        if (mustResetBaseline) {
          try {
            clearSyncBaseline(storage, loaded);
            if (previous) clearSyncBaseline(storage, previous);
          } catch (error) {
            if (!isCurrent(token)) return;
            baselineBlocked = true;
            const userError: UserFacingError = {
              code: "sync.error.baseline_reset_failed",
              ...(diagnosticOf(error)
                ? { diagnostic: diagnosticOf(error) }
                : {}),
            };
            commit({
              status: "error",
              config: loaded,
              message: zhMessage(userError),
              error: userError,
              notice: null,
              lastSyncedAt: null,
              conflict: null,
            });
            return;
          }
          baselineBlocked = false;
          reconnectRequired = false;
        }

        if (!isCurrent(token)) return;
        deferred = false;
        commit({
          status: "idle",
          config: loaded,
          message: zhMessage({ code: "sync.message.config_saved" }),
          error: null,
          notice: notice("sync.message.config_saved"),
          lastSyncedAt: mustResetBaseline ? null : snapshot.lastSyncedAt,
          conflict: null,
        });
        shouldSync = true;
      });
    } finally {
      configTransition -= 1;
    }

    if (shouldSync && isCurrent(token) && configTransition === 0) {
      await enqueueSync();
    }
  }

  async function disconnect(): Promise<void> {
    if (disposed) return;
    generation += 1;
    const token = generation;
    clearLocalTimer();
    resetQueue();
    configTransition += 1;
    reconnectRequired = true;
    preparedGeneration = null;
    const previous = snapshot.config;

    try {
      await enqueueConfigTask(async () => {
        if (!isCurrent(token)) return;
        try {
          await options.adapter.disconnect();
        } catch (error) {
          if (isCurrent(token)) {
            failFrom(error, "sync.error.disconnect_failed");
          }
          return;
        }
        if (!isCurrent(token)) return;
        // 断开过程中的请求同样必须过期,不能拿到结果后写回进度。
        generation += 1;
        // 原生断开已确认;旧配置不再可用于同步。
        configBlocked = false;

        let cleared = true;
        let message = zhMessage({ code: "sync.message.disconnected" });
        let cleanupDiagnostic: string | undefined;
        if (previous) {
          try {
            clearSyncBaseline(storage, previous);
            baselineBlocked = false;
            reconnectRequired = false;
          } catch (error) {
            cleared = false;
            baselineBlocked = true;
            cleanupDiagnostic = diagnosticOf(error);
            message = zhMessage({
              code: "sync.message.disconnect_baseline_failed",
            });
          }
        }
        deferred = false;
        const disconnectError: UserFacingError = {
          code: cleared
            ? "sync.message.disconnected"
            : "sync.message.disconnect_baseline_failed",
          ...(cleanupDiagnostic ? { diagnostic: cleanupDiagnostic } : {}),
        };
        commit({
          status: cleared ? "disabled" : "error",
          config: null,
          message,
          error: cleared ? null : disconnectError,
          notice: cleared ? disconnectError : null,
          lastSyncedAt: null,
          conflict: null,
        });
      });
    } finally {
      configTransition -= 1;
    }
  }

  function announceStaleConflict(): void {
    if (snapshot.conflict) {
      commit({
        status: "conflict",
        message: zhMessage({ code: "sync.message.conflict_updated" }),
        error: null,
        notice: notice("sync.message.conflict_updated"),
      });
    } else {
      commit({
        message: zhMessage({ code: "sync.message.conflict_handled" }),
        error: null,
        notice: notice("sync.message.conflict_handled"),
      });
    }
  }

  /** 调用时绑定冲突对象与 generation;排队后旧选择不得作用于新冲突。 */
  function resolveConflict(choice: "local" | "remote"): Promise<void> {
    const requestedConflict = snapshot.conflict;
    if (!requestedConflict) return Promise.resolve();
    const token = generation;
    return enqueueTask(async () => {
      if (!isCurrent(token)) {
        if (snapshot.conflict === requestedConflict) {
          commit({
            status: "conflict",
            message: zhMessage({ code: "sync.message.conflict_config_changed" }),
            error: null,
            notice: notice("sync.message.conflict_config_changed"),
          });
        }
        return;
      }
      if (configTransition > 0) return;
      if (configBlocked) {
        commit({
          message: zhMessage({ code: "sync.message.config_pending" }),
          error: null,
          notice: notice("sync.message.config_pending"),
        });
        return;
      }
      if (snapshot.conflict !== requestedConflict) {
        announceStaleConflict();
        return;
      }
      await resolveConflictNow(choice, requestedConflict, token);
    });
  }

  async function resolveConflictNow(
    choice: "local" | "remote",
    conflict: SyncConflict,
    token: number
  ): Promise<void> {
    const config = snapshot.config;
    if (!config || !isCurrent(token) || configTransition > 0) return;
    if (configBlocked) {
      commit({
        message: zhMessage({ code: "sync.message.config_pending" }),
        error: null,
        notice: notice("sync.message.config_pending"),
      });
      return;
    }
    if (baselineBlocked) {
      fail("sync.error.baseline_blocked");
      return;
    }
    if (snapshot.conflict !== conflict) {
      announceStaleConflict();
      return;
    }
    if (!storage) {
      fail("sync.error.conflict_storage_unsupported");
      return;
    }

    if (!(await ensureDirectory(token))) return;
    if (!isCurrent(token)) return;

    const account: SyncAccount = { url: config.url, username: config.username };

    if (choice === "local") {
      commit({
        status: "syncing",
        message: zhMessage({ code: "sync.message.overwriting_cloud" }),
        error: null,
        notice: notice("sync.message.overwriting_cloud"),
      });
      if (!saveRecovery(account, conflict.local, conflict.remote, "local-overwrite")) {
        // 保留旧云端内容是覆盖的前置条件;失败时保持冲突可选择重试。
        commit({ status: "conflict" });
        return;
      }
      if (!isCurrent(token) || snapshot.conflict !== conflict) {
        if (isCurrent(token)) announceStaleConflict();
        return;
      }
      const uploaded = await upload(
        account,
        conflict.local,
        { ifMatch: conflict.remoteEtag },
        token
      );
      if (uploaded === "retry") {
        await performSync();
      } else if (uploaded === "failed" && isCurrent(token) && snapshot.status === "syncing") {
        fail("sync.error.overwrite_failed");
      }
      return;
    }

    if (!canApplyRemote()) {
      deferred = true;
      commit({
        status: "conflict",
        message: zhMessage({ code: "sync.message.busy_learning" }),
        error: null,
        notice: notice("sync.message.busy_learning"),
      });
      return;
    }

    commit({
      status: "syncing",
      message: zhMessage({ code: "sync.message.confirming_remote" }),
      error: null,
      notice: notice("sync.message.confirming_remote"),
    });
    const result = await requestGet(token);
    if (!isCurrent(token)) return;
    if (configTransition > 0) return;
    if (snapshot.conflict !== conflict) {
      announceStaleConflict();
      return;
    }
    if (result.kind === "error") return;
    const response = result.response;
    if (response.status !== 200) {
      const http = httpError(response.status);
      fail(http.code, http.params);
      return;
    }
    let remote: ProgressBackup;
    try {
      remote = parseSyncDocument(response.body);
    } catch (error) {
      fail("sync.error.remote_invalid", undefined, diagnosticOf(error));
      return;
    }
    const remoteEtag = getStrongEtag(response.headers);
    if (!remoteEtag) {
      fail("sync.error.etag_missing_auto");
      return;
    }
    if (
      remoteEtag !== conflict.remoteEtag ||
      !sameProgress(remote.progress, conflict.remote.progress)
    ) {
      // 云端在用户选择后变化,必须重新比较,不能应用已过期的展示版本。
      await performSync();
      return;
    }

    if (!localStillMatches(conflict.local)) {
      // 本机在请求期间变化,不得被展示的旧云端版本覆盖。
      await performSync();
      return;
    }

    if (!isCurrent(token) || snapshot.conflict !== conflict) {
      if (isCurrent(token)) announceStaleConflict();
      return;
    }

    applyRemote(
      account,
      conflict.local,
      remote,
      remoteEtag,
      "remote-overwrite",
      token
    );
  }

  return {
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    initialize() {
      if (disposed) return Promise.resolve();
      if (!initializePromise) initializePromise = doInitialize();
      return initializePromise;
    },
    configure,
    disconnect,
    sync() {
      if (disposed) return Promise.resolve();
      return enqueueSync();
    },
    resolveConflict,
    notifyLocalChange() {
      if (disposed) return;
      if (configTransition > 0 || configBlocked || baselineBlocked) return;
      const config = snapshot.config;
      if (!config || !config.autoSync) return;
      if (deferred) return;
      if (localTimer !== null) return;
      localTimer = setTimeout(() => {
        localTimer = null;
        if (!disposed) void enqueueSync();
      }, LOCAL_CHANGE_DELAY_MS);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearLocalTimer();
      listeners.clear();
    },
  };
}
