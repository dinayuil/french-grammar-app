import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import { util } from '@kit.ArkTS';
import { window } from '@kit.ArkUI';
import { FgeSyncManager, NativeSyncError } from './FgeSyncManager';

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_PNG_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
const PASSWORD_KEY = 'password';
const PNG_SIGNATURE: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function themeBackground(mode: string): string {
  return mode === 'dark' ? '#0e1420' : '#f6f4ef';
}

function themeContent(mode: string): string {
  return mode === 'dark' ? '#FFFFFF' : '#000000';
}

interface Reply {
  status: string;
  message?: string;
  code?: string;
  params?: Record<string, string | number>;
}

interface SyncReply {
  status: string;
  message?: string;
  code?: string;
  params?: Record<string, string | number>;
  config?: Object;
  response?: Object;
}

interface ParsedRequest {
  operation: string;
  mode: string;
  filename: string;
  mimeType: string;
  encoding: string;
  data: string;
  raw: Record<string, Object> | null;
}

/**
 * Strict, origin-scoped bridge for window.fgeHarmony.invoke(requestJson).
 * Only applyTheme and shareFile(JSON/PNG) are accepted; no arbitrary paths.
 */
export class FgeHarmonyBridge {
  static readonly NAME: string = 'fgeHarmony';
  static readonly PERMISSION: string =
    '{"javascriptProxyPermission":{"urlPermissionList":[' +
    '{"scheme":"https","host":"fge.local","port":"","path":""}],' +
    '"methodList":[{"methodName":"invoke","urlPermissionList":[' +
    '{"scheme":"https","host":"fge.local","port":"","path":""}]}]}}';

  private context: common.UIAbilityContext | null = null;
  private shareBusy: boolean = false;
  private sync: FgeSyncManager = new FgeSyncManager();

  setContext(context: common.UIAbilityContext): void {
    this.context = context;
    this.sync.setContext(context);
  }

  invoke(requestJson: string): Promise<string> {
    try {
      const request = this.parseRequest(requestJson);
      if (request.operation === 'applyTheme') {
        return this.applyTheme(request.mode);
      }
      if (request.operation === 'shareFile') {
        return this.shareFile(request);
      }
      return this.handleSync(request);
    } catch (error) {
      return Promise.resolve(this.errorReply(error, '请求无效'));
    }
  }

  private reply(reply: Reply): string {
    return JSON.stringify(reply);
  }

  /**
   * 统一错误回复:稳定 code + 非敏感 params + 原始诊断 message。旧 JS 只
   * 读取 message 仍可展示;新 JS 按 code 生成本地化主提示。
   */
  private errorReply(
    error: Object,
    fallback: string,
    operation?: string
  ): string {
    return this.reply(this.nativeErrorReply(error, fallback, operation));
  }

  /** 显式 `Reply` 返回值,供同步/分享等需要直接 resolve 的错误路径复用。 */
  private nativeErrorReply(
    error: Object,
    fallback: string,
    operation?: string
  ): Reply {
    let code = 'native.unknown';
    let diagnostic = this.messageFor(error, fallback);
    const params: Record<string, string | number> = {};
    if (error instanceof NativeSyncError) {
      code = error.code;
      diagnostic = error.diagnostic.length > 0 ? error.diagnostic : fallback;
      const names = Object.keys(error.params);
      for (const name of names) {
        params[name] = error.params[name];
      }
    }
    if (operation !== undefined) {
      params['operation'] = operation;
    }
    const reply: Reply = {
      status: 'error',
      code: code,
      message: diagnostic,
    };
    if (Object.keys(params).length > 0) {
      reply.params = params;
    }
    return reply;
  }

