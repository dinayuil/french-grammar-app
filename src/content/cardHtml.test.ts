import { describe, expect, test } from "vitest";
import { sanitizeCardHtml } from "./cardHtml";

describe("sanitizeCardHtml", () => {
  test("允许的标签还原，文本原样保留", () => {
    expect(sanitizeCardHtml("<p>什么是宾语代词？</p>")).toBe("<p>什么是宾语代词？</p>");
    expect(sanitizeCardHtml("<ul><li>le</li><li>la</li></ul>")).toBe(
      "<ul><li>le</li><li>la</li></ul>",
    );
    expect(sanitizeCardHtml("第一行<br>第二行")).toBe("第一行<br>第二行");
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
  });

  test("& < > 一律先转义", () => {
    expect(sanitizeCardHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
});
