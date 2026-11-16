import { beforeEach, describe, expect, test, vi } from "vitest";
import { createBackup } from "../backup/progressBackup";
import { formatUserError } from "../i18n/errors";
import { DEFAULT_PROGRESS } from "../storage";
import type { Progress } from "../types";
import {
  accountFingerprint,
  readSyncBaseline,
  readSyncRecovery,
  readSyncRecoveryHistory,
  syncBaselineKey,
  syncRecoveryKey,
  writeSyncBaseline,
} from "./storage";
import { createSyncController } from "./controller";
import type { SyncAdapter, SyncConfig, SyncRequest, SyncResponse } from "./types";
import { DAV_PROPERTY_QUERY, SYNC_APP_FOLDER } from "./types";

const SETTINGS = {
  url: "https://dav.example.com/fge",
  username: "alice",
  autoSync: true,
};
const CONFIG: SyncConfig = { ...SETTINGS, hasPassword: true };

const emptyProgress = (): Progress => ({ ...DEFAULT_PROGRESS });
const richProgress = (xp = 40): Progress => ({
  ...DEFAULT_PROGRESS,
  xp,
  days: {
    "2026-11-14": {
      xp: 8,
      earnedQids: ["ch1-l1-q1"],
      bonusIds: [],
      readSeconds: 12,
      practiceSeconds: 30,
    },
  },
  lessons: { "ch1-l1": { completed: true, stars: 2 } },
  mistakes: { "ch1-l1-q2": { lastWrong: "2026-11-14", count: 1 } },
});
const backup = (progress: Progress) => createBackup(progress);

const envelope = (value: ReturnType<typeof backup>) =>
  JSON.stringify({ format: "fge-sync", version: 1, backup: value });

function davCollectionXml(href = `/dav/${SYNC_APP_FOLDER}/`): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<d:multistatus xmlns:d="DAV:">',
    "<d:response>",
    `<d:href>${href}</d:href>`,
    "<d:propstat>",
    "<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>",
    "<d:status>HTTP/1.1 200 OK</d:status>",
    "</d:propstat>",
    "</d:response>",
    "</d:multistatus>",
  ].join("");
}

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  failKeys = new Set<string>();
  failRemoveKeys = new Set<string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    if (this.failRemoveKeys.has(key)) throw new Error("remove failed");
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failKeys.has(key)) throw new Error("quota exceeded");
    this.data.set(key, value);
  }
}

/**
 * Minimal in-memory WebDAV service: directory MKCOL/PROPFIND plus GET/PUT file,
 * strong ETag and condition checks. Hooks let a test change local progress or
 * remote state at exact protocol points.
 */
function createServer(initial: ReturnType<typeof backup> | null = null) {
  const server = {
    backup: initial,
    etag: initial ? '"v1"' : null,
    version: 1,
    requests: [] as SyncRequest[],
    directoryExists: initial !== null,
    mkcolStatus: null as number | null,
    propfindStatus: null as number | null,
    propfindBody: null as string | null,
    etagMode: "normal" as "normal" | "missing" | "weak",
    getStatus: null as number | null,
    beforePut: null as ((request: SyncRequest) => void) | null,
    onRequest: null as ((request: SyncRequest) => void) | null,
    syncRequests(): SyncRequest[] {
      return server.requests.filter(
        (request) => request.method === "GET" || request.method === "PUT"
      );
    },
    handler(request: SyncRequest): SyncResponse {
      server.requests.push(request);
      server.onRequest?.(request);

      if (request.method === "MKCOL") {
        if (server.mkcolStatus !== null) {
          return { status: server.mkcolStatus, headers: {}, body: "" };
        }
        if (server.directoryExists) {
          return { status: 405, headers: {}, body: "" };
        }
        server.directoryExists = true;
        return { status: 201, headers: {}, body: "" };
      }

      if (request.method === "PROPFIND") {
        if (server.propfindStatus !== null) {
          return { status: server.propfindStatus, headers: {}, body: "" };
        }
        if (!server.directoryExists) {
          return { status: 404, headers: {}, body: "" };
        }
        return {
          status: 207,
          headers: { "Content-Type": "application/xml" },
          body: server.propfindBody ?? davCollectionXml(),
        };
      }

      if (request.method === "GET") {
        if (server.getStatus !== null) {
          return { status: server.getStatus, headers: {}, body: "" };
        }
        if (!server.backup) return { status: 404, headers: {}, body: "" };
        const headers: Record<string, string> = {};
        if (server.etagMode === "normal" && server.etag) {
          headers.ETag = server.etag;
        } else if (server.etagMode === "weak") {
          headers.ETag = `W/${server.etag ?? '"v1"'}`;
        }
        return { status: 200, headers, body: envelope(server.backup) };
      }

      server.beforePut?.(request);
      if (!server.directoryExists) {
        return { status: 409, headers: {}, body: "" };
      }
      if (!server.backup) {
        if (request.headers["If-None-Match"] !== "*") {
          return { status: 412, headers: {}, body: "" };
        }
      } else if (request.headers["If-Match"] !== server.etag) {
        return { status: 412, headers: {}, body: "" };
      }
      const parsed = JSON.parse(request.body ?? "{}") as { backup: ReturnType<typeof backup> };
      server.backup = parsed.backup;
      server.version += 1;
      server.etag = `"v${server.version}"`;
      return { status: 200, headers: { ETag: server.etag }, body: "" };
    },
  };
  return server;
}

