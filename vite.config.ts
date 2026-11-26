import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import {
  contentPlugin,
  resolveContentRoot,
  resolveEdition,
} from "./build/content";

const appRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const edition = resolveEdition(process.env.FGE_EDITION);
const contentRoot = resolveContentRoot(edition);
const { FGE_PUBLIC_VERSION_CODE, FGE_PUBLIC_VERSION_NAME } = process.env;
const publicReleaseCode =
  edition === "public" &&
  FGE_PUBLIC_VERSION_CODE &&
  /^[1-9][0-9]{0,9}$/.test(FGE_PUBLIC_VERSION_CODE) &&
  Number(FGE_PUBLIC_VERSION_CODE) <= 2_100_000_000 &&
  FGE_PUBLIC_VERSION_NAME === `1.0-test.${FGE_PUBLIC_VERSION_CODE}`
    ? Number(FGE_PUBLIC_VERSION_CODE)
    : null;

export default defineConfig({
  plugins: [react(), contentPlugin({ edition, root: contentRoot })],
  define: {
    __FGE_EDITION__: JSON.stringify(edition),
    __FGE_PUBLIC_RELEASE_CODE__: JSON.stringify(publicReleaseCode),
  },
  build: {
    outDir: path.resolve(appRoot, "dist", edition),
    emptyOutDir: true,
  },
  server: {
    fs: {
      // Only the application and the selected content repository are readable.
      allow: [appRoot, contentRoot],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    // scripts/**/*.test.mjs belongs to Node's test runner (node:test), not
    // Vitest. run-mode.mjs runs those as a separate full-suite stage.
    exclude: [...configDefaults.exclude, "scripts/**/*.test.mjs"],
  },
});
