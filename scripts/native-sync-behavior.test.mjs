/**
 * Behavioral contract for the HarmonyOS native sync manager.
 *
 * The ArkTS source is bundled with esbuild (kits replaced by in-memory fakes)
 * so credential-retention and atomic-save behavior is executed, not merely
 * grepped. No device or HUKS is required.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANAGER_PATH = path.join(
  APP_ROOT,
  'harmony/entry/src/main/ets/bridge/FgeSyncManager.ets',
);
const MANAGER_SOURCE = readFileSync(MANAGER_PATH, 'utf8');

let bundleCounter = 0;

function createHarness() {
  const harness = {
    store: new Map(),
    flushError: null,
    encryptError: null,
    encryptGate: null,
    encryptStarted: false,
    requests: [],
    requestError: null,
    response: { responseCode: 200, header: {}, result: '{}' },
  };

  harness.preferences = {
    async getPreferences() {
      return {
        getSync(key, defaultValue) {
          return harness.store.has(key)
            ? harness.store.get(key)
            : defaultValue;
        },
        putSync(key, value) {
          harness.store.set(key, value);
        },
        deleteSync(key) {
          harness.store.delete(key);
        },
        clearSync() {
          harness.store.clear();
        },
        async flush() {
          if (harness.flushError) throw harness.flushError;
        },
      };
    },
  };

  const HuksTag = {
    HUKS_TAG_ALGORITHM: 1,
    HUKS_TAG_PURPOSE: 2,
    HUKS_TAG_KEY_SIZE: 3,
    HUKS_TAG_PADDING: 4,
    HUKS_TAG_BLOCK_MODE: 5,
    HUKS_TAG_DIGEST: 6,
    HUKS_TAG_NONCE: 7,
    HUKS_TAG_AE_TAG: 8,
  };
  const HuksKeyPurpose = {
    HUKS_KEY_PURPOSE_ENCRYPT: 1,
    HUKS_KEY_PURPOSE_DECRYPT: 2,
  };

  harness.huks = {
    HuksTag,
    HuksKeyPurpose,
    HuksKeyAlg: { HUKS_ALG_AES: 20 },
    HuksKeySize: { HUKS_AES_KEY_SIZE_256: 256 },
    HuksKeyPadding: { HUKS_PADDING_NONE: 0 },
    HuksCipherMode: { HUKS_MODE_GCM: 32 },
    HuksKeyDigest: { HUKS_DIGEST_NONE: 0 },
    async isKeyItemExist() {
      return true;
    },
    async generateKeyItem() {},
    async deleteKeyItem() {},
    async initSession() {
      return { handle: 1 };
    },
    async finishSession(_handle, options) {
      const purpose = options.properties.find(
        (property) => property.tag === HuksTag.HUKS_TAG_PURPOSE,
      )?.value;
      if (purpose === HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT) {
        if (harness.encryptGate) {
          harness.encryptStarted = true;
          await harness.encryptGate;
        }
        if (harness.encryptError) throw harness.encryptError;
        const output = new Uint8Array(options.inData.length + 16);
        output.set(options.inData, 0);
        return { outData: output };
      }
      return { outData: options.inData };
    },
  };

  harness.util = {
    Base64Helper: class {
      encodeToStringSync(bytes) {
        return Buffer.from(bytes).toString('base64');
      }
      decodeSync(text) {
        return new Uint8Array(Buffer.from(text, 'base64'));
      }
    },
    TextEncoder: class {
      encodeInto(text) {
        return new TextEncoder().encode(text);
      }
    },
    TextDecoder: class {
      decodeToString(bytes) {
        return new TextDecoder().decode(bytes);
      }
    },
  };

  harness.url = { URL: globalThis.URL };
  harness.cryptoFramework = {
    createRandom() {
      return {
        generateRandomSync(length) {
          return { data: new Uint8Array(length) };
        },
      };
    },
  };
  harness.http = {
    RequestMethod: { GET: 'GET', PUT: 'PUT' },
    HttpDataType: { STRING: 0 },
    createHttp() {
      return {
        async request(url, options) {
          harness.requests.push({ url, options });
          if (harness.requestError) throw harness.requestError;
          return harness.response;
        },
        destroy() {},
      };
    },
  };

  return harness;
}

const KIT_PLUGIN = {
  name: 'fge-kit-fakes',
  setup(builder) {
    builder.onResolve({ filter: /^@kit\./ }, (args) => ({
      path: args.path,
      namespace: 'fge-kit',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'fge-kit' }, (args) => {
      const harness = 'globalThis.__FGE_SYNC_HARNESS__';
      switch (args.path) {
        case '@kit.AbilityKit':
          return { contents: 'export const common = {};', loader: 'js' };
        case '@kit.ArkData':
          return {
            contents: `export const preferences = ${harness}.preferences;`,
            loader: 'js',
          };
        case '@kit.ArkTS':
          return {
            contents: `export const util = ${harness}.util;\nexport const url = ${harness}.url;`,
            loader: 'js',
          };
        case '@kit.NetworkKit':
          return {
            contents: `export const http = ${harness}.http;`,
            loader: 'js',
          };
        case '@kit.UniversalKeystoreKit':
          return {
            contents: `export const huks = ${harness}.huks;`,
            loader: 'js',
          };
        case '@kit.CryptoArchitectureKit':
          return {
            contents: `export const cryptoFramework = ${harness}.cryptoFramework;`,
            loader: 'js',
          };
        default:
          return { contents: 'export {};', loader: 'js' };
      }
    });
  },
};

async function loadManager(harness) {
  globalThis.__FGE_SYNC_HARNESS__ = harness;
  const result = await build({
    stdin: {
      contents: MANAGER_SOURCE,
      resolveDir: path.dirname(MANAGER_PATH),
      sourcefile: 'FgeSyncManager.ets',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    plugins: [KIT_PLUGIN],
  });
  const code = `${result.outputFiles[0].text}\n// bundle ${++bundleCounter}`;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  const manager = new module.FgeSyncManager();
  manager.setContext({
    abilityInfo: { bundleName: 'com.fge.open' },
  });
  return manager;
}

const A = {
  url: 'https://dav.example.com/dav/',
  username: 'learner',
  autoSync: true,
};
const B = {
  url: 'https://dav.example.com/other',
  username: 'learner',
  autoSync: true,
};

async function seed(manager, settings = A, password = 'old-password') {
  await manager.writeConfig(settings, password);
}

test('changed URL without a new password is rejected and old auth is kept', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);
  const before = harness.requests.length;

  await assert.rejects(
    manager.writeConfig(B, null),
    /重新输入|密码/,
  );

  const config = await manager.readConfig();
  assert.equal(config.url, A.url);
  assert.equal(config.hasPassword, true);

  await manager.request({
    method: 'GET',
    filename: 'fge-progress-public.json',
    headers: { Accept: 'application/json' },
  });
  assert.equal(harness.requests.length, before + 1);
  assert.match(harness.requests[before].url, /^https:\/\/dav\.example\.com\/dav\//);
  assert.equal(
    harness.requests[before].options.header.Authorization,
    `Basic ${Buffer.from('learner:old-password').toString('base64')}`,
  );
});

test('same normalized directory and username retains the stored password', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  await manager.writeConfig(
    { ...A, url: 'https://dav.example.com/dav' },
    null,
  );

  const config = await manager.readConfig();
  assert.equal(config.url, 'https://dav.example.com/dav');
  assert.equal(config.hasPassword, true);
});

test('changed username without a new password is rejected', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  await assert.rejects(
    manager.writeConfig({ ...A, username: 'someone-else' }, null),
    /重新输入|密码/,
  );
  assert.equal((await manager.readConfig()).username, A.username);
});

test('encryption failure leaves the previous URL and credential untouched', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);
  harness.encryptError = new Error('huks failure');

  await assert.rejects(manager.writeConfig(B, 'new-password'), /保存/);

  const config = await manager.readConfig();
  assert.equal(config.url, A.url);
  assert.equal(config.hasPassword, true);
});

test('flush failure restores the previous config instead of mixing targets', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);
  harness.flushError = new Error('disk full');

  await assert.rejects(manager.writeConfig(B, 'new-password'), /保存/);

  harness.flushError = null;
  const config = await manager.readConfig();
  assert.equal(config.url, A.url);
  assert.equal(config.hasPassword, true);
});

test('successful config save is a single stored record', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  assert.equal(harness.store.size, 1);
});

test('a slow write followed by disconnect leaves no stored credentials', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  let releaseEncrypt;
  harness.encryptGate = new Promise((resolve) => {
    releaseEncrypt = resolve;
  });
  const write = manager.writeConfig(B, 'new-password');
  const disconnect = manager.disconnect();

  while (!harness.encryptStarted) await Promise.resolve();
  releaseEncrypt();
  await Promise.allSettled([write, disconnect]);

  assert.equal(harness.store.size, 0);
  assert.equal(await manager.readConfig(), null);
});

test('HTTP root is accepted and MKCOL targets the fixed application folder', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  const HTTP_ROOT = {
    url: 'http://dav.example.com:8080/dav/',
    username: 'learner',
    autoSync: true,
  };
  await seed(manager, HTTP_ROOT);

  await manager.request({
    method: 'MKCOL',
    filename: 'fge-progress-public.json',
    headers: {},
  });

  const call = harness.requests[harness.requests.length - 1];
  assert.equal(
    call.url,
    'http://dav.example.com:8080/dav/FrenchGrammarExercise/',
  );
  assert.equal(call.options.customMethod, 'MKCOL');
  assert.equal(call.options.body, undefined);
  assert.equal(call.options.extraData, undefined);
  assert.equal(call.options.header.Authorization.startsWith('Basic '), true);
});

test('PROPFIND uses Depth 0 and the fixed folder target with an optional body', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);
  const body =
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

  await manager.request({
    method: 'PROPFIND',
    filename: 'fge-progress-public.json',
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
    body,
  });

  const call = harness.requests[harness.requests.length - 1];
  assert.equal(call.url, 'https://dav.example.com/dav/FrenchGrammarExercise/');
  assert.equal(call.options.customMethod, 'PROPFIND');
  assert.equal(call.options.body, body);
  assert.equal(call.options.extraData, undefined);
  assert.equal(call.options.header.Depth, '0');
});

test('GET and PUT target the fixed edition file inside the application folder', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  await manager.request({
    method: 'GET',
    filename: 'fge-progress-public.json',
    headers: { Accept: 'application/json' },
  });
  await manager.request({
    method: 'PUT',
    filename: 'fge-progress-public.json',
    headers: { 'Content-Type': 'application/json' },
    body: '{"format":"fge-sync"}',
  });

  assert.equal(
    harness.requests[0].url,
    'https://dav.example.com/dav/FrenchGrammarExercise/fge-progress-public.json',
  );
  assert.equal(
    harness.requests[1].url,
    'https://dav.example.com/dav/FrenchGrammarExercise/fge-progress-public.json',
  );
  assert.equal(harness.requests[1].options.body, '{"format":"fge-sync"}');
  assert.equal(harness.requests[1].options.extraData, undefined);
  assert.equal(harness.requests[0].options.customMethod, undefined);
});

test('DAV method and Depth bounds reject invalid requests before the network', async () => {
  const harness = createHarness();
  const manager = await loadManager(harness);
  await seed(manager);

  await assert.rejects(
    manager.request({
      method: 'MKCOL',
      filename: 'fge-progress-public.json',
      headers: {},
      body: 'not empty',
    }),
    /请求体/,
  );
  await assert.rejects(
    manager.request({
      method: 'PROPFIND',
      filename: 'fge-progress-public.json',
      headers: { Depth: '1' },
    }),
    /请求头/,
  );
  await assert.rejects(
    manager.request({
      method: 'GET',
      filename: 'fge-progress-public.json',
      headers: { Depth: '0' },
    }),
    /请求头/,
  );
  await assert.rejects(
    manager.request({
      method: 'DELETE',
      filename: 'fge-progress-public.json',
      headers: {},
    }),
    /方法/,
  );
  await assert.rejects(
    manager.request({
      method: 'MKCOL',
      filename: 'fge-progress-internal.json',
      headers: {},
    }),
    /文件名/,
  );
  assert.equal(harness.requests.length, 0);
});
