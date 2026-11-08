import { useState } from "react";
import type { Chapter, Lesson, Progress, Question } from "../types";
import { judge, applyAnswer, applyLessonComplete, starsFor, streakFor, levelFor } from "../engine";
import type { StudyKind } from "../engine";
import { useStudyTimer } from "../studyTimer";
import { today } from "../storage";
import { XP_PERFECT_BONUS, XP_LESSON_BONUS, XP_CHALLENGE_BONUS } from "../config";
import { playSound } from "../sound";
import { ChoiceQuestion } from "../components/ChoiceQuestion";
import { LettersQuestion } from "../components/LettersQuestion";
import { TilesQuestion } from "../components/TilesQuestion";
import { Settlement } from "../components/Settlement";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion as CQ, LettersQuestion as LQ, TilesQuestion as TQ } from "../types";

type Phase = "quiz" | "settlement" | "redo";
type Response = number | string | string[];
type Breakdown = { quiz: number; redo: number; lesson: number; perfect: number };

interface Props {
  chapter: Chapter;
  lesson: Lesson;
  progress: Progress;
  onProgress: (p: Progress) => void;
  onSettlement?: (progress: Progress) => void;
  onExit: () => void;
  onNextLesson: () => void;
  onFinish: (wrongQids: string[]) => void;
  onStudyTick?: (kind: StudyKind, seconds: number) => void;
}

