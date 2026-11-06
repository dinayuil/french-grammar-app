import { describe, expect, test } from "vitest";
import { cardBodyToText, sanitizeCardHtml } from "./cardHtml";

describe("sanitizeCardHtml", () => {
  test("允许的标签还原，文本原样保留", () => {
    expect(sanitizeCardHtml("<p>什么是宾语代词？</p>")).toBe("<p>什么是宾语代词？</p>");
    expect(sanitizeCardHtml("<ul><li>le</li><li>la</li></ul>")).toBe(
      "<ul><li>le</li><li>la</li></ul>",
    );
    expect(sanitizeCardHtml("第一行<br>第二行")).toBe("第一行<br>第二行");
    expect(sanitizeCardHtml("第一行<br/>第二行")).toBe("第一行<br>第二行");
    expect(sanitizeCardHtml("第一行<br />第二行")).toBe("第一行<br>第二行");
    expect(sanitizeCardHtml("<strong>le / la / les</strong>")).toBe(
      "<strong>le / la / les</strong>",
    );
  });

  test("非法标签与属性保持转义，不进入 DOM", () => {
    expect(sanitizeCardHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(\"x\")&lt;/script&gt;",
    );
    expect(sanitizeCardHtml('<p class="x">文本</p>')).toBe(
      "&lt;p class=\"x\"&gt;文本&lt;/p&gt;",
    );
    expect(sanitizeCardHtml('<img src="x" onerror="y">')).toBe(
      "&lt;img src=\"x\" onerror=\"y\"&gt;",
    );
    expect(sanitizeCardHtml('<a href="https://x">链接</a>')).toBe(
      "&lt;a href=\"https://x\"&gt;链接&lt;/a&gt;",
    );
    expect(sanitizeCardHtml("<P>大写标签</P>")).toBe("<p>大写标签</p>");
  });

  test("字面 < 与 > 不会被当成标签吞掉内容", () => {
    expect(sanitizeCardHtml("<p>1 < 2</p>")).toBe("<p>1 &lt; 2</p>");
    expect(sanitizeCardHtml("<p>x < y <strong>z</strong></p>")).toBe(
      "<p>x &lt; y <strong>z</strong></p>",
    );
  });

  test("没有配对或错位的结束标签按文本处理", () => {
    expect(sanitizeCardHtml("</p>")).toBe("&lt;/p&gt;");
    expect(sanitizeCardHtml("<p>x</p></p>")).toBe("<p>x</p>&lt;/p&gt;");
    expect(sanitizeCardHtml("<p><strong>x</p>")).toBe("<p><strong>x&lt;/p&gt;");
  });

  test("</br> 不当成换行", () => {
    expect(sanitizeCardHtml("a</br>b")).toBe("a&lt;/br&gt;b");
  });

  test("实体先还原再转义，不会双重转义", () => {
    expect(sanitizeCardHtml("<p>a &lt; b &amp; c</p>")).toBe("<p>a &lt; b &amp; c</p>");
  });

  test("& < > 一律先转义", () => {
    expect(sanitizeCardHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
});

describe("cardBodyToText", () => {
  test("去标签并保留段落/列表分行", () => {
    expect(cardBodyToText("<p>什么是宾语代词？<br>法语里…</p><ul><li>le</li><li>la</li></ul>")).toBe(
      "什么是宾语代词？\n法语里…\nle\nla",
    );
  });

  test("还原实体", () => {
    expect(cardBodyToText("<p>a &lt; b &amp; c</p>")).toBe("a < b & c");
  });

  test("字面 < 保留", () => {
    expect(cardBodyToText("<p>a < b</p>")).toBe("a < b");
  });
});
