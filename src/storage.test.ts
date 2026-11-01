import { DEFAULT_PROGRESS, loadProgress, saveProgress, today, shiftDate } from "./storage";
import { STORAGE_KEY, LEGACY_STORAGE_KEY } from "./config";
import type { Progress } from "./types";

const isPublic = __FGE_EDITION__ === "public";

/** 本测试只通过公开导出判断当前模式,不读取任何隐藏配置。 */
const INTERNAL_V2_KEY = "fge.progress.v2";
const INTERNAL_V1_KEY = "fge.progress.v1";
const PUBLIC_KEY = "fge.public.progress.v2";

const progressWith = (over: Partial<Progress> = {}): Progress => ({
  ...DEFAULT_PROGRESS,
  ...over,
});

function readJoined(key: string): string {
  const raw = localStorage.getItem(key);
  if (raw === null) throw new Error(`missing key ${key}`);
  return raw;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("today", () => {
  test("返回本地日期 YYYY-MM-DD(禁用 UTC)", () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const manual =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    expect(t).toBe(manual);
  });
});

describe("loadProgress", () => {
  beforeEach(() => localStorage.clear());

  test("空 localStorage → 默认进度(dailyGoal 30)", () => {
    expect(loadProgress().dailyGoal).toBe(30);
    expect(loadProgress().xp).toBe(0);
  });

  test("损坏 JSON → 不抛异常,返回默认值", () => {
    localStorage.setItem(STORAGE_KEY, "{bad json");
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress().dailyGoal).toBe(30);
  });

  test("缺子字段 → 用默认兜底", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 5, dailyGoal: 60 }));
    const p = loadProgress();
    expect(p.xp).toBe(5);
    expect(p.dailyGoal).toBe(60);
    expect(p.days).toEqual({});
    expect(p.mistakes).toEqual({});
  });

  test("旧数据缺 sound 字段 → 默认开启", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 5, dailyGoal: 30, days: {}, lessons: {}, mistakes: {} }));
    expect(loadProgress().sound).toBe(true);
  });

  test("sound=false 会被保留", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 5, sound: false, days: {}, lessons: {}, mistakes: {} }));
    expect(loadProgress().sound).toBe(false);
  });

  test("非法 sound 值 → 回退开启", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 5, sound: "no", days: {}, lessons: {}, mistakes: {} }));
    expect(loadProgress().sound).toBe(true);
  });

  test("旧数据缺翻译设置 → 默认开启 + 答题后显示", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 5, days: {}, lessons: {}, mistakes: {} }));
    const p = loadProgress();
    expect(p.translationEnabled).toBe(true);
    expect(p.translationTiming).toBe("after");
  });

  test("翻译设置 false/before 会被保留", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ xp: 5, translationEnabled: false, translationTiming: "before", days: {}, lessons: {}, mistakes: {} })
    );
    const p = loadProgress();
    expect(p.translationEnabled).toBe(false);
    expect(p.translationTiming).toBe("before");
  });

  test("非法翻译设置 → 回退默认", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ xp: 5, translationEnabled: "yes", translationTiming: "later", days: {}, lessons: {}, mistakes: {} })
    );
    const p = loadProgress();
    expect(p.translationEnabled).toBe(true);
    expect(p.translationTiming).toBe("after");
  });
});

describe("公钥按模式固定", () => {
  test("STORAGE_KEY 与 LEGACY_STORAGE_KEY 符合当前 edition 契约", () => {
    if (isPublic) {
      expect(STORAGE_KEY).toBe(PUBLIC_KEY);
      expect(LEGACY_STORAGE_KEY).toBeNull();
    } else {
      expect(STORAGE_KEY).toBe(INTERNAL_V2_KEY);
      expect(LEGACY_STORAGE_KEY).toBe(INTERNAL_V1_KEY);
    }
  });
});

