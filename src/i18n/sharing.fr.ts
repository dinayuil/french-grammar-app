import type { SharingKey } from "./sharing.zh-CN";

/** 分享域法语文案；键与占位符必须和 `sharingZhCN` 完全一致。 */
export const sharingFr = {
  "sharing.card.brand": "Exercices de grammaire française",
  "sharing.card.tagline": "Chaque jour, un peu de grammaire française",
  "sharing.card.today": "Auj.",
  "sharing.card.goal": "Objectif {goal} XP · {percent} % atteint",
  "sharing.card.goalNone": "Aucun objectif quotidien",
  "sharing.card.todayXp": "XP du jour",
  "sharing.card.streak": "Jours de série",
  "sharing.card.level": "Niveau",
  "sharing.card.totalXp": "XP cumulés",
  "sharing.card.weekXp": "XP des 7 derniers jours",
  "sharing.card.emptyXp": "Pas encore de points cette semaine",
  "sharing.card.todayStudy": "Temps d’étude aujourd’hui",
  "sharing.card.studyBreakdown": "Cours {read} · Exercices {practice}",
  "sharing.card.totalStudy": "Temps d’étude cumulé {total}",
  "sharing.card.legendRead": "Cours",
  "sharing.card.legendPractice": "Exercices",
  "sharing.card.weekStudy": "Temps d’étude (7 jours, min)",
  "sharing.card.emptyStudy": "Pas encore de temps d’étude cette semaine",
  "sharing.share.title": "Ma progression en grammaire française",
  "sharing.share.dialogTitle": "Partager ma progression",
  "sharing.share.saveDialogTitle": "Enregistrer la carte de partage",
  "sharing.share.error": "Échec du partage. Veuillez réessayer.",
  "sharing.share.ariaLabel": "Partager l’image du bilan du jour",
} satisfies Record<SharingKey, string>;
