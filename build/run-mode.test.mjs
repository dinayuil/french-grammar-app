// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEdition } from "../scripts/edition.mjs";
import { createPlan, discoverNodeTests } from "../scripts/run-mode.mjs";

const BUILD_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(BUILD_DIR, "..");
const RUN_MODE = path.join(APP_ROOT, "scripts", "run-mode.mjs");

function runCli(args, envPatch = {}) {
  const env = { ...process.env };
  delete env.FGE_EDITION;
  Object.assign(env, envPatch);
  return spawnSync(process.execPath, [RUN_MODE, ...args], {
    cwd: APP_ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("edition resolution", () => {
  it("defaults to public only for an unset value", () => {
    expect(resolveEdition(undefined)).toBe("public");
    expect(resolveEdition("public")).toBe("public");
    expect(resolveEdition("internal")).toBe("internal");
  });

  it("rejects unknown, empty and differently-cased modes", () => {
    for (const raw of ["", "Public", "INTERNAL", "private", " internal"]) {
      expect(() => resolveEdition(raw)).toThrow(/FGE_EDITION|public|internal/i);
    }
  });
});

describe("mode command plan", () => {
  it("runs vitest with forwarded arguments for test", () => {
    const plan = createPlan("test", ["build/content.test.ts", "--reporter=dot"], "public");
    expect(plan.edition).toBe("public");
    expect(plan.env.FGE_EDITION).toBe("public");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].args).toEqual([
      expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/),
      "run",
      "build/content.test.ts",
      "--reporter=dot",
    ]);
  });

  it("runs Node script tests before Vitest only for the unfiltered full command", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fge-run-mode-test-"));
    const scripts = path.join(root, "scripts");
    mkdirSync(scripts);
    const buildApkTest = path.join(scripts, "build-apk.test.mjs");
    const checkPublicTest = path.join(scripts, "check-public.test.mjs");
    writeFileSync(buildApkTest, "");
    writeFileSync(checkPublicTest, "");
    writeFileSync(path.join(scripts, "run-mode.spec.mjs"), "");
    writeFileSync(path.join(scripts, "helper.mjs"), "");

    try {
      expect(discoverNodeTests(root)).toEqual([buildApkTest, checkPublicTest]);

      const full = createPlan("test", [], "public", { appRoot: root, env: {} });
      expect(full.steps).toHaveLength(2);
      expect(full.steps[0].args).toEqual([
        "--test",
        buildApkTest,
        checkPublicTest,
      ]);
      expect(full.steps[1].args).toEqual([
        expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/),
        "run",
      ]);

      const focused = createPlan("test", ["build/content.test.ts"], "public", {
        appRoot: root,
        env: {},
      });
      expect(focused.steps).toHaveLength(1);
      expect(focused.steps[0].args.slice(0, 2)).toEqual([
        expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/),
        "run",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs app tsc, then tools tsc, before vite build and forwards build arguments", () => {
    const plan = createPlan("build", ["--mode", "production"], "internal");
    expect(plan.edition).toBe("internal");
    expect(plan.env.FGE_EDITION).toBe("internal");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].args).toEqual([
      expect.stringMatching(/node_modules[\\/]typescript[\\/]bin[\\/]tsc$/),
    ]);
    expect(plan.steps[1].args).toEqual([
      expect.stringMatching(/node_modules[\\/]typescript[\\/]bin[\\/]tsc$/),
      "-p",
      "tsconfig.tools.json",
    ]);
    expect(plan.steps[2].args).toEqual([
      expect.stringMatching(/node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/),
      "build",
      "--mode",
      "production",
    ]);
  });

  it("maps dev and preview to vite", () => {
    const dev = createPlan("dev", ["--open"], "public");
    expect(dev.steps[0].args).toEqual([
      expect.stringMatching(/node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/),
      "--open",
    ]);
    const preview = createPlan("preview", ["--port", "4173"], "public");
    expect(preview.steps[0].args).toEqual([
      expect.stringMatching(/node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/),
      "preview",
      "--port",
      "4173",
    ]);
  });

  it("rejects unknown commands and editions", () => {
    expect(() => createPlan("serve", [], "public")).toThrow(/未知|command|命令/i);
    expect(() => createPlan("dev", [], "publicx")).toThrow(/FGE_EDITION|public|internal/i);
  });
});

describe("run-mode CLI", () => {
  it("rejects an unknown command", () => {
    const result = runCli(["serve", "public"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/未知|command|命令/i);
  });

  it("rejects an unknown explicit edition", () => {
    const result = runCli(["dev", "publicx"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/FGE_EDITION|public|internal/i);
  });

  it("rejects an illegal inherited FGE_EDITION before selecting explicit public", () => {
    const result = runCli(["dev", "public"], { FGE_EDITION: "garbage" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/FGE_EDITION|非法/i);
  });

  it("forwards arguments to vitest and accepts explicit public alongside a valid inherited value", () => {
    const result = runCli(["test", "public", "--help"], { FGE_EDITION: "internal" });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/vitest/i);
  });
});
