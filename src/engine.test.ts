import {
  judge,
  acceptedChoiceIndices,
  normalizeText,
  applyAnswer,
  applyLessonComplete,
  markSharePrompted,
  starsFor,
  reviewQueue,
  lettersBank,
  decoyCount,
  pickDecoys,
  tilesBank,
  streakFor,
  levelFor,
  addStudySeconds,
  studyTotals,
} from "./engine";
import type {
  ChoiceQuestion,
  LettersQuestion,
  TilesQuestion,
  DayRecord,
  MistakeInfo,
  Progress,
} from "./types";

const choiceQ: ChoiceQuestion = {
  id: "q-c",
  prompt: "La salle ___ grande.",
  explain: "单数主语用 est",
  type: "choice",
  options: ["est", "sont"],
  answer: 0,
  alternatives: [1],
};

const lettersQ: LettersQuestion = {
  id: "q-l",
  prompt: "Les enfants ___ contents.",
  explain: "复数主语用 sont",
  type: "letters",
  answer: "sont",
};

const lettersAltQ: LettersQuestion = {
  id: "q-la",
  prompt: "Nous ___ ici.",
  explain: "",
  type: "letters",
  answer: "restons",
  alternatives: ["demeurons"],
};

const tilesQ: TilesQuestion = {
  id: "q-t",
  prompt: "改成否定句:Le chat dort.",
  explain: "ne...pas",
  type: "tiles",
  answer: ["Le", "chat", "ne", "dort", "pas."],
  bank: ["Le", "chat", "ne", "dort", "pas.", "mange", "vite"],
};

const tilesAltQ: TilesQuestion = {
  id: "q-ta",
  prompt: "连词成句",
  explain: "",
  type: "tiles",
  answer: ["Nous", "lisons", "un", "livre."],
  alternatives: [["On", "lit", "un", "livre."]],
  bank: ["Nous", "lisons", "un", "livre.", "On", "lit", "revue"],
};

describe("judge", () => {
  test("choice: 对正确下标 true", () => {
    expect(judge(choiceQ, 0)).toBe(true);
  });

  test("choice: 对错误下标 false", () => {
    expect(judge({ ...choiceQ, alternatives: undefined }, 1)).toBe(false);
  });

  test("choice: alternatives 下标命中", () => {
    expect(judge(choiceQ, 1)).toBe(true);
  });

  test("letters: 全等 true", () => {
    expect(judge(lettersQ, "sont")).toBe(true);
  });

  test("letters: 大小写敏感,『Sont』false", () => {
    expect(judge(lettersQ, "Sont")).toBe(false);
  });

  test("letters: 首尾空白归一,『 sont 』true", () => {
    expect(judge(lettersQ, " sont ")).toBe(true);
  });

  test("letters: 弯撇号归一为直撇号", () => {
    expect(judge({ ...lettersQ, answer: "j'ai" }, "j’ai")).toBe(true);
  });

  test("letters: 缺字母 false", () => {
    expect(judge({ ...lettersQ, answer: "j'ai" }, "ja")).toBe(false);
  });

  test("letters: 重音不归一,été ≠ ete", () => {
    expect(judge({ ...lettersQ, answer: "été" }, "ete")).toBe(false);
  });

  test("letters: alternatives 命中", () => {
    expect(judge(lettersAltQ, "demeurons")).toBe(true);
  });

  test("letters: alternatives 与 answer 均不中 false", () => {
    expect(judge(lettersAltQ, "restiez")).toBe(false);
  });

  test("tiles: 完全一致 true", () => {
    expect(judge(tilesQ, ["Le", "chat", "ne", "dort", "pas."])).toBe(true);
  });

  test("tiles: 换序 false", () => {
    expect(judge({ ...tilesQ, alternatives: undefined }, ["chat", "Le", "ne", "dort", "pas."])).toBe(false);
  });

  test("tiles: alternatives 语序命中", () => {
    expect(judge(tilesAltQ, ["On", "lit", "un", "livre."])).toBe(true);
  });
});

