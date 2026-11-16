/**
 * 分享卡与分享动作的中文文案。
 *
 * 该文件是分享域的唯一中文来源；主会话把 `sharingZhCN` 汇入根目录后，
 * 分享代码仍通过核心 `t(locale, key, params)` 解析，不另建翻译器或中文回退。
 */
export const sharingZhCN = {
  "sharing.card.brand": "法语语法练习",
  "sharing.card.tagline": "每天练一点法语语法",
  "sharing.card.today": "今天",
  "sharing.card.goal": "目标 {goal} XP · 已完成 {percent}%",
  "sharing.card.goalNone": "未设置每日目标",
  "sharing.card.todayXp": "今日 XP",
  "sharing.card.streak": "连击天数",
  "sharing.card.level": "等级",
  "sharing.card.totalXp": "累计 XP",
  "sharing.card.weekXp": "最近 7 天 XP",
  "sharing.card.emptyXp": "这一周还没有得分",
  "sharing.card.todayStudy": "今日学习时长",
  "sharing.card.studyBreakdown": "看讲解 {read} · 做练习 {practice}",
  "sharing.card.totalStudy": "累计学习 {total}",
  "sharing.card.legendRead": "看讲解",
  "sharing.card.legendPractice": "做练习",
  "sharing.card.weekStudy": "最近 7 天学习时长（分钟）",
  "sharing.card.emptyStudy": "这一周还没有学习记录",
  "sharing.share.title": "我的法语学习打卡",
  "sharing.share.dialogTitle": "分享打卡",
  "sharing.share.saveDialogTitle": "保存分享卡",
  "sharing.share.error": "分享失败，请重试",
  "sharing.share.ariaLabel": "分享今日打卡图片",
} as const;

export type SharingKey = keyof typeof sharingZhCN;
