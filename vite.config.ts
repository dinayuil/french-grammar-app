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

export default defineConfig({
  plugins: [react(), contentPlugin({ edition, root: contentRoot })],
  define: {
    __FGE_EDITION__: JSON.stringify(edition),
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
    // scripts/**/*.test.mjs belongs to Node's test runner (node:test), not
    // Vitest. run-mode.mjs runs those as a separate full-suite stage.
    exclude: [...configDefaults.exclude, "scripts/**/*.test.mjs"],
  },
});
