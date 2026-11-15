import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Progress } from "../types";
import type { SyncAdapter, SyncSettings, SyncSnapshot } from "./types";
import { getSyncAdapter, isSyncAvailable } from "./native";
import { createSyncController } from "./controller";

/** 控制器对 UI 暴露的稳定结构;只依赖接口契约,不依赖核心内部类型。 */
export interface ClientSyncController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncSnapshot;
  initialize(): Promise<void>;
  configure(settings: SyncSettings, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  resolveConflict(choice: "local" | "remote"): Promise<void>;
  notifyLocalChange(): void;
  dispose(): void;
}

export interface ClientSyncState {
  /** 网页版为 null;设置页据此完全不渲染同步入口。 */
  controller: ClientSyncController | null;
  snapshot: SyncSnapshot;
}

interface Options {
  getProgress: () => Progress;
  /** 必须先持久化成功再更新界面;抛错表示落盘失败,控制器不会确认基线。 */
  applyProgress: (progress: Progress) => void;
  /** 答题/阅读期间为 true:云端数据延后应用,不打断正在作答的状态。 */
  interactionActive?: boolean;
}

/** 网页版和原生端的初始占位,保持同一对象身份以稳定 useSyncExternalStore。 */
const DISABLED_SNAPSHOT: SyncSnapshot = {
  status: "disabled",
  config: null,
  message: "",
  lastSyncedAt: null,
  conflict: null,
};

const noopSubscribe = () => () => {};

function readAvailability(): boolean {
  try {
    // 网页版只做平台判断,不读取配置也不访问网络。
    return isSyncAvailable();
  } catch {
    return false;
  }
}

function safeAdapter(): SyncAdapter | null {
  try {
    return getSyncAdapter();
  } catch {
    return null;
  }
}

/**
 * 客户端同步生命周期:只在真实原生容器内创建控制器。
 *
 * App 把进度保存在 ref 里;这里通过 ref 读取最新进度,避免同步回调捕获旧状态。
 * 远端进度由 applyProgress 负责"先落盘、再更新 App 的 ref 与界面"。
 */
export function useClientSync({
  getProgress,
  applyProgress,
  interactionActive = false,
}: Options): ClientSyncState {
  const [available] = useState(readAvailability);
  const [controller, setController] = useState<ClientSyncController | null>(null);

  const getProgressRef = useRef(getProgress);
  const applyProgressRef = useRef(applyProgress);
  const interactionActiveRef = useRef(interactionActive);

  useEffect(() => {
    getProgressRef.current = getProgress;
    applyProgressRef.current = applyProgress;
    interactionActiveRef.current = interactionActive;
  });

  useEffect(() => {
    if (!available) return;
    const adapter = safeAdapter();
    if (!adapter) return;

    let instance: ClientSyncController | null = null;
    try {
      instance = createSyncController({
        adapter,
        getProgress: () => getProgressRef.current(),
        applyProgress: (progress) => applyProgressRef.current(progress),
        // 练习、复习和阅读进行中不覆盖当前答题状态。
        canApplyRemote: () => !interactionActiveRef.current,
      });
    } catch {
      // 原生适配器不可用时保持网页的安静降级,不让设置页崩溃。
      return;
    }
    if (!instance) return;

    setController(instance);
    void instance.initialize().catch(() => {
      // 控制器把初始化失败写入 snapshot;UI 负责显示可读消息。
    });

    const triggerForeground = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      const snapshot = instance.getSnapshot();
      if (!snapshot.config?.autoSync || snapshot.status === "syncing") return;
      void instance.sync().catch(() => {
        // 同步失败已进入 snapshot,前台事件只尽力重试。
      });
    };

    document.addEventListener("visibilitychange", triggerForeground);
    window.addEventListener("focus", triggerForeground);

    return () => {
      document.removeEventListener("visibilitychange", triggerForeground);
      window.removeEventListener("focus", triggerForeground);
      instance.dispose();
    };
  }, [available]);

  // 从答题/阅读返回后补一次机会;不刷新正在进行中的作答。
  const wasInteracting = useRef(interactionActive);
  useEffect(() => {
    const previous = wasInteracting.current;
    wasInteracting.current = interactionActive;
    if (!previous || interactionActive || !controller) return;
    const snapshot = controller.getSnapshot();
    if (!snapshot.config?.autoSync) return;
    void controller.sync().catch(() => {
      // 失败写入 snapshot,不打断用户返回后的页面。
    });
  }, [controller, interactionActive]);

  const subscribe = useCallback(
    (listener: () => void) =>
      controller ? controller.subscribe(listener) : noopSubscribe(),
    [controller]
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : DISABLED_SNAPSHOT),
    [controller]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { controller, snapshot };
}