function createHarness(
  options: {
    local?: Progress;
    config?: SyncConfig | null;
    initialRemote?: ReturnType<typeof backup> | null;
    storage?: MemoryStorage;
    canApplyRemote?: () => boolean;
  } = {}
) {
  const server = createServer(options.initialRemote ?? null);
  let local = options.local ?? emptyProgress();
  let currentConfig = options.config === undefined ? { ...CONFIG } : options.config;
  const applied: Progress[] = [];
  const adapter: SyncAdapter = {
    readConfig: vi.fn(async () => currentConfig),
    writeConfig: vi.fn(async (settings, password) => {
      currentConfig = {
        ...settings,
        hasPassword:
          password !== undefined || currentConfig?.hasPassword === true,
      };
    }),
    disconnect: vi.fn(async () => {
      currentConfig = null;
    }),
    request: vi.fn(async (request: SyncRequest) => server.handler(request)),
  };
  const storage = options.storage ?? new MemoryStorage();
  const controller = createSyncController({
    adapter,
    getProgress: () => local,
    applyProgress: (progress) => {
      applied.push(progress);
      local = progress;
    },
    canApplyRemote: options.canApplyRemote,
    storage,
  });
  return {
    controller,
    server,
    adapter,
    storage,
    applied,
    getLocal: () => local,
    setLocal: (progress: Progress) => {
      local = progress;
    },
    baseline: () => readSyncBaseline(storage, SETTINGS),
  };
}

/** First sync against an empty server uploads local progress and stores a baseline. */
async function establishBaseline(
  harness: ReturnType<typeof createHarness>,
  local: Progress = richProgress()
) {
  harness.setLocal(local);
  await harness.controller.initialize();
  expect(harness.server.syncRequests().map((request) => request.method)).toEqual([
    "GET",
    "PUT",
  ]);
  harness.server.requests.length = 0;
  return harness.server.etag as string;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("first connection", () => {
  test("本机有进度、云端无文件 → 条件新建并记录基线", async () => {
    const harness = createHarness({ local: richProgress() });
    await harness.controller.initialize();

    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put).toBeDefined();
    expect(put?.filename).toBe(`fge-progress-${__FGE_EDITION__}.json`);
    expect(put?.headers["If-None-Match"]).toBe("*");
    expect(put?.headers["If-Match"]).toBeUndefined();
    expect(harness.applied).toHaveLength(0);

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.lastSyncedAt).toEqual(expect.any(String));
    expect(harness.baseline()?.etag).toBe(harness.server.etag);
    expect(harness.baseline()?.progress).toEqual(richProgress());
  });

  test("本机为空、云端有进度 → 安全恢复,不上传", async () => {
    const remote = backup(richProgress(90));
    const harness = createHarness({ local: emptyProgress(), initialRemote: remote });
    await harness.controller.initialize();

    expect(harness.applied).toHaveLength(1);
    expect(harness.applied[0]).toEqual(richProgress(90));
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("synced");
    expect(harness.baseline()?.etag).toBe('"v1"');
    expect(harness.baseline()?.progress).toEqual(richProgress(90));
  });

  test("首次连接两边都有不同进度 → 冲突,不覆盖也不上传", async () => {
    const harness = createHarness({
      local: richProgress(10),
      initialRemote: backup(richProgress(20)),
    });
    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.conflict?.local.progress).toEqual(richProgress(10));
    expect(snapshot.conflict?.remote.progress).toEqual(richProgress(20));
    expect(snapshot.conflict?.remoteEtag).toBe('"v1"');
    expect(harness.applied).toHaveLength(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.baseline()).toBeNull();
    expect(readSyncRecovery(harness.storage, SETTINGS)?.reason).toBe("conflict");
  });

  test("两边进度相同 → 不写不应用,只记录基线", async () => {
    const harness = createHarness({
      local: richProgress(33),
      initialRemote: backup(richProgress(33)),
    });
    await harness.controller.initialize();

    expect(harness.controller.getSnapshot().status).toBe("synced");
    expect(harness.applied).toHaveLength(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.baseline()?.progress).toEqual(richProgress(33));
  });

  test("云端是空进度文件、本机有进度 → 用 If-Match 上传", async () => {
    const harness = createHarness({
      local: richProgress(12),
      initialRemote: backup(emptyProgress()),
    });
    await harness.controller.initialize();

    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["If-Match"]).toBe('"v1"');
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("两边都是空进度 → 不写不应用", async () => {
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(emptyProgress()),
    });
    await harness.controller.initialize();

    expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });
});

