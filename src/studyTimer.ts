import { useEffect, useRef } from "react";

/** 每 5 秒结算一次;单次结算最多计入 10 秒,避免休眠/挂起恢复后一次暴增。 */
const FLUSH_INTERVAL_MS = 5000;
const MAX_SETTLE_SECONDS = 10;

/**
 * 页面可见时累计学习秒数,每 5 秒把新增秒数交给 onFlush;隐藏、pagehide、focus、卸载时也会结算。
 * onFlush 用 ref 保存,回调变化不会重启计时。
 */
export function useStudyTimer(onFlush: (seconds: number) => void): void {
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  useEffect(() => {
    let acc = 0;
    let last = Date.now();

    const settle = () => {
      const now = Date.now();
      const elapsed = document.hidden
        ? 0
        : Math.min(MAX_SETTLE_SECONDS, Math.max(0, Math.floor((now - last) / 1000)));
      acc += elapsed;
      last = now;
      if (acc > 0) {
        onFlushRef.current(acc);
        acc = 0;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        settle();
      } else {
        last = Date.now();
      }
    };
    const onPageHide = () => settle();
    const onFocus = () => {
      settle();
      last = Date.now();
    };

    const interval = setInterval(settle, FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", onFocus);
      settle();
    };
  }, []);
}
