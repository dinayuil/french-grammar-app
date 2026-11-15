import { useState } from "react";
import type { Progress, ShareCardContent } from "../types";
import type { ThemeChoice } from "../theme";
import { GOAL_PRESETS, STORAGE_KEY } from "../config";
import { DEFAULT_PROGRESS } from "../storage";
import { ProgressBackup } from "./ProgressBackup";

interface Props {
  progress: Progress;
  onChange: (p: Progress) => void;
  themeChoice?: ThemeChoice;
  onThemeChange?: (choice: ThemeChoice) => void;
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "system", label: "跟随系统" },
  { value: "dark", label: "深色" },
];

const SHARE_CONTENT_OPTIONS: ReadonlyArray<{ value: ShareCardContent; label: string }> = [
  { value: "xp", label: "经验" },
  { value: "time", label: "时间" },
  { value: "both", label: "都有" },
];

/** 旧运行时对象可能还没有 shareCardContent;选择器按默认「都有」显示。 */
function shareContentFor(progress: Progress): ShareCardContent {
  const value = progress.shareCardContent;
  return value === "xp" || value === "time" || value === "both" ? value : "both";
}

export function SettingsView({
  progress,
  onChange,
  themeChoice = "system",
  onThemeChange,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const shareContent = shareContentFor(progress);

  return (
    <div className="settings">
      <div className="settings-title">外观</div>
      <div className="goal-presets" role="radiogroup" aria-label="外观">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themeChoice === option.value}
            className={`theme-option ${themeChoice === option.value ? "selected" : ""}`}
            onClick={() => onThemeChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="settings-title">每日目标</div>
      <div className="goal-presets">
        {GOAL_PRESETS.map((g) => (
          <button
            key={g}
            className={`option-btn ${progress.dailyGoal === g ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, dailyGoal: g })}
          >
            {g} XP / 天
          </button>
        ))}
      </div>

      <div className="settings-title">分享卡内容</div>
      <div className="goal-presets" role="radiogroup" aria-label="分享卡内容">
        {SHARE_CONTENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={shareContent === option.value}
            className={`option-btn ${shareContent === option.value ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, shareCardContent: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="settings-title">音效</div>
      <div className="goal-presets">
        {[
          { value: true, label: "🔊 开启" },
          { value: false, label: "🔇 关闭" },
        ].map((o) => (
          <button
            key={String(o.value)}
            className={`option-btn ${progress.sound === o.value ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, sound: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="settings-title">翻译</div>
      <div className="goal-presets">
        {[
          { value: true, label: "开启翻译" },
          { value: false, label: "关闭翻译" },
        ].map((o) => (
          <button
            key={String(o.value)}
            className={`option-btn ${progress.translationEnabled === o.value ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, translationEnabled: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="settings-title">翻译显示时机</div>
      <div className="goal-presets">
        {[
          { value: "before" as const, label: "答题前显示" },
          { value: "after" as const, label: "答题后显示" },
        ].map((o) => (
          <button
            key={o.value}
            className={`option-btn ${progress.translationTiming === o.value ? "selected" : ""}`}
            disabled={!progress.translationEnabled}
            onClick={() => onChange({ ...progress, translationTiming: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <ProgressBackup progress={progress} onChange={onChange} />

      <div className="settings-title">危险操作</div>
      {confirming ? (
        <div className="danger-row">
          <span>确定清空全部进度(连击、XP、关卡)?</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              onChange({ ...DEFAULT_PROGRESS });
              setConfirming(false);
            }}
          >
            确认清空
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      ) : (
        <button className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
          清空进度
        </button>
      )}

      <div className="settings-note">
        内容说明：本应用内容由 AI 参与编写与复核，未经过人工法语审校。
      </div>
    </div>
  );
}
