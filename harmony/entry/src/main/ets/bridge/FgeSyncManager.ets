import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util, url } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { huks } from '@kit.UniversalKeystoreKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

const MAX_SYNC_BYTES: number = 5 * 1024 * 1024;
const MAX_URL_LENGTH: number = 4096;
const MAX_HEADER_LENGTH: number = 8192;
const SYNC_TIMEOUT_MS: number = 20000;
const SYNC_PREFS: string = 'fge-sync';
const KEY_CONFIG: string = 'config';
const HUKS_ALIAS: string = 'fge_sync_credentials_v1';
const NONCE_BYTES: number = 12;
const GCM_TAG_BYTES: number = 16;
const ALLOWED_HEADERS: string[] = [
  'accept',
  'content-type',
  'if-match',
  'if-none-match',
  'depth',
];
const APP_DIRECTORY: string = 'FrenchGrammarExercise';

export interface HarmonySyncSettings {
  url: string;
  username: string;
  autoSync: boolean;
}

export interface HarmonySyncConfig extends HarmonySyncSettings {
  hasPassword: boolean;
}

export interface HarmonySyncRequest {
  method: string;
  filename: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HarmonySyncResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type NativeErrorCode =
  | 'native.config_invalid'
  | 'native.credentials_required'
  | 'native.storage_failed'
  | 'native.network_failed'
  | 'native.file_failed'
  | 'native.unsupported'
  | 'native.unknown';

/**
 * 稳定错误码 + 非敏感参数 + 原始诊断。桥接层只转发这些字段,界面文案由
 * JS 按当前语言生成;这里的中文 message 仅作兼容与诊断。
 */
export class NativeSyncError extends Error {
  readonly code: NativeErrorCode;
  readonly params: Record<string, string | number>;
  readonly diagnostic: string;

  constructor(
    code: NativeErrorCode,
    diagnostic: string,
    params?: Record<string, string | number>
  ) {
    super(diagnostic);
    this.name = 'NativeSyncError';
    this.code = code;
    this.diagnostic = diagnostic;
    this.params = params === undefined ? {} : params;
  }

  withParam(name: string, value: string | number): NativeSyncError {
    this.params[name] = value;
    return this;
  }
}

interface SyncRecord {
  url: string;
  username: string;
  autoSync: boolean;
  credential: string;
}

interface SyncSnapshot {
  url: string;
  username: string;
  password: string;
  filename: string;
}

/**
 * HarmonyOS WebDAV 同步的原生实现。
 *
 * URL、Authorization、重定向与大小限制都在这里执行;应用密码由 HUKS 中
 * 不可导出的 AES-256-GCM 密钥加密后写入单条配置记录。地址/用户名变更
 * 且未重新输入密码时拒绝保存,避免把旧凭据发往新目标。
 */
export class FgeSyncManager {
  private context: common.UIAbilityContext | null = null;
  private configTail: Promise<void> = Promise.resolve();

  setContext(context: common.UIAbilityContext): void {
    this.context = context;
  }

  async readConfig(): Promise<HarmonySyncConfig | null> {
    try {
      const context = this.requireContext();
      const store = await preferences.getPreferences(context, SYNC_PREFS);
      const record = this.readRecord(store);
      if (record === null) {
        return null;
      }
      const config: HarmonySyncConfig = {
        url: record.url,
        username: record.username,
        autoSync: record.autoSync,
        hasPassword: record.credential.length > 0,
      };
      return config;
    } catch (error) {
      throw this.storageError(error, '无法读取同步配置');
    }
  }

  writeConfig(
    configValue: Object,
    password: string | null
  ): Promise<void> {
    return this.enqueueConfig(async () => {
      try {
        await this.writeConfigLocked(configValue, password);
      } catch (error) {
        throw this.storageError(error, '无法保存同步配置');
      }
    });
  }

  disconnect(): Promise<void> {
    return this.enqueueConfig(async () => {
      try {
        await this.disconnectLocked();
      } catch (error) {
        throw this.storageError(error, '无法断开同步');
      }
    });
  }

