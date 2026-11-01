#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveEdition } from "./edition.mjs";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMMANDS = new Set(["dev", "test", "build", "preview"]);

function toolPath(appRoot, ...segments) {
  return path.join(appRoot, "node_modules", ...segments);
}

/**
 * Node's own `node:test` files in scripts/ are a separate runner from Vitest.
 * Discover only actual `*.test.mjs` files so a missing or renamed Node suite
 * never falls through to Vitest's default include patterns.
 */
export function discoverNodeTests(appRoot = APP_ROOT) {
  const scriptsDir = path.join(appRoot, "scripts");
  return readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join(scriptsDir, entry.name))
    .sort();
}

/**
 * Build the executable steps for one mode. Exported so focused tests can pin
 * tool selection and argument forwarding without starting a server.
 */
export function createPlan(command, extraArgs = [], rawEdition, options = {}) {
  if (!COMMANDS.has(command)) {
    throw new Error(`未知命令: ${JSON.stringify(command)}；只能是 dev/test/build/preview`);
  }
  const edition = resolveEdition(rawEdition);
  const appRoot = options.appRoot ?? APP_ROOT;
  const nodePath = options.nodePath ?? process.execPath;
  const env = { ...(options.env ?? process.env), FGE_EDITION: edition };

  if (command === "build") {
    return {
      appRoot,
      command,
      edition,
      env,
      steps: [
        {
          bin: nodePath,
          args: [toolPath(appRoot, "typescript", "bin", "tsc")],
        },
        {
          bin: nodePath,
          args: [
            toolPath(appRoot, "typescript", "bin", "tsc"),
            "-p",
            "tsconfig.tools.json",
          ],
        },
        {
          bin: nodePath,
          args: [
            toolPath(appRoot, "vite", "bin", "vite.js"),
            "build",
            ...extraArgs,
          ],
        },
      ],
    };
  }

  if (command === "test") {
    const steps = [];
    // Run Node's test files only for the unfiltered full suite. Focused Vitest
    // arguments must not trigger the slower script/guard Node suites.
    if (extraArgs.length === 0) {
      const nodeTests = discoverNodeTests(appRoot);
      if (nodeTests.length === 0) {
        throw new Error(
          `未发现 Node 测试文件 (*.test.mjs) 于 ${path.join(appRoot, "scripts")}`
        );
      }
      steps.push({
        bin: nodePath,
        args: ["--test", ...nodeTests],
      });
    }
    steps.push({
      bin: nodePath,
      args: [
        toolPath(appRoot, "vitest", "vitest.mjs"),
        "run",
        ...extraArgs,
      ],
    });
    return {
      appRoot,
      command,
      edition,
      env,
      steps,
    };
  }

  if (command === "preview") {
    return {
      appRoot,
      command,
      edition,
      env,
      steps: [
        {
          bin: nodePath,
          args: [
            toolPath(appRoot, "vite", "bin", "vite.js"),
            "preview",
            ...extraArgs,
          ],
        },
      ],
    };
  }

  return {
    appRoot,
    command,
    edition,
    env,
    steps: [
      {
        bin: nodePath,
        args: [toolPath(appRoot, "vite", "bin", "vite.js"), ...extraArgs],
      },
    ],
  };
}

export function main(argv = process.argv.slice(2), options = {}) {
  // Explicit npm defaults must not mask a corrupt inherited mode. Validate it
  // before using the explicit command-line edition.
  if (process.env.FGE_EDITION !== undefined) {
    try {
      resolveEdition(process.env.FGE_EDITION);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const [command, rawEdition, ...extraArgs] = argv;
  if (!command || rawEdition === undefined) {
    console.error(
      "用法: node scripts/run-mode.mjs <dev|test|build|preview> <public|internal> [...args]"
    );
    return 1;
  }

  let plan;
  try {
    plan = createPlan(command, extraArgs, rawEdition, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log(`[fge] ${plan.command} edition=${plan.edition}`);
  for (const step of plan.steps) {
    const result = spawnSync(step.bin, step.args, {
      cwd: plan.appRoot,
      env: plan.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) {
      console.error(`[fge] 无法执行: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = main();
}
