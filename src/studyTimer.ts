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
    // 只有可见期间才累计;隐藏后重复的 visibilitychange 不能把后台时间算进来。
    let counting = !document.hidden;

    /** 结算自上次结算以来的可见秒数;只在 counting 为真(页面可见)时调用。 */
    const settle = () => {
      const now = Date.now();
      const elapsed = Math.min(
        MAX_SETTLE_SECONDS,
        Math.max(0, Math.floor((now - last) / 1000))
      );
      acc += elapsed;
      last = now;
      if (acc > 0) {
        const seconds = acc;
        // 先清空再回调:即使回调抛错,下一次结算也不会重复累计同一批秒数。
        acc = 0;
        onFlushRef.current(seconds);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // 进入隐藏时 document.hidden 已经为 true,必须显式结算刚过去的可见时间。
        if (counting) settle();
        counting = false;
      } else {
        last = Date.now();
        counting = true;
      }
    };
    const onPageHide = () => {
      // pagehide 可能在 visibilitychange 之前(直接关页)或之后(先切后台再关);只结算可见时间。
      if (counting) settle();
    };
    const onFocus = () => {
      if (counting) settle();
      last = Date.now();
    };

    const interval = setInterval(() => {
      if (counting) settle();
    }, FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", onFocus);
      if (counting) settle();
      counting = false;
    };
  }, []);
}