  private storageError(error: Object, fallback: string): NativeSyncError {
    if (error instanceof NativeSyncError) {
      return error;
    }
    return new NativeSyncError('native.storage_failed', fallback);
  }

  async request(requestValue: Object): Promise<HarmonySyncResponse> {
    const context = this.requireContext();
    const record = this.asRecord(requestValue);
    if (record === null) {
      throw new NativeSyncError('native.config_invalid', '同步请求无效');
    }

    const methodValue = record['method'];
    const filenameValue = record['filename'];
    const headerValue = record['headers'];
    if (
      methodValue !== 'GET' &&
      methodValue !== 'PUT' &&
      methodValue !== 'MKCOL' &&
      methodValue !== 'PROPFIND'
    ) {
      throw new NativeSyncError('native.config_invalid', '同步请求方法无效');
    }
    if (
      typeof filenameValue !== 'string' ||
      typeof headerValue !== 'object' ||
      headerValue === null
    ) {
      throw new NativeSyncError('native.config_invalid', '同步请求无效');
    }
    const method = methodValue as string;
    const filename = filenameValue as string;
    const headerRecord = this.asRecord(headerValue);
    if (headerRecord === null) {
      throw new NativeSyncError('native.config_invalid', '同步请求无效');
    }

    const expectedFilename = this.filename(context);
    if (
      filename !== expectedFilename ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ||
      filename.indexOf('..') >= 0
    ) {
      throw new NativeSyncError('native.config_invalid', '同步文件名无效');
    }

    const bodyValue = record['body'];
    if (bodyValue !== undefined && typeof bodyValue !== 'string') {
      throw new NativeSyncError('native.config_invalid', '同步请求体无效');
    }
    const body = typeof bodyValue === 'string' ? bodyValue : '';
    if (method !== 'PUT' && method !== 'PROPFIND' && body.length > 0) {
      throw new NativeSyncError('native.config_invalid', '同步请求不能携带请求体');
    }
    if (new util.TextEncoder().encodeInto(body).length > MAX_SYNC_BYTES) {
      throw new NativeSyncError('native.config_invalid', '同步请求超过大小上限');
    }

    const snapshot = await this.loadSnapshot(context);
    const target =
      method === 'GET' || method === 'PUT'
        ? this.buildFileUrl(snapshot.url, expectedFilename)
        : this.buildAppDirectoryUrl(snapshot.url);
    const headers = this.buildHeaders(
      headerRecord,
      method,
      snapshot.username,
      snapshot.password
    );
    const options = this.buildOptions(method, headers, body);

    const client = http.createHttp();
    let response: http.HttpResponse | null = null;
    try {
      response = await client.request(target, options);
    } catch (error) {
      throw new NativeSyncError('native.network_failed', '同步请求失败，请检查网络或服务器');
    } finally {
      client.destroy();
    }
    if (response === null) {
      throw new NativeSyncError('native.network_failed', '同步请求失败，请检查网络或服务器');
    }
    return this.parseResponse(response);
  }

