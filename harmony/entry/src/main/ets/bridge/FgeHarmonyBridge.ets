import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import { util } from '@kit.ArkTS';
import { window } from '@kit.ArkUI';

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_PNG_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
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
}

interface ParsedRequest {
  operation: string;
  mode: string;
  filename: string;
  mimeType: string;
  encoding: string;
  data: string;
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

  setContext(context: common.UIAbilityContext): void {
    this.context = context;
  }

  invoke(requestJson: string): Promise<string> {
    try {
      const request = this.parseRequest(requestJson);
      if (request.operation === 'applyTheme') {
        return this.applyTheme(request.mode);
      }
      return this.shareFile(request);
    } catch (error) {
      return Promise.resolve(this.reply({
        status: 'error',
        message: this.messageFor(error, '请求无效'),
      }));
    }
  }

  private reply(reply: Reply): string {
    if (reply.message === undefined) {
      return JSON.stringify(reply);
    }
    return JSON.stringify(reply);
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
      throw new Error('请求字段不匹配');
    }
    for (const key of keys) {
      if (allowed.indexOf(key) < 0) {
        throw new Error('请求字段不匹配');
      }
    }
  }

  private parseRequest(requestJson: string): ParsedRequest {
    let parsed: Object;
    try {
      parsed = JSON.parse(requestJson) as Object;
    } catch (error) {
      throw new Error('请求不是有效 JSON');
    }
    const record = this.asRecord(parsed);
    if (record === null) {
      throw new Error('请求必须是 JSON 对象');
    }
    const keys = Object.keys(record);
    if (record['version'] !== 1) {
      throw new Error('不支持的协议版本');
    }
    const operation = record['operation'];
    if (typeof operation !== 'string') {
      throw new Error('缺少 operation');
    }

    if (operation === 'applyTheme') {
      this.assertExactKeys(keys, ['version', 'operation', 'mode']);
      const mode = record['mode'];
      if (typeof mode !== 'string' || (mode !== 'light' && mode !== 'dark')) {
        throw new Error('主题模式无效');
      }
      return {
        operation,
        mode,
        filename: '',
        mimeType: '',
        encoding: '',
        data: '',
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
        throw new Error('分享字段类型无效');
      }
      return { operation, mode: '', filename, mimeType, encoding, data };
    }

    throw new Error('未知 operation');
  }

  private validateFilename(filename: string): void {
    if (
      filename.length === 0 ||
      filename.length > MAX_FILENAME_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ||
      filename.indexOf('..') >= 0
    ) {
      throw new Error('文件名无效');
    }
  }

  private decodePng(data: string): Uint8Array {
    if (
      data.length === 0 ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    ) {
      throw new Error('图片 base64 无效');
    }
    const maxEncoded = Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4;
    if (data.length > maxEncoded) {
      throw new Error('图片超过大小上限');
    }
    let bytes: Uint8Array;
    try {
      bytes = new util.Base64Helper().decodeSync(data);
    } catch (error) {
      throw new Error('图片 base64 无效');
    }
    if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
      throw new Error('图片超过大小上限');
    }
    if (bytes.length < PNG_SIGNATURE.length) {
      throw new Error('图片不是 PNG');
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        throw new Error('图片不是 PNG');
      }
    }
    return bytes;
  }

  private validateShare(request: ParsedRequest): Uint8Array | null {
    this.validateFilename(request.filename);
    if (request.mimeType === 'application/json') {
      if (request.encoding !== 'utf8' || !request.filename.toLowerCase().endsWith('.json')) {
        throw new Error('JSON 分享的编码或扩展名无效');
      }
      const bytes = new util.TextEncoder().encodeInto(request.data);
      if (bytes.length > MAX_BACKUP_BYTES) {
        throw new Error('备份超过大小上限');
      }
      try {
        JSON.parse(request.data);
      } catch (error) {
        throw new Error('备份不是有效 JSON');
      }
      return null;
    }
    if (request.mimeType === 'image/png') {
      if (request.encoding !== 'base64' || !request.filename.toLowerCase().endsWith('.png')) {
        throw new Error('PNG 分享的编码或扩展名无效');
      }
      return this.decodePng(request.data);
    }
    throw new Error('不支持的分享类型');
  }

  private ensureCacheDir(context: common.UIAbilityContext): string {
    const dir = `${context.cacheDir}/fge-share`;
    try {
      fileIo.mkdirSync(dir, true);
    } catch (error) {
      if (!fileIo.accessSync(dir)) {
        throw new Error('无法创建分享缓存目录');
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
    } finally {
      fileIo.closeSync(file);
    }
    return filePath;
  }

  private applyTheme(mode: string): Promise<string> {
    const context = this.context;
    if (context === null) {
      return Promise.resolve(this.reply({
        status: 'error',
        message: '原生上下文不可用',
      }));
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
      .catch((error: BusinessError) => this.reply({
        status: 'error',
        message: this.messageFor(error, '主题同步失败'),
      }));
  }

  private shareFile(request: ParsedRequest): Promise<string> {
    if (this.shareBusy) {
      return Promise.resolve(this.reply({
        status: 'error',
        message: '分享正在进行',
      }));
    }
    const context = this.context;
    if (context === null) {
      return Promise.resolve(this.reply({
        status: 'error',
        message: '原生上下文不可用',
      }));
    }

    let pngBytes: Uint8Array | null = null;
    let filePath = '';
    try {
      pngBytes = this.validateShare(request);
      filePath = this.writeCacheFile(context, request, pngBytes);
    } catch (error) {
      return Promise.resolve(this.reply({
        status: 'error',
        message: this.messageFor(error, '分享文件无效'),
      }));
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
          finish({
            status: 'error',
            message: this.messageFor(error, '系统分享失败'),
          });
        });
      } catch (error) {
        finish({
          status: 'error',
          message: this.messageFor(error, '系统分享失败'),
        });
      }
    });
  }
}
