import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { STORAGE_KEY } from "../config";
import type { Progress } from "../types";
import {
  BackupCancelledError,
  BackupError,
  RECOVERY_STORAGE_KEY,
  createBackup,
  exportBackup,
  isBackupCancelled,
  loadRecoveryBackup,
  parseBackup,
  restoreBackup,
} from "./progressBackup";

const ISO = "2026-11-14T08:09:10.123Z";
const INCOMING_URI = "file:///cache/backup/fge-progress.json";

const RICH: Progress = {
  xp: 321,
  dailyGoal: 0,
  sound: false,
  translationEnabled: false,
  translationTiming: "before",
  days: {
    "2026-11-14": {
      xp: 12,
      earnedQids: ["legacy-ch99-l1-q1", "ch1-l1-q1"],
      bonusIds: ["legacy-ch99-l1", "legacy-ch99-l1:perfect"],
      sharePrompted: false,
      readSeconds: 0,
      practiceSeconds: 90,
    },
  },
  lessons: {
    "legacy-ch99-l1": { completed: true, stars: 2 },
    "ch1-l1": { completed: false, stars: 0 },
  },
  mistakes: {
    "legacy-ch99-l1-q1": { lastWrong: "2026-11-13", count: 0 },
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 生成 20000 条合法 lesson,用长 ID 把 JSON 推到 5MB 边界附近。 */
function hugeProgress(keyLength: number): Progress {
  const lessons: Progress["lessons"] = {};
  for (let index = 0; index < 20000; index += 1) {
    const prefix = `l${String(index).padStart(5, "0")}-`;
    const key = `${prefix}${"x".repeat(keyLength)}`.slice(0, keyLength);
    lessons[key] = { completed: false, stars: 0 };
  }
  return { ...RICH, lessons };
}

function rawBackup(
  top: Record<string, unknown> = {},
  progress: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    format: "fge-progress",
    version: 1,
    edition: __FGE_EDITION__,
    exportedAt: ISO,
    progress: { ...clone(RICH), ...progress },
    ...top,
  };
}

function parseRaw(raw: unknown) {
  return parseBackup(JSON.stringify(raw));
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------ */
/* Capacitor mocks (same shape the export path uses)                   */
/* ------------------------------------------------------------------ */

const capacitorMock = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitorMock }));

const filesystemMock = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystemMock,
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));

const sharePluginMock = vi.hoisted(() => ({ share: vi.fn() }));

vi.mock("@capacitor/share", () => ({ Share: sharePluginMock }));

/* ------------------------------------------------------------------ */
/* Web download mocks                                                  */
/* ------------------------------------------------------------------ */

const urlDescriptors = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
};

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchors: HTMLAnchorElement[];
let clickedAnchorsConnected: boolean[];

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor?: PropertyDescriptor
): void {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    delete (URL as unknown as Record<string, unknown>)[name];
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();

  capacitorMock.isNativePlatform.mockReturnValue(false);
  filesystemMock.writeFile.mockResolvedValue({ uri: INCOMING_URI });
  filesystemMock.getUri.mockResolvedValue({ uri: INCOMING_URI });
  sharePluginMock.share.mockResolvedValue({ activityType: "test" });

  clickedAnchors = [];
  clickedAnchorsConnected = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
      clickedAnchorsConnected.push(this.isConnected);
    }
  );

  createObjectURL = vi.fn(() => "blob:backup-url");
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  restoreUrlMethod("createObjectURL", urlDescriptors.createObjectURL);
  restoreUrlMethod("revokeObjectURL", urlDescriptors.revokeObjectURL);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* createBackup                                                        */
/* ------------------------------------------------------------------ */

