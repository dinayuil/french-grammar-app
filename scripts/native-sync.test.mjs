import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function source(relative) {
  return readFileSync(path.join(APP_ROOT, relative), 'utf8');
}

const ANDROID_JAVA = 'android/app/src/main/java/com/fge/app';
const plugin = source(`${ANDROID_JAVA}/FgeSyncPlugin.java`);
const store = source(`${ANDROID_JAVA}/FgeSyncStore.java`);
const policy = source(`${ANDROID_JAVA}/FgeSyncPolicy.java`);
const targets = source(`${ANDROID_JAVA}/FgeSyncTargets.java`);
const http = source(`${ANDROID_JAVA}/FgeSyncHttp.java`);
const errors = source(`${ANDROID_JAVA}/FgeSyncErrors.java`);
const activity = source(`${ANDROID_JAVA}/MainActivity.java`);
const manifest = source('android/app/src/main/AndroidManifest.xml');
const buildGradle = source('android/app/build.gradle');
const harmonyBridge = source(
  'harmony/entry/src/main/ets/bridge/FgeHarmonyBridge.ets',
);
const harmonySync = source(
  'harmony/entry/src/main/ets/bridge/FgeSyncManager.ets',
);
const harmonyModule = source('harmony/entry/src/main/module.json5');
const jsNative = source('src/sync/native.ts');

test('Android registers the FgeSync Capacitor plugin', () => {
  assert.match(plugin, /@CapacitorPlugin\(name = "FgeSync"\)/);
  assert.match(activity, /registerPlugin\(FgeSyncPlugin\.class\)/);
});