describe.skipIf(!isPublic)("public: 与内部键完全隔离", () => {
  beforeEach(() => localStorage.clear());

  test("预存内部 v2/v1 高 XP 与错题:既不读取也不采纳", () => {
    const internalV2 = JSON.stringify(
      progressWith({
        xp: 999,
        dailyGoal: 120,
        mistakes: { "synth-ch1-l1-q1": { lastWrong: "2026-10-27", count: 4 } },
        lessons: { "synth-ch1-l1": { completed: true, stars: 3 } },
        sound: false,
      })
    );
    const internalV1 = JSON.stringify({
      xp: 888,
      dailyGoal: 60,
      days: {},
      lessons: { "synth-ch1-l1": { completed: true, perfect: true } },
      mistakes: ["synth-ch1-l1-q1"],
    });
    localStorage.setItem(INTERNAL_V2_KEY, internalV2);
    localStorage.setItem(INTERNAL_V1_KEY, internalV1);

    const getSpy = vi.spyOn(Storage.prototype, "getItem");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const p = loadProgress();
    const readKeys = getSpy.mock.calls.map((c) => String(c[0]));

    expect(readKeys).not.toContain(INTERNAL_V2_KEY);
    expect(readKeys).not.toContain(INTERNAL_V1_KEY);
    expect(readKeys).toEqual([PUBLIC_KEY]);
    expect(setSpy).not.toHaveBeenCalled();
    expect(p.xp).toBe(0);
    expect(p.dailyGoal).toBe(30);
    expect(p.mistakes).toEqual({});
    expect(p.sound).toBe(true);

    getSpy.mockRestore();
    setSpy.mockRestore();
    expect(localStorage.getItem(INTERNAL_V2_KEY)).toBe(internalV2);
    expect(localStorage.getItem(INTERNAL_V1_KEY)).toBe(internalV1);
  });

  test("内部键为空时也不探测 legacy", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem");
    loadProgress();
    const readKeys = getSpy.mock.calls.map((c) => String(c[0]));
    expect(readKeys).toEqual([PUBLIC_KEY]);
    getSpy.mockRestore();
  });

  test("saveProgress 只写公钥,内部键原样保留", () => {
    const internalV2 = JSON.stringify(progressWith({ xp: 777 }));
    const internalV1 = JSON.stringify({ xp: 666, mistakes: [] });
    localStorage.setItem(INTERNAL_V2_KEY, internalV2);
    localStorage.setItem(INTERNAL_V1_KEY, internalV1);

    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    saveProgress(progressWith({ xp: 7 }));
    const writtenKeys = setSpy.mock.calls.map((c) => String(c[0]));
    expect(writtenKeys).toEqual([PUBLIC_KEY]);
    setSpy.mockRestore();

    expect(JSON.parse(readJoined(PUBLIC_KEY)).xp).toBe(7);
    expect(localStorage.getItem(INTERNAL_V2_KEY)).toBe(internalV2);
    expect(localStorage.getItem(INTERNAL_V1_KEY)).toBe(internalV1);
  });

  test("公钥与内部键同时预置:只采用公钥", () => {
    localStorage.setItem(PUBLIC_KEY, JSON.stringify(progressWith({ xp: 12 })));
    localStorage.setItem(INTERNAL_V2_KEY, JSON.stringify(progressWith({ xp: 999 })));
    expect(loadProgress().xp).toBe(12);
  });
});

describe.skipIf(isPublic)("internal: v2 优先与 v1 迁移", () => {
  beforeEach(() => localStorage.clear());

  test("v1 数据自动迁移:mistakes 数组 → 记录,lessons 补 stars", () => {
    localStorage.setItem(
      INTERNAL_V1_KEY,
      JSON.stringify({
        xp: 42,
        dailyGoal: 30,
        days: { "2026-10-27": { xp: 12, earnedQids: [], bonusIds: [] } },
        lessons: { "synth-ch1-l1": { completed: true, perfect: true } },
        mistakes: ["synth-ch1-l1-q1", "synth-ch1-l2-q1"],
      })
    );
    const p = loadProgress();
    expect(p.xp).toBe(42);
    expect(p.mistakes["synth-ch1-l1-q1"].count).toBe(1);
    expect(typeof p.mistakes["synth-ch1-l2-q1"].lastWrong).toBe("string");
    expect(p.lessons["synth-ch1-l1"]).toEqual({ completed: true, stars: 3 });
  });

  test("v2 键存在时优先于 v1", () => {
    localStorage.setItem(
      INTERNAL_V1_KEY,
      JSON.stringify({ xp: 1, dailyGoal: 30, days: {}, lessons: {}, mistakes: [] })
    );
    localStorage.setItem(
      INTERNAL_V2_KEY,
      JSON.stringify({ xp: 9, dailyGoal: 30, days: {}, lessons: {}, mistakes: {} })
    );
    expect(loadProgress().xp).toBe(9);
  });

  test("v2 损坏时按旧兜底语义回落到 v1", () => {
    localStorage.setItem(INTERNAL_V2_KEY, "{bad json");
    localStorage.setItem(
      INTERNAL_V1_KEY,
      JSON.stringify({ xp: 33, dailyGoal: 30, days: {}, lessons: {}, mistakes: [] })
    );
    expect(loadProgress().xp).toBe(33);
  });

  test("v2 与 v1 均损坏 → 默认值且不抛异常", () => {
    localStorage.setItem(INTERNAL_V2_KEY, "{bad json");
    localStorage.setItem(INTERNAL_V1_KEY, "not json");
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress().xp).toBe(0);
  });

  test("saveProgress 写 v2 且保留 v1", () => {
    const v1 = JSON.stringify({ xp: 1, dailyGoal: 30, days: {}, lessons: {}, mistakes: [] });
    localStorage.setItem(INTERNAL_V1_KEY, v1);
    saveProgress(progressWith({ xp: 55 }));
    expect(JSON.parse(readJoined(INTERNAL_V2_KEY)).xp).toBe(55);
    expect(localStorage.getItem(INTERNAL_V1_KEY)).toBe(v1);
  });
});

describe("shiftDate(纯日期平移,禁 UTC)", () => {
  test("前一天", () => {
    expect(shiftDate("2026-10-27", -1)).toBe("2026-10-26");
  });

  test("跨月:3月1日的前一天是2月28日", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("跨年:12月31日的后一天是1月1日", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("saveProgress / loadProgress 往返", () => {
  beforeEach(() => localStorage.clear());

  test("保存后再读,xp/days/dailyGoal 一致", () => {
    saveProgress({
      ...DEFAULT_PROGRESS,
      xp: 42,
      dailyGoal: 120,
      days: { "2026-10-27": { xp: 12, earnedQids: ["q1"], bonusIds: ["l1"] } },
    });
    const p = loadProgress();
    expect(p.xp).toBe(42);
    expect(p.dailyGoal).toBe(120);
    expect(p.days["2026-10-27"]).toEqual({ xp: 12, earnedQids: ["q1"], bonusIds: ["l1"] });
  });
});
