import { createBackup } from "../backup/progressBackup";
import type { ProgressBackup } from "../backup/progressBackup";
import type { Progress } from "../types";
import {
  SyncStorageError,
  clearSyncBaseline,
  readSyncBaseline,
  writeSyncBaseline,
  writeSyncRecovery,
} from "./storage";
import {
  SyncError,
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof SyncStorageError || error instanceof SyncError) {
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function httpMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "云端认证失败，请检查用户名与应用密码";
  }
  if (status === 404) {
    return "云端同步目录或文件不存在，请检查 WebDAV 地址";
  }
  if (status >= 300 && status < 400) {
    return "云端重定向被拒绝，请检查 WebDAV 地址";
  }
  if (status === 412) {
    return "云端进度已被其他设备修改，正在重新比较";
  }
  if (status === 507) {
    return "云端存储空间不足";
  }
  return `云端请求失败（HTTP ${status}）`;
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

  function fail(message: string): void {
    commit({ status: "error", message });
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
      fail(errorMessage(error, "保存同步基线失败，请检查本地存储空间"));
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
      fail(errorMessage(error, "保存同步恢复副本失败，请检查本地存储空间"));
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
    let message = "云端与本机都有新的学习进度，请选择保留哪一份";
    try {
      writeSyncRecovery(storage, account, {
        savedAt: nowIso(),
        reason: "conflict",
        local,
        remote,
      });
    } catch {
      message += "（恢复副本保存失败，请先导出备份）";
    }
    deferred = false;
    commit({ status: "conflict", message, conflict });
  }

  async function requestGet(token: number): Promise<
    | { kind: "ok"; response: Awaited<ReturnType<SyncAdapter["request"]>> }
    | { kind: "error" }
  > {
    try {
      return { kind: "ok", response: await options.adapter.request(buildGetRequest()) };
    } catch {
      if (isCurrent(token)) fail("连接云端失败，请检查网络与服务器地址");
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
      fail("已上传学习进度，但无法确认云端版本");
      return null;
    }
    let remote: ProgressBackup;
    try {
      remote = parseSyncDocument(response.body);
    } catch (error) {
      fail(errorMessage(error, "已上传学习进度，但云端内容无法确认"));
      return null;
    }
    const etag = getStrongEtag(response.headers);
    if (!etag) {
      fail("已上传学习进度，但云端未返回强 ETag，已停止自动覆盖");
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
        fail(errorMessage(error, "上传学习进度失败，请检查网络与服务器地址"));
      }
      return "failed";
    }
    if (!isCurrent(token)) return "failed";
    if (response.status === 412) return "retry";
    if (!isSuccess(response.status)) {
      if (isCurrent(token)) fail(httpMessage(response.status));
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
    const message = localStillMatches(local)
      ? "已同步"
      : "已上传学习进度，本机还有新的变更";
    deferred = false;
    commit({
      status: "synced",
      message,
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
        message: "本机学习进度在同步期间发生变化，稍后再同步",
      });
      return;
    }
    if (!canApplyRemote()) {
      deferred = true;
      commit({
        status: snapshot.conflict ? "conflict" : "idle",
        message: "正在练习或阅读，稍后再应用云端学习进度",
      });
      return;
    }
    if (!saveRecovery(account, localBefore, remote, reason)) return;
    try {
      options.applyProgress(remote.progress);
    } catch {
      fail("应用云端学习进度失败，已保留本机原进度");
      return;
    }
    const syncedAt = saveBaseline(account, remote.progress, etag);
    if (!syncedAt) {
      fail("已应用云端学习进度，但保存同步基线失败");
      return;
    }
    deferred = false;
    commit({
      status: "synced",
      message: "已从云端恢复学习进度",
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
    } catch {
      if (isCurrent(token)) {
        fail("创建云端应用目录失败，请检查网络与服务器权限");
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
      fail(`创建云端应用目录失败（HTTP ${mkcol.status}）`);
      return false;
    }

    let propfind;
    try {
      propfind = await options.adapter.request(buildPropfindRequest());
    } catch {
      if (isCurrent(token)) {
        fail("验证云端应用目录失败，请检查网络与服务器权限");
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

    fail("云端应用目录不是可用的 WebDAV collection，已停止同步");
    return false;
  }

  async function performSync(): Promise<void> {
    const token = generation;
    if (!isCurrent(token)) return;
    // 配置/断开期间,旧 snapshot 绝不能发起网络请求。
    if (configTransition > 0) return;
    if (configBlocked) {
      fail("同步配置变更尚未确认，已停止同步");
      return;
    }
    if (baselineBlocked) {
      fail("本地同步基线无法重置，已停止同步");
      return;
    }
    const config = snapshot.config;
    if (!config) {
      commit({ status: "disabled", message: "尚未配置同步" });
      return;
    }
    if (!storage) {
      fail("当前环境不支持本地存储，无法记录同步基线");
      return;
    }
    if (!config.hasPassword) {
      fail("同步配置缺少密码，请重新保存同步配置");
      return;
    }

    deferred = false;
    commit({ status: "syncing", message: "正在同步…" });

    const account: SyncAccount = { url: config.url, username: config.username };
    let local = readLocalBackup();
    if (!local) {
      fail("读取本机学习进度失败，已停止同步");
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
          fail("云端同步文件不存在，已停止自动同步");
          return;
        }
        if (!localStillMatches(local)) {
          commit({
            status: "idle",
            message: "本机学习进度在同步期间发生变化，稍后再同步",
          });
          return;
        }
        if (!hasLearningProgress(local.progress)) {
          commit({
            status: "idle",
            message: "云端尚无学习进度文件，本机有进度后再同步",
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
        fail(httpMessage(response.status));
        return;
      }

      let remote: ProgressBackup;
      try {
        remote = parseSyncDocument(response.body);
      } catch (error) {
        fail(errorMessage(error, "云端同步文件无效，已停止自动同步"));
        return;
      }
      const remoteEtag = getStrongEtag(response.headers);
      if (!remoteEtag) {
        fail("云端未返回强 ETag，已停止自动覆盖与恢复");
        return;
      }

      if (!localStillMatches(local)) {
        commit({
          status: "idle",
          message: "本机学习进度在同步期间发生变化，稍后再同步",
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
          fail("本机学习进度为空，已停止自动同步以避免覆盖云端");
          return;
        }

        if (!remoteHasProgress && baselineHasProgress) {
          if (localChanged) {
            recordConflict(account, local, remote, remoteEtag);
            return;
          }
          fail("云端学习进度为空，已停止自动恢复以避免清空本机");
          return;
        }

        if (!localChanged && !remoteChanged) {
          const syncedAt = saveBaseline(account, remote.progress, remoteEtag);
          if (!syncedAt) return;
          commit({
            status: "synced",
            message: "云端没有新的学习进度",
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
              message: "云端与本机均无学习进度",
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
            message: "本机与云端学习进度一致",
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
          message: "本机与云端学习进度一致",
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
          message: "云端与本机均无学习进度",
          lastSyncedAt: syncedAt,
          conflict: null,
        });
        return;
      }

      recordConflict(account, local, remote, remoteEtag);
      return;
    }

    fail("云端学习进度变化频繁，请稍后重试");
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
          fail(errorMessage(error, "同步失败，请稍后重试"));
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
    } catch {
      if (isCurrent(token)) fail("读取同步配置失败");
      return;
    }
    if (!isCurrent(token)) return;

    if (!loaded) {
      commit({
        status: "disabled",
        config: null,
        message: "尚未配置同步",
        conflict: null,
      });
      return;
    }

    commit({
      status: "idle",
      config: loaded,
      message: "",
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
            fail(errorMessage(error, "保存同步配置失败"));
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
        } catch {
          if (isCurrent(token)) fail("读取同步配置失败");
          return;
        }
        if (!isCurrent(token)) return;
        if (!loaded) {
          fail("保存同步配置失败，未能读回配置");
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
            commit({
              status: "error",
              config: loaded,
              message: errorMessage(
                error,
                "重置同步基线失败，已停止同步"
              ),
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
          message: "已保存同步配置",
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
            fail(errorMessage(error, "断开同步失败，请重试"));
          }
          return;
        }
        if (!isCurrent(token)) return;
        // 断开过程中的请求同样必须过期,不能拿到结果后写回进度。
        generation += 1;
        // 原生断开已确认;旧配置不再可用于同步。
        configBlocked = false;

        let cleared = true;
        let message = "已断开同步";
        if (previous) {
          try {
            clearSyncBaseline(storage, previous);
            baselineBlocked = false;
            reconnectRequired = false;
          } catch (error) {
            cleared = false;
            baselineBlocked = true;
            message = errorMessage(
              error,
              "已断开同步，但本地同步基线清理失败"
            );
          }
        }
        deferred = false;
        commit({
          status: cleared ? "disabled" : "error",
          config: null,
          message,
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
        message: "冲突已更新，请重新选择保留版本",
      });
    } else {
      commit({ message: "冲突已由其他操作处理" });
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
            message: "同步配置已变更，请重新选择保留版本",
          });
        }
        return;
      }
      if (configTransition > 0) return;
      if (configBlocked) {
        commit({ message: "同步配置尚未确认，已停止同步" });
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
      commit({ message: "同步配置尚未确认，已停止同步" });
      return;
    }
    if (baselineBlocked) {
      fail("本地同步基线无法重置，已停止同步");
      return;
    }
    if (snapshot.conflict !== conflict) {
      announceStaleConflict();
      return;
    }
    if (!storage) {
      fail("当前环境不支持本地存储，无法处理冲突");
      return;
    }

    if (!(await ensureDirectory(token))) return;
    if (!isCurrent(token)) return;

    const account: SyncAccount = { url: config.url, username: config.username };

    if (choice === "local") {
      commit({ status: "syncing", message: "正在用本机进度覆盖云端…" });
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
        fail("覆盖云端失败，请稍后重试");
      }
      return;
    }

    if (!canApplyRemote()) {
      deferred = true;
      commit({
        status: "conflict",
        message: "正在练习或阅读，稍后再应用云端学习进度",
      });
      return;
    }

    commit({ status: "syncing", message: "正在确认云端版本…" });
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
      fail(httpMessage(response.status));
      return;
    }
    let remote: ProgressBackup;
    try {
      remote = parseSyncDocument(response.body);
    } catch (error) {
      fail(errorMessage(error, "云端同步文件无效，已停止自动同步"));
      return;
    }
    const remoteEtag = getStrongEtag(response.headers);
    if (!remoteEtag) {
      fail("云端未返回强 ETag，已停止自动恢复");
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
