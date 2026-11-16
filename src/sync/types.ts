import type { ProgressBackup } from "../backup/progressBackup";
import type { UserFacingError } from "../i18n/errors";

/** 用户可编辑的同步配置;密码永远不在这里。 */
export interface SyncSettings {
  url: string;
  username: string;
  autoSync: boolean;
}

/** HTTP 方法:应用目录准备只允许 MKCOL/PROPFIND,文件只允许 GET/PUT。 */
export type SyncMethod = "GET" | "PUT" | "MKCOL" | "PROPFIND";

/** 新目录布局的固定应用子目录名;由原生拼接到用户 WebDAV 根下。 */
export const SYNC_APP_FOLDER = "FrenchGrammarExercise";

/** PROPFIND 固定属性查询;原生/JS 都只接受这一份正文。 */
export const DAV_PROPERTY_QUERY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

/**
 * 同步根 URL 的纯 JS 预校验:HTTP/HTTPS 均允许,不限制私网/回环。
 * 返回可展示错误;null 表示通过。
 */
export function validateSyncRootUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[\r\n\0]/.test(value)
  ) {
    return "同步地址无效";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "同步地址无效";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "同步地址必须使用 HTTP 或 HTTPS";
  }
  if (parsed.username || parsed.password) {
    return "同步地址不能包含用户名或密码";
  }
  if (value.includes("?") || value.includes("#")) {
    return "同步地址不能包含查询参数或片段";
  }
  return null;
}

/** 原生端读回的配置只暴露是否已保存密码,绝不返回密码本身。 */
export interface SyncConfig extends SyncSettings {
  hasPassword: boolean;
}

/**
 * 交给原生适配器的单个 HTTP 请求描述。
 * Authorization 由原生端根据已保存凭据构造,核心层不接触密码。
 */
export interface SyncRequest {
  method: SyncMethod;
  filename: string;
  headers: Record<string, string>;
  body?: string;
}

/** 原生适配器返回的 HTTP 响应;headers 名称大小写由原生端保留。 */
export interface SyncResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 平台同步适配器:配置持久化、凭据存储与受限 WebDAV 请求。 */
export interface SyncAdapter {
  readConfig(): Promise<SyncConfig | null>;
  writeConfig(config: SyncSettings, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  request(request: SyncRequest): Promise<SyncResponse>;
}

/** 冲突时展示的两份不可变进度快照;remoteEtag 是显示时的云端版本。 */
export interface SyncConflict {
  local: ProgressBackup;
  remote: ProgressBackup;
  remoteEtag: string;
}

export type SyncStatus =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "conflict"
  | "error";

/** 控制器对外发布的稳定快照;每次真实状态变化才产生新对象。 */
export interface SyncSnapshot {
  status: SyncStatus;
  config: SyncConfig | null;
  /** 旧版兼容字段:中文可读诊断;界面优先使用 error/notice 按当前语言格式化。 */
  message: string;
  /** 结构化错误;失败时由界面按当前 locale 即时格式化。 */
  error?: UserFacingError | null;
  /** 结构化非错误提示(同步中、成功、冲突等),同样按当前 locale 格式化。 */
  notice?: UserFacingError | null;
  lastSyncedAt: string | null;
  conflict: SyncConflict | null;
}
