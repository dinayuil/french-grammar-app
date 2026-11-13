// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { findBash, runBash, stepRun } from "./workflow-harness";

const BASH = findBash();
const tempRoots: string[] = [];

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    timeout: 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function mustGit(cwd: string, args: string[]): string {
  const result = git(cwd, args);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(result.status)}):\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function write(cwd: string, name: string, text: string): void {
  writeFileSync(path.join(cwd, name), text, "utf8");
}

function createHistory(): {
  root: string;
  originUrl: string;
  mainAncestor: string;
  mainHead: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "fge-content-trust-"));
  tempRoots.push(root);

  const origin = path.join(root, "origin.git");
  mustGit(root, ["init", "--bare", "origin.git"]);
  mustGit(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const work = path.join(root, "work");
  mustGit(root, ["init", "work"]);
  mustGit(work, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  mustGit(work, ["config", "user.name", "FGE Test"]);
  mustGit(work, ["config", "user.email", "fge-test@example.invalid"]);
  mustGit(work, ["remote", "add", "origin", origin]);

  write(work, "content.txt", "main ancestor\n");
  mustGit(work, ["add", "content.txt"]);
  mustGit(work, ["commit", "-m", "main ancestor"]);
  const mainAncestor = mustGit(work, ["rev-parse", "HEAD"]);
  mustGit(work, ["push", "-u", "origin", "main"]);

  mustGit(work, ["checkout", "-b", "feature"]);
  write(work, "content.txt", "unmerged feature\n");
  mustGit(work, ["commit", "-am", "unmerged feature"]);
  mustGit(work, ["push", "-u", "origin", "feature"]);

  mustGit(work, ["checkout", "main"]);
  write(work, "content.txt", "main head\n");
  mustGit(work, ["commit", "-am", "main head"]);
  const mainHead = mustGit(work, ["rev-parse", "HEAD"]);
  mustGit(work, ["push", "origin", "main"]);

  return {
    root,
    originUrl: pathToFileURL(origin).href,
    mainAncestor,
    mainHead,
  };
}

function clone(root: string, originUrl: string, args: string[]): void {
  mustGit(root, ["clone", ...args, originUrl, "content-public"]);
}

function gateScript(root: string): string {
  const script = stepRun("build-public-apk", "Verify content commit is on main");
  const scriptPath = path.join(root, "verify-content-main.sh");
  writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("content-public main-history gate", () => {
  it.skipIf(!BASH)(
    "rejects unmerged content and accepts a shallow main ancestor",
    () => {
      const { root, originUrl, mainAncestor } = createHistory();
      const scriptPath = gateScript(root);

      clone(root, originUrl, ["--depth", "1", "--branch", "feature"]);
      const rejected = runBash(scriptPath, { cwd: root });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toMatch(/not reachable from origin\/main/);

      rmSync(path.join(root, "content-public"), { recursive: true, force: true });
      clone(root, originUrl, ["--depth", "1", "--branch", "main"]);
      mustGit(path.join(root, "content-public"), [
        "fetch",
        "--depth",
        "1",
        "origin",
        mainAncestor,
      ]);
      mustGit(path.join(root, "content-public"), [
        "checkout",
        "--detach",
        mainAncestor,
      ]);
      expect(
        mustGit(path.join(root, "content-public"), [
          "rev-parse",
          "--is-shallow-repository",
        ]),
      ).toBe("true");

      const accepted = runBash(scriptPath, { cwd: root });
      expect(accepted.status, accepted.stderr).toBe(0);
      expect(accepted.stdout).toMatch(/is on main history/);
    },
    120_000,
  );

  it.skipIf(!BASH)("rejects a missing content checkout", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fge-content-trust-"));
    tempRoots.push(root);
    const scriptPath = gateScript(root);
    const result = runBash(scriptPath, { cwd: root });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not reachable from origin\/main|missing/i);
  });
});
