import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { UiLocale } from "../i18n/types";
import { t } from "../i18n/messages";
import "./LanguageMenu.css";

export interface LanguageMenuProps {
  /** 当前界面语言,决定按钮文案、菜单标题和无障碍名称。 */
  locale: UiLocale;
  /** 当前 edition 已启用的界面语言;顺序即菜单顺序。 */
  supportedLocales: readonly UiLocale[];
  /** 只通知语言选择,不负责保存、同步或路由。 */
  onChange: (locale: UiLocale) => void;
}

type LocaleMeta = {
  /** 语言自称,选项和按钮都使用它,避免读者必须先认识当前界面语言。 */
  name: string;
  /** 极窄屏的缩写;完整名称保留在 aria-label。 */
  shortName: string;
};

const LOCALE_META: Record<UiLocale, LocaleMeta> = {
  "zh-CN": { name: "简体中文", shortName: "中" },
  fr: { name: "Français", shortName: "FR" },
};

function GlobeIcon() {
  return (
    <svg
      className="language-menu__globe"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.75 10h14.5" />
      <path d="M10 2.75c2.1 2.2 3.1 4.6 3.1 7.25S12.1 15.05 10 17.25c-2.1-2.2-3.1-4.6-3.1-7.25S7.9 4.95 10 2.75z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="language-menu__check"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.2 8.4l3.1 3.1 6.5-6.7" />
    </svg>
  );
}

export function LanguageMenu({ locale, supportedLocales, onChange }: LanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const pendingFocus = useRef<"selected" | "first" | "last">("selected");
  const baseId = useId();

  // 调用方可能重复声明同一语言;真正的门槛是“不同语言至少两种”。
  const supported = Array.from(new Set(supportedLocales)).filter((code) =>
    Object.prototype.hasOwnProperty.call(LOCALE_META, code)
  );

  // 当前 edition 暂时只提供一种语言时收起菜单;恢复完整语言包后保持关闭,
  // 不能因为曾经展开过就自动弹开。
  useEffect(() => {
    if (supported.length < 2 && open) setOpen(false);
  }, [open, supported.length]);

  // 打开后焦点进入选中项;点击触发按钮时同样适用。只依赖 open,
  // 避免调用方每次重渲染传入新数组或新对象时把焦点抢回菜单。
  useEffect(() => {
    if (!open || supported.length < 2) return;
    const selected = supported.indexOf(locale);
    let index = selected >= 0 ? selected : 0;
    if (pendingFocus.current === "first") index = 0;
    else if (pendingFocus.current === "last") index = supported.length - 1;
    pendingFocus.current = "selected";
    optionRefs.current[index]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // 外部按压就关闭并回焦。mousedown 的默认聚焦必须阻止,否则浏览器随后
    // 会把焦点送给被点的元素,不符合“关闭后回焦”的约定。
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", onDocumentMouseDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open]);

  if (supported.length < 2) return null;

  const caption = t(locale, "language.label");
  const changeLabel = t(locale, "language.change");
  // 两种语言时显示另一种语言的自称,中文用户看到 Français,法语用户看到
  // 简体中文。未来超过两种语言时仍给出一个可切换目标,而不是当前语言。
  const targetCode = supported.find((code) => code !== locale) ?? supported[0]!;
  const target = LOCALE_META[targetCode];
  const triggerLabel =
    locale === "fr" ? `${changeLabel} : ${target.name}` : `${changeLabel}：${target.name}`;
  const listboxId = `${baseId}-listbox`;
  const captionId = `${baseId}-caption`;

  const openMenu = (focus: "selected" | "first" | "last" = "selected") => {
    pendingFocus.current = focus;
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const focusOption = (index: number) => {
    if (supported.length === 0) return;
    const normalized = ((index % supported.length) + supported.length) % supported.length;
    optionRefs.current[normalized]?.focus();
  };

  const choose = (next: UiLocale) => {
    setOpen(false);
    if (next !== locale) onChange(next);
    triggerRef.current?.focus();
  };

  const handleTriggerClick = () => {
    if (open) closeMenu();
    else openMenu();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) focusOption(0);
      else openMenu();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) focusOption(supported.length - 1);
      else openMenu("last");
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      // 显式处理并阻止默认点击,避免浏览器再合成一次 click 把刚打开的菜单关掉。
      event.preventDefault();
      if (open) closeMenu();
      else openMenu();
    }
  };

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLLIElement>,
    index: number,
    code: UiLocale
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOption(supported.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(code);
    }
  };

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const next = event.relatedTarget;
    // relatedTarget 为空时可能是浏览器窗口切换或按压过程中的瞬时失焦,
    // 交给 Escape / 外部按压处理,避免把菜单提前关掉。
    if (!next) return;
    if (rootRef.current?.contains(next)) return;
    // 键盘 Tab 离开菜单:关闭但不抢走用户刚移到的焦点。
    setOpen(false);
  };

  return (
    <div className="language-menu" ref={rootRef} lang={locale} onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="language-menu__trigger"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <GlobeIcon />
        <span className="language-menu__label language-menu__label--full" aria-hidden="true">
          {target.name}
        </span>
        <span className="language-menu__label language-menu__label--short" aria-hidden="true">
          {target.shortName}
        </span>
      </button>

      {open && (
        <div className="language-menu__panel">
          <div className="language-menu__caption" id={captionId}>
            {caption}
          </div>
          <ul
            className="language-menu__list"
            id={listboxId}
            role="listbox"
            aria-labelledby={captionId}
            aria-orientation="vertical"
          >
            {supported.map((code, index) => {
              const meta = LOCALE_META[code];
              const selected = code === locale;
              return (
                <li
                  key={code}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  className="language-menu__option"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  lang={code}
                  onClick={() => choose(code)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index, code)}
                >
                  <span className="language-menu__option-name">{meta.name}</span>
                  {selected && <CheckIcon />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