describe("application folder preparation", () => {
  test("首次同步先 MKCOL 201,再 GET/PUT 新目录文件", async () => {
    const harness = createHarness({ local: richProgress() });
    await harness.controller.initialize();

    expect(harness.server.requests.map((request) => request.method)).toEqual([
      "MKCOL",
      "GET",
      "PUT",
    ]);
    const mkcol = harness.server.requests[0];
    expect(mkcol.filename).toBe(`fge-progress-${__FGE_EDITION__}.json`);
    expect(mkcol.body).toBeUndefined();
    expect(mkcol.headers).toEqual({});
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("MKCOL 405 只有 PROPFIND 207 成功 collection 才继续", async () => {
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
    });
    await harness.controller.initialize();

    expect(harness.server.requests.map((request) => request.method)).toEqual([
      "MKCOL",
      "PROPFIND",
      "GET",
    ]);
    const propfind = harness.server.requests[1];
    expect(propfind.filename).toBe(`fge-progress-${__FGE_EDITION__}.json`);
    expect(propfind.headers.Depth).toBe("0");
    expect(propfind.body).toBe(DAV_PROPERTY_QUERY);
    expect(harness.applied).toEqual([richProgress(70)]);
  });

  test.each([
    ["HTML 207", "<html><body>created</body></html>"],
    [
      "没有 collection",
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/FrenchGrammarExercise/</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
    ],
    ["目标不是应用目录", davCollectionXml("/dav/Other/")],
    [
      "propstat 失败",
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/FrenchGrammarExercise/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>',
    ],
  ])("405 后 PROPFIND 207 %s → 停止且不 GET/PUT", async (_name, body) => {
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
    });
    harness.server.propfindBody = body;

    await harness.controller.initialize();

    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.server.syncRequests()).toHaveLength(0);
    expect(harness.applied).toHaveLength(0);
    expect(harness.baseline()).toBeNull();
  });

  test("PROPFIND 非 207 或 MKCOL 失败 → 停止且不 GET/PUT", async () => {
    const notMulti = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
    });
    notMulti.server.propfindStatus = 200;
    await notMulti.controller.initialize();
    expect(notMulti.controller.getSnapshot().status).toBe("error");
    expect(notMulti.server.syncRequests()).toHaveLength(0);

    const mkcolFailed = createHarness({ local: richProgress() });
    mkcolFailed.server.mkcolStatus = 500;
    await mkcolFailed.controller.initialize();
    expect(mkcolFailed.controller.getSnapshot().status).toBe("error");
    expect(mkcolFailed.server.syncRequests()).toHaveLength(0);
    expect(mkcolFailed.baseline()).toBeNull();
  });

  test("目录准备失败后下次同步重试,不会回退写用户根", async () => {
    const harness = createHarness({ local: richProgress() });
    harness.server.mkcolStatus = 500;
    await harness.controller.initialize();
    expect(harness.controller.getSnapshot().status).toBe("error");

    harness.server.mkcolStatus = null;
    harness.server.requests.length = 0;
    await harness.controller.sync();

    expect(harness.server.requests.map((request) => request.method)).toEqual([
      "MKCOL",
      "GET",
      "PUT",
    ]);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(true);
    expect(harness.server.backup?.progress).toEqual(richProgress());
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("旧根目录基线 namespace 不会让新目录首连直接上传", async () => {
    const harness = createHarness({
      local: richProgress(50),
      initialRemote: backup(richProgress(40)),
    });
    const fingerprint = accountFingerprint(SETTINGS);
    writeSyncBaseline(harness.storage, SETTINGS, {
      etag: '"v1"',
      progress: richProgress(40),
      syncedAt: "2026-11-15T09:00:00.000Z",
    });
    const newKey = syncBaselineKey(fingerprint);
    const raw = harness.storage.getItem(newKey);
    if (raw === null) throw new Error("baseline missing");
    harness.storage.setItem(
      `fge.sync.baseline.v1.${__FGE_EDITION__}.${fingerprint}`,
      raw
    );
    harness.storage.removeItem(newKey);

    await harness.controller.initialize();

    expect(harness.controller.getSnapshot().status).toBe("conflict");
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.baseline()).toBeNull();
  });

  test("同一配置 generation 只准备一次目录;configure 换代后重新准备", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);

    await harness.controller.sync();
    expect(harness.server.requests.map((request) => request.method)).toEqual(["GET"]);
    harness.server.requests.length = 0;

    await harness.controller.configure(SETTINGS);
    expect(harness.server.requests.slice(0, 3).map((request) => request.method)).toEqual([
      "MKCOL",
      "PROPFIND",
      "GET",
    ]);
  });

  test("配置换代时未完成的目录准备结果不能继续 GET/PUT", async () => {
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
    });
    let release!: (response: SyncResponse) => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const pending = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "MKCOL") {
        startedResolve();
        return pending;
      }
      return harness.server.handler(request);
    });

    const syncing = harness.controller.initialize();
    await started;
    await harness.controller.disconnect();
    release({ status: 201, headers: {}, body: "" });
    await syncing;

    expect(harness.server.syncRequests()).toHaveLength(0);
    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("disabled");
  });
});

describe("three-way comparison after a shared baseline", () => {
  test("无变化 → 只 GET,不写不应用", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const etag = await establishBaseline(harness);

    await harness.controller.sync();

    expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("synced");
    expect(harness.baseline()?.etag).toBe(etag);
  });

  test("仅云端变化 → 下载恢复,不上传", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.server.backup = backup(richProgress(70));
    harness.server.version += 1;
    harness.server.etag = `"v${harness.server.version}"`;

    await harness.controller.sync();

    expect(harness.applied).toEqual([richProgress(70)]);
    expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
    expect(harness.baseline()?.progress).toEqual(richProgress(70));
    expect(harness.baseline()?.etag).toBe(harness.server.etag);
  });

  test("仅本机变化 → 用当前 ETag 条件覆盖", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const etag = await establishBaseline(harness);
    harness.setLocal(richProgress(55));

    await harness.controller.sync();

    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["If-Match"]).toBe(etag);
    expect(harness.baseline()?.progress).toEqual(richProgress(55));
    expect(harness.baseline()?.etag).toBe(harness.server.etag);
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("双边不同变化 → 冲突并保留两份副本", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(45));
    harness.server.backup = backup(richProgress(80));
    harness.server.etag = '"v9"';

    await harness.controller.sync();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.conflict?.remoteEtag).toBe('"v9"');
    expect(harness.applied).toHaveLength(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.baseline()?.progress).toEqual(richProgress(40));
    expect(readSyncRecovery(harness.storage, SETTINGS)?.remote?.progress).toEqual(
      richProgress(80)
    );
  });

  test("本机被重置为空 → 不自动用空进度覆盖云端", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(emptyProgress());

    await harness.controller.sync();

    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.controller.getSnapshot().message).toMatch(/为空|覆盖/);
    expect(harness.baseline()?.progress).toEqual(richProgress(40));
  });

  test("云端变成空进度 → 不自动清空本机", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.server.backup = backup(emptyProgress());
    harness.server.etag = '"v2"';

    await harness.controller.sync();

    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.baseline()?.progress).toEqual(richProgress(40));
  });

  test("云端文件在建立基线后消失 → 停止,不擅自重建", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.server.backup = null;
    harness.server.etag = null;

    await harness.controller.sync();

    expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
    expect(harness.controller.getSnapshot().status).toBe("error");
  });

  test("云端缺少强 ETag → 停止自动覆盖", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    harness.server.etagMode = "missing";

    await harness.controller.sync();

    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.controller.getSnapshot().message).toMatch(/ETag|版本/);
  });

  test("弱 ETag → 同样停止", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    harness.server.etagMode = "weak";

    await harness.controller.sync();

    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("error");
  });

  test("云端内容损坏 → 不应用不覆盖", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    let corrupt = true;
    harness.server.onRequest = (request) => {
      if (request.method === "GET" && corrupt) {
        harness.server.backup = { nope: true } as unknown as ReturnType<typeof backup>;
      }
    };
    harness.server.etag = '"v8"';

    await harness.controller.sync();

    expect(harness.applied).toHaveLength(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("error");
    corrupt = false;
  });

  test("PUT 返回 412 → 重新 GET 并形成新冲突", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(55));
    harness.server.beforePut = () => {
      // 其他设备在我们上传前写入,条件写失败。
      harness.server.backup = backup(richProgress(80));
      harness.server.etag = '"v12"';
    };

    await harness.controller.sync();

    expect(harness.server.syncRequests().map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.conflict?.remoteEtag).toBe('"v12"');
  });

  test("GET 期间本机变化 → 不用下载结果覆盖,稍后再同步", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.server.backup = backup(richProgress(70));
    harness.server.etag = '"v7"';
    harness.server.onRequest = (request) => {
      if (request.method === "GET") {
        harness.setLocal(richProgress(41));
      }
    };

    await harness.controller.sync();

    expect(harness.applied).toHaveLength(0);
    expect(harness.getLocal()).toEqual(richProgress(41));
    expect(harness.controller.getSnapshot().status).not.toBe("conflict");
  });
});

