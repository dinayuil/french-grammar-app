/**
 * 学习时长显示规则:不足一小时按四舍五入的分钟显示;满一小时后显示小时与剩余分钟。
 * 统计页与分享卡共用,避免两处口径漂移。
 */
export function formatStudyDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.round(safeSeconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}
