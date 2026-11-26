import { useState } from "react";
import type { ClientUpdates } from "../native/useClientUpdates";
import { useLocale } from "../i18n/LocaleProvider";

interface Props {
  updates: ClientUpdates;
}

/**
 * 客户端更新面板:只读取原生 hook 提供的状态,不自行发起检查。
 * 视觉上沿用设置页的备份样式与按钮,不另设状态卡片。
 */
export function ClientUpdateSettings({ updates }: Props) {
  const { t } = useLocale();
  const { installedVersion, status, check, openRelease } = updates;
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const statusText =
    status === "checking"
      ? t("update.status.checking")
      : status === "current"
        ? t("update.status.current")
        : status === "available"
          ? t("update.status.available")
          : t("update.status.error");

  const checkLabel =
    status === "checking"
      ? t("update.checking")
      : status === "error"
        ? t("update.retry")
        : t("update.check");

  const handleCheck = () => {
    setOpenFailed(false);
    check();
  };

  const handleOpenRelease = async () => {
    if (opening) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      await openRelease();
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <section
      className="backup-panel update-panel"
      aria-labelledby="client-update-title"
    >
      <h2 className="settings-title backup-title" id="client-update-title">
        {t("update.title")}
      </h2>
      <p className="backup-hint">
        {t("update.currentVersion", { version: installedVersion })}
      </p>

      <p
        className={`backup-status${status === "error" ? " backup-error" : ""}`}
        role={status === "error" ? "alert" : "status"}
      >
        {statusText}
      </p>

      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCheck}
          disabled={status === "checking"}
          aria-busy={status === "checking" ? "true" : undefined}
        >
          {checkLabel}
        </button>
        <button
          type="button"
          className={`btn ${
            status === "available" ? "btn-primary" : "btn-secondary"
          }`}
          onClick={handleOpenRelease}
          disabled={opening}
          aria-busy={opening ? "true" : undefined}
        >
          {opening ? t("update.opening") : t("update.open")}
        </button>
      </div>

      {openFailed && (
        <p className="backup-status backup-error" role="alert">
          {t("update.openFailed")}
        </p>
      )}
    </section>
  );
}