describe("createBackup", () => {
  test("生成带版本号的备份且只含约定字段", () => {
    const backup = createBackup(RICH);

    expect(backup.format).toBe("fge-progress");
    expect(backup.version).toBe(1);
    expect(backup.edition).toBe(__FGE_EDITION__);
    expect(Object.keys(backup).sort()).toEqual([
      "edition",
      "exportedAt",
      "format",
      "progress",
      "version",
    ]);
    expect(backup.progress).toEqual(RICH);
    expect(backup.exportedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  test("导出时间取自当前时钟", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO));

    expect(createBackup(RICH).exportedAt).toBe(ISO);
  });

  test("剥离 progress 内的额外字段与权益字段", () => {
    const dirty = clone(RICH) as Progress & Record<string, unknown>;
    dirty.theme = "dark";
    dirty.entitlements = { pro: true };
    const backup = createBackup(dirty);

    expect(backup.progress).toEqual(RICH);
    expect((backup as unknown as Record<string, unknown>).theme).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain("entitlements");
  });

  test("非法进度拒绝导出,抛出可读错误", () => {
    expect(() => createBackup({ ...RICH, xp: -1 })).toThrow(BackupError);
    expect(() => createBackup({ ...RICH, xp: -1 })).toThrow(/xp/);
    expect(() =>
      createBackup({
        ...RICH,
        days: {
          "2026-02-30": { xp: 1, earnedQids: [], bonusIds: [] },
        },
      })
    ).toThrow(/日期/);
  });
});

/* ------------------------------------------------------------------ */
/* parseBackup                                                         */
/* ------------------------------------------------------------------ */

describe("parseBackup 往返与白名单", () => {
  test("完整进度往返一致", () => {
    const backup = createBackup(RICH);
    const parsed = parseBackup(JSON.stringify(backup));

    expect(parsed).toEqual(backup);
    expect(parsed.progress).toEqual(RICH);
  });

  test("dailyGoal=0、stars=0、count=0 均合法", () => {
    const parsed = parseRaw(rawBackup());

    expect(parsed.progress.dailyGoal).toBe(0);
    expect(parsed.progress.lessons["ch1-l1"].stars).toBe(0);
    expect(parsed.progress.mistakes["legacy-ch99-l1-q1"].count).toBe(0);
  });

  test("保留当前题库中不存在的旧内容 ID", () => {
    const parsed = parseRaw(rawBackup());

    expect(parsed.progress.lessons["legacy-ch99-l1"]).toEqual({
      completed: true,
      stars: 2,
    });
    expect(parsed.progress.mistakes["legacy-ch99-l1-q1"]).toEqual({
      lastWrong: "2026-11-13",
      count: 0,
    });
    expect(parsed.progress.days["2026-11-14"].earnedQids).toContain(
      "legacy-ch99-l1-q1"
    );
  });

  test("额外权益/未知字段不会穿透,只输出白名单", () => {
    const progress = clone(RICH) as unknown as Record<string, unknown>;
    (progress.days as Record<string, Record<string, unknown>>)["2026-11-14"].extra =
      "day";
    (progress.lessons as Record<string, Record<string, unknown>>)[
      "legacy-ch99-l1"
    ].entitled = true;
    (progress.mistakes as Record<string, Record<string, unknown>>)[
      "legacy-ch99-l1-q1"
    ].note = "x";

    const parsed = parseRaw(
      rawBackup(
        { entitlement: { pro: true }, theme: "dark", purchased: ["x"] },
        progress
      )
    );

    expect(parsed.progress).toEqual(RICH);
    expect(JSON.stringify(parsed)).not.toContain("entitlement");
    expect(JSON.stringify(parsed)).not.toContain("purchased");
    expect(JSON.stringify(parsed)).not.toContain("theme");
    expect(
      (parsed.progress.days["2026-11-14"] as unknown as Record<string, unknown>)
        .extra
    ).toBeUndefined();
  });
});