describe("storage failures", () => {
  test("上传成功但基线写入失败 → 报错,不记录成功基线", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.storage.failKeys.add(syncBaselineKey(accountFingerprint(SETTINGS)));

    await harness.controller.initialize();

    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(true);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.controller.getSnapshot().message).toMatch(/基线|存储/);
    expect(harness.baseline()).toBeNull();
  });

  test("应用云端前进度回退副本保存失败 → 不应用", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.server.backup = backup(richProgress(70));
    harness.server.etag = '"v7"';
    harness.storage.failKeys.add(syncRecoveryKey(accountFingerprint(SETTINGS)));

    await harness.controller.sync();

    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.baseline()?.progress).toEqual(richProgress(40));
  });

  test("applyProgress 抛错 → 不记录新基线", async () => {
    const harness = createHarness({ local: emptyProgress(), initialRemote: backup(richProgress(70)) });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => harness.server.handler(request));
    const original = harness.controller;
    // 替身控制器:applyProgress 写入时失败。
    const controller = createSyncController({
      adapter: harness.adapter,
      getProgress: () => emptyProgress(),
      applyProgress: () => {
        throw new Error("disk full");
      },
      storage: harness.storage,
    });
    await controller.initialize();

    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().message).toMatch(/保存|应用/);
    expect(readSyncBaseline(harness.storage, SETTINGS)).toBeNull();
    original.dispose();
  });
});

describe("deferred apply", () => {
  test("学习视图禁止应用时保留云端结果,稍后手动同步再应用", async () => {
    let canApply = false;
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
      canApplyRemote: () => canApply,
    });
    await harness.controller.initialize();

    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("idle");
    expect(harness.controller.getSnapshot().message).toMatch(/稍后|学习/);
    expect(harness.baseline()).toBeNull();

    canApply = true;
    await harness.controller.sync();

    expect(harness.applied).toEqual([richProgress(70)]);
    expect(harness.controller.getSnapshot().status).toBe("synced");
    expect(harness.baseline()?.progress).toEqual(richProgress(70));
  });
});

