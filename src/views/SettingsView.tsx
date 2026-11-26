import { useState } from "react";
import type { Progress, ShareCardContent } from "../types";
import type { ThemeChoice } from "../theme";
import type { ClientSyncController } from "../sync/useClientSync";
import type { ClientUpdates } from "../native/useClientUpdates";
import { GOAL_PRESETS, STORAGE_KEY } from "../config";
import { DEFAULT_PROGRESS } from "../storage";
import { useLocale } from "../i18n/LocaleProvider";
import { formatNumber } from "../i18n/format";
import { isUiLocale } from "../i18n/locale";
import { ClientUpdateSettings } from "./ClientUpdateSettings";
import { ProgressBackup } from "./ProgressBackup";
import { SyncSettings } from "./SyncSettings";

interface Props {
  progress: Progress;
  onChange: (p: Progress) => void;
  themeChoice?: ThemeChoice;
  onThemeChange?: (choice: ThemeChoice) => void;
  /** 只在原生容器传入;网页版保持 null,对应设置完全不渲染。 */
  syncController?: ClientSyncController | null;
  /** 只在原生容器传入;网页版为 null,不显示客户端更新入口。 */
  clientUpdates?: ClientUpdates | null;
}

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeChoice;
  key:
    | "settings.theme.light"
    | "settings.theme.system"
    | "settings.theme.dark";
}> = [
  { value: "light", key: "settings.theme.light" },
  { value: "system", key: "settings.theme.system" },
  { value: "dark", key: "settings.theme.dark" },
];

const SHARE_CONTENT_OPTIONS: ReadonlyArray<{
  value: ShareCardContent;
  key:
    | "settings.shareCard.xp"
    | "settings.shareCard.time"
    | "settings.shareCard.both";
}> = [
  { value: "xp", key: "settings.shareCard.xp" },
  { value: "time", key: "settings.shareCard.time" },
  { value: "both", key: "settings.shareCard.both" },
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
  syncController = null,
  clientUpdates = null,
}: Props) {
  const { choice, locale, supportedLocales, setLocale, t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const shareContent = shareContentFor(progress);
  // 只列真正注册了界面文案的语言;重复值不生成选项,少于两种时整段隐藏。
  const languages = [...new Set(supportedLocales.filter(isUiLocale))];

  return (
    <div className="settings">
      {clientUpdates && <ClientUpdateSettings updates={clientUpdates} />}

      {languages.length >= 2 && (
        <fieldset className="language-settings">
          <legend className="settings-title">{t("language.label")}</legend>
          <div className="goal-presets language-options">
            <label className="language-option">
              <input
                className="visually-hidden"
                type="radio"
                name="ui-locale"
                value="system"
                checked={choice === "system"}
                onChange={() => setLocale("system")}
              />
              <span className={`theme-option ${choice === "system" ? "selected" : ""}`}>
                {t("language.system")}
              </span>
            </label>
            {languages.map((code) => (
              <label className="language-option" key={code}>
                <input
                  className="visually-hidden"
                  type="radio"
                  name="ui-locale"
                  value={code}
                  checked={choice === code}
                  onChange={() => setLocale(code)}
                />
                <span
                  className={`theme-option ${choice === code ? "selected" : ""}`}
                  lang={code}
                >
                  {t(`language.${code}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="settings-title">{t("settings.appearance")}</div>
      <div
        className="goal-presets"
        role="radiogroup"
        aria-label={t("settings.appearance")}
      >
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themeChoice === option.value}
            className={`theme-option ${themeChoice === option.value ? "selected" : ""}`}
            onClick={() => onThemeChange?.(option.value)}
          >
            {t(option.key)}
          </button>
        ))}
      </div>

      <div className="settings-title">{t("settings.dailyGoal")}</div>
      <div className="goal-presets">
        {GOAL_PRESETS.map((g) => (
          <button
            key={g}
            className={`option-btn ${progress.dailyGoal === g ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, dailyGoal: g })}
          >
            {t("settings.dailyGoalValue", { xp: formatNumber(locale, g) })}
          </button>
        ))}
      </div>

      <div className="settings-title">{t("settings.shareCard")}</div>
      <div
        className="goal-presets"
        role="radiogroup"
        aria-label={t("settings.shareCard")}
      >
        {SHARE_CONTENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={shareContent === option.value}
            className={`option-btn ${shareContent === option.value ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, shareCardContent: option.value })}
          >
            {t(option.key)}
          </button>
        ))}
      </div>

      <div className="settings-title">{t("settings.sound")}</div>
      <div className="goal-presets">
        {[
          { value: true, key: "settings.sound.on" },
          { value: false, key: "settings.sound.off" },
        ].map((o) => (
          <button
            key={String(o.value)}
            className={`option-btn ${progress.sound === o.value ? "selected" : ""}`}
            onClick={() => onChange({ ...progress, sound: o.value })}
          >
            {t(o.key as "settings.sound.on" | "settings.sound.off")}
          </button>
        ))}
      </div>

      {locale !== "fr" && (
        <>
          <div className="settings-title">{t("translation.title")}</div>
          <div className="goal-presets">
            {[
              { value: true, key: "translation.enable" },
              { value: false, key: "translation.disable" },
            ].map((o) => (
              <button
                key={String(o.value)}
                className={`option-btn ${progress.translationEnabled === o.value ? "selected" : ""}`}
                onClick={() => onChange({ ...progress, translationEnabled: o.value })}
              >
                {t(o.key as "translation.enable" | "translation.disable")}
              </button>
            ))}
          </div>

          <div className="settings-title">{t("translation.timing")}</div>
          <div className="goal-presets">
            {[
              { value: "before" as const, key: "translation.before" as const },
              { value: "after" as const, key: "translation.after" as const },
            ].map((o) => (
              <button
                key={o.value}
                className={`option-btn ${progress.translationTiming === o.value ? "selected" : ""}`}
                disabled={!progress.translationEnabled}
                onClick={() => onChange({ ...progress, translationTiming: o.value })}
              >
                {t(o.key)}
              </button>
            ))}
          </div>
        </>
      )}

      <ProgressBackup progress={progress} onChange={onChange} />

      {syncController && <SyncSettings controller={syncController} />}

      <div className="settings-title">{t("settings.danger")}</div>
      {confirming ? (
        <div className="danger-row">
          <span>{t("settings.clearConfirm")}</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              onChange({ ...DEFAULT_PROGRESS });
              setConfirming(false);
            }}
          >
            {t("settings.clearConfirmAction")}
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
          {t("settings.clear")}
        </button>
      )}

      <div className="settings-note">{t("settings.note")}</div>
    </div>
  );
}
