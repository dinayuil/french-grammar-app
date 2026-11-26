import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyLocale,
  getSystemLanguages,
  loadLocaleChoice,
  resolveLocale,
  saveLocaleChoice,
  type LocaleChoice,
} from "./locale";
import { createTranslator, type Translate } from "./messages";
import type { UiLocale } from "./types";

export interface LocaleContextValue {
  /** 当前版本实际生效的 UI 语言。 */
  locale: UiLocale;
  choice: LocaleChoice;
  /** 当前内容版本声明的可用语言，由构建/App 传入，Provider 不硬编码版别。 */
  supportedLocales: readonly UiLocale[];
  /** 保存偏好并立即切换；不受当前支持列表限制，供上层恢复偏好使用。 */
  setLocale: (choice: LocaleChoice) => void;
  /** 已绑定当前语言的类型化文案函数。 */
  t: Translate;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  supportedLocales,
}: {
  children: ReactNode;
  supportedLocales: readonly UiLocale[];
}) {
  const [choice, setChoice] = useState(loadLocaleChoice);
  const [systemLanguages, setSystemLanguages] = useState(getSystemLanguages);
  const locale = resolveLocale(choice, supportedLocales, systemLanguages);

  useEffect(() => {
    const update = () => setSystemLanguages(getSystemLanguages());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: LocaleChoice) => {
    // 先持久化偏好，再更新状态；存储失败由 saveLocaleChoice 吞掉，本次会话仍切换。
    saveLocaleChoice(next);
    setChoice(next);
  }, []);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, choice, supportedLocales, setLocale, t }),
    [locale, choice, supportedLocales, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