describe("parseBackup 拒绝坏文件", () => {
  test.each([
    ["空文本", "", /JSON|有效/],
    ["非 JSON", "{oops", /JSON/],
    ["JSON null", "null", /对象/],
    ["JSON 数组", "[]", /对象/],
    ["JSON 字符串", '"hello"', /对象/],
  ])("%s", (_name, text, pattern) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(pattern);
  });

  test("超出 5MB 上限,先于解析拒绝", () => {
    const oversized = `${JSON.stringify(rawBackup())}${"x".repeat(5 * 1024 * 1024)}`;
    expect(() => parseBackup(oversized)).toThrow(/大小|上限|5\s*MB/i);
  });

  test("format 非本应用", () => {
    expect(() => parseRaw(rawBackup({ format: "other-app" }))).toThrow(
      /不是本应用/
    );
    expect(() => parseRaw(rawBackup({ format: undefined }))).toThrow(
      /不是本应用/
    );
  });

  test("未知 version", () => {
    expect(() => parseRaw(rawBackup({ version: 2 }))).toThrow(/版本/);
    expect(() => parseRaw(rawBackup({ version: "1" }))).toThrow(/版本/);
    expect(() => parseRaw(rawBackup({ version: undefined }))).toThrow(/版本/);
  });

  test("edition 非法或跨版本均拒绝", () => {
    const other = __FGE_EDITION__ === "public" ? "internal" : "public";
    expect(() => parseRaw(rawBackup({ edition: other }))).toThrow(
      /版本|edition|不匹配/
    );
    expect(() => parseRaw(rawBackup({ edition: "global" }))).toThrow(
      /版本|edition|标识/
    );
    expect(() => parseRaw(rawBackup({ edition: undefined }))).toThrow(
      /版本|edition|标识/
    );
  });

  test("缺失或非对象 progress", () => {
    expect(() => parseRaw(rawBackup({ progress: undefined }))).toThrow(
      /progress|进度/
    );
    expect(() => parseRaw(rawBackup({ progress: [] }))).toThrow(
      /progress|进度/
    );
    expect(() => parseRaw(rawBackup({ progress: "x" }))).toThrow(
      /progress|进度/
    );
  });

  test("exportedAt 必须是真实 ISO 时间", () => {
    expect(() => parseRaw(rawBackup({ exportedAt: "2026-11-14" }))).toThrow(
      /时间/
    );
    expect(() =>
      parseRaw(rawBackup({ exportedAt: "2026-02-30T00:00:00.000Z" }))
    ).toThrow(/时间/);
    expect(() =>
      parseRaw(rawBackup({ exportedAt: "2026-11-14T25:00:00.000Z" }))
    ).toThrow(/时间/);
    expect(() => parseRaw(rawBackup({ exportedAt: undefined }))).toThrow(
      /时间/
    );
  });

  test("数值字段拒绝负数、小数、非安全整数与非数字", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["xp 负数", { xp: -1 }],
      ["xp 小数", { xp: 1.5 }],
      ["xp 超安全整数", { xp: Number.MAX_SAFE_INTEGER + 2 }],
      ["xp 字符串", { xp: "12" }],
      ["xp null", { xp: null }],
      ["dailyGoal 负数", { dailyGoal: -1 }],
      ["dailyGoal 小数", { dailyGoal: 30.5 }],
      ["dailyGoal null", { dailyGoal: null }],
    ];
    for (const [name, progress] of cases) {
      expect(() => parseRaw(rawBackup({}, progress)), name).toThrow(
        /xp|dailyGoal|非负|整数/
      );
    }
  });

  test("布尔与翻译时机严格校验", () => {
    expect(() => parseRaw(rawBackup({}, { sound: 1 }))).toThrow(/sound/);
    expect(() =>
      parseRaw(rawBackup({}, { translationEnabled: "yes" }))
    ).toThrow(/translationEnabled/);
    expect(() =>
      parseRaw(rawBackup({}, { translationTiming: "later" }))
    ).toThrow(/translationTiming/);
  });

  test("days 必须是对象且键为真实日期", () => {
    expect(() => parseRaw(rawBackup({}, { days: [] }))).toThrow(/days/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-02-30": { xp: 1, earnedQids: [], bonusIds: [] },
          },
        })
      )
    ).toThrow(/日期/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-1-1": { xp: 1, earnedQids: [], bonusIds: [] },
          },
        })
      )
    ).toThrow(/日期/);
  });

  test("day 记录字段严格校验", () => {
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": { xp: -1, earnedQids: [], bonusIds: [] },
          },
        })
      )
    ).toThrow(/xp/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": { xp: 1, earnedQids: "q1", bonusIds: [] },
          },
        })
      )
    ).toThrow(/earnedQids/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": { xp: 1, earnedQids: [1], bonusIds: [] },
          },
        })
      )
    ).toThrow(/earnedQids/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": { xp: 1, earnedQids: [""], bonusIds: [] },
          },
        })
      )
    ).toThrow(/earnedQids/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": {
              xp: 1,
              earnedQids: [],
              bonusIds: [],
              sharePrompted: "yes",
            },
          },
        })
      )
    ).toThrow(/sharePrompted/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          days: {
            "2026-11-14": {
              xp: 1,
              earnedQids: [],
              bonusIds: [],
              practiceSeconds: -3,
            },
          },
        })
      )
    ).toThrow(/practiceSeconds/);
  });

  test("lessons 严格校验星级 0..3 与 completed", () => {
    for (const stars of [-1, 1.5, 4, "3", null]) {
      expect(() =>
        parseRaw(
          rawBackup({}, {
            lessons: { "ch1-l1": { completed: true, stars } },
          })
        )
      ).toThrow(/stars/);
    }
    expect(() =>
      parseRaw(
        rawBackup({}, {
          lessons: { "ch1-l1": { completed: "yes", stars: 3 } },
        })
      )
    ).toThrow(/completed/);
    expect(() => parseRaw(rawBackup({}, { lessons: [] }))).toThrow(/lessons/);
  });

  test("mistakes 严格校验 lastWrong 与 count", () => {
    expect(() =>
      parseRaw(
        rawBackup({}, {
          mistakes: { q1: { lastWrong: "2026-02-30", count: 1 } },
        })
      )
    ).toThrow(/lastWrong|日期/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          mistakes: { q1: { lastWrong: "2026-11-13", count: -1 } },
        })
      )
    ).toThrow(/count/);
    expect(() =>
      parseRaw(
        rawBackup({}, {
          mistakes: { q1: { lastWrong: "2026-11-13", count: 1.5 } },
        })
      )
    ).toThrow(/count/);
    expect(() => parseRaw(rawBackup({}, { mistakes: [] }))).toThrow(
      /mistakes/
    );
  });

  test("记录数量有上限", () => {
    const days: Record<string, unknown> = {};
    for (let i = 0; i < 3661; i += 1) {
      const date = new Date(Date.UTC(2020, 0, 1 + i));
      const key = date.toISOString().slice(0, 10);
      days[key] = { xp: 0, earnedQids: [], bonusIds: [] };
    }
    expect(() => parseRaw(rawBackup({}, { days }))).toThrow(/数量|上限/);
  });

  test("拒绝原型污染键", () => {
    const protoDays = JSON.parse(
      '{"__proto__":{"xp":1,"earnedQids":[],"bonusIds":[]}}'
    );
    expect(() => parseRaw(rawBackup({}, { days: protoDays }))).toThrow(
      /__proto__|非法键/
    );

    const protoLessons = JSON.parse(
      '{"constructor":{"completed":true,"stars":1}}'
    );
    expect(() => parseRaw(rawBackup({}, { lessons: protoLessons }))).toThrow(
      /constructor|非法键/
    );

    const root = JSON.parse(
      `{"format":"fge-progress","version":1,"edition":"${__FGE_EDITION__}","exportedAt":"${ISO}","progress":${JSON.stringify(
        RICH
      )},"__proto__":{"polluted":true}}`
    );
    expect(() => parseRaw(root)).toThrow(/__proto__|非法键/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* restoreBackup / loadRecoveryBackup                                  */
/* ------------------------------------------------------------------ */

describe("restoreBackup", () => {
  test("保存按 edition 隔离的回退快照后写入新进度", () => {
    const incoming = createBackup({ ...RICH, xp: 9001 });
    const setSpy = vi.spyOn(Storage.prototype, "setItem");

    restoreBackup(incoming, RICH);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(
      incoming.progress
    );
    const recovery = loadRecoveryBackup();
    expect(recovery).not.toBeNull();
    expect(recovery!.format).toBe("fge-progress");
    expect(recovery!.version).toBe(1);
    expect(recovery!.edition).toBe(__FGE_EDITION__);
    expect(recovery!.progress).toEqual(RICH);
    expect(RECOVERY_STORAGE_KEY).toBe(
      __FGE_EDITION__ === "public"
        ? "fge.public.progress.recovery.v1"
        : "fge.progress.recovery.v1"
    );
    const writtenKeys = setSpy.mock.calls.map((call) => String(call[0]));
    expect(writtenKeys).toEqual([RECOVERY_STORAGE_KEY, STORAGE_KEY]);
    setSpy.mockRestore();
  });

  test("无效备份在写入前拒绝,当前进度与快照均不变", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(RICH));
    const forged = {
      ...createBackup({ ...RICH, xp: 7 }),
      progress: { ...RICH, xp: -1 },
    };

    expect(() => restoreBackup(forged, RICH)).toThrow(BackupError);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(RICH));
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  test("跨 edition 备份拒绝恢复", () => {
    const other: "public" | "internal" =
      __FGE_EDITION__ === "public" ? "internal" : "public";
    const forged = { ...createBackup(RICH), edition: other };

    expect(() => restoreBackup(forged, RICH)).toThrow(/版本|edition/);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  test("写入新进度 quota 失败时原进度保留且错误可读", () => {
    const before = JSON.stringify(RICH);
    localStorage.setItem(STORAGE_KEY, before);
    const originalSetItem = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === STORAGE_KEY) throw new Error("quota exceeded");
        originalSetItem.call(this, key, value);
      });

    try {
      expect(() => restoreBackup(createBackup({ ...RICH, xp: 1 }), RICH)).toThrow(
        /保存|失败|保留/
      );
    } finally {
      spy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(loadRecoveryBackup()!.progress).toEqual(RICH);
  });

  test("保存回退快照失败时不写入新进度,原进度保留", () => {
    const before = JSON.stringify(RICH);
    localStorage.setItem(STORAGE_KEY, before);
    const originalSetItem = Storage.prototype.setItem;
    let calls = 0;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        calls += 1;
        if (calls === 1) throw new Error("quota exceeded");
        originalSetItem.call(this, key, value);
      });

    try {
      expect(() =>
        restoreBackup(createBackup({ ...RICH, xp: 1 }), RICH)
      ).toThrow(/恢复前备份|未修改|保存/);
    } finally {
      spy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe("loadRecoveryBackup", () => {
  test("没有快照时返回 null", () => {
    expect(loadRecoveryBackup()).toBeNull();
  });

  test("损坏或跨 edition 快照返回 null 且不抛异常", () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, "{oops");
    expect(() => loadRecoveryBackup()).not.toThrow();
    expect(loadRecoveryBackup()).toBeNull();

    const other = __FGE_EDITION__ === "public" ? "internal" : "public";
    localStorage.setItem(
      RECOVERY_STORAGE_KEY,
      JSON.stringify({ ...createBackup(RICH), edition: other })
    );
    expect(loadRecoveryBackup()).toBeNull();
  });

  test("localStorage 读取抛异常也返回 null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => loadRecoveryBackup()).not.toThrow();
    expect(loadRecoveryBackup()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* exportBackup                                                        */
/* ------------------------------------------------------------------ */

describe("exportBackup web", () => {
  test("用 Blob 下载 JSON,内容可被严格解析", async () => {
    await exportBackup(RICH);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("application/json");

    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchorsConnected).toEqual([true]);
    expect(clickedAnchors[0].download).toMatch(
      /^fge-progress-(public|internal)-\d{4}-\d{2}-\d{2}\.json$/
    );
    expect(clickedAnchors[0].isConnected).toBe(false);
    // 点击后立即回收会让部分浏览器/WebView 取消下载,必须延后。
    expect(revokeObjectURL).not.toHaveBeenCalled();

    const parsed = parseBackup(await readBlob(blob));
    expect(parsed.progress).toEqual(RICH);
    expect(parsed.format).toBe("fge-progress");
    expect(parsed.edition).toBe(__FGE_EDITION__);

    await flushTasks();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup-url");
  });

  test("浏览器不支持对象 URL 时抛出可读错误", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: undefined,
    });

    await expect(exportBackup(RICH)).rejects.toThrow(/浏览器|下载|不支持/);
    expect(clickedAnchors).toHaveLength(0);
  });

  test("下载触发失败时抛出可读错误并回收 URL", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click blocked");
    });

    await expect(exportBackup(RICH)).rejects.toThrow(/下载|导出|失败/);
    await flushTasks();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup-url");
  });

  test("缺少 revokeObjectURL 时下载仍成功", async () => {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: undefined,
    });

    await expect(exportBackup(RICH)).resolves.toBeUndefined();
    await expect(flushTasks()).resolves.toBeUndefined();
  });
});