describe("configure / initialize / disconnect", () => {
  test("初始化读取配置,autoSync=false 不发起请求", async () => {
    const harness = createHarness({
      local: richProgress(),
      config: { ...SETTINGS, autoSync: false, hasPassword: true },
    });
    await harness.controller.initialize();

    expect(harness.adapter.readConfig).toHaveBeenCalledTimes(1);
    expect(harness.server.requests).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("idle");
    expect(harness.controller.getSnapshot().config?.autoSync).toBe(false);
  });

  test("初始化 autoSync=true 自动尝试同步", async () => {
    const harness = createHarness({ local: richProgress() });
    await harness.controller.initialize();

    expect(harness.server.requests.length).toBeGreaterThan(0);
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("configure 改 URL 时写入配置、重置基线并立即同步", async () => {
    const harness = createHarness({ local: richProgress() });
    await establishBaseline(harness);
    harness.server.getStatus = 500;
    const next = { ...SETTINGS, url: "https://dav.example.com/other" };

    await harness.controller.configure(next);

    expect(harness.adapter.writeConfig).toHaveBeenCalled();
    expect(harness.baseline()).toBeNull();
    expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.controller.getSnapshot().config?.url).toBe(next.url);
  });

  test("configure 使用 native 读回的规范化配置", async () => {
    const harness = createHarness({ local: emptyProgress() });
    const normalized: SyncConfig = {
      url: "https://dav.example.com/normalized/",
      username: "alice",
      autoSync: true,
      hasPassword: true,
    };
    harness.adapter.writeConfig = vi.fn(async () => {});
    harness.adapter.readConfig = vi.fn(async () => normalized);

    await harness.controller.configure({
      ...SETTINGS,
      url: "https://dav.example.com/normalized",
    });

    expect(harness.adapter.readConfig).toHaveBeenCalled();
    expect(harness.controller.getSnapshot().config).toEqual(normalized);
  });

  test("configure 写成功但 readConfig 抛错 → 持续禁用网络直到重新发布配置", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    const previous = harness.controller.getSnapshot().config;
    const next: SyncConfig = {
      url: "https://dav.example.com/other",
      username: "alice",
      autoSync: true,
      hasPassword: true,
    };

    harness.adapter.readConfig = vi.fn(async () => {
      throw new Error("read failed");
    });
    await harness.controller.configure(next);

    expect(harness.controller.getSnapshot().config).toEqual(previous);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.server.requests).toHaveLength(0);

    await harness.controller.sync();
    expect(harness.server.requests).toHaveLength(0);

    // 成功重新读回并发布新配置后才解除封锁。
    harness.adapter.readConfig = vi.fn(async () => next);
    await harness.controller.configure(next);
    expect(harness.controller.getSnapshot().config?.url).toBe(next.url);
    expect(harness.server.requests.length).toBeGreaterThan(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("conflict");
  });

  test("configure 写成功但 readConfig 返回 null → 持续禁用网络", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    const previous = harness.controller.getSnapshot().config;
    const next: SyncConfig = {
      url: "https://dav.example.com/other",
      username: "alice",
      autoSync: true,
      hasPassword: true,
    };

    harness.adapter.readConfig = vi.fn(async () => null);
    await harness.controller.configure(next);

    expect(harness.controller.getSnapshot().config).toEqual(previous);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.server.requests).toHaveLength(0);

    await harness.controller.sync();
    expect(harness.server.requests).toHaveLength(0);
  });

  test("readback 失败后成功 disconnect 解除配置封锁", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    const next: SyncConfig = {
      url: "https://dav.example.com/other",
      username: "alice",
      autoSync: true,
      hasPassword: true,
    };
    harness.adapter.readConfig = vi.fn(async () => {
      throw new Error("read failed");
    });
    await harness.controller.configure(next);
    await harness.controller.sync();
    expect(harness.server.requests).toHaveLength(0);

    await harness.controller.disconnect();
    expect(harness.controller.getSnapshot().status).toBe("disabled");
    await harness.controller.sync();
    expect(harness.controller.getSnapshot().message).toMatch(/尚未配置/);
    expect(harness.server.requests).toHaveLength(0);
  });

  test("配置未确认时冲突选择也禁止网络", async () => {
    const harness = createHarness({
      local: richProgress(10),
      initialRemote: backup(richProgress(20)),
    });
    await harness.controller.initialize();
    expect(harness.controller.getSnapshot().status).toBe("conflict");
    harness.adapter.readConfig = vi.fn(async () => {
      throw new Error("read failed");
    });
    await harness.controller.configure({
      ...SETTINGS,
      url: "https://dav.example.com/other",
    });
    harness.server.requests.length = 0;

    await harness.controller.resolveConflict("remote");

    expect(harness.server.requests).toHaveLength(0);
    expect(harness.controller.getSnapshot().conflict).not.toBeNull();
  });

  test("同账号仅改 autoSync/密码保留共同基线", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const etag = await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    harness.server.requests.length = 0;

    await harness.controller.configure(
      { ...SETTINGS, autoSync: false },
      "new-password"
    );

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.conflict).toBeNull();
    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["If-Match"]).toBe(etag);
    expect(harness.baseline()?.progress).toEqual(richProgress(50));
    expect(harness.server.backup?.progress).toEqual(richProgress(50));
  });

  test("配置切换期间禁止旧 snapshot 触发同步", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const etag = await establishBaseline(harness);
    expect(etag).toBeTruthy();
    harness.setLocal(richProgress(50));
    harness.server.requests.length = 0;

    const next: SyncConfig = {
      url: "https://dav.example.com/other",
      username: "alice",
      autoSync: true,
      hasPassword: true,
    };
    let releaseWrite!: () => void;
    let startedWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      startedWrite = resolve;
    });
    harness.adapter.writeConfig = vi.fn(() => {
      startedWrite();
      return new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    });
    harness.adapter.readConfig = vi.fn(async () => next);

    const configuring = harness.controller.configure(next);
    await writeStarted;
    const syncing = harness.controller.sync();
    await Promise.resolve();

    expect(harness.server.requests).toHaveLength(0);
    releaseWrite();
    await configuring;
    await syncing;

    expect(harness.controller.getSnapshot().config?.url).toBe(next.url);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.server.backup?.progress).toEqual(richProgress(40));
    expect(harness.controller.getSnapshot().status).toBe("conflict");
  });

  test("配置写入挂起时 disconnect 排队在后,最终断开", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const order: string[] = [];
    let releaseWrite!: () => void;
    let startedWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      startedWrite = resolve;
    });
    harness.adapter.writeConfig = vi.fn(() => {
      order.push("write-start");
      startedWrite();
      return new Promise<void>((resolve) => {
        releaseWrite = () => {
          order.push("write-end");
          resolve();
        };
      });
    });
    harness.adapter.disconnect = vi.fn(async () => {
      order.push("disconnect");
    });

    const configuring = harness.controller.configure({
      ...SETTINGS,
      url: "https://dav.example.com/other",
    });
    await writeStarted;
    const disconnecting = harness.controller.disconnect();
    await Promise.resolve();
    expect(order).toEqual(["write-start"]);

    releaseWrite();
    await configuring;
    await disconnecting;

    expect(order).toEqual(["write-start", "write-end", "disconnect"]);
    expect(harness.controller.getSnapshot().status).toBe("disabled");
    expect(harness.controller.getSnapshot().config).toBeNull();
  });

  test("disconnect 挂起时重连同账号仍重置基线", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    harness.setLocal(richProgress(50));
    harness.server.requests.length = 0;

    let releaseDisconnect!: () => void;
    let startedDisconnect!: () => void;
    const disconnectStarted = new Promise<void>((resolve) => {
      startedDisconnect = resolve;
    });
    harness.adapter.disconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          startedDisconnect();
          releaseDisconnect = resolve;
        })
    );

    const disconnecting = harness.controller.disconnect();
    await disconnectStarted;
    const configuring = harness.controller.configure(SETTINGS);
    releaseDisconnect();
    await disconnecting;
    await configuring;

    expect(harness.controller.getSnapshot().config?.url).toBe(SETTINGS.url);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.server.backup?.progress).toEqual(richProgress(40));
    expect(harness.controller.getSnapshot().status).toBe("conflict");
  });

  test("清理旧基线失败 → fail closed,不发起同步", async () => {
    const harness = createHarness({
      local: richProgress(50),
      initialRemote: backup(richProgress(40)),
    });
    writeSyncBaseline(harness.storage, SETTINGS, {
      etag: '"old"',
      progress: richProgress(40),
      syncedAt: "2026-11-15T09:00:00.000Z",
    });
    harness.storage.failRemoveKeys.add(syncBaselineKey(accountFingerprint(SETTINGS)));

    await harness.controller.configure(SETTINGS);

    expect(harness.server.requests).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("error");
    expect(harness.controller.getSnapshot().message).toMatch(/基线|重置|清理/);
    expect(harness.baseline()).toBeNull();

    await harness.controller.sync();
    expect(harness.server.requests).toHaveLength(0);

    // 存储恢复后重新保存可重试清理并解除锁定;旧基线已不在,应重新比较而非直接上传。
    harness.storage.failRemoveKeys.clear();
    await harness.controller.configure(SETTINGS);
    expect(harness.server.requests.length).toBeGreaterThan(0);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.controller.getSnapshot().status).toBe("conflict");
  });

  test("disconnect 清除配置与基线,不触碰本机进度", async () => {
    const harness = createHarness({ local: richProgress() });
    await establishBaseline(harness);
    const local = harness.getLocal();

    await harness.controller.disconnect();

    expect(harness.adapter.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.controller.getSnapshot().status).toBe("disabled");
    expect(harness.controller.getSnapshot().config).toBeNull();
    expect(harness.baseline()).toBeNull();
    expect(harness.getLocal()).toEqual(local);
  });

  test("disconnect 使未完成请求过期,不再应用结果", async () => {
    const harness = createHarness({ local: emptyProgress(), initialRemote: backup(richProgress(70)) });
    let release!: (response: SyncResponse) => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const pending = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "MKCOL" || request.method === "PROPFIND") {
        return harness.server.handler(request);
      }
      startedResolve();
      return pending;
    });

    const syncing = harness.controller.initialize();
    await started;
    await harness.controller.disconnect();
    release({
      status: 200,
      headers: { ETag: '"v1"' },
      body: envelope(backup(richProgress(70))),
    });
    await syncing;

    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("disabled");
    expect(harness.baseline()).toBeNull();
  });

  test("configure 使旧配置的未完成请求过期", async () => {    const harness = createHarness({ local: emptyProgress(), initialRemote: backup(richProgress(70)) });
    let release!: (response: SyncResponse) => void;
    const pending = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    let first = true;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "MKCOL" || request.method === "PROPFIND") {
        return harness.server.handler(request);
      }
      if (first) {
        first = false;
        startedResolve();
        return pending;
      }
      harness.server.requests.push(request);
      return { status: 500, headers: {}, body: "" };
    });

    const syncing = harness.controller.initialize();
    await started;
    await harness.controller.configure({
      ...SETTINGS,
      url: "https://dav.example.com/other",
    });
    release({
      status: 200,
      headers: { ETag: '"v1"' },
      body: envelope(backup(richProgress(70))),
    });
    await syncing;

    expect(harness.applied).toHaveLength(0);
    expect(harness.controller.getSnapshot().config?.url).toBe(
      "https://dav.example.com/other"
    );
  });

  test("过期 GET 的失败不会覆盖新配置状态", async () => {
    const harness = createHarness({
      local: emptyProgress(),
      initialRemote: backup(richProgress(70)),
    });
    let rejectRequest!: (error: unknown) => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const pending = new Promise<SyncResponse>((_resolve, reject) => {
      rejectRequest = reject;
    });
    let first = true;
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "MKCOL" || request.method === "PROPFIND") {
        return harness.server.handler(request);
      }
      if (first) {
        first = false;
        startedResolve();
        return pending;
      }
      return { status: 401, headers: {}, body: "" };
    });

    const syncing = harness.controller.initialize();
    await started;
    await harness.controller.configure({
      ...SETTINGS,
      url: "https://dav.example.com/new",
    });
    expect(harness.controller.getSnapshot().message).toMatch(/认证|密码/);

    rejectRequest(new Error("offline"));
    await syncing;

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.config?.url).toBe("https://dav.example.com/new");
    expect(snapshot.message).toMatch(/认证|密码/);
    expect(snapshot.message).not.toMatch(/连接云端失败/);
  });

  test("未配置时 sync 保持 disabled 且不请求", async () => {
    const harness = createHarness({ local: richProgress(), config: null });
    await harness.controller.initialize();
    await harness.controller.sync();

    expect(harness.server.requests).toHaveLength(0);
    expect(harness.controller.getSnapshot().status).toBe("disabled");
  });
});

