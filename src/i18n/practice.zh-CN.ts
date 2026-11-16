/**
 * 练习、结算、统计、设置与错题复习的中文文案。
 *
 * 本域文件由多语言主会话聚合进 `src/i18n/zh-CN.ts`；在聚合完成前，直接
 * 渲染相关组件会因中央目录缺少键而抛错，这是刻意的接线依赖，不做静默回退。
 */
export const practiceZhCN = {
  "lesson.exit": "退出练习",
  "lesson.progress": "第 {current} 题，共 {total} 题",

  "question.correctOption": "{option}，正确答案",
  "question.wrongOption": "{option}，所选答案错误",

  "letters.backspace": "⌫ 退格",
  "letters.clear": "清空",

  "settlement.title.lesson": "练习完成!",
  "settlement.title.challenge": "挑战完成!",
  "settlement.perfect": "全对!零失误!",
  "settlement.mistakes": "答错 {count} 题,重做可补回 3 星",
  "settlement.quizXp": "答题 XP",
  "settlement.redoXp": "重做错题",
  "settlement.lessonXp": "过关奖励",
  "settlement.perfectXp": "全对奖励",
  "settlement.totalXp": "共获得",
  "settlement.redo": "重做错题",
  "settlement.next": "下一关",

  "goal.title": "今日目标达成 🎉",
  "goal.body": "已完成今日 {goal} XP 目标，分享打卡记录鼓励自己吧！",
  "goal.share": "分享打卡",
  "goal.busy": "生成中…",
  "goal.retry": "重试",
  "goal.later": "稍后再说",
  "goal.downloaded": "图片已保存到本地，可手动分享",
  "goal.cancelled": "已取消",
  "goal.shareFailed": "分享失败：{detail}",

  "level.current": "等级 {level}",
  "level.xpLabel": "升级经验",
  "level.xpValue": "{current} / {total} XP",

  "streak.label": "天连击",

  "stats.xp": "累计 XP",
  "stats.level": "等级",
  "stats.streak": "连击",
  "stats.recent7": "最近 7 天",
  "stats.studyRecent7": "最近 7 天学习时长（分钟）",
  "stats.read": "看讲解",
  "stats.practice": "做练习",
  "stats.total": "累计学习时长 {total}（看讲解 {read} / 做练习 {practice}）",
  "stats.share": "分享今日打卡",
  "stats.shareAria": "分享今日打卡图片",
  "stats.shareBusy": "生成中…",
  "stats.shareError": "分享失败，点击重试",
  "stats.shareFailed": "分享失败：{detail}",
  "stats.shareOpened": "已打开分享",
  "stats.shareDownloaded": "图片已保存到本地，可手动分享",
  "stats.shareCancelled": "已取消",
  "stats.retry": "请重试",

  "settings.appearance": "外观",
  "settings.theme.light": "浅色",
  "settings.theme.system": "跟随系统",
  "settings.theme.dark": "深色",
  "settings.dailyGoal": "每日目标",
  "settings.dailyGoalValue": "{xp} XP / 天",
  "settings.shareCard": "分享卡内容",
  "settings.shareCard.xp": "经验",
  "settings.shareCard.time": "时间",
  "settings.shareCard.both": "都有",
  "settings.sound": "音效",
  "settings.sound.on": "🔊 开启",
  "settings.sound.off": "🔇 关闭",
  "settings.danger": "危险操作",
  "settings.clear": "清空进度",
  "settings.clearConfirm": "确定清空全部进度(连击、XP、关卡)?",
  "settings.clearConfirmAction": "确认清空",
  "settings.note":
    "内容说明：本应用内容由 AI 参与编写与复核，未经过人工法语审校。",

  "review.title": "错题回顾",
  "review.source": "错题本",
  "review.empty": "没有错题,太棒了!",
} as const;