test('Android stores credentials with AndroidKeyStore AES-GCM, not plaintext prefs', () => {
  assert.match(store, /"AndroidKeyStore"/);
  assert.match(store, /"AES\/GCM\/NoPadding"/);
  assert.match(store, /Base64\.encodeToString/);
  assert.match(store, /FgeSyncPolicy\.resolvePassword/);
  assert.match(store, /restore\(prefs/);
  assert.doesNotMatch(store, /putString\([^)]*PASSWORD/i);
  assert.doesNotMatch(store, /Log\.[a-z]+\([^)]*password/i);
});

test('Android URL policy accepts HTTP/HTTPS but rejects credential/query/fragment targets', () => {
  assert.match(policy, /!"https"\.equals\(scheme\) && !"http"\.equals\(scheme\)/);
  assert.match(policy, /getRawUserInfo\(\) != null/);
  assert.match(policy, /getRawQuery\(\) != null \|\| uri\.getRawFragment\(\) != null/);
  assert.match(policy, /lower\.contains\("%2e"\)/);
  assert.match(policy, /resolvePassword/);
  assert.match(http, /FgeSyncPolicy\.normalizeDirectoryUrl/);
});

test('Android uses OkHttp for real DAV methods and fixed application-folder targets', () => {
  assert.match(buildGradle, /com\.squareup\.okhttp3:okhttp/);
  assert.match(manifest, /android:usesCleartextTraffic="true"/);
  assert.match(http, /import okhttp3\./);
  assert.match(http, /builder\.method\(request\.method/);
  assert.match(http, /followRedirects\(false\)/);
  assert.match(http, /followSslRedirects\(false\)/);
  assert.doesNotMatch(
    http,
    /import java\.net\.HttpURLConnection|setAccessible|java\.lang\.reflect/,
  );
  assert.match(targets, /FrenchGrammarExercise/);
  assert.match(targets, /"MKCOL"\.equals\(method\)/);
  assert.match(targets, /"PROPFIND"\.equals\(method\)/);
  assert.match(targets, /"GET"\.equals\(method\) \|\| "PUT"\.equals\(method\)/);
});

test('Android HTTP is redirect-free, bounded and header-allowlisted including Depth 0', () => {
  assert.match(http, /MAX_SYNC_BYTES = 5 \* 1024 \* 1024/);
  assert.match(
    http,
    /Set\.of\("accept", "content-type", "if-match", "if-none-match", "depth"\)/,
  );
  assert.match(http, /builder\.header\("Authorization"/);
  assert.match(http, /"depth"\.equals\(lower\) && \(!"PROPFIND"\.equals\(method\) \|\| !"0"\.equals\(text\)\)/);
  assert.doesNotMatch(http, /authorization.*ALLOWED_HEADERS/i);
  assert.doesNotMatch(
    http,
    /TrustAll|ALLOW_ALL_HOSTNAME|setHostnameVerifier|X509TrustManager/,
  );
});

test('Android rejects with stable native codes and non-sensitive params', () => {
  for (const code of [
    'native.config_invalid',
    'native.credentials_required',
    'native.storage_failed',
    'native.network_failed',
    'native.unsupported',
    'native.unknown',
  ]) {
    assert.match(errors, new RegExp(code.replaceAll('.', '\\.')));
  }
  assert.match(plugin, /rejectWith\(/);
  assert.match(plugin, /rejectMessage\(/);
  assert.match(plugin, /rejectRequest\(call, error\)/);
  assert.match(plugin, /FgeSyncErrors\.forRequestFailure/);
  assert.match(plugin, /call\.reject\(payload\.message, payload\.code, data\)/);
  assert.match(plugin, /data\.put\("params", params\)/);
  assert.match(plugin, /data\.put\("diagnostic", payload\.message\)/);
  assert.doesNotMatch(plugin, /call\.reject\([^,)]*\)/);
});

test('Harmony declares INTERNET and routes sync operations without losing theme/share', () => {
  assert.match(harmonyModule, /ohos\.permission\.INTERNET/);
  assert.match(harmonyBridge, /case 'syncReadConfig'|=== 'syncReadConfig'/);
  assert.match(harmonyBridge, /syncWriteConfig/);
  assert.match(harmonyBridge, /syncDisconnect/);
  assert.match(harmonyBridge, /syncRequest/);
  assert.match(harmonyBridge, /applyTheme/);
  assert.match(harmonyBridge, /shareFile/);
});

test('Harmony sync uses HUKS AES-GCM, single-record config and no plaintext credentials', () => {
  assert.match(harmonySync, /@kit\.UniversalKeystoreKit/);
  assert.match(harmonySync, /HUKS_ALG_AES/);
  assert.match(harmonySync, /HUKS_MODE_GCM/);
  assert.match(harmonySync, /HUKS_TAG_AE_TAG/);
  assert.match(harmonySync, /putSync\(\s*KEY_CONFIG/);
  assert.match(harmonySync, /请重新输入应用密码/);
  assert.match(harmonySync, /class NativeSyncError extends Error/);
  assert.match(harmonySync, /native\.credentials_required/);
  assert.match(harmonySync, /native\.network_failed/);
  assert.match(harmonyBridge, /NativeSyncError/);
  assert.match(harmonyBridge, /native\.file_failed/);
  assert.match(harmonyBridge, /errorReply\(/);
  assert.match(harmonyBridge, /params\[/);
  assert.doesNotMatch(harmonySync, /console\.(log|info|error)/);
});

test('Harmony HTTP accepts HTTP/HTTPS, disables redirects and keeps the 5 MB limit', () => {
  assert.match(harmonySync, /maxRedirects: 0/);
  assert.match(harmonySync, /maxLimit: MAX_SYNC_BYTES/);
  assert.match(harmonySync, /MAX_SYNC_BYTES: number = 5 \* 1024 \* 1024/);
  assert.match(harmonySync, /SYNC_TIMEOUT_MS: number = 20000/);
  assert.match(harmonySync, /candidate\.protocol !== 'https:' && candidate\.protocol !== 'http:'/);
  assert.match(harmonySync, /options\.customMethod = method/);
  assert.match(harmonySync, /options\.body = body/);
  assert.doesNotMatch(harmonySync, /options\.extraData = body/);
  assert.match(harmonySync, /FrenchGrammarExercise/);
  assert.match(harmonySync, /lower === 'depth'/);
});

test('JS adapter exposes availability + adapter only for native containers', () => {
  assert.match(jsNative, /export function isSyncAvailable\(\): boolean/);
  assert.match(jsNative, /export function getSyncAdapter\(\): SyncAdapter \| null/);
  assert.match(jsNative, /fge-progress-public\.json/);
  assert.match(jsNative, /fge-progress-internal\.json/);
  assert.match(jsNative, /isHarmonyPlatform\(\)/);
  assert.match(jsNative, /sync_get_config/);
  assert.match(jsNative, /sync_set_config/);
  assert.match(jsNative, /sync_disconnect/);
  assert.match(jsNative, /sync_request/);
  assert.doesNotMatch(jsNative, /\bfetch\(|localStorage/);
  assert.doesNotMatch(jsNative, /Authorization:/);
});