  private messageFor(error: Object, fallback: string): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
    return fallback;
  }

  private asRecord(value: Object): Record<string, Object> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, Object>;
  }

  private assertExactKeys(keys: string[], allowed: string[]): void {
    if (keys.length !== allowed.length) {
      throw new NativeSyncError('native.config_invalid', '请求字段不匹配');
    }
    for (const key of keys) {
      if (allowed.indexOf(key) < 0) {
        throw new NativeSyncError('native.config_invalid', '请求字段不匹配');
      }
    }
  }

  private parseRequest(requestJson: string): ParsedRequest {
    let parsed: Object;
    try {
      parsed = JSON.parse(requestJson) as Object;
    } catch (error) {
      throw new NativeSyncError('native.config_invalid', '请求不是有效 JSON');
    }
    const record = this.asRecord(parsed);
    if (record === null) {
      throw new NativeSyncError('native.config_invalid', '请求必须是 JSON 对象');
    }
    const keys = Object.keys(record);
    if (record['version'] !== 1) {
      throw new NativeSyncError('native.unsupported', '不支持的协议版本');
    }
    const operation = record['operation'];
    if (typeof operation !== 'string') {
      throw new NativeSyncError('native.config_invalid', '缺少 operation');
    }

    if (operation === 'applyTheme') {
      this.assertExactKeys(keys, ['version', 'operation', 'mode']);
      const mode = record['mode'];
      if (typeof mode !== 'string' || (mode !== 'light' && mode !== 'dark')) {
        throw new NativeSyncError('native.config_invalid', '主题模式无效');
      }
      return {
        operation,
        mode,
        filename: '',
        mimeType: '',
        encoding: '',
        data: '',
        raw: null,
      };
    }

    if (operation === 'shareFile') {
      this.assertExactKeys(
        keys,
        ['version', 'operation', 'filename', 'mimeType', 'encoding', 'data']
      );
      const filename = record['filename'];
      const mimeType = record['mimeType'];
      const encoding = record['encoding'];
      const data = record['data'];
      if (
        typeof filename !== 'string' ||
        typeof mimeType !== 'string' ||
        typeof encoding !== 'string' ||
        typeof data !== 'string'
      ) {
        throw new NativeSyncError('native.file_failed', '分享字段类型无效');
      }
      return {
        operation,
        mode: '',
        filename,
        mimeType,
        encoding,
        data,
        raw: null,
      };
    }

    return this.parseSyncRequest(operation, keys, record);
  }

  private emptyRequest(
    operation: string,
    raw: Record<string, Object>
  ): ParsedRequest {
    return {
      operation,
      mode: '',
      filename: '',
      mimeType: '',
      encoding: '',
      data: '',
      raw,
    };
  }

  /** 同步 operation 只接受锁定字段;请求/配置内容由原生同步层再次校验。 */
  private parseSyncRequest(
    operation: string,
    keys: string[],
    record: Record<string, Object>
  ): ParsedRequest {
    if (operation === 'syncReadConfig' || operation === 'syncDisconnect') {
      this.assertExactKeys(keys, ['version', 'operation']);
      return this.emptyRequest(operation, record);
    }

    if (operation === 'syncWriteConfig') {
      const allowed = ['version', 'operation', 'config'];
      const hasPassword = keys.indexOf(PASSWORD_KEY) >= 0;
      if (hasPassword) {
        allowed.push(PASSWORD_KEY);
      }
      this.assertExactKeys(keys, allowed);
      const config = record['config'];
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new NativeSyncError('native.config_invalid', '同步配置无效');
      }
      if (hasPassword && typeof record[PASSWORD_KEY] !== 'string') {
        throw new NativeSyncError('native.config_invalid', '同步密码无效');
      }
      return this.emptyRequest(operation, record);
    }

    if (operation === 'syncRequest') {
      this.assertExactKeys(keys, ['version', 'operation', 'request']);
      const request = record['request'];
      if (typeof request !== 'object' || request === null || Array.isArray(request)) {
        throw new NativeSyncError('native.config_invalid', '同步请求无效');
      }
      return this.emptyRequest(operation, record);
    }

    throw new NativeSyncError('native.unsupported', '未知 operation');
  }

  private async handleSync(request: ParsedRequest): Promise<string> {
    const raw = request.raw;
    if (raw === null) {
      return this.errorReply(
        new NativeSyncError('native.config_invalid', '请求无效'),
        '请求无效',
        request.operation
      );
    }

    try {
      if (request.operation === 'syncReadConfig') {
        const config = await this.sync.readConfig();
        const result: SyncReply = { status: 'ok' };
        if (config !== null) {
          result.config = config;
        }
        return this.replySync(result);
      }
      if (request.operation === 'syncWriteConfig') {
        const passwordValue = raw[PASSWORD_KEY];
        const password: string | null =
          passwordValue === undefined ? null : passwordValue as string;
        await this.sync.writeConfig(raw['config'] as Object, password);
        return this.replySync({ status: 'ok' });
      }
      if (request.operation === 'syncDisconnect') {
        await this.sync.disconnect();
        return this.replySync({ status: 'ok' });
      }
      if (request.operation === 'syncRequest') {
        const response = await this.sync.request(raw['request'] as Object);
        const result: SyncReply = { status: 'ok', response: response };
        return this.replySync(result);
      }
      return this.errorReply(
        new NativeSyncError('native.unsupported', '未知 operation'),
        '同步失败',
        request.operation
      );
    } catch (error) {
      return this.errorReply(error, '同步失败', request.operation);
    }
  }

  private replySync(reply: SyncReply): string {
    return JSON.stringify(reply);
  }

  private validateFilename(filename: string): void {
    if (
      filename.length === 0 ||
      filename.length > MAX_FILENAME_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ||
      filename.indexOf('..') >= 0
    ) {
      throw new NativeSyncError('native.file_failed', '文件名无效');
    }
  }

  private decodePng(data: string): Uint8Array {
    if (
      data.length === 0 ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    ) {
      throw new NativeSyncError('native.file_failed', '图片 base64 无效');
    }
    const maxEncoded = Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4;
    if (data.length > maxEncoded) {
      throw new NativeSyncError('native.file_failed', '图片超过大小上限');
    }
    let bytes: Uint8Array;
    try {
      bytes = new util.Base64Helper().decodeSync(data);
    } catch (error) {
      throw new NativeSyncError('native.file_failed', '图片 base64 无效');
    }
    if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
      throw new NativeSyncError('native.file_failed', '图片超过大小上限');
    }
    if (bytes.length < PNG_SIGNATURE.length) {
      throw new NativeSyncError('native.file_failed', '图片不是 PNG');
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        throw new NativeSyncError('native.file_failed', '图片不是 PNG');
      }
    }
    return bytes;
  }

  private validateShare(request: ParsedRequest): Uint8Array | null {
    this.validateFilename(request.filename);
    if (request.mimeType === 'application/json') {
      if (request.encoding !== 'utf8' || !request.filename.toLowerCase().endsWith('.json')) {
        throw new NativeSyncError('native.file_failed', 'JSON 分享的编码或扩展名无效');
      }
      const bytes = new util.TextEncoder().encodeInto(request.data);
      if (bytes.length > MAX_BACKUP_BYTES) {
        throw new NativeSyncError('native.file_failed', '备份超过大小上限');
      }
      try {
        JSON.parse(request.data);
      } catch (error) {
        throw new NativeSyncError('native.file_failed', '备份不是有效 JSON');
      }
      return null;
    }
    if (request.mimeType === 'image/png') {
      if (request.encoding !== 'base64' || !request.filename.toLowerCase().endsWith('.png')) {
        throw new NativeSyncError('native.file_failed', 'PNG 分享的编码或扩展名无效');
      }
      return this.decodePng(request.data);
    }
    throw new NativeSyncError('native.unsupported', '不支持的分享类型');
  }

  private ensureCacheDir(context: common.UIAbilityContext): string {
    const dir = `${context.cacheDir}/fge-share`;
    try {
      fileIo.mkdirSync(dir, true);
    } catch (error) {
      if (!fileIo.accessSync(dir)) {
        throw new NativeSyncError('native.file_failed', '无法创建分享缓存目录');
      }
    }
    return dir;
  }

  private writeCacheFile(
    context: common.UIAbilityContext,
    request: ParsedRequest,
    pngBytes: Uint8Array | null
  ): string {
    const dir = this.ensureCacheDir(context);
    const filePath = `${dir}/${request.filename}`;
    let failure: Object | null = null;
    try {
      const file = fileIo.openSync(
        filePath,
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC
      );
      try {
        if (pngBytes === null) {
          fileIo.writeSync(file.fd, request.data);
        } else {
          const buffer = pngBytes.buffer.slice(
            pngBytes.byteOffset,
            pngBytes.byteOffset + pngBytes.byteLength
          );
          fileIo.writeSync(file.fd, buffer);
        }
      } catch (error) {
        failure = error;
      }
      try {
        fileIo.closeSync(file);
      } catch (error) {
        // 写入已有失败时保留原异常;关闭本身失败才作为文件错误上报。
        if (failure === null) {
          failure = error;
        }
      }
    } catch (error) {
      failure = error;
    }
    if (failure !== null) {
      // 异常原文可能含缓存路径;只上报固定可操作诊断。
      throw new NativeSyncError('native.file_failed', '无法写入分享文件');
    }
    return filePath;
  }

  private applyTheme(mode: string): Promise<string> {
    const context = this.context;
    if (context === null) {
      return Promise.resolve(this.errorReply(
        new NativeSyncError('native.unsupported', '原生上下文不可用'),
        '主题同步失败',
        'applyTheme'
      ));
    }
    const background = themeBackground(mode);
    const content = themeContent(mode);
    return window.getLastWindow(context)
      .then((mainWindow: window.Window) => {
        mainWindow.setWindowBackgroundColor(background);
        return mainWindow.setWindowSystemBarProperties({
          statusBarColor: background,
          navigationBarColor: background,
          statusBarContentColor: content,
          navigationBarContentColor: content,
        });
      })
      .then(() => this.reply({ status: 'ok' }))
      .catch((error: BusinessError) => this.errorReply(
        error,
        '主题同步失败',
        'applyTheme'
      ));
  }

  private shareFile(request: ParsedRequest): Promise<string> {
    if (this.shareBusy) {
      return Promise.resolve(this.errorReply(
        new NativeSyncError('native.unsupported', '分享正在进行'),
        '分享正在进行',
        'shareFile'
      ));
    }
    const context = this.context;
    if (context === null) {
      return Promise.resolve(this.errorReply(
        new NativeSyncError('native.unsupported', '原生上下文不可用'),
        '原生上下文不可用',
        'shareFile'
      ));
    }

    let pngBytes: Uint8Array | null = null;
    let filePath = '';
    try {
      pngBytes = this.validateShare(request);
      filePath = this.writeCacheFile(context, request, pngBytes);
    } catch (error) {
      return Promise.resolve(this.errorReply(error, '分享文件无效', 'shareFile'));
    }

    this.shareBusy = true;
    const uri = fileUri.getUriFromPath(filePath);
    const mimeType = request.mimeType;
    const resolvedType = utd.getUniformDataTypeByMIMEType(mimeType);
    const record: systemShare.SharedRecord = {
      utd: resolvedType.length > 0 ? resolvedType : utd.UniformDataType.FILE,
      uri,
      title: request.filename,
    };
    const shared = new systemShare.SharedData(record);

    return new Promise<string>((resolve) => {
      let settled = false;
      let completed = false;
      const finish = (reply: Reply): void => {
        if (settled) return;
        settled = true;
        this.shareBusy = false;
        resolve(this.reply(reply));
      };

      try {
        const controller = new systemShare.ShareController(shared);
        controller.on('shareCompleted', () => {
          completed = true;
          finish({ status: 'ok' });
        });
        controller.on('dismiss', () => {
          setTimeout(() => {
            finish({ status: completed ? 'ok' : 'cancelled' });
          }, 200);
        });
        controller.show(context, {
          previewMode: systemShare.SharePreviewMode.DETAIL,
          selectionMode: systemShare.SelectionMode.SINGLE,
        }).catch((error: BusinessError) => {
          finish(this.nativeErrorReply(error, '系统分享失败', 'shareFile'));
        });
      } catch (error) {
        finish(this.nativeErrorReply(error, '系统分享失败', 'shareFile'));
      }
    });
  }
}
