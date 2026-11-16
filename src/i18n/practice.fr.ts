import { practiceZhCN } from "./practice.zh-CN";

type PracticeCatalog = Record<keyof typeof practiceZhCN, string>;

/**
 * 练习、结算、统计、设置与错题复习的法语文案。
 *
 * 与中文域文件逐键对应；聚合后仍由中央 `assertMessageCatalogsComplete()`
 * 校验非空与占位符一致性。
 */
export const practiceFr = {
  "lesson.exit": "Quitter l'exercice",
  "lesson.progress": "Question {current} sur {total}",

  "question.correctOption": "{option}, bonne réponse",
  "question.wrongOption": "{option}, réponse choisie incorrecte",

  "letters.backspace": "⌫ Retour arrière",
  "letters.clear": "Vider",

  "settlement.title.lesson": "Exercice terminé !",
  "settlement.title.challenge": "Défi terminé !",
  "settlement.perfect": "Tout juste ! Aucune erreur !",
  "settlement.mistakes": "Erreurs : {count} · refaites-les pour retrouver 3 étoiles",
  "settlement.quizXp": "XP des réponses",
  "settlement.redoXp": "XP des reprises",
  "settlement.lessonXp": "Bonus de niveau",
  "settlement.perfectXp": "Bonus sans faute",
  "settlement.totalXp": "Total obtenu",
  "settlement.redo": "Refaire les erreurs",
  "settlement.next": "Niveau suivant",

  "goal.title": "Objectif du jour atteint 🎉",
  "goal.body":
    "Vous avez atteint l'objectif de {goal} XP aujourd'hui. Partagez votre progression du jour pour vous encourager !",
  "goal.share": "Partager la progression",
  "goal.busy": "Génération…",
  "goal.retry": "Réessayer",
  "goal.later": "Plus tard",
  "goal.downloaded": "Image enregistrée localement ; partage manuel possible",
  "goal.cancelled": "Annulé",
  "goal.shareFailed": "Échec du partage : {detail}",

  "level.current": "Niveau {level}",
  "level.xpLabel": "XP avant le niveau suivant",
  "level.xpValue": "{current} / {total} XP",

  "streak.label": "jours de série",

  "stats.xp": "XP cumulés",
  "stats.level": "Niveau",
  "stats.streak": "Série",
  "stats.recent7": "7 derniers jours",
  "stats.studyRecent7": "Temps d'étude des 7 derniers jours (minutes)",
  "stats.read": "Cours",
  "stats.practice": "Exercices",
  "stats.total":
    "Temps d'étude total : {total} (cours {read} / exercices {practice})",
  "stats.share": "Partager la progression du jour",
  "stats.shareAria": "Partager l'image de la progression du jour",
  "stats.shareBusy": "Génération…",
  "stats.shareError": "Échec du partage, cliquez pour réessayer",
  "stats.shareFailed": "Échec du partage : {detail}",
  "stats.shareOpened": "Partage ouvert",
  "stats.shareDownloaded": "Image enregistrée localement ; partage manuel possible",
  "stats.shareCancelled": "Annulé",
  "stats.retry": "Veuillez réessayer",

  "settings.appearance": "Apparence",
  "settings.theme.light": "Clair",
  "settings.theme.system": "Système",
  "settings.theme.dark": "Sombre",
  "settings.dailyGoal": "Objectif quotidien",
  "settings.dailyGoalValue": "{xp} XP / jour",
  "settings.shareCard": "Contenu de la carte de partage",
  "settings.shareCard.xp": "XP",
  "settings.shareCard.time": "Temps",
  "settings.shareCard.both": "Les deux",
  "settings.sound": "Son",
  "settings.sound.on": "🔊 Activé",
  "settings.sound.off": "🔇 Désactivé",
  "settings.danger": "Zone sensible",
  "settings.clear": "Effacer la progression",
  "settings.clearConfirm": "Effacer toute la progression (série, XP, niveaux) ?",
  "settings.clearConfirmAction": "Effacer",
  "settings.note":
    "À propos du contenu : cette application est rédigée et révisée avec l'aide de l'IA, sans relecture humaine du français.",

  "review.title": "Révision des erreurs",
  "review.source": "Cahier d'erreurs",
  "review.empty": "Aucune erreur, bravo !",
} satisfies PracticeCatalog;