  /**
   * 配置写入/断开按调用顺序串行,避免较慢的写入在新一次断开之后提交。
   * 单条配置记录保证 URL、开关与凭据不会出现新旧混合。
   */
  private enqueueConfig(task: () => Promise<void>): Promise<void> {
    const next = this.configTail.then(
      () => task(),
      () => task()
    );
    this.configTail = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  private async writeConfigLocked(
    configValue: Object,
    password: string | null
  ): Promise<void> {
    const context = this.requireContext();
    const record = this.asRecord(configValue);
    if (record === null) {
      throw new NativeSyncError('native.config_invalid', '同步配置无效');
    }
    const urlValue = record['url'];
    const usernameValue = record['username'];
    const autoValue = record['autoSync'];
    if (
      typeof urlValue !== 'string' ||
      typeof usernameValue !== 'string' ||
      typeof autoValue !== 'boolean'
    ) {
      throw new NativeSyncError('native.config_invalid', '同步配置无效');
    }
    const configUrl = urlValue.trim();
    const username = usernameValue;
    const autoSync = autoValue;
    this.validateUsername(username);
    if (password !== null) {
      this.validatePassword(password);
    }
    const normalizedUrl = this.normalizeBaseUrl(configUrl);

    const store = await preferences.getPreferences(context, SYNC_PREFS);
    const previousRaw = store.getSync(KEY_CONFIG, '');
    const previous =
      typeof previousRaw === 'string' ? this.parseRecord(previousRaw) : null;
    const previousHasPassword = previous !== null && previous.credential.length > 0;

    let sameTarget = false;
    if (previous !== null) {
      try {
        sameTarget =
          this.normalizeBaseUrl(previous.url) === normalizedUrl &&
          previous.username === username;
      } catch (error) {
        sameTarget = false;
      }
    }

    let credential = '';
    if (password !== null) {
      if (!sameTarget && previousHasPassword && password.length === 0) {
        throw new NativeSyncError('native.credentials_required', '更换同步地址或用户名时，请重新输入应用密码');
      }
      if (password.length > 0) {
        try {
          credential = await this.encryptPassword(password);
        } catch (error) {
          throw new NativeSyncError('native.storage_failed', '无法保存同步配置');
        }
      }
    } else {
      if (!sameTarget && previousHasPassword) {
        throw new NativeSyncError('native.credentials_required', '更换同步地址或用户名时，请重新输入应用密码');
      }
      credential = sameTarget && previous !== null ? previous.credential : '';
    }

    const nextRecord: SyncRecord = {
      url: configUrl,
      username: username,
      autoSync: autoSync,
      credential: credential,
    };
    const nextRaw = JSON.stringify(nextRecord);
    try {
      store.putSync(KEY_CONFIG, nextRaw);
      await store.flush();
    } catch (error) {
      // 单条记录回滚:内存和下次 flush 都恢复上一份配置,避免新地址配旧凭据。
      try {
        if (typeof previousRaw === 'string' && previousRaw.length > 0) {
          store.putSync(KEY_CONFIG, previousRaw);
        } else {
          store.deleteSync(KEY_CONFIG);
        }
        await store.flush();
      } catch (rollbackError) {
        // 回滚失败时保留可读错误;调用方可能重新连接。
      }
      throw new NativeSyncError('native.storage_failed', '无法保存同步配置');
    }
  }

  private async disconnectLocked(): Promise<void> {
    const context = this.requireContext();
    const store = await preferences.getPreferences(context, SYNC_PREFS);
    try {
      store.clearSync();
      await store.flush();
    } catch (error) {
      throw new NativeSyncError('native.storage_failed', '无法断开同步');
    }
    try {
      await huks.deleteKeyItem(HUKS_ALIAS, { properties: [] });
    } catch (error) {
      // 密文已经删除;删不掉旧密钥也不会暴露任何凭据。
    }
  }

  private async loadSnapshot(context: common.UIAbilityContext): Promise<SyncSnapshot> {
    try {
      const store = await preferences.getPreferences(context, SYNC_PREFS);
      const record = this.readRecord(store);
      if (record === null) {
        throw new NativeSyncError('native.config_invalid', '尚未配置同步');
      }
      const normalizedUrl = this.normalizeBaseUrl(record.url);
      const password =
        record.credential.length === 0
          ? ''
          : await this.decryptPassword(record.credential);
      const snapshot: SyncSnapshot = {
        url: normalizedUrl,
        username: record.username,
        password: password,
        filename: this.filename(context),
      };
      return snapshot;
    } catch (error) {
      throw this.storageError(error, '无法读取同步配置');
    }
  }

  private readRecord(store: preferences.Preferences): SyncRecord | null {
    const raw = store.getSync(KEY_CONFIG, '');
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }
    return this.parseRecord(raw);
  }

