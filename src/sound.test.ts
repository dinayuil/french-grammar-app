import { SOUND_PATTERNS, playSound } from "./sound";

const freqs = (name: keyof typeof SOUND_PATTERNS) => SOUND_PATTERNS[name].map((t) => t.freq);

describe("SOUND_PATTERNS", () => {
  test("四种音效齐备且都有音符", () => {
    expect(Object.keys(SOUND_PATTERNS).sort()).toEqual(["complete", "correct", "levelup", "wrong"]);
    for (const tones of Object.values(SOUND_PATTERNS)) expect(tones.length).toBeGreaterThan(0);
  });

  test("答对上行、答错下行、过关三音、升级四音", () => {
    expect(freqs("correct")[1]).toBeGreaterThan(freqs("correct")[0]);
    expect(freqs("wrong")[1]).toBeLessThan(freqs("wrong")[0]);
    expect(SOUND_PATTERNS.complete).toHaveLength(3);
    expect(SOUND_PATTERNS.levelup).toHaveLength(4);
  });
});

describe("playSound", () => {
  test("无 Web Audio 环境(jsdom)时安全 no-op", () => {
    expect(() => playSound("correct")).not.toThrow();
  });

  test("AudioContext 构造抛异常时不影响答题", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("blocked");
        }
      }
    );
    expect(() => playSound("wrong")).not.toThrow();
    vi.unstubAllGlobals();
  });

  test("关闭音效时不创建 AudioContext", () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          constructed();
        }
      }
    );
    playSound("correct", false);
    expect(constructed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
