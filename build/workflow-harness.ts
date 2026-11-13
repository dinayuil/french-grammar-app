import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function workflowText(): string {
  return readFileSync(
    path.join(APP_ROOT, ".github", "workflows", "build-public-apk.yml"),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

export function jobBlock(name: string, workflow = workflowText()): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`workflow job is missing: ${name}`);
  const lines = workflow.slice(start + marker.length).split("\n");
  const block = [`  ${name}:`];
  for (const line of lines) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

/** Return a step's `run: |` block with YAML indentation removed. */
export function stepRun(
  jobName: string,
  stepName: string,
  workflow = workflowText(),
): string {
  const lines = jobBlock(jobName, workflow).split("\n");
  const start = lines.findIndex((line) => line === `      - name: ${stepName}`);
  if (start === -1) {
    throw new Error(`workflow step is missing: ${jobName}/${stepName}`);
  }
  let runLine = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      - name: /.test(lines[index])) break;
    if (/^        run:\s*\|/.test(lines[index])) {
      runLine = index;
      break;
    }
  }
  if (runLine === -1) {
    throw new Error(`workflow step has no block run script: ${jobName}/${stepName}`);
  }

  const content: string[] = [];
  for (let index = runLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      content.push("");
      continue;
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent < 10) break;
    content.push(line.slice(10));
  }
  return content.join("\n").replace(/\n+$/, "\n");
}

export function findBash(): string | undefined {
  const candidates = [
    process.env.BASH,
    ...(process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        ]
      : ["/bin/bash", "/usr/bin/bash"]),
    "bash",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (candidate !== "bash" && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

export interface BashRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runBash(
  scriptPath: string,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    args?: string[];
    timeout?: number;
  } = {},
): BashRun {
  const bash = findBash();
  if (!bash) throw new Error("bash is unavailable");
  const result = spawnSync(bash, [scriptPath, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