  private parseRecord(raw: string): SyncRecord | null {
    let parsed: Object;
    try {
      parsed = JSON.parse(raw) as Object;
    } catch (error) {
      return null;
    }
    const record = this.asRecord(parsed);
    if (record === null) {
      return null;
    }
    const urlValue = record['url'];
    const usernameValue = record['username'];
    const autoValue = record['autoSync'];
    const credentialValue = record['credential'];
    if (
      typeof urlValue !== 'string' ||
      typeof usernameValue !== 'string' ||
      typeof autoValue !== 'boolean' ||
      typeof credentialValue !== 'string'
    ) {
      return null;
    }
    const parsedRecord: SyncRecord = {
      url: urlValue,
      username: usernameValue,
      autoSync: autoValue,
      credential: credentialValue,
    };
    return parsedRecord;
  }

  private buildHeaders(
    raw: Record<string, Object>,
    method: string,
    username: string,
    password: string
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    const seen: string[] = [];
    const names = Object.keys(raw);
    for (const name of names) {
      const lower = name.toLowerCase();
      const value = raw[name];
      if (
        ALLOWED_HEADERS.indexOf(lower) < 0 ||
        seen.indexOf(lower) >= 0 ||
        typeof value !== 'string' ||
        value.length > MAX_HEADER_LENGTH ||
        this.hasControl(value) ||
        (lower === 'depth' && (method !== 'PROPFIND' || value !== '0'))
      ) {
        throw new NativeSyncError('native.config_invalid', '同步请求头无效');
      }
      seen.push(lower);
      headers[name] = value;
    }

    const authorization = this.authorization(username, password);
    if (authorization.length > 0) {
      headers['Authorization'] = authorization;
    }
    return headers;
  }

  private buildOptions(
    method: string,
    headers: Record<string, string>,
    body: string
  ): http.HttpRequestOptions {
    const options: http.HttpRequestOptions = {
      method: method === 'PUT' ? http.RequestMethod.PUT : http.RequestMethod.GET,
      header: headers,
      connectTimeout: SYNC_TIMEOUT_MS,
      readTimeout: SYNC_TIMEOUT_MS,
      usingCache: false,
      maxRedirects: 0,
      maxLimit: MAX_SYNC_BYTES,
      expectDataType: http.HttpDataType.STRING,
    };
    // net.http 只枚举标准方法;API 23+ 的 customMethod 是官方 WebDAV 入口,
    // 不修改 method 枚举或偷改内部字段。
    if (method === 'MKCOL' || method === 'PROPFIND') {
      options.customMethod = method;
    }
    // API 26 的显式 body 对任意方法都按请求体发送;extraData 在 GET 占位时
    // 可能被解释为 query,因此 WebDAV 正文只使用 body。
    if ((method === 'PUT' || method === 'PROPFIND') && body.length > 0) {
      options.body = body;
    }
    return options;
  }

  private parseResponse(response: http.HttpResponse): HarmonySyncResponse {
    const status = response.responseCode;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
      throw new NativeSyncError('native.network_failed', '同步响应无效');
    }
    if (typeof response.result !== 'string') {
      throw new NativeSyncError('native.network_failed', '同步响应无效');
    }
    const body = response.result;
    if (new util.TextEncoder().encodeInto(body).length > MAX_SYNC_BYTES) {
      throw new NativeSyncError('native.network_failed', '同步响应超过大小上限');
    }

    const headers: Record<string, string> = {};
    const rawHeaders = this.asRecord(response.header);
    if (rawHeaders !== null) {
      const names = Object.keys(rawHeaders);
      for (const name of names) {
        const rawValue = rawHeaders[name];
        let value = '';
        if (typeof rawValue === 'string') {
          value = rawValue;
        } else if (Array.isArray(rawValue)) {
          value = (rawValue as string[]).join(', ');
        } else {
          value = rawValue.toString();
        }
        if (this.hasControl(name) || this.hasControl(value)) {
          throw new NativeSyncError('native.network_failed', '同步响应无效');
        }
        headers[name] = value;
      }
    }

    const parsed: HarmonySyncResponse = {
      status: status,
      headers: headers,
      body: body,
    };
    return parsed;
  }

