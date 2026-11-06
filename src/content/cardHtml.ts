/**
 * 卡片正文是受限 HTML（见各章卡片写作约定）：只允许 p / br / strong / em / b / i /
 * ul / ol / li 这几个标签，不允许属性。这里按标签逐个处理：文本一律转义，
 * 只有白名单里的标签原样保留；带属性的标签、非法标签、以及没有对应开始标签的
 * 结束标签，全部按文本转义，避免出现「半还原」的标签。
 */

const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "b", "i", "ul", "ol", "li"]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeCardHtml(raw: string): string {
  const pieces = raw.split(/(<[^>]*>)/g);
  const out: string[] = [];
  const open: string[] = [];

  for (const piece of pieces) {
    const match = piece.match(/^<(\/?)([a-zA-Z]+)>$/);
    if (!match) {
      out.push(escapeHtml(piece));
      continue;
    }
    const [, slash, rawName] = match;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      out.push(escapeHtml(piece));
      continue;
    }
    if (name === "br") {
      out.push("<br>");
      continue;
    }
    if (slash === "") {
      open.push(name);
      out.push(`<${name}>`);
      continue;
    }
    const index = open.lastIndexOf(name);
    if (index === -1) {
      out.push(escapeHtml(piece));
      continue;
    }
    open.splice(index);
    out.push(`</${name}>`);
  }

  return out.join("");
}
