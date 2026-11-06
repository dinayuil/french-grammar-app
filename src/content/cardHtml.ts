/**
 * 卡片正文是受限 HTML（见各章卡片写作约定）：只允许 p / br / strong / em / b / i /
 * ul / ol / li 这几个标签，不允许属性。
 *
 * 这里先把正文切成「文本」和「标签」两类 token（只有形如 `<名字>`、`</名字>`、
 * `<名字/>` 的才算标签，其余 `<` 一律当文本），再：
 * - 文本：先还原实体，再整体转义；
 * - 标签：只保留白名单、且没有对应开始标签的结束标签会被转义。
 * 这样 `<script>`、带属性的标签、`</br>`、没有配对的结束标签都不会进入 DOM。
 */

const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "b", "i", "ul", "ol", "li"]);
const TAG_PATTERN = /^\/?([a-zA-Z]+)\s*\/?$/;

type Token = { type: "text"; value: string } | { type: "tag"; slash: boolean; name: string };

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let text = "";

  while (i < raw.length) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      text += raw.slice(i);
      break;
    }
    text += raw.slice(i, lt);
    const gt = raw.indexOf(">", lt);
    if (gt === -1) {
      text += raw.slice(lt);
      break;
    }
    const inner = raw.slice(lt + 1, gt);
    const match = inner.match(TAG_PATTERN);
    if (!match) {
      // 不是合法标签（例如字面量 `<`），只把 `<` 当文本，继续往后找真正的标签
      text += "<";
      i = lt + 1;
      continue;
    }
    if (text) {
      tokens.push({ type: "text", value: text });
      text = "";
    }
    tokens.push({ type: "tag", slash: inner.startsWith("/"), name: match[1].toLowerCase() });
    i = gt + 1;
  }

  if (text) tokens.push({ type: "text", value: text });
  return tokens;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeCardHtml(raw: string): string {
  const out: string[] = [];
  const open: string[] = [];

  for (const token of tokenize(raw)) {
    if (token.type === "text") {
      out.push(escapeHtml(decodeEntities(token.value)));
      continue;
    }
    const { slash, name } = token;
    if (!ALLOWED_TAGS.has(name)) {
      out.push(escapeHtml(`<${slash ? "/" : ""}${name}>`));
      continue;
    }
    if (name === "br" && !slash) {
      out.push("<br>");
      continue;
    }
    if (!slash) {
      open.push(name);
      out.push(`<${name}>`);
      continue;
    }
    if (open.length === 0 || open[open.length - 1] !== name) {
      // 没有配对（或配对的不是最近一个）的结束标签按文本处理
      out.push(escapeHtml(`</${name}>`));
      continue;
    }
    open.pop();
    out.push(`</${name}>`);
  }

  return out.join("");
}

/**
 * 卡片正文的纯文本版本：去掉标签、还原实体，并把段落/列表边界换行。
 * 供搜索索引与摘要使用。
 */
export function cardBodyToText(raw: string): string {
  let out = "";
  for (const token of tokenize(raw)) {
    if (token.type === "text") {
      out += token.value;
    } else if (token.name === "br" || token.name === "p" || token.name === "li" || token.name === "ul" || token.name === "ol") {
      out += "\n";
    }
  }
  return decodeEntities(out)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