describe("exportBackup native", () => {
  beforeEach(() => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
  });

  test("写入缓存 JSON 并调用系统分享", async () => {
    await exportBackup(RICH);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(filesystemMock.writeFile).toHaveBeenCalledTimes(1);
    const write = filesystemMock.writeFile.mock.calls[0][0] as {
      path: string;
      data: string;
      directory: string;
      recursive: boolean;
      encoding?: string;
    };
    expect(write.path).toMatch(
      /^backup\/fge-progress-(public|internal)-\d{4}-\d{2}-\d{2}\.json$/
    );
    expect(write.directory).toBe("CACHE");
    expect(write.recursive).toBe(true);
    // 漏传 encoding 时 Capacitor 会按 base64 解释,JSON 文本写入会失败。
    expect(write.encoding).toBe("utf8");
    expect(parseBackup(write.data).progress).toEqual(RICH);

    expect(filesystemMock.getUri).toHaveBeenCalledWith({
      path: write.path,
      directory: "CACHE",
    });
    expect(sharePluginMock.share).toHaveBeenCalledWith({
      title: expect.any(String),
      dialogTitle: expect.any(String),
      files: [INCOMING_URI],
    });
  });

  test("写入缓存失败 → 可读错误,不调用分享", async () => {
    filesystemMock.writeFile.mockRejectedValue(new Error("quota exceeded"));

    await expect(exportBackup(RICH)).rejects.toThrow(/写入|空间|失败/);
    expect(filesystemMock.getUri).not.toHaveBeenCalled();
    expect(sharePluginMock.share).not.toHaveBeenCalled();
  });

  test("获取缓存文件 URI 失败 → 可读错误,不调用分享", async () => {
    filesystemMock.getUri.mockRejectedValue(new Error("uri failed"));

    await expect(exportBackup(RICH)).rejects.toThrow(/备份文件|定位|失败/);
    expect(sharePluginMock.share).not.toHaveBeenCalled();
  });

  test("用户取消分享 → 不是成功,抛取消错误", async () => {
    sharePluginMock.share.mockRejectedValue(
      new DOMException("Share canceled", "AbortError")
    );

    let caught: unknown;
    try {
      await exportBackup(RICH);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BackupCancelledError);
    expect(isBackupCancelled(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/取消/);
  });

  test("分享抛其它错误 → 可读错误且不算取消", async () => {
    sharePluginMock.share.mockRejectedValue(new Error("no target"));

    let caught: unknown;
    try {
      await exportBackup(RICH);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BackupError);
    expect(isBackupCancelled(caught)).toBe(false);
    expect((caught as Error).message).toMatch(/分享|失败/);
  });

  test("大进度自动改用 compact JSON,导出文件仍可严格解析", async () => {
    // 20000 条合法 lesson:compact 约 4.4MB(可导入),pretty 约 5.1MB(超限)。
    const progress = hugeProgress(200);
    await exportBackup(progress);

    const write = filesystemMock.writeFile.mock.calls[0][0] as {
      data: string;
    };
    expect(write.data).not.toContain("\n");
    expect(new TextEncoder().encode(write.data).length).toBeLessThanOrEqual(
      5 * 1024 * 1024
    );
    const parsed = parseBackup(write.data);
    const lessonKeys = Object.keys(parsed.progress.lessons);
    expect(lessonKeys).toHaveLength(20000);
    expect(lessonKeys[0]).toMatch(/^l00000-x+$/);
    expect(lessonKeys[0]).toHaveLength(200);
  });

  test("compact 仍超过 5MB 时导出抛可读错误,不写文件也不下载", async () => {
    await expect(exportBackup(hugeProgress(256))).rejects.toThrow(
      /大小|上限|5\s*MB/i
    );
    expect(filesystemMock.writeFile).not.toHaveBeenCalled();
    expect(filesystemMock.getUri).not.toHaveBeenCalled();
    expect(sharePluginMock.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