describe("conflict resolution", () => {
  async function conflicted() {
    const harness = createHarness({
      local: richProgress(10),
      initialRemote: backup(richProgress(20)),
    });
    await harness.controller.initialize();
    expect(harness.controller.getSnapshot().status).toBe("conflict");
    harness.server.requests.length = 0;
    return harness;
  }

  test("选择本机:条件覆盖已展示云端版本,保留旧副本", async () => {
    const harness = await conflicted();

    await harness.controller.resolveConflict("local");

    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["If-Match"]).toBe('"v1"');
    expect(JSON.parse(put?.body ?? "{}").backup.progress).toEqual(richProgress(10));
    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.conflict).toBeNull();
    expect(harness.baseline()?.progress).toEqual(richProgress(10));
    expect(readSyncRecovery(harness.storage, SETTINGS)?.reason).toBe("local-overwrite");
    expect(readSyncRecovery(harness.storage, SETTINGS)?.remote?.progress).toEqual(
      richProgress(20)
    );
  });

  test("选择云端:确认 ETag 后应用,保留本机旧副本", async () => {
    const harness = await conflicted();

    await harness.controller.resolveConflict("remote");

    expect(harness.applied).toEqual([richProgress(20)]);
    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.conflict).toBeNull();
    expect(harness.baseline()?.progress).toEqual(richProgress(20));
    expect(readSyncRecovery(harness.storage, SETTINGS)?.reason).toBe("remote-overwrite");
    expect(readSyncRecovery(harness.storage, SETTINGS)?.local?.progress).toEqual(
      richProgress(10)
    );
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
  });

  test("选择云端时 ETag 已变化 → 重新比较而不是应用过期版本", async () => {
    const harness = await conflicted();
    harness.server.backup = backup(richProgress(30));
    harness.server.etag = '"v5"';

    await harness.controller.resolveConflict("remote");

    expect(harness.applied).toHaveLength(0);
    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.conflict?.remoteEtag).toBe('"v5"');
  });

  test("选择本机时 PUT 412 → 重新比较形成新冲突", async () => {
    const harness = await conflicted();
    harness.server.beforePut = () => {
      harness.server.backup = backup(richProgress(60));
      harness.server.etag = '"v6"';
    };

    await harness.controller.resolveConflict("local");

    expect(harness.controller.getSnapshot().status).toBe("conflict");
    expect(harness.controller.getSnapshot().conflict?.remoteEtag).toBe('"v6"');
  });

  test("选择本机但恢复副本保存失败 → 保留冲突错误且不上传", async () => {
    const harness = await conflicted();
    harness.storage.failKeys.add(
      syncRecoveryKey(accountFingerprint(SETTINGS))
    );

    await harness.controller.resolveConflict("local");

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.error?.code).toBe("sync.error.recovery_save_failed");
    expect(snapshot.notice).toBeNull();
    expect(
      harness.server.requests.some((request) => request.method === "PUT")
    ).toBe(false);
  });

  test("并发冲突选择串行:先完成的 remote 生效,旧 local 选择不覆盖", async () => {
    const harness = await conflicted();
    let release!: (response: SyncResponse) => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const pending = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "GET") {
        startedResolve();
        return pending;
      }
      return harness.server.handler(request);
    });

    const remoteChoice = harness.controller.resolveConflict("remote");
    await started;
    const localChoice = harness.controller.resolveConflict("local");
    await Promise.resolve();

    // local 选择必须排在挂起的 remote 之后,不能在旧 GET 返回前完成覆盖。
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);

    release({
      status: 200,
      headers: { ETag: '"v1"' },
      body: envelope(backup(richProgress(20))),
    });
    await remoteChoice;
    await localChoice;

    expect(harness.applied).toEqual([richProgress(20)]);
    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(harness.getLocal()).toEqual(richProgress(20));
    expect(harness.server.backup?.progress).toEqual(richProgress(20));
    expect(harness.baseline()?.progress).toEqual(richProgress(20));
    expect(harness.controller.getSnapshot().status).toBe("synced");
  });

  test("旧冲突选择不作用于排队期间出现的新冲突", async () => {
    const harness = await conflicted();
    let release!: (response: SyncResponse) => void;
    let startedGet!: () => void;
    const started = new Promise<void>((resolve) => {
      startedGet = resolve;
    });
    const pending = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      if (request.method === "GET") {
        startedGet();
        return pending;
      }
      return harness.server.handler(request);
    });

    const syncing = harness.controller.sync();
    await started;
    const localChoice = harness.controller.resolveConflict("local");
    release({
      status: 200,
      headers: { ETag: '"v9"' },
      body: envelope(backup(richProgress(30))),
    });
    await syncing;
    await localChoice;

    expect(harness.server.requests.some((request) => request.method === "PUT")).toBe(false);
    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.conflict?.remote.progress).toEqual(richProgress(30));
    expect(snapshot.message).toMatch(/更新|重新选择|已处理/);
  });

  test("后续冲突不挤掉覆盖前恢复副本", async () => {
    const harness = await conflicted();
    await harness.controller.resolveConflict("remote");
    harness.setLocal(richProgress(25));
    harness.server.backup = backup(richProgress(30));
    harness.server.etag = '"v9"';

    await harness.controller.sync();

    expect(harness.controller.getSnapshot().status).toBe("conflict");
    const history = readSyncRecoveryHistory(harness.storage, SETTINGS);
    expect(
      history.some(
        (record) =>
          record.reason === "remote-overwrite" &&
          record.local.progress.xp === 10 &&
          record.remote?.progress.xp === 20
      )
    ).toBe(true);
    expect(readSyncRecovery(harness.storage, SETTINGS)?.local.progress.xp).toBe(25);
  });
});

