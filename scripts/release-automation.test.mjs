// Focused automation checks for the unified public APK + Windows release.
// Executes the publisher Windows artifact verifier (bash) and the Windows
// installer metadata verifier (PowerShell when available), plus structural pins.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(
  path.join(APP_ROOT, ".github", "workflows", "build-public-apk.yml"),
  "utf8"
).replace(/\r\n/g, "\n");

function jobBlock(name) {
  const marker = `\n  ${name}:\n`;
  const start = WORKFLOW.indexOf(marker);
  if (start === -1) throw new Error(`workflow job is missing: ${name}`);
  const lines = WORKFLOW.slice(start + marker.length).split("\n");
  const block = [`  ${name}:`];
  for (const line of lines) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function stepRun(job, name) {
  const lines = job.split("\n");
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  if (start === -1) throw new Error(`workflow step is missing: ${name}`);
  let runLine = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      - name: /.test(lines[index])) break;
    if (/^        run:\s*\|/.test(lines[index])) {
      runLine = index;
      break;
    }
  }
  if (runLine === -1) throw new Error(`workflow step has no block run: ${name}`);
  const content = [];
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
  return content.join("\n");
}

function stepBlock(job, name) {
  const lines = job.split("\n");
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  if (start === -1) throw new Error(`workflow step is missing: ${name}`);
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      - name: /.test(lines[index])) break;
    block.push(lines[index]);
  }
  return block.join("\n");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function findBash() {
  const candidates = [
    process.env.BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "bash",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== "bash" && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

function findPowerShell() {
  for (const candidate of ["pwsh", "powershell.exe"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  }).trim();
}

const STANDARD = "fge-windows-public-standard-setup.exe";
const OFFLINE = "fge-windows-public-offline-setup.exe";

test("workflow has four jobs and only the publisher can write", () => {
  for (const job of [
    "resolve-public-inputs",
    "build-public-apk",
    "build-public-windows",
    "publish-public-release",
  ]) {
    assert.ok(jobBlock(job).includes(`  ${job}:`), job);
  }
  assert.match(WORKFLOW, /^permissions:\n  contents: read$/m);
  for (const job of [
    "resolve-public-inputs",
    "build-public-apk",
    "build-public-windows",
  ]) {
    const block = jobBlock(job);
    assert.match(block, /contents: read/);
    assert.doesNotMatch(block, /contents: write/);
  }
  const publisher = jobBlock("publish-public-release");
  assert.match(publisher, /contents: write/);
  assert.doesNotMatch(publisher, /actions\/checkout|working-directory:|\bnpm (?:ci|test|run)\b|\bcargo\b|\.\/scripts\//);
});

test("resolver pins both SHAs and both builds consume exact refs", () => {
  const resolver = jobBlock("resolve-public-inputs");
  assert.match(resolver, /merge-base --is-ancestor/);
  assert.match(resolver, /app_sha=\$APP_SHA/);
  assert.match(resolver, /content_sha=\$CONTENT_SHA/);
  for (const job of ["build-public-apk", "build-public-windows"]) {
    const block = jobBlock(job);
    assert.match(block, /ref: \$\{\{ needs\.resolve-public-inputs\.outputs\.app_sha \}\}/);
    assert.match(block, /ref: \$\{\{ needs\.resolve-public-inputs\.outputs\.content_sha \}\}/);
  }
  const publisher = jobBlock("publish-public-release");
  assert.match(publisher, /APK_APP_SHA/);
  assert.match(publisher, /WINDOWS_APP_SHA/);
  assert.match(publisher, /RESOLVED_APP_SHA/);
  assert.match(publisher, /APK_CONTENT_SHA/);
  assert.match(publisher, /WINDOWS_CONTENT_SHA/);
  assert.match(publisher, /RESOLVED_CONTENT_SHA/);
});

test("Windows build is unsigned/read-only and uploads exactly two exes", () => {
  const windows = jobBlock("build-public-windows");
  assert.match(windows, /runs-on: windows-latest/);
  assert.match(windows, /timeout-minutes: 90/);
  assert.doesNotMatch(windows, /secrets\.FGE_/);
  assert.match(windows, /cargo test --manifest-path src-tauri\/Cargo\.toml --lib --locked/);
  assert.match(windows, /run: npm run windows/);
  assert.match(windows, /actions\/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4\.2\.3/);
  const upload = stepBlock(windows, "Upload public Windows installers");
  assert.match(upload, /name: public-windows-installers/);
  assert.doesNotMatch(upload, /\*/);
  assert.equal((upload.match(/fge-windows-public-(?:standard|offline)-setup\.exe/g) ?? []).length, 2);
});

test("publisher verifier accepts exact Windows files and rejects partial/tampered input", (t) => {
  const bash = findBash();
  if (!bash) {
    t.skip("bash unavailable");
    return;
  }
  const root = mkdtempSync(path.join(tmpdir(), "fge-windows-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const windowsDir = path.join(root, "release", "windows");
  mkdirSync(windowsDir, { recursive: true });
  const standard = Buffer.from("standard installer");
  const offline = Buffer.from("offline installer");
  writeFileSync(path.join(windowsDir, STANDARD), standard);
  writeFileSync(path.join(windowsDir, OFFLINE), offline);
  const standardSha = sha256(standard);
  const offlineSha = sha256(offline);
  const script = path.join(root, "verify.sh");
  writeFileSync(script, stepRun(jobBlock("publish-public-release"), "Verify downloaded Windows installers"));
  const output = path.join(root, "github-output");
  const baseEnv = {
    ...process.env,
    RESOLVED_APP_SHA: "a".repeat(40),
    RESOLVED_CONTENT_SHA: "b".repeat(40),
    APK_APP_SHA: "a".repeat(40),
    APK_CONTENT_SHA: "b".repeat(40),
    WINDOWS_APP_SHA: "a".repeat(40),
    WINDOWS_CONTENT_SHA: "b".repeat(40),
    EXPECTED_STANDARD_SHA256: standardSha,
    EXPECTED_OFFLINE_SHA256: offlineSha,
    GITHUB_OUTPUT: output,
  };
  const run = (overrides = {}) => {
    writeFileSync(output, "");
    const result = spawnSync(bash, [script], {
      cwd: root,
      env: { ...baseEnv, ...overrides },
      encoding: "utf8",
    });
    return { ...result, output: readFileSync(output, "utf8") };
  };

  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.output, new RegExp(`standard_sha256=${standardSha}`));
  assert.match(ok.output, new RegExp(`offline_sha256=${offlineSha}`));
  assert.match(ok.output, /standard_path=release\/windows\/fge-windows-public-standard-setup\.exe/);

  rmSync(path.join(windowsDir, OFFLINE));
  assert.notEqual(run().status, 0, "missing offline installer must fail");
  writeFileSync(path.join(windowsDir, OFFLINE), offline);
  writeFileSync(path.join(windowsDir, "extra.txt"), "extra");
  assert.notEqual(run().status, 0, "extra file must fail");
  rmSync(path.join(windowsDir, "extra.txt"));
  assert.notEqual(run({ EXPECTED_STANDARD_SHA256: "0".repeat(64) }).status, 0, "hash mismatch must fail");
  assert.notEqual(run({ WINDOWS_APP_SHA: "c".repeat(40) }).status, 0, "mismatched app SHA must fail");
  assert.notEqual(run({ WINDOWS_CONTENT_SHA: "c".repeat(40) }).status, 0, "mismatched content SHA must fail");
});

test("Windows metadata verifier accepts matching marker/manifest and rejects tamper", (t) => {
  const powershell = findPowerShell();
  if (!powershell) {
    t.skip("PowerShell unavailable");
    return;
  }
  const root = mkdtempSync(path.join(tmpdir(), "fge-windows-meta-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const content = path.join(root, "content-public");
  const packageDir = path.join(app, ".fge-build", "windows", "public", "packages");
  mkdirSync(path.join(app, "src-tauri"), { recursive: true });
  mkdirSync(path.join(app, ".fge-build", "windows", "public", "web"), { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(content, { recursive: true });
  writeFileSync(
    path.join(app, "src-tauri", "tauri.public.conf.json"),
    JSON.stringify({ identifier: "com.fge.open", build: { frontendDist: "../.fge-build/windows/public/web" } })
  );
  writeFileSync(path.join(app, ".fge-build", "windows", "public", "web", "index.html"), "<div id=root></div>");
  writeFileSync(
    path.join(app, ".fge-build", "windows", "public", "build.json"),
    JSON.stringify({
      format: "fge-windows",
      version: 1,
      edition: "public",
      identifier: "com.fge.open",
      productName: "fixture",
      webDir: ".fge-build/windows/public/web",
    })
  );
  const standard = Buffer.from("standard");
  const offline = Buffer.from("offline");
  writeFileSync(path.join(packageDir, STANDARD), standard);
  writeFileSync(path.join(packageDir, OFFLINE), offline);
  const manifest = (standardSha, offlineSha) => ({
    format: "fge-windows-packages",
    version: 1,
    edition: "public",
    identifier: "com.fge.open",
    webviewInstallModes: { standard: "downloadBootstrapper", offline: "offlineInstaller" },
    packages: [
      { variant: "standard", path: `.fge-build/windows/public/packages/${STANDARD}`, size: standard.length, sha256: standardSha },
      { variant: "offline", path: `.fge-build/windows/public/packages/${OFFLINE}`, size: offline.length, sha256: offlineSha },
    ],
  });
  writeFileSync(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(manifest(sha256(standard), sha256(offline)))
  );
  writeFileSync(path.join(content, "README.md"), "fixture");
  for (const repo of [app, content]) {
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-qm", "fixture"]);
  }
  const script = path.join(root, "metadata.ps1");
  writeFileSync(script, stepRun(jobBlock("build-public-windows"), "Verify Windows installer metadata"));
  const output = path.join(root, "github-output");
  const run = (overrides = {}) => {
    writeFileSync(output, "");
    const result = spawnSync(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", `& '${script.replaceAll("'", "''")}'`],
      {
        cwd: root,
        env: {
          ...process.env,
          EXPECTED_APP_SHA: runGit(app, ["rev-parse", "HEAD"]),
          EXPECTED_CONTENT_SHA: runGit(content, ["rev-parse", "HEAD"]),
          GITHUB_OUTPUT: output,
          ...overrides,
        },
        encoding: "utf8",
      }
    );
    return { ...result, output: readFileSync(output, "utf8") };
  };

  const ok = run();
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.output, /standard_sha256=[0-9a-f]{64}/);
  assert.match(ok.output, /offline_sha256=[0-9a-f]{64}/);

  // Tamper with one installer, commit, and keep the old manifest hashes: the
  // verifier must fail on the hash rather than the dirty-worktree check.
  writeFileSync(path.join(packageDir, OFFLINE), Buffer.from("offline-tampered"));
  runGit(app, ["add", "."]);
  runGit(app, ["commit", "-qm", "tamper"]);
  const tampered = run();
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /SHA-256|size/i);

  writeFileSync(path.join(packageDir, OFFLINE), offline);
  writeFileSync(
    path.join(app, ".fge-build", "windows", "public", "build.json"),
    JSON.stringify({
      format: "fge-windows",
      version: 1,
      edition: "internal",
      identifier: "com.fge.open",
      productName: "fixture",
      webDir: ".fge-build/windows/public/web",
    })
  );
  runGit(app, ["add", "."]);
  runGit(app, ["commit", "-qm", "tamper-marker"]);
  const markerBad = run();
  assert.notEqual(markerBad.status, 0);
  assert.match(`${markerBad.stdout}\n${markerBad.stderr}`, /marker|edition/i);
});
