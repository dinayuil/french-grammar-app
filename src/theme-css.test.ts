import css from "./styles.css?raw";

/** 取指定选择器的规则体;精确匹配选择器后的 `{`,避免命中 `:disabled` 等派生规则。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`styles.css 中未找到规则: ${selector}`);
  return match[1];
}

test("浅色主题使用法国蓝白红纸墨色板", () => {
  const light = ruleBody(":root");
  expect(light).toContain("--bg: #f6f4ef");
  expect(light).toContain("--surface: #ffffff");
  expect(light).toContain("--text: #1c2433");
  expect(light).toContain("--primary: #21409a");
  expect(light).toContain("--primary-ink: #1b3578");
  expect(light).toContain("--green: #2e7d4f");
  expect(light).toContain("--red: #c93b45");
  expect(light).toContain("--nav-active: var(--primary-ink)");
});

test("深色主题使用夜蓝、亮蓝强调文字与 4560d2 实心按钮", () => {
  const dark = ruleBody(':root[data-theme="dark"]');
  expect(dark).toContain("--bg: #0e1420");
  expect(dark).toContain("--surface: #171f2e");
  expect(dark).toContain("--text: #edf0f7");
  expect(dark).toContain("--text-secondary: #a1aabd");
  expect(dark).toContain("--primary: #4560d2");
  expect(dark).toContain("--primary-ink: #a8bdff");
  expect(dark).toContain("--on-primary: #ffffff");
  expect(css).toContain(":root:not([data-theme])");
});

test("主操作与成功色分离", () => {
  expect(ruleBody(".btn-primary")).toContain("background: var(--primary)");
  expect(ruleBody(".btn-primary")).toContain("color: var(--on-primary)");
  expect(ruleBody(".option-btn.correct")).toContain("border-color: var(--green)");
  expect(ruleBody(".feedback.good")).toContain("background: var(--success-bg)");
  expect(ruleBody(".settlement-sub.good")).toContain("color: var(--green-ink)");
  expect(ruleBody(".hero-goal-fill")).toContain("background: var(--primary)");
  expect(ruleBody(".hero-goal.is-done .hero-goal-fill")).toContain(
    "background: var(--gold)"
  );
  expect(ruleBody(".lesson-progress-fill")).toContain("background: var(--primary)");
  expect(ruleBody(".reader-progress-fill")).toContain("background: var(--primary)");
  expect(ruleBody(".bar-fill")).toContain("background: var(--primary)");
});

test("章节卡不再是 2px 灰框，展开态有明确状态", () => {
  const card = ruleBody(".chapter-card");
  expect(card).toContain("border: 1px solid var(--border)");
  expect(card).not.toContain("border: 2px solid var(--gray)");
  expect(card).toContain("box-shadow: var(--shadow-card)");
  expect(ruleBody(".chapter-card.is-open")).toContain(
    "border-color: var(--primary-border)"
  );
  expect(ruleBody(".section-card.is-open")).toContain(
    "background: var(--primary-soft)"
  );
});

test("折叠控件使用 plus/minus 图标而不是文本箭头", () => {
  expect(ruleBody(".plus-minus-icon")).toContain("stroke: currentColor");
  expect(ruleBody(".section-fold")).toContain("width: 44px");
  expect(css).not.toContain(".section-arrow");
  expect(css).not.toContain(".chapter-arrow");
});

test("讲解入口是固定的轻量控件，不是绿色主按钮", () => {
  const cards = ruleBody(".btn-cards");
  expect(cards).toContain("background: var(--primary-soft)");
  expect(cards).toContain("color: var(--primary-ink)");
  expect(ruleBody(".library-start")).toContain("background: var(--surface)");
  expect(ruleBody(".library-start")).toContain("color: var(--primary-ink)");
  expect(ruleBody(".library-start")).not.toContain("var(--green)");
});

test("阅读器使用蓝主按钮、浅蓝练习入口和纸张容器", () => {
  expect(ruleBody(".reader-next")).toContain("background: var(--primary)");
  expect(ruleBody(".reader-next")).toContain("color: var(--on-primary)");
  expect(ruleBody(".reader-practice")).toContain("background: var(--primary-soft)");
  expect(ruleBody(".reader-body")).toContain("background: var(--surface)");
  expect(ruleBody(".reader-body")).toContain("border: 1px solid var(--border)");
  expect(ruleBody(".reader-footer")).toContain("display: grid");
});

test("选择态使用蓝色，不冒充答对绿", () => {
  expect(ruleBody(".theme-option.selected")).toContain("background: var(--primary)");
  expect(ruleBody(".theme-option.selected")).toContain("color: var(--on-primary)");
  expect(ruleBody(".option-btn.selected")).toContain("border-color: var(--primary)");
  expect(ruleBody(".option-btn.correct")).toContain("var(--green)");
});

test("focus 环双层且章节内使用 inset 版本", () => {
  expect(ruleBody(":root")).toContain(
    "--focus: 0 0 0 2px var(--surface), 0 0 0 5px var(--primary)"
  );
  expect(ruleBody(":root")).toContain(
    "--focus-inset: inset 0 0 0 2px var(--surface), inset 0 0 0 5px var(--primary)"
  );
  expect(ruleBody(".chapter-toggle:focus-visible")).toContain("var(--focus-inset)");
  expect(ruleBody(".section-toggle:focus-visible")).toContain("var(--focus-inset)");
  expect(ruleBody(".lesson-item:focus-visible")).toContain("var(--focus-inset)");
});

test("导航 active 与讲解库搜索使用主色", () => {
  expect(ruleBody(".nav-item.active")).toContain("color: var(--nav-active)");
  expect(ruleBody(".library-search:focus")).toContain("border-color: var(--primary)");
  expect(ruleBody(".library-result-chapter")).toContain("color: var(--primary-ink)");
});