describe("local change timer", () => {
  test("15 秒延迟只触发一次,学习计时不会无限重置", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({ local: richProgress(40) });
      await establishBaseline(harness);

      harness.controller.notifyLocalChange();
      await vi.advanceTimersByTimeAsync(5000);
      harness.controller.notifyLocalChange();
      await vi.advanceTimersByTimeAsync(5000);
      harness.controller.notifyLocalChange();
      await vi.advanceTimersByTimeAsync(5000);

      // 第一次变更后 15 秒准时尝试一次,后续学习计时不会把它推后。
      expect(harness.server.syncRequests().map((request) => request.method)).toEqual(["GET"]);
      expect(harness.controller.getSnapshot().status).toBe("synced");
    } finally {
      vi.useRealTimers();
    }
  });

  test("autoSync=false 不注册延迟任务", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({
        local: richProgress(40),
        config: { ...SETTINGS, autoSync: false, hasPassword: true },
      });
      await harness.controller.initialize();
      harness.server.requests.length = 0;

      harness.controller.notifyLocalChange();
      await vi.advanceTimersByTimeAsync(60000);

      expect(harness.server.requests).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("dispose 取消待执行任务并取消订阅", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({ local: richProgress(40) });
      await establishBaseline(harness);
      const listener = vi.fn();
      harness.controller.subscribe(listener);
      harness.controller.notifyLocalChange();
      harness.controller.dispose();
      await vi.advanceTimersByTimeAsync(60000);

      expect(harness.server.requests).toHaveLength(0);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("serialization and snapshot identity", () => {
  test("并发 sync 不重叠执行", async () => {
    const harness = createHarness({ local: richProgress(40) });
    await establishBaseline(harness);
    let active = 0;
    let maxActive = 0;
    harness.adapter.request = vi.fn(async (request: SyncRequest) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return harness.server.handler(request);
    });

    await Promise.all([
      harness.controller.sync(),
      harness.controller.sync(),
      harness.controller.sync(),
    ]);

    expect(maxActive).toBe(1);
    expect(harness.server.requests).toHaveLength(3);
  });

  test("快照只在状态变化时更换对象", async () => {
    const harness = createHarness({ local: richProgress(40) });
    const initial = harness.controller.getSnapshot();
    expect(harness.controller.getSnapshot()).toBe(initial);

    const listener = vi.fn();
    const unsubscribe = harness.controller.subscribe(listener);
    await harness.controller.initialize();
    expect(listener).toHaveBeenCalled();
    const after = harness.controller.getSnapshot();
    expect(after).not.toBe(initial);
    expect(harness.controller.getSnapshot()).toBe(after);

    unsubscribe();
    harness.controller.dispose();
  });

  test("上传期间本机再次变化:基线只记录已上传的那一份", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.server.beforePut = () => {
      harness.setLocal(richProgress(41));
    };

    await harness.controller.initialize();

    expect(harness.baseline()?.progress).toEqual(richProgress(40));
    harness.server.requests.length = 0;

    await harness.controller.sync();

    const put = harness.server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["If-Match"]).toBe('"v2"');
    expect(harness.baseline()?.progress).toEqual(richProgress(41));
  });
});

