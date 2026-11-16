import type { readingZhCN } from "./reading.zh-CN";

/**
 * 阅读、目录与首页范围的法语文案。
 *
 * 键集合与中文域目录一致，最终由消息目录聚合器展开进 `fr.ts`。
 */
export const readingFr = {
  "home.greeting": "Bonjour, pratiquons un peu le ",
  "home.goal.today": "Objectif du jour",
  "home.goal.earned": "Gagnés aujourd'hui",
  "home.goal.unset": "Aucun objectif quotidien défini",
  "home.goal.met": "Objectif du jour atteint",
  "home.goal.over": "Atteint · {xp} XP en plus",
  "home.goal.remaining": "Encore {xp} XP",
  "home.review": "Réviser les erreurs",
  "home.empty": "La banque d'exercices originaux est en préparation",
  "home.challenge": "Défi",
  "home.cardsButton": "Cours",
  "home.cardsTitle": "Fiche de cours",
  "home.sectionCardsTitle": "Fiche de cette section",
  "home.readCardsAria": "Lire la fiche : {title}",
  "home.chapterAria": "Chapitre {number} {title}, {done}/{total} terminés",

  "library.title": "Cours",
  "library.searchPlaceholder": "Rechercher dans les fiches…",
  "library.back": "Retour aux cours",
  "library.resultCount": "{count} résultat(s)",
  "library.noResults": "Aucune fiche pour « {query} »",
  "library.clear": "Effacer la recherche",
  "library.chapterAria": "Chapitre {number} {title}, {count} fiches",
  "library.start": "Commencer la lecture",
  "library.startAria": "Commencer la lecture : {title}",
  "library.read": "Lire",

  "reader.emptySection": "Aucune fiche dans cette section",
  "reader.emptyChapter": "Aucune fiche dans ce chapitre",
  "reader.chapterHeading": "Chapitre {number} · {title}",
  "reader.toc": "Sommaire",
  "reader.progress": "Progression de lecture",
  "reader.previousSection": "Section précédente",
  "reader.previousSectionAria": "Section précédente : {title}",
  "reader.sectionEnd": "Fin de la section",
  "reader.nextSection": "Section suivante",
  "reader.nextSectionAria": "Section suivante : {title}",
  "reader.previousCard": "Fiche précédente",
  "reader.nextCard": "Fiche suivante",
  "reader.practiceSection": "S'exercer sur cette section",
  "reader.practiceChapter": "S'exercer sur ce chapitre",
  "reader.tocClose": "Fermer le sommaire",
  "reader.tocScope": "{title} · {count} fiches",

  "section.unit": "Unité {unit}",
  "section.cards": "{count} fiches",
  "section.progress": "{done}/{total} niveaux",
  "section.noChallenges": "Aucun défi",
  "section.noLessons": "Aucun exercice",
  "section.noCards": "Aucun exercice dans cette section",
  "section.complete": "Terminé",
  "section.comprehensive": "Défis de synthèse",
} satisfies Record<keyof typeof readingZhCN, string>;
