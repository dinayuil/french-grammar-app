import { beforeEach, describe, expect, test } from "vitest";
import { createBackup } from "../backup/progressBackup";
import type { Progress } from "../types";
import {
  SyncStorageError,
  accountFingerprint,
  clearSyncBaseline,
  clearSyncState,
  readSyncBaseline,
  readSyncRecovery,
  readSyncRecoveryHistory,
  syncBaselineKey,
  syncRecoveryKey,
  writeSyncBaseline,
  writeSyncRecovery,
} from "./storage";

const PROGRESS: Progress = {
  xp: 12,
  dailyGoal: 30,
  sound: true,
  translationEnabled: true,
  translationTiming: "after",
  shareCardContent: "both",
  days: {},
  lessons: { "ch1-l1": { completed: true, stars: 3 } },
  mistakes: {},
};

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  failKey: string | null = null;
  readonly failRemoveKeys = new Set<string>();

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
    if (this.failKey === key) throw new Error("quota exceeded");
    this.data.set(key, value);
  }
}

const SETTINGS = { url: "https://dav.example.com/fge", username: "alice" };
const OTHER = { url: "https://dav.example.com/fge", username: "bob" };
const backup = (progress: Progress = PROGRESS) => createBackup(progress);

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("account isolation", () => {
  test("不同账号/URL 得到不同指纹与存储键", () => {
    expect(accountFingerprint(SETTINGS)).not.toBe(accountFingerprint(OTHER));
    expect(accountFingerprint(SETTINGS)).not.toBe(
      accountFingerprint({ ...SETTINGS, url: "https://dav.example.com/other" })
    );
    expect(syncBaselineKey(accountFingerprint(SETTINGS))).not.toBe(
      syncBaselineKey(accountFingerprint(OTHER))
    );
    // edition 参与键,公开/内部互不读取。
    expect(syncBaselineKey("abc", "public")).toContain("public");
    expect(syncBaselineKey("abc", "internal")).toContain("internal");
    expect(syncBaselineKey("abc", "public")).not.toBe(syncBaselineKey("abc", "internal"));
  });
});

describe("baseline", () => {
  test("保存并读回基线", () => {
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    const record = readSyncBaseline(storage, SETTINGS);
    expect(record).not.toBeNull();
    expect(record?.etag).toBe('"v1"');
    expect(record?.progress).toEqual(PROGRESS);
    expect(record?.syncedAt).toBe("2026-11-15T10:00:00.000Z");
    expect(record?.edition).toBe(__FGE_EDITION__);
  });

  test("账号隔离:其他账号读不到基线", () => {
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    expect(readSyncBaseline(storage, OTHER)).toBeNull();
  });

  test("损坏 JSON、错误记录或 URL 不匹配 → null,不抛异常", () => {
    storage.setItem(syncBaselineKey(accountFingerprint(SETTINGS)), "{bad");
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();

    storage.setItem(
      syncBaselineKey(accountFingerprint(SETTINGS)),
      JSON.stringify({ version: 1, etag: '"v1"', progress: { nope: true } })
    );
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();

    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    const raw = JSON.parse(
      storage.getItem(syncBaselineKey(accountFingerprint(SETTINGS))) ?? "{}"
    ) as Record<string, unknown>;
    storage.setItem(
      syncBaselineKey(accountFingerprint(SETTINGS)),
      JSON.stringify({ ...raw, url: "https://evil.example.com" })
    );
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();
  });

  test("写入失败抛出 SyncStorageError;清除后读回 null", () => {
    storage.failKey = syncBaselineKey(accountFingerprint(SETTINGS));
    expect(() =>
      writeSyncBaseline(storage, SETTINGS, {
        etag: '"v1"',
        progress: PROGRESS,
        syncedAt: "2026-11-15T10:00:00.000Z",
      })
    ).toThrow(SyncStorageError);

    storage.failKey = null;
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    clearSyncBaseline(storage, SETTINGS);
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();
  });

  test("clearSyncBaseline 删除失败 → 抛错且旧基线不可用", () => {
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    const key = syncBaselineKey(accountFingerprint(SETTINGS));
    storage.failRemoveKeys.add(key);

    expect(() => clearSyncBaseline(storage, SETTINGS)).toThrow(SyncStorageError);
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();
    // 墓碑覆盖残留记录,即使 removeItem 持续失败也不会重新启用旧基线。
    expect(storage.getItem(key)).toBe("");
  });

  test("旧根目录基线 namespace 不会被新应用目录布局读取", () => {
    const fingerprint = accountFingerprint(SETTINGS);
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    const newKey = syncBaselineKey(fingerprint);
    const raw = storage.getItem(newKey);
    if (raw === null) throw new Error("baseline missing");
    storage.setItem(
      `fge.sync.baseline.v1.${__FGE_EDITION__}.${fingerprint}`,
      raw
    );
    storage.removeItem(newKey);

    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();
    expect(syncBaselineKey(fingerprint)).toContain(".v2.");
    // 恢复副本继续沿用旧 namespace,保证既有历史可读。
    expect(syncRecoveryKey(fingerprint)).toContain(".recovery.v1.");
  });

  test("无可用存储时读为 null、写入失败", () => {
    expect(readSyncBaseline(null, SETTINGS)).toBeNull();
    expect(() =>
      writeSyncBaseline(undefined, SETTINGS, {
        etag: '"v1"',
        progress: PROGRESS,
        syncedAt: "2026-11-15T10:00:00.000Z",
      })
    ).toThrow(SyncStorageError);
  });
});