describe("acceptedChoiceIndices", () => {
  test("answer 与 alternatives 全部视为正确答案", () => {
    expect([...acceptedChoiceIndices(choiceQ)].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test("无 alternatives 时只有 answer", () => {
    expect(acceptedChoiceIndices({ ...choiceQ, alternatives: undefined })).toEqual(new Set([0]));
  });

  test("所有合法下标都判对", () => {
    for (const i of acceptedChoiceIndices(choiceQ)) {
      expect(judge(choiceQ, i)).toBe(true);
    }
  });
});

describe("normalizeText", () => {
  test("trim + 合并空白 + 撇号归一", () => {
    expect(normalizeText("  l’école   est  ")).toBe("l'école est");
  });
});

const T = "2026-10-27";

const P = (over: Partial<Progress> = {}): Progress => ({
  xp: 0,
  dailyGoal: 30,
  sound: true,
  translationEnabled: true,
  translationTiming: "after",
  days: {},
  lessons: {},
  mistakes: {},
  ...over,
});

describe("applyAnswer", () => {
  test("普通答对 +2,记录 qid 与当日 xp", () => {
    const p = applyAnswer(P(), T, "q1", true);
    expect(p.xp).toBe(2);
    expect(p.days[T]).toEqual({ xp: 2, earnedQids: ["q1"], bonusIds: [] });
  });

  test("同一天同题再次答对不加 XP", () => {
    let p = applyAnswer(P(), T, "q1", true);
    p = applyAnswer(p, T, "q1", true);
    expect(p.xp).toBe(2);
  });

  test("答错 0 XP,记入错题本(count 累计,lastWrong 更新)", () => {
    let p = applyAnswer(P(), T, "q1", false);
    p = applyAnswer(p, "2026-10-28", "q1", false);
    expect(p.xp).toBe(0);
    expect(p.days[T].earnedQids).not.toContain("q1");
    expect(p.mistakes["q1"]).toEqual({ lastWrong: "2026-10-28", count: 2 });
  });

  test("答对即移出错题本(再错重新计入)", () => {
    let p = applyAnswer(P(), T, "q1", false);
    expect(Object.keys(p.mistakes)).toContain("q1");
    p = applyAnswer(p, T, "q1", true);
    expect(p.mistakes["q1"]).toBeUndefined();
    expect(Object.keys(p.mistakes)).toHaveLength(0);
  });

  test("redo 答对 +1(当日未得过该题)", () => {
    let p = applyAnswer(P(), T, "q1", false);
    p = applyAnswer(p, T, "q1", true, true);
    expect(p.xp).toBe(1);
  });

  test("redo:当日已得过该题不给分", () => {
    let p = applyAnswer(P(), T, "q1", true); // 先得 +2
    p = applyAnswer(p, T, "q1", true, true);
    expect(p.xp).toBe(2);
  });

  test("跨天重做可再得 XP:昨天得过的题今天答对再 +2", () => {
    let p = applyAnswer(P(), "2026-10-26", "q1", true);
    p = applyAnswer(p, T, "q1", true);
    expect(p.xp).toBe(4);
    expect(p.days["2026-10-26"].earnedQids).toContain("q1");
    expect(p.days[T].earnedQids).toContain("q1");
  });

  test("immutable:不改入参", () => {
    const orig = P();
    applyAnswer(orig, T, "q1", true);
    expect(orig.xp).toBe(0);
    expect(orig.days[T]).toBeUndefined();
  });
});

describe("applyLessonComplete", () => {
  test("普通关全对:+5 过关 +5 全对,记录 completed/stars=3", () => {
    const p = applyLessonComplete(P(), T, "synth-ch1-l1", "lesson", 0, 3);
    expect(p.xp).toBe(10);
    expect(p.lessons["synth-ch1-l1"]).toEqual({ completed: true, stars: 3 });
    expect(p.days[T].bonusIds).toEqual(["synth-ch1-l1", "synth-ch1-l1:perfect"]);
  });

  test("普通关有错(90% 正确率):只 +5 过关,记录 2 星", () => {
    const p = applyLessonComplete(P(), T, "synth-ch1-l1", "lesson", 1, 2);
    expect(p.xp).toBe(5);
    expect(p.lessons["synth-ch1-l1"]).toEqual({ completed: true, stars: 2 });
    expect(p.days[T].bonusIds).toEqual(["synth-ch1-l1"]);
  });

  test("挑战关:+10 过关,全对再 +5", () => {
    const p = applyLessonComplete(P(), T, "synth-ch1-x1", "challenge", 0, 3);
    expect(p.xp).toBe(15);
    expect(p.days[T].bonusIds).toEqual(["synth-ch1-x1", "synth-ch1-x1:perfect"]);
  });

  test("同一天同关重复结算不重复加 bonus", () => {
    let p = applyLessonComplete(P(), T, "synth-ch1-l1", "lesson", 0, 3);
    p = applyLessonComplete(p, T, "synth-ch1-l1", "lesson", 0, 3);
    expect(p.xp).toBe(10);
    expect(p.days[T].bonusIds).toEqual(["synth-ch1-l1", "synth-ch1-l1:perfect"]);
  });

  test("重做补救全对后再次结算:全对奖发放,星级取历史最好", () => {
    let p = applyLessonComplete(P(), T, "synth-ch1-l1", "lesson", 1, 2); // 首次:2 星
    p = applyLessonComplete(p, T, "synth-ch1-l1", "lesson", 0, 3); // 重做后全对
    expect(p.xp).toBe(10); // 首次 +5 过关;再次结算时过关奖已有,只发全对奖 +5
    expect(p.lessons["synth-ch1-l1"]).toEqual({ completed: true, stars: 3 });
  });

  test("星级只升不降:已有 3 星,再来一次 1 星仍是 3 星", () => {
    let p = applyLessonComplete(P(), T, "synth-ch1-l1", "lesson", 0, 3);
    p = applyLessonComplete(p, T, "synth-ch1-l1", "lesson", 5, 1);
    expect(p.lessons["synth-ch1-l1"].stars).toBe(3);
  });
});

describe("markSharePrompted", () => {
  const day: DayRecord = { xp: 25, earnedQids: ["q1", "q2"], bonusIds: ["l1"] };

  test("已有当天记录:设置 sharePrompted,保留 xp/earnedQids/bonusIds,不动顶层数据", () => {
    const base = P({
      xp: 40,
      days: { [T]: day, "2026-10-26": { xp: 5, earnedQids: [], bonusIds: [] } },
      lessons: { l1: { completed: true, stars: 2 } },
      mistakes: { q9: { lastWrong: "2026-10-26", count: 2 } },
    });
    const p = markSharePrompted(base, T);
    expect(p.days[T]).toEqual({ ...day, sharePrompted: true });
    expect(p.days["2026-10-26"]).toEqual({ xp: 5, earnedQids: [], bonusIds: [] });
    expect(p.xp).toBe(40);
    expect(p.lessons).toEqual(base.lessons);
    expect(p.mistakes).toEqual(base.mistakes);
  });

  test("当天没有记录:创建 {xp:0, earnedQids:[], bonusIds:[], sharePrompted:true}", () => {
    const p = markSharePrompted(P(), T);
    expect(p.days[T]).toEqual({ xp: 0, earnedQids: [], bonusIds: [], sharePrompted: true });
    expect(p.xp).toBe(0);
    expect(p.lessons).toEqual({});
    expect(p.mistakes).toEqual({});
  });

  test("已为 true:保持 true,不重复添加", () => {
    const base = P({ days: { [T]: { ...day, sharePrompted: true } } });
    const p = markSharePrompted(base, T);
    expect(p.days[T]).toEqual({ ...day, sharePrompted: true });
  });

  test("immutable:不改入参", () => {
    const base = P({ days: { [T]: day } });
    markSharePrompted(base, T);
    expect(base.days[T]).toEqual(day);
    expect(base.days[T].sharePrompted).toBeUndefined();
  });
});

describe("reviewQueue(复习关选题)", () => {
  test("lastWrong 升序:错得最久的优先", () => {
    const mistakes = {
      a: { lastWrong: "2026-10-27", count: 1 },
      b: { lastWrong: "2026-10-20", count: 3 },
      c: { lastWrong: "2026-10-25", count: 1 },
    };
    expect(reviewQueue(mistakes)).toEqual(["b", "c", "a"]);
  });

  test("每关最多 10 题", () => {
    const mistakes: Record<string, MistakeInfo> = {};
    for (let i = 0; i < 15; i++) {
      mistakes[`q${i}`] = { lastWrong: "2026-10-27", count: 1 };
    }
    expect(reviewQueue(mistakes).length).toBe(10);
  });

  test("无错题 → 空数组", () => {
    expect(reviewQueue({})).toEqual([]);
  });
});

describe("lettersBank", () => {
  test("无 decoys:词库恰为答案字母的多重集(打乱)", () => {
    const bank = lettersBank({ id: "q1", type: "letters", prompt: "", explain: "", answer: "êtes" });
    expect(bank.length).toBe(4);
    expect([...bank].sort()).toEqual([...("êtes")].sort());
  });

  test("有 decoys:词库 = 答案字母 + 干扰字母", () => {
    const bank = lettersBank({
      id: "q2", type: "letters", prompt: "", explain: "", answer: "a", decoys: ["i", "s"],
    });
    expect(bank.length).toBe(3);
    expect([...bank].sort()).toEqual(["a", "i", "s"]);
  });

  test("同一题每次调用顺序一致(确定性),不同题不同", () => {
    const q: LettersQuestion = { id: "q3", type: "letters", prompt: "", explain: "", answer: "sommes", decoys: ["o", "t"] };
    expect(lettersBank(q)).toEqual(lettersBank(q));
    expect(lettersBank(q)).not.toEqual(
      lettersBank({ ...q, id: "q4" })
    );
  });
});

describe("tilesBank", () => {
  test("词库是原 bank 的多重集,且不会保持原始答案顺序", () => {
    const bank = tilesBank(tilesQ);
    expect([...bank].sort()).toEqual([...tilesQ.bank].sort());
    expect(bank).not.toEqual(tilesQ.bank);
  });

  test("同一题每次调用顺序一致(确定性)", () => {
    expect(tilesBank(tilesQ)).toEqual(tilesBank(tilesQ));
  });
});

describe("decoy 生成规则(用户定案:max(3, 5-答案长),随机抽)", () => {
  test("decoyCount:统一 3 个,答案太短补到总数 5", () => {
    expect(decoyCount("a")).toBe(4);
    expect(decoyCount("es")).toBe(3);
    expect(decoyCount("sont")).toBe(3);
    expect(decoyCount("sommes")).toBe(3);
  });

  test("pickDecoys:数量正确、全部来自字母池(可注入 rng)", () => {
    let n = 0;
    const rng = () => (n++ % 5) / 5;
    const d = pickDecoys("a", rng);
    expect(d.length).toBe(4);
    const pool = "abcdefghijklmnopqrstuvwxyzéèêàâîôûùëïç";
    expect(d.every((c) => pool.includes(c))).toBe(true);
  });
});

describe("starsFor", () => {
  test("会话全对(allFixed)= 3 星", () => {
    expect(starsFor(9, 10, true)).toBe(3);
    expect(starsFor(10, 10, false)).toBe(3);
  });

  test("正确率 ≥ 80% = 2 星", () => {
    expect(starsFor(9, 10, false)).toBe(2);
    expect(starsFor(8, 10, false)).toBe(2);
    expect(starsFor(4, 5, false)).toBe(2);
  });

  test("正确率 < 80% = 1 星(完成即有星)", () => {
    expect(starsFor(7, 10, false)).toBe(1);
    expect(starsFor(0, 10, false)).toBe(1);
  });
});

describe("streakFor", () => {
  const goal = 30;
  const met = (xp = 40): DayRecord => ({ xp, earnedQids: [], bonusIds: [] });

  test("连续 3 天达标 + 今天已达标 → 4", () => {
    const days = {
      "2026-10-24": met(),
      "2026-10-25": met(),
      "2026-10-26": met(),
      "2026-10-27": met(),
    };
    expect(streakFor(days, goal, T)).toBe(4);
  });

  test("今天未达标(昨天达标)→ 3,今天的欠账不清昨天的连击", () => {
    const days = {
      "2026-10-24": met(),
      "2026-10-25": met(),
      "2026-10-26": met(),
      "2026-10-27": met(10),
    };
    expect(streakFor(days, goal, T)).toBe(3);
  });

  test("昨天断档但今天已达标 → 1(今天自立门户)", () => {
    const days = {
      "2026-10-24": met(),
      "2026-10-25": met(),
      "2026-10-26": met(0),
      "2026-10-27": met(),
    };
    expect(streakFor(days, goal, T)).toBe(1);
  });

  test("昨天断档且今天未达标 → 0", () => {
    const days = {
      "2026-10-24": met(),
      "2026-10-25": met(),
      "2026-10-26": met(0),
      "2026-10-27": met(0),
    };
    expect(streakFor(days, goal, T)).toBe(0);
  });

  test("只有今天达标 → 1", () => {
    expect(streakFor({ "2026-10-27": met() }, goal, T)).toBe(1);
  });

  test("目标为 0 → 0(无目标不构成连击)", () => {
    expect(streakFor({}, 0, T)).toBe(0);
  });

  test("目标为负数 → 0(不得无限循环)", () => {
    expect(streakFor({}, -5, T)).toBe(0);
  });
});

describe("levelFor", () => {
  test("每 100 XP 升一级", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(250)).toBe(3);
  });
});

describe("addStudySeconds", () => {
  test("read 与 practice 分别累加，保留当天其他字段", () => {
    const p = P({ days: { "2026-11-08": { xp: 5, earnedQids: ["q1"], bonusIds: [], sharePrompted: true } } });
    const np = addStudySeconds(addStudySeconds(p, "2026-11-08", "read", 120), "2026-11-08", "practice", 60);
    expect(np.days["2026-11-08"]).toMatchObject({ xp: 5, readSeconds: 120, practiceSeconds: 60, sharePrompted: true });
  });
  test("seconds <= 0 返回原对象", () => {
    const p = P();
    expect(addStudySeconds(p, "2026-11-08", "read", 0)).toBe(p);
  });
  test("旧数据没有字段时从 0 开始", () => {
    const p = P({ days: { "2026-11-08": { xp: 0, earnedQids: [], bonusIds: [] } } });
    expect(addStudySeconds(p, "2026-11-08", "read", 30).days["2026-11-08"]?.readSeconds).toBe(30);
  });
  test("旧值是非数字时按 0 开始累加", () => {
    const p = P({ days: { "2026-11-08": { xp: 0, earnedQids: [], bonusIds: [], readSeconds: "x" as unknown as number } } });
    expect(addStudySeconds(p, "2026-11-08", "read", 30).days["2026-11-08"]?.readSeconds).toBe(30);
  });
});

describe("studyTotals", () => {
  test("跨天求和并拆分", () => {
    const days = {
      "2026-11-07": { xp: 0, earnedQids: [], bonusIds: [], readSeconds: 100, practiceSeconds: 50 },
      "2026-11-08": { xp: 0, earnedQids: [], bonusIds: [], readSeconds: 20, practiceSeconds: 40 },
    };
    expect(studyTotals(days)).toEqual({ read: 120, practice: 90, total: 210 });
  });
  test("缺字段与非数字按 0 处理", () => {
    const days = { "2026-11-08": { xp: 0, earnedQids: [], bonusIds: [], readSeconds: 10, practiceSeconds: "x" as unknown as number } };
    expect(studyTotals(days)).toEqual({ read: 10, practice: 0, total: 10 });
  });
});
