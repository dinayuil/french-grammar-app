import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { FgeHarmonyBridge } from '../bridge/FgeHarmonyBridge';

const ORIGIN = 'https://fge.local';
const START_URL = `${ORIGIN}/index.html`;
const RAW_PREFIX = 'web/';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  bridge: FgeHarmonyBridge = new FgeHarmonyBridge();
  private proxyReady: boolean = false;
  private started: boolean = false;

  private ensureStart(): void {
    if (!this.proxyReady || this.started) {
      return;
    }
    this.started = true;
    this.controller.loadUrl(START_URL);
  }

  aboutToDisappear(): void {
    try {
      this.controller.deleteJavaScriptRegister(FgeHarmonyBridge.NAME);
    } catch (error) {
      // The page may be disposed before the proxy is registered.
    }
  }

  private isPathChar(code: number): boolean {
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    return isDigit || isUpper || isLower || code === 46 || code === 95 || code === 45 || code === 47;
  }

  private assetPath(url: string): string {
    if (url === ORIGIN || url === `${ORIGIN}/`) {
      return `${RAW_PREFIX}index.html`;
    }
    const prefix = `${ORIGIN}/`;
    if (!url.startsWith(prefix)) {
      return '';
    }
    let rest = url.substring(prefix.length);
    const hashIndex = rest.indexOf('#');
    if (hashIndex >= 0) {
      rest = rest.substring(0, hashIndex);
    }
    const queryIndex = rest.indexOf('?');
    if (queryIndex >= 0) {
      rest = rest.substring(0, queryIndex);
    }
    let decoded = '';
    try {
      decoded = decodeURIComponent(rest);
    } catch (error) {
      return '';
    }
    if (decoded.length === 0) {
      return `${RAW_PREFIX}index.html`;
    }
    if (decoded.indexOf('..') >= 0 || decoded.indexOf('\\') >= 0 || decoded.startsWith('/')) {
      return '';
    }
    for (let i = 0; i < decoded.length; i++) {
      if (!this.isPathChar(decoded.charCodeAt(i))) {
        return '';
      }
    }
    return `${RAW_PREFIX}${decoded}`;
  }

  private mimeFor(path: string): string {
    if (path.endsWith('.html')) return 'text/html';
    if (path.endsWith('.js')) return 'text/javascript';
    if (path.endsWith('.mjs')) return 'text/javascript';
    if (path.endsWith('.css')) return 'text/css';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.ico')) return 'image/x-icon';
    if (path.endsWith('.woff')) return 'font/woff';
    if (path.endsWith('.woff2')) return 'font/woff2';
    if (path.endsWith('.ttf')) return 'font/ttf';
    if (path.endsWith('.wasm')) return 'application/wasm';
    return '';
  }

  private textResponse(code: number, reason: string, mime: string, body: string): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseCode(code);
    response.setReasonMessage(reason);
    response.setResponseMimeType(mime);
    response.setResponseEncoding('utf-8');
    response.setResponseData(body);
    response.setResponseIsReady(true);
    return response;
  }

  private emptyResponse(code: number): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseCode(code);
    response.setReasonMessage('No Content');
    response.setResponseMimeType('text/plain');
    response.setResponseData('');
    response.setResponseIsReady(true);
    return response;
  }

  private buildResponse(url: string): WebResourceResponse {
    if (url === 'about:blank') {
      return this.emptyResponse(204);
    }
    const path = this.assetPath(url);
    const mime = path.length > 0 ? this.mimeFor(path) : '';
    if (path.length === 0 || mime.length === 0) {
      return this.textResponse(404, 'Not Found', 'text/plain', 'Not Found');
    }
    try {
      const data: Uint8Array = getContext(this).resourceManager.getRawFileContentSync(path);
      const buffer = new ArrayBuffer(data.length);
      new Uint8Array(buffer).set(data);
      const response = new WebResourceResponse();
      response.setResponseCode(200);
      response.setReasonMessage('OK');
      response.setResponseMimeType(mime);
      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml') {
        response.setResponseEncoding('utf-8');
      }
      const headers: Header[] = [{ headerKey: 'Cache-Control', headerValue: 'no-store' }];
      response.setResponseHeader(headers);
      response.setResponseData(buffer);
      response.setResponseIsReady(true);
      return response;
    } catch (error) {
      return this.textResponse(404, 'Not Found', 'text/plain', 'Not Found');
    }
  }

  build() {
    Column() {
      Web({ src: 'about:blank', controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .onControllerAttached(() => {
          this.bridge.setContext(getContext(this) as common.UIAbilityContext);
          this.controller.registerJavaScriptProxy(
            this.bridge,
            FgeHarmonyBridge.NAME,
            ['invoke'],
            [],
            FgeHarmonyBridge.PERMISSION
          );
          this.proxyReady = true;
          // about:blank may still finish after onControllerAttached; start only
          // after its page ends so it cannot overwrite the fixed-origin load.
          setTimeout(() => this.ensureStart(), 1000);
        })
        .onPageEnd(() => {
          this.ensureStart();
        })
        .onInterceptRequest((event) => this.buildResponse(event.request.getRequestUrl()))
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
