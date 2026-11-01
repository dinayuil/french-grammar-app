export type SoundName = "correct" | "wrong" | "complete" | "levelup";

export interface Tone {
  freq: number;
  /** 相对于播放起点的秒数 */
  start: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

export const SOUND_PATTERNS: Record<SoundName, readonly Tone[]> = {
  correct: [
    { freq: 1046.5, start: 0, duration: 0.09, type: "sine", gain: 0.18 },
    { freq: 1318.5, start: 0.07, duration: 0.12, type: "sine", gain: 0.18 },
  ],
  wrong: [
    { freq: 220, start: 0, duration: 0.12, type: "triangle", gain: 0.14 },
    { freq: 174.6, start: 0.1, duration: 0.16, type: "triangle", gain: 0.14 },
  ],
  complete: [
    { freq: 523.25, start: 0, duration: 0.14, type: "triangle", gain: 0.16 },
    { freq: 659.25, start: 0.12, duration: 0.14, type: "triangle", gain: 0.16 },
    { freq: 783.99, start: 0.24, duration: 0.26, type: "triangle", gain: 0.16 },
  ],
  levelup: [
    { freq: 523.25, start: 0, duration: 0.12, type: "triangle", gain: 0.16 },
    { freq: 659.25, start: 0.1, duration: 0.12, type: "triangle", gain: 0.16 },
    { freq: 783.99, start: 0.2, duration: 0.12, type: "triangle", gain: 0.16 },
    { freq: 1046.5, start: 0.3, duration: 0.32, type: "triangle", gain: 0.16 },
  ],
};

let ctx: AudioContext | null = null;

/** 惰性创建 AudioContext；环境不支持时返回 null。 */
function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/**
 * 播放一个合成音效。enabled=false 直接返回；delay 秒后再整体开始。
 * 任何音频异常都静默吞掉，绝不影响答题。
 */
export function playSound(name: SoundName, enabled = true, delay = 0): void {
  if (!enabled) return;
  try {
    const audio = audioContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const t0 = audio.currentTime + delay;
    for (const tone of SOUND_PATTERNS[name]) {
      const start = t0 + tone.start;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(start);
      osc.stop(start + tone.duration + 0.02);
    }
  } catch {
    // 没有音频权限 / 环境不支持：静默失败
  }
}
