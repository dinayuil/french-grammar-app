import { expect, test } from "vitest";
import { CHAPTERS } from "../content";
import { sanitizeCardHtml } from "./cardHtml";

test.skipIf(__FGE_EDITION__ !== "public")("讲解卡的编号不会因拆成单项列表而重复从 1 开始", () => {
  const problems: string[] = [];
  const body = document.createElement("div");

  for (const chapter of CHAPTERS) {
    for (const card of chapter.cards) {
      for (const [locale, content] of Object.entries({ "zh-CN": card, ...card.locales })) {
        if (!content.body) continue;
        body.innerHTML = sanitizeCardHtml(content.body);
        const singleItemLists = body.querySelectorAll(":scope > ol > li:only-child");
        if (singleItemLists.length > 1) {
          problems.push(`${card.id} (${locale}): ${Array(singleItemLists.length).fill(1).join(", ")}`);
        }
      }
    }
  }

  expect(problems).toEqual([]);
});