export function LessonView({
  chapter,
  lesson,
  progress,
  onProgress,
  onSettlement,
  onExit,
  onNextLesson,
  onFinish,
  onStudyTick,
}: Props) {
  const [phase, setPhase] = useState<Phase>("quiz");
  const [qIndex, setQIndex] = useState(0);
  const [xpStart] = useState(() => progress.xp);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [gains, setGains] = useState<Record<string, number>>({});
  const [wrongQids, setWrongQids] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<Breakdown>({ quiz: 0, redo: 0, lesson: 0, perfect: 0 });
  const [sessionStars, setSessionStars] = useState(1);
  // 重做轮(仅本次会话):队列中是本 run 答错的题
  const [redoQueue, setRedoQueue] = useState<string[]>([]);
  const [redoIdx, setRedoIdx] = useState(0);
  const [redoResponses, setRedoResponses] = useState<Record<string, Response>>({});
  const [redoResults, setRedoResults] = useState<Record<string, boolean>>({});
  const [redoGains, setRedoGains] = useState<Record<string, number>>({});

  useStudyTimer((s) => onStudyTick?.("practice", s));

  const allLessons = [...chapter.lessons, ...chapter.challenges];
  const hasNext = allLessons[allLessons.findIndex((l) => l.id === lesson.id) + 1] !== undefined;

  const settle = (mistakesThisRun: number, stars: number, bd: Breakdown) => {
    const beforeLevel = levelFor(progress.xp);
    setBreakdown(bd);
    setSessionStars(stars);
    const np = applyLessonComplete(progress, today(), lesson.id, lesson.kind, mistakesThisRun, stars);
    onProgress(np);
    onSettlement?.(np);
    playSound("complete", progress.sound);
    if (levelFor(np.xp) > beforeLevel) playSound("levelup", progress.sound, 0.5);
  };

  if (phase === "settlement") {
    const t = today();
    return (
      <Settlement
        lesson={lesson}
        breakdown={breakdown}
        xpGained={progress.xp - xpStart}
        stars={sessionStars}
        wrongQids={wrongQids}
        streak={streakFor(progress.days, progress.dailyGoal, t)}
        onRedo={() => {
          setRedoQueue([...wrongQids]);
          setRedoIdx(0);
          setPhase("redo");
        }}
        onNext={hasNext ? onNextLesson : null}
        onHome={onExit}
      />
    );
  }

  const isRedo = phase === "redo";
  const currentQid = isRedo ? redoQueue[redoIdx] : lesson.questions[qIndex].id;
  const currentQ: Question = isRedo
    ? lesson.questions.find((q) => q.id === currentQid)!
    : lesson.questions[qIndex];
  const judged = isRedo
    ? redoResults[currentQid] !== undefined
    : results[currentQid] !== undefined;
  const lastPosition = isRedo
    ? redoIdx === redoQueue.length - 1
    : qIndex === lesson.questions.length - 1;
  const completed = judged ? completedQuestion(currentQ) : null;
  const showTranslation =
    !!currentQ.translation &&
    progress.translationEnabled &&
    (progress.translationTiming === "before" || judged);
  const judgedCorrect = (isRedo ? redoResults : results)[currentQid] === true;

  const submit = () => {
    if (judged) return;
    const resp = isRedo ? redoResponses : responses;
    const correct = judge(currentQ, resp[currentQid]);
    const before = progress.xp;
    const beforeLevel = levelFor(progress.xp);
    const np = applyAnswer(progress, today(), currentQid, correct, isRedo);
    onProgress(np);
    const gain = np.xp - before;
    playSound(correct ? "correct" : "wrong", progress.sound);
    if (levelFor(np.xp) > beforeLevel) playSound("levelup", progress.sound, 0.35);
    if (isRedo) {
      setRedoResults({ ...redoResults, [currentQid]: correct });
      setRedoGains({ ...redoGains, [currentQid]: gain });
    } else {
      setResults({ ...results, [currentQid]: correct });
      setGains({ ...gains, [currentQid]: gain });
      if (!correct) setWrongQids([...wrongQids, currentQid]);
    }
  };

  const advance = () => {
    const r = isRedo ? redoResults : results;
    const correct = r[currentQid];
    if (isRedo) {
      if (correct) {
        if (lastPosition) {
          // 重做轮全部补救成功:会话全对 → 3 星,补发全对奖,清空剩余错题
          settle(0, 3, {
            quiz: sum(Object.values(gains)),
            redo: sum(Object.values(redoGains)),
            lesson: lesson.kind === "challenge" ? XP_CHALLENGE_BONUS : XP_LESSON_BONUS,
            perfect: XP_PERFECT_BONUS,
          });
          setWrongQids([]);
          setRedoQueue([]);
          setRedoIdx(0);
          setPhase("settlement");
        } else {
          setRedoIdx(redoIdx + 1);
        }
      } else {
        // 再错一次:排到队尾,继续直到答对
        const nextQueue = [...redoQueue.slice(0, redoIdx), ...redoQueue.slice(redoIdx + 1), currentQid];
        setRedoQueue(nextQueue);
        setRedoResponses({ ...redoResponses, [currentQid]: "" });
        setRedoResults({ ...redoResults, [currentQid]: undefined } as Record<string, boolean>);
        return;
      }
    } else if (lastPosition) {
      // 首次结算:星级按首次正确率;全对奖只在零失误时发放
      const bonus = lesson.kind === "challenge" ? XP_CHALLENGE_BONUS : XP_LESSON_BONUS;
      const firstTryCorrect = lesson.questions.length - wrongQids.length;
      const stars = starsFor(firstTryCorrect, lesson.questions.length, false);
      settle(wrongQids.length, stars, {
        quiz: sum(Object.values(gains)),
        redo: 0,
        lesson: bonus,
        perfect: wrongQids.length === 0 ? XP_PERFECT_BONUS : 0,
      });
      setPhase("settlement");
      onFinish(wrongQids);
    } else {
      setQIndex(qIndex + 1);
    }
  };

  return (
    <div className="lesson">
      <div className="lesson-header">
        <button className="btn btn-ghost" onClick={onExit}>✕</button>
        <div className="lesson-progress-track">
          <div
            className="lesson-progress-fill"
            style={{
              width: isRedo
                ? `${((redoIdx + (judged ? 1 : 0)) / Math.max(redoQueue.length, 1)) * 100}%`
                : `${((qIndex + (judged ? 1 : 0)) / lesson.questions.length) * 100}%`,
            }}
          />
        </div>
        <span className="lesson-counter">
          {isRedo ? redoIdx + 1 : qIndex + 1}/
          {isRedo ? redoQueue.length : lesson.questions.length}
        </span>
      </div>

      <div className="quiz-question">
        {currentQ.example && (
          <div className="quiz-example">
            <span className="quiz-example-label">范例</span>
            {currentQ.example}
          </div>
        )}
        <div className="quiz-prompt">{completed ? completed.prompt : currentQ.prompt}</div>
        {completed?.target && <div className="quiz-target">{completed.target}</div>}
        {showTranslation && <div className="quiz-translation">{currentQ.translation}</div>}
        <QuestionBody
          q={currentQ}
          responses={isRedo ? redoResponses : responses}
          setResponses={isRedo ? setRedoResponses : setResponses}
          judged={judged}
        />
      </div>

      <div
        className={`feedback ${judged ? (judgedCorrect ? "good" : "bad") : "visually-hidden"}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {judged && (
          <>
            <div className="feedback-head">
              {judgedCorrect
                ? `✓ 正确${(isRedo ? redoGains : gains)[currentQid] > 0 ? ` +${(isRedo ? redoGains : gains)[currentQid]} XP` : ""}`
                : "✗ 答错了"}
            </div>
            {currentQ.explain && <div className="explain">{currentQ.explain}</div>}
          </>
        )}
      </div>

      <div className="quiz-footer">
        {judged ? (
          <button className="btn btn-primary btn-wide" onClick={advance}>
            继续
          </button>
        ) : (
          <button
            className="btn btn-primary btn-wide"
            disabled={empty((isRedo ? redoResponses : responses)[currentQid])}
            onClick={submit}
          >
            检查
          </button>
        )}
      </div>
    </div>
  );
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function empty(v: Response | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function QuestionBody({
  q,
  responses,
  setResponses,
  judged,
}: {
  q: Question;
  responses: Record<string, Response>;
  setResponses: (r: Record<string, Response>) => void;
  judged: boolean;
}) {
  const set = (v: Response) => setResponses({ ...responses, [q.id]: v });
  if (q.type === "choice") {
    return (
      <ChoiceQuestion
        key={q.id}
        q={q as CQ}
        response={(responses[q.id] as number) ?? null}
        onResponse={(n) => set(n)}
        disabled={judged}
        judged={judged}
      />
    );
  }
  if (q.type === "letters") {
    return (
      <LettersQuestion
        key={q.id}
        q={q as LQ}
        response={(responses[q.id] as string) ?? ""}
        onResponse={(s) => set(s)}
        disabled={judged}
      />
    );
  }
  return (
    <TilesQuestion
      key={q.id}
      q={q as TQ}
      response={(responses[q.id] as string[]) ?? []}
      onResponse={(t) => set(t)}
      disabled={judged}
    />
  );
}
