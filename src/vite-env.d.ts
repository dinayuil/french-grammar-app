/// <reference types="vite/client" />

declare const __FGE_EDITION__: "public" | "internal";
declare const __FGE_PUBLIC_RELEASE_CODE__: number | null;

declare module "virtual:fge-content" {
  export const CHAPTERS: import("./types").Chapter[];
  export const SUPPORTED_LOCALES: readonly import("./i18n/types").UiLocale[];
}
