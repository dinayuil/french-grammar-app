// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKFLOW = readFileSync(
  path.join(APP_ROOT, ".github", "workflows", "build-public-apk.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const CI_WORKFLOW = readFileSync(
  path.join(APP_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const WORKFLOW_DIR = path.join(APP_ROOT, ".github", "workflows");
const TEST_WORKFLOWS = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => ({
    name,
    text: readFileSync(path.join(WORKFLOW_DIR, name), "utf8").replace(
      /\r\n/g,
      "\n",
    ),
  }))
  .filter(({ text }) => /\bnpm test\b/.test(text));

function jobBlock(name: string): string {
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

function stepBlock(job: string, name: string): string {
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

function expectCompletePublicSigning(block: string): void {
  for (const secret of [
    "secrets.FGE_PUBLIC_KEYSTORE_BASE64",
    "secrets.FGE_PUBLIC_KEYSTORE_PASSWORD",
    "secrets.FGE_PUBLIC_KEY_ALIAS",
    "secrets.FGE_PUBLIC_KEY_PASSWORD",
  ]) {
    expect(block).toContain(secret);
  }
}

describe("public APK release workflow", () => {
  const build = jobBlock("build-public-apk");
  const release = jobBlock("publish-public-release");

  it("publishes only successful automatic main and content-updated builds", () => {
    expect(WORKFLOW).toMatch(
      /repository_dispatch:\s*\n\s*types:\s*\[content-updated\]/,
    );
    expect(WORKFLOW).toMatch(/push:\s*\n\s*branches:\s*\n\s*- "main"/);
    expect(WORKFLOW).toMatch(/tags:\s*\n\s*- "v\*"/);
    expect(WORKFLOW).toMatch(/workflow_dispatch:/);

    expect(release).toMatch(/needs: build-public-apk/);
    expect(release).toMatch(
      /github\.repository == 'dinayuil\/french-grammar-app'/,
    );
    expect(release).toMatch(
      /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    );
    expect(release).toMatch(
      /github\.event_name == 'repository_dispatch' && github\.event\.action == 'content-updated'/,
    );
    expect(release).not.toMatch(/github\.event_name == 'workflow_dispatch'/);
    expect(release).not.toMatch(/refs\/tags\/v\*/);
  });

  it("keeps build read-only and grants write only to the release job", () => {
    expect(WORKFLOW).toMatch(/^permissions:\n  contents: read$/m);
    expect(build).toMatch(/permissions:\n      contents: read/);
    expect(build).not.toMatch(/contents: write/);
    expect(release).toMatch(/permissions:\n      contents: write/);
    expect(release).not.toMatch(/contents: read/);
  });

  it("downloads the exact artifact from this run without checkout or repo code", () => {
    expect(release).toMatch(
      /uses: actions\/download-artifact@[0-9a-f]{40} # v8\.0\.2/,
    );
    expect(release).toMatch(/name: app-public-debug/);
    expect(release).toMatch(/path: release/);
    expect(release).not.toMatch(
      /run-id:|github-token:|pattern:|merge-multiple:|artifact-ids:/,
    );
    expect(release).not.toMatch(/actions\/checkout/);
    expect(release).not.toMatch(/working-directory:/);
    expect(release).not.toMatch(/\bnpm (?:ci|test|run)\b/);
    expect(release).not.toMatch(/\bnode\s+[^\n]*\.(?:mjs|js)\b/);
    expect(release).not.toMatch(/\.\/scripts\//);
  });

  it("uploads only the exact APK and checksum from the build artifact", () => {
    const upload = stepBlock(build, "Upload public debug APK");
    expect(upload).toMatch(/name: app-public-debug/);
    expect(upload).toMatch(
      /path: app\/android\/app\/build\/outputs\/apk\/public\/debug\/app-public-debug\.apk/,
    );
    expect(upload).not.toMatch(/\*/);
    expect(release).toMatch(/gh release upload apk-latest "\$APK_PATH"/);
    expect(release).toMatch(/app-public-debug\.apk\.sha256/);
    expect(release).not.toMatch(/release\/\*/);
    expect(release).not.toMatch(/gh release upload[^\n]*release\s/);
  });

  it("pins every action to a full commit SHA", () => {
    const uses = [
      ...WORKFLOW.matchAll(/^\s*uses:\s*(\S+)\s*(?:#\s*(\S+))?$/gm),
    ];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, action, version] of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
      expect(version).toBeTruthy();
    }
  });

  it("keeps signing secrets out of dependency install and release steps", () => {
    const install = stepBlock(build, "Install dependencies");
    expect(install).not.toMatch(/secrets\./);
    expect(install).not.toMatch(/FGE_PUBLIC_KEY/);

    const restore = stepBlock(build, "Restore public signing material");
    expectCompletePublicSigning(restore);
    expect(restore).toMatch(/RUNNER_TEMP\/fge-public\.keystore/);
    expect(restore).toMatch(/base64/);

    const buildStep = stepBlock(build, "Build public debug APK");
    expect(buildStep).toContain(
      'FGE_PUBLIC_KEYSTORE_PATH: ${{ steps.signing.outputs.keystore_path }}',
    );
    expect(buildStep).toContain(
      'FGE_PUBLIC_KEYSTORE_PASSWORD: ${{ secrets.FGE_PUBLIC_KEYSTORE_PASSWORD }}',
    );
    expect(buildStep).toContain(
      'FGE_PUBLIC_KEY_ALIAS: ${{ secrets.FGE_PUBLIC_KEY_ALIAS }}',
    );
    expect(buildStep).toContain(
      'FGE_PUBLIC_KEY_PASSWORD: ${{ secrets.FGE_PUBLIC_KEY_PASSWORD }}',
    );
    expect(buildStep).toContain('FGE_REQUIRE_PUBLIC_SIGNING: "1"');
    expect(buildStep).toContain(
      "FGE_PUBLIC_VERSION_CODE: ${{ github.run_number }}",
    );
    expect(buildStep).toContain(
      "FGE_PUBLIC_VERSION_NAME: 1.0-test.${{ github.run_number }}",
    );

    const verify = stepBlock(build, "Verify public APK identity");
    expect(verify).toContain("secrets.FGE_PUBLIC_CERT_SHA256");

    const cleanup = stepBlock(build, "Remove public signing material");
    expect(cleanup).toMatch(/if: always\(\)/);
    expect(cleanup).toContain("$RUNNER_TEMP/fge-public.keystore");

    expect(release).not.toMatch(/secrets\./);
    expect(WORKFLOW).not.toMatch(
      /(?:echo|printf)[^\n]*\$\{\{\s*secrets\./,
    );
  });

  it("verifies package, version and certificate before publishing", () => {
    const verify = stepBlock(build, "Verify public APK identity");
    expect(verify).toContain("EXPECTED_PACKAGE: com.fge.open");
    expect(verify).toContain(
      "EXPECTED_VERSION_CODE: ${{ github.run_number }}",
    );
    expect(verify).toContain(
      "EXPECTED_VERSION_NAME: 1.0-test.${{ github.run_number }}",
    );
    expect(verify).toContain("secrets.FGE_PUBLIC_CERT_SHA256");
    expect(verify).toMatch(/dump badging/);
    expect(verify).toMatch(/verify --print-certs/);
    expect(verify).toMatch(/certificate SHA-256 digest/);
  });

  it("skips stale builds and already-published versions before moving the rolling tag", () => {
    expect(release).toContain("APP_SHA");
    expect(release).toContain("CONTENT_SHA");
    expect(release).toMatch(
      /git ls-remote[^\n]*refs\/heads\/main/,
    );
    expect(release).toMatch(/APP_MAIN_SHA/);
    expect(release).toMatch(/CONTENT_MAIN_SHA/);
    expect(release).toMatch(/"\$APP_SHA" != "\$APP_MAIN_SHA"/);
    expect(release).toMatch(/"\$CONTENT_SHA" != "\$CONTENT_MAIN_SHA"/);
    expect(release).toMatch(/PUBLISHED_VERSION/);
    expect(release).toMatch(/PUBLISHED_VERSION >= VERSION_CODE/);
    expect(release).toContain("apk-latest");
    expect(release).toMatch(/git\/refs\/tags\/apk-latest/);
    expect(release).toContain("force=true");
    expect(release).not.toMatch(/--target/);
    expect(release).not.toMatch(/refs\/tags\/v\*/);
    expect(release).toContain("--prerelease");
    expect(release).toContain("--verify-tag");
    expect(release).toContain("gh release edit");
  });

  it("writes the fixed traceable release notes template", () => {
    for (const token of [
      "APP_SHA",
      "CONTENT_SHA",
      "VERSION_CODE",
      "VERSION_NAME",
      "APK_SHA256",
      "RUN_URL",
    ]) {
      expect(release).toContain(token);
    }
    expect(release).toMatch(/应用提交/);
    expect(release).toMatch(/题库提交/);
    expect(release).toMatch(/SHA-256/);
    expect(release).toMatch(/versionCode/);
    expect(release).toMatch(/versionName/);
    expect(release).toMatch(/固定测试签名/);
    expect(release).toMatch(/不是应用商店正式版本/);
  });

  it("keeps internal build inputs out of the public workflow", () => {
    expect(build).not.toMatch(/assembleInternal|apk:internal|FGE_INTERNAL/);
    expect(WORKFLOW).not.toMatch(/content-private|content-internal/);
  });

  it("gates content-public checkout on main history before dependencies and signing", () => {
    const gate = stepBlock(build, "Verify content commit is on main");
    expect(gate).toMatch(
      /fetch --unshallow --no-tags origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/,
    );
    expect(gate).toMatch(/merge-base --is-ancestor/);
    expect(gate).toContain("refs/remotes/origin/main");
    expect(gate).toMatch(/not reachable from origin\/main/);

    const gateIndex = build.indexOf(
      "      - name: Verify content commit is on main",
    );
    for (const later of [
      "      - name: Install dependencies",
      "      - name: Restore public signing material",
    ]) {
      expect(gateIndex).toBeGreaterThan(-1);
      expect(build.indexOf(later)).toBeGreaterThan(gateIndex);
    }
  });

  it("provisions Java and Gradle Groovy before npm test in every workflow that runs it", () => {
    expect(TEST_WORKFLOWS.map(({ name }) => name).sort()).toEqual([
      "build-public-apk.yml",
      "ci.yml",
      "deploy-pages.yml",
    ]);

    for (const { name, text } of TEST_WORKFLOWS) {
      expect(text, name).toMatch(
        /uses: actions\/setup-java@b843ebf9b913146b38da2eaa7aeddf76074ae1ad # v6\.1\.0/,
      );
      expect(text, name).toMatch(/java-version: "21"/);
      expect(text, name).toMatch(
        /working-directory: app\/android\n\s+run: bash \.\/gradlew --version/,
      );

      const prepIndex = text.indexOf("      - name: Prepare Gradle wrapper");
      const testIndex = text.indexOf("      - name: Run public test suite");
      expect(prepIndex, name).toBeGreaterThan(-1);
      expect(testIndex, name).toBeGreaterThan(prepIndex);
    }
  });

  it("creates new releases as drafts and publishes only after asset verification", () => {
    expect(release).toContain("--json isDraft");
    expect(release).toMatch(/--draft\b/);
    expect(release).toContain("--draft=false");
    expect(release).toMatch(
      /gh release upload apk-latest "\$APK_PATH"[\s\S]*?gh release upload apk-latest "\$CHECKSUM_PATH"/,
    );
    expect(release).toMatch(
      /gh release upload apk-latest "\$CHECKSUM_PATH"[\s\S]*?ASSET_NAMES/,
    );
    expect(release).toMatch(
      /ASSET_NAMES[\s\S]*?gh release edit apk-latest/,
    );
    expect(release.indexOf("gh release upload")).toBeLessThan(
      release.lastIndexOf("gh release edit"),
    );
  });
});