describe("recovery copies", () => {
  test("冲突两份快照按账号保存并可读回", () => {
    const local = backup();
    const remote = createBackup({ ...PROGRESS, xp: 99 });
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:00:00.000Z",
      reason: "conflict",
      local,
      remote,
    });
    const record = readSyncRecovery(storage, SETTINGS);
    expect(record?.reason).toBe("conflict");
    expect(record?.local.progress).toEqual(local.progress);
    expect(record?.remote?.progress).toEqual(remote.progress);
    expect(readSyncRecovery(storage, OTHER)).toBeNull();
    expect(storage.getItem(syncRecoveryKey(accountFingerprint(SETTINGS)))).toContain(
      "conflict"
    );
  });

  test("清除同步状态同时移除基线与恢复副本", () => {
    writeSyncBaseline(storage, SETTINGS, {
      etag: '"v1"',
      progress: PROGRESS,
      syncedAt: "2026-11-15T10:00:00.000Z",
    });
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:00:00.000Z",
      reason: "remote-apply",
      local: backup(),
      remote: null,
    });
    clearSyncState(storage, SETTINGS);
    expect(readSyncBaseline(storage, SETTINGS)).toBeNull();
    expect(readSyncRecovery(storage, SETTINGS)).toBeNull();
  });

  test("恢复副本历史有界且冲突不挤掉覆盖前副本", () => {
    const withXp = (xp: number) => createBackup({ ...PROGRESS, xp });
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:00:00.000Z",
      reason: "conflict",
      local: withXp(10),
      remote: withXp(20),
    });
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:01:00.000Z",
      reason: "remote-overwrite",
      local: withXp(10),
      remote: withXp(20),
    });
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:02:00.000Z",
      reason: "conflict",
      local: withXp(25),
      remote: withXp(30),
    });

    let history = readSyncRecoveryHistory(storage, SETTINGS);
    expect(history).toHaveLength(3);
    expect(readSyncRecovery(storage, SETTINGS)?.local.progress.xp).toBe(25);
    expect(
      history.some(
        (record) =>
          record.reason === "remote-overwrite" &&
          record.local.progress.xp === 10 &&
          record.remote?.progress.xp === 20
      )
    ).toBe(true);

    // 重复同一个冲突不新增、不驱逐覆盖前副本。
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:03:00.000Z",
      reason: "conflict",
      local: withXp(25),
      remote: withXp(30),
    });
    history = readSyncRecoveryHistory(storage, SETTINGS);
    expect(history).toHaveLength(3);
    expect(
      history.some((record) => record.reason === "remote-overwrite")
    ).toBe(true);

    // 又一个新冲突只驱逐最旧 conflict,覆盖前副本仍在。
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:04:00.000Z",
      reason: "conflict",
      local: withXp(35),
      remote: withXp(40),
    });
    history = readSyncRecoveryHistory(storage, SETTINGS);
    expect(history).toHaveLength(3);
    expect(
      history.some(
        (record) =>
          record.reason === "remote-overwrite" &&
          record.local.progress.xp === 10
      )
    ).toBe(true);
    expect(history.some((record) => record.local.progress.xp === 35)).toBe(true);
  });

  test("历史缺失时从兼容单槽记录回退", () => {
    writeSyncRecovery(storage, SETTINGS, {
      savedAt: "2026-11-15T10:00:00.000Z",
      reason: "conflict",
      local: backup(),
      remote: null,
    });
    for (const key of [...storage.data.keys()]) {
      if (key.includes(".history.")) storage.removeItem(key);
    }
    const history = readSyncRecoveryHistory(storage, SETTINGS);
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe("conflict");
  });

  test("恢复副本写入失败抛出 SyncStorageError", () => {
    storage.failKey = syncRecoveryKey(accountFingerprint(SETTINGS));
    expect(() =>
      writeSyncRecovery(storage, SETTINGS, {
        savedAt: "2026-11-15T10:00:00.000Z",
        reason: "conflict",
        local: backup(),
        remote: null,
      })
    ).toThrow(SyncStorageError);
  });
});
