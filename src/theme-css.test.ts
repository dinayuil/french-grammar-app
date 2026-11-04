import css from "./styles.css?raw";

/** 取指定选择器的规则体;精确匹配选择器后的 `{`,避免命中 `:disabled` 等派生规则。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`styles.css 中未找到规则: ${selector}`);
  return match[1];
}

test("定义深色主题选择器并覆盖关键 token", () => {
  expect(css).toContain(':root[data-theme="dark"]');
  expect(css).toContain("--bg: #131f24");
  expect(css).toContain("--on-green: #1a2e05");
  expect(css).toContain("--text-secondary: #6e6e6e");
  expect(css).toContain("--focus: 0 0 0 3px #2f6b00");
});

test("深色 token 使用规范值", () => {
  const dark = ruleBody(':root[data-theme="dark"]');
  expect(dark).toContain("--bg: #131f24");
  expect(dark).toContain("--surface: #1b2a31");
  expect(dark).toContain("--text: #e4e6e8");
  expect(dark).toContain("--text-secondary: #9aa2a8");
  expect(dark).toContain("--green: #6ad923");
  expect(dark).toContain("--on-green: #0a1a10");
  expect(dark).toContain("--focus: 0 0 0 3px #86e44a");
  expect(css).toContain(":root:not([data-theme])");
});

test("主题选择控件选中态使用绿底深字", () => {
  expect(css).toContain(".theme-option.selected");
  const selected = ruleBody(".theme-option.selected");
  expect(selected).toContain("background: var(--green)");
  expect(selected).toContain("color: var(--on-green)");
});

test("全站焦点态与减少动效规则存在", () => {
  expect(css).toContain("*:focus-visible");
  expect(ruleBody("*:focus-visible")).toContain("box-shadow: var(--focus)");
  expect(css).toContain("prefers-reduced-motion");
});

test("按钮规则使用语义 token,不再硬编码白字", () => {
  const primary = ruleBody(".btn-primary");
  expect(primary).toContain("var(--on-green)");
  expect(primary).not.toContain("color: #fff");

  expect(ruleBody(".lesson-badge")).toContain("var(--on-gold)");
  expect(ruleBody(".nav-item")).toContain("var(--text-secondary)");
});
