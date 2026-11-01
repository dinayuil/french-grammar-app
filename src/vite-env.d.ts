/// <reference types="vite/client" />

declare const __FGE_EDITION__: "public" | "internal";

declare module "virtual:fge-content" {
  export const CHAPTERS: import("./types").Chapter[];
}