describe("结构化同步状态", () => {
  test("HTTP 认证失败提供稳定错误码，旧 message 继续可读", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.server.getStatus = 401;

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error?.code).toBe("sync.error.http_auth");
    expect(snapshot.message).toMatch(/认证|密码/);

    const fr = formatUserError(snapshot.error!, "fr");
    expect(fr.message.toLowerCase()).toContain("authentification");
    expect(fr.message).not.toMatch(/[\u3400-\u9fff]/);
  });

  test("成功同步带结构化提示码，切换语言即时得到法语", async () => {
    const harness = createHarness({ local: richProgress(40) });

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.notice?.code).toBe("sync.message.synced");
    expect(snapshot.error ?? null).toBeNull();

    const fr = formatUserError(snapshot.notice!, "fr").message;
    expect(fr).not.toMatch(/[\u3400-\u9fff]/);
    expect(fr.toLowerCase()).toContain("synchronis");
  });

  test("冲突提示也结构化，主提示不再依赖匹配中文", async () => {
    const harness = createHarness({
      local: richProgress(10),
      initialRemote: backup(richProgress(20)),
    });

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("conflict");
    expect(snapshot.notice?.code).toBe("sync.message.conflict");
    expect(snapshot.message).toContain("请选择保留哪一份");
    expect(formatUserError(snapshot.notice!, "fr").message).not.toMatch(
      /[\u3400-\u9fff]/
    );
  });

  test("HTTP 认证错误码不把中文原文当作语言判定依据", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.server.getStatus = 403;

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.error?.code).toBe("sync.error.http_auth");
    expect(snapshot.error?.code).not.toMatch(/[\u3400-\u9fff]/);
    expect(formatUserError(snapshot.error!, "fr").message).not.toBe(
      snapshot.message
    );
  });

  test("原生桥稳定错误码优先于本地网络兜底码", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.adapter.request = vi.fn(async () => {
      throw Object.assign(new Error("原生存储写入失败"), {
        code: "native.storage_failed",
        diagnostic: "native storage raw",
      });
    });

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error?.code).toBe("native.storage_failed");
    expect(snapshot.error?.diagnostic).toContain("native storage raw");
    const fr = formatUserError(snapshot.error!, "fr").message;
    expect(fr).toContain("stockage sécurisé");
    expect(snapshot.message).not.toBe(fr);
  });

  test("Capacitor Error.data 的原生错误码保留 params 与 diagnostic", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.adapter.request = vi.fn(async () => {
      throw Object.assign(new Error("native request failed"), {
        code: "native.network_failed",
        data: {
          params: { operation: "request" },
          diagnostic: "native network raw",
        },
      });
    });

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error?.code).toBe("native.network_failed");
    expect(snapshot.error?.params).toEqual({ operation: "request" });
    expect(snapshot.error?.diagnostic).toBe("native network raw");
    expect(formatUserError(snapshot.error!, "fr").message).not.toMatch(
      /[\u3400-\u9fff]/
    );
  });

  test("coded Error 无 diagnostic 时用 message 兜底", async () => {
    const harness = createHarness({ local: richProgress(40) });
    harness.adapter.request = vi.fn(async () => {
      throw Object.assign(new Error("native failure message"), {
        code: "native.network_failed",
      });
    });

    await harness.controller.initialize();

    const snapshot = harness.controller.getSnapshot();
    expect(snapshot.error?.code).toBe("native.network_failed");
    expect(snapshot.error?.diagnostic).toBe("native failure message");
  });
});