  private authorization(username: string, password: string): string {
    this.validateUsername(username);
    this.validatePassword(password);
    if (username.length === 0 && password.length === 0) {
      return '';
    }
    const token = new util.Base64Helper().encodeToStringSync(
      new util.TextEncoder().encodeInto(`${username}:${password}`)
    );
    return `Basic ${token}`;
  }

  /** 规范化根 URL:HTTP/HTTPS、无账号/查询/片段、无点段;去掉尾斜杠。 */
  private normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_URL_LENGTH ||
      this.hasControl(trimmed)
    ) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }

    let candidate: url.URL;
    try {
      candidate = new url.URL(trimmed);
    } catch (error) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }
    if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') {
      throw new NativeSyncError('native.config_invalid', '同步地址必须使用 HTTP 或 HTTPS');
    }
    if (candidate.host.length === 0 || candidate.hostname.length === 0) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }
    if (candidate.username.length > 0 || candidate.password.length > 0) {
      throw new NativeSyncError('native.config_invalid', '同步地址不能包含账号信息');
    }
    if (candidate.search.length > 0 || candidate.hash.length > 0) {
      throw new NativeSyncError('native.config_invalid', '同步地址不能包含查询或片段');
    }

    const path = candidate.pathname;
    this.validatePath(path);
    let basePath = path;
    while (basePath.length > 0 && basePath.endsWith('/')) {
      basePath = basePath.substring(0, basePath.length - 1);
    }
    return `${candidate.protocol}//${candidate.host}${basePath}`;
  }

  private buildAppDirectoryUrl(baseUrl: string): string {
    return `${this.normalizeBaseUrl(baseUrl)}/${APP_DIRECTORY}/`;
  }

  private buildFileUrl(baseUrl: string, filename: string): string {
    return `${this.buildAppDirectoryUrl(baseUrl)}${filename}`;
  }

  private validatePath(path: string): void {
    if (path.indexOf('\\') >= 0 || path.indexOf(' ') >= 0 || this.hasControl(path)) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }
    const lower = path.toLowerCase();
    if (
      lower.indexOf('%2e') >= 0 ||
      lower.indexOf('%2f') >= 0 ||
      lower.indexOf('%5c') >= 0 ||
      lower.indexOf('%00') >= 0
    ) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }

    let decoded = '';
    try {
      decoded = decodeURIComponent(path);
    } catch (error) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }
    if (decoded.indexOf('\\') >= 0 || this.hasControl(decoded)) {
      throw new NativeSyncError('native.config_invalid', '同步地址无效');
    }
    const segments = decoded.split('/');
    for (const segment of segments) {
      if (segment === '.' || segment === '..') {
        throw new NativeSyncError('native.config_invalid', '同步地址无效');
      }
    }
  }

  private filename(context: common.UIAbilityContext): string {
    const bundleName = context.abilityInfo.bundleName;
    if (bundleName === 'com.fge.open') {
      return 'fge-progress-public.json';
    }
    if (bundleName === 'com.fge.app') {
      return 'fge-progress-internal.json';
    }
    throw new NativeSyncError('native.unsupported', '未知应用版本');
  }

  private validateUsername(username: string): void {
    if (username.length > 256 || username.indexOf(':') >= 0 || this.hasControl(username)) {
      throw new NativeSyncError('native.config_invalid', '同步用户名无效');
    }
  }

  private validatePassword(password: string): void {
    if (this.hasControl(password)) {
      throw new NativeSyncError('native.config_invalid', '同步密码无效');
    }
  }

  private async encryptPassword(password: string): Promise<string> {
    const encrypted = await this.encrypt(
      new util.TextEncoder().encodeInto(password)
    );
    return new util.Base64Helper().encodeToStringSync(encrypted);
  }

  private async decryptPassword(encoded: string): Promise<string> {
    let combined: Uint8Array;
    try {
      combined = new util.Base64Helper().decodeSync(encoded);
    } catch (error) {
      throw new NativeSyncError('native.credentials_required', '同步凭据不可用');
    }
    try {
      const plain = await this.decrypt(combined);
      return new util.TextDecoder().decodeToString(plain);
    } catch (error) {
      throw new NativeSyncError('native.credentials_required', '同步凭据不可用');
    }
  }

  private async ensureKey(): Promise<void> {
    const exists = await huks.isKeyItemExist(HUKS_ALIAS, { properties: [] });
    if (exists) {
      return;
    }
    const properties: huks.HuksParam[] = [
      {
        tag: huks.HuksTag.HUKS_TAG_ALGORITHM,
        value: huks.HuksKeyAlg.HUKS_ALG_AES,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_KEY_SIZE,
        value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_PURPOSE,
        value:
          huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT |
          huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_PADDING,
        value: huks.HuksKeyPadding.HUKS_PADDING_NONE,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE,
        value: huks.HuksCipherMode.HUKS_MODE_GCM,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_DIGEST,
        value: huks.HuksKeyDigest.HUKS_DIGEST_NONE,
      },
    ];
    await huks.generateKeyItem(HUKS_ALIAS, { properties: properties });
  }

  private async encrypt(plain: Uint8Array): Promise<Uint8Array> {
    await this.ensureKey();
    const nonce = cryptoFramework.createRandom().generateRandomSync(NONCE_BYTES).data;
    const options: huks.HuksOptions = {
      properties: this.cipherProperties(
        huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT,
        nonce,
        null
      ),
      inData: plain,
    };
    const handle = await huks.initSession(HUKS_ALIAS, options);
    const result = await huks.finishSession(handle.handle, options);
    if (result.outData === undefined || result.outData.length === 0) {
      throw new NativeSyncError('native.storage_failed', '同步凭据加密失败');
    }
    const combined = new Uint8Array(nonce.length + result.outData.length);
    combined.set(nonce, 0);
    combined.set(result.outData, nonce.length);
    return combined;
  }

  private async decrypt(combined: Uint8Array): Promise<Uint8Array> {
    if (combined.length <= NONCE_BYTES + GCM_TAG_BYTES) {
      throw new NativeSyncError('native.credentials_required', '同步凭据不可用');
    }
    const nonce = combined.slice(0, NONCE_BYTES);
    const payload = combined.slice(NONCE_BYTES);
    const ciphertext = payload.slice(0, payload.length - GCM_TAG_BYTES);
    const tag = payload.slice(payload.length - GCM_TAG_BYTES);
    const options: huks.HuksOptions = {
      properties: this.cipherProperties(
        huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT,
        nonce,
        tag
      ),
      inData: ciphertext,
    };
    const handle = await huks.initSession(HUKS_ALIAS, options);
    const result = await huks.finishSession(handle.handle, options);
    if (result.outData === undefined || result.outData.length === 0) {
      throw new NativeSyncError('native.credentials_required', '同步凭据不可用');
    }
    return result.outData;
  }

  private cipherProperties(
    purpose: huks.HuksKeyPurpose,
    nonce: Uint8Array,
    tag: Uint8Array | null
  ): huks.HuksParam[] {
    const properties: huks.HuksParam[] = [
      {
        tag: huks.HuksTag.HUKS_TAG_ALGORITHM,
        value: huks.HuksKeyAlg.HUKS_ALG_AES,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_KEY_SIZE,
        value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_PURPOSE,
        value: purpose,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_PADDING,
        value: huks.HuksKeyPadding.HUKS_PADDING_NONE,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE,
        value: huks.HuksCipherMode.HUKS_MODE_GCM,
      },
      {
        tag: huks.HuksTag.HUKS_TAG_NONCE,
        value: nonce,
      },
    ];
    if (tag !== null) {
      properties.push({
        tag: huks.HuksTag.HUKS_TAG_AE_TAG,
        value: tag,
      });
    }
    return properties;
  }

  private requireContext(): common.UIAbilityContext {
    const context = this.context;
    if (context === null) {
      throw new NativeSyncError('native.unsupported', '原生上下文不可用');
    }
    return context;
  }

  private asRecord(value: Object): Record<string, Object> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, Object>;
  }

  private hasControl(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code < 0x20 || code === 0x7f) {
        return true;
      }
    }
    return false;
  }
}
