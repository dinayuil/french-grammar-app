// @vitest-environment node
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
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { findBash, stepRun } from "./workflow-harness";

const BASH = findBash();
const APP_SHA = "a".repeat(40);
const CONTENT_SHA = "b".repeat(40);
const OLD_TAG_SHA = "f".repeat(40);

const GH_AND_GIT_STUBS = `
state="$STATE_DIR"

record() {
  printf '%s\\n' "$1" >> "$state/actions"
}

gh() {
  cmd="$1"
  if [ "$cmd" = "release" ]; then
    sub="$2"
    shift 2
    case "$sub" in
      view)
        if [ ! -f "$state/release" ]; then
          echo "release not found" >&2
          return 1
        fi
        json=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --json) json="$2"; shift 2 ;;
            --repo) shift 2 ;;
            *) shift ;;
          esac
        done
        case "$json" in
          isDraft) cat "$state/draft" ;;
          isPrerelease) cat "$state/prerelease" ;;
          body) cat "$state/body" ;;
          assets)
            if [ -n "$HIDE_ASSET" ]; then
              grep -v -x "$HIDE_ASSET" "$state/assets" || true
            else
              cat "$state/assets"
            fi
            ;;
          *) return 9 ;;
        esac
        record "view:$json"
        ;;
      upload)
        tag_seen=""
        file=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --repo) shift 2 ;;
            --clobber) shift ;;
            -*) shift ;;
            *)
              if [ -z "$tag_seen" ]; then
                tag_seen=1
              else
                file="$1"
              fi
              shift
              ;;
          esac
        done
        base=$(basename "$file")
        if [ "$FAIL_UPLOAD" = "all" ] || [ "$FAIL_UPLOAD" = "$base" ]; then
          record "upload-failed:$base"
          return 1
        fi
        if [ ! -f "$file" ]; then
          return 1
        fi
        if ! grep -qx "$base" "$state/assets" 2>/dev/null; then
          printf '%s\\n' "$base" >> "$state/assets"
        fi
        record "upload:$base"
        ;;
      create)
        if [ -f "$state/release" ]; then
          echo "release already exists" >&2
          return 1
        fi
        if [ ! -f "$state/tag" ] && [[ " $* " == *" --verify-tag "* ]]; then
          echo "tag missing" >&2
          return 1
        fi
        draft=false
        if [[ " $* " == *" --draft "* ]]; then
          draft=true
        fi
        printf '%s' "$draft" > "$state/draft"
        printf '%s' "true" > "$state/prerelease"
        printf '%s' "Draft placeholder without version marker" > "$state/body"
        : > "$state/assets"
        touch "$state/release"
        record "create:$draft"
        ;;
      edit)
        draft=""
        notes=""
        notes_text=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --draft=false) draft=false; shift ;;
            --draft=true) draft=true; shift ;;
            --prerelease) printf '%s' "true" > "$state/prerelease"; shift ;;
            --latest=false) shift ;;
            --notes-file) notes="$2"; shift 2 ;;
            --notes) notes_text="$2"; shift 2 ;;
            --repo|--title) shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -n "$draft" ]; then
          printf '%s' "$draft" > "$state/draft"
        fi
        if [ -n "$notes" ]; then
          cp "$notes" "$state/body"
        fi
        if [ -n "$notes_text" ]; then
          printf '%s' "$notes_text" > "$state/body"
        fi
        record "edit:draft=$draft"
        ;;
      *) return 9 ;;
    esac
    return 0
  fi

  if [ "$cmd" = "api" ]; then
    method="GET"
    api_path=""
    sha=""
    force=""
    ref=""
    shift
    while [ $# -gt 0 ]; do
      case "$1" in
        -X) method="$2"; shift 2 ;;
        --jq) shift 2 ;;
        -f)
          pair="$2"
          key=$(printf '%s' "$pair" | cut -d= -f1)
          value=$(printf '%s' "$pair" | cut -d= -f2-)
          if [ "$key" = "sha" ]; then sha="$value"; fi
          if [ "$key" = "ref" ]; then ref="$value"; fi
          shift 2
          ;;
        -F)
          pair="$2"
          key=$(printf '%s' "$pair" | cut -d= -f1)
          value=$(printf '%s' "$pair" | cut -d= -f2-)
          if [ "$key" = "force" ]; then force="$value"; fi
          shift 2
          ;;
        *) api_path="$1"; shift ;;
      esac
    done
    case "$api_path" in
      */git/ref/tags/apk-latest)
        if [ ! -f "$state/tag" ]; then
          echo "gh: Not Found (HTTP 404)" >&2
          return 1
        fi
        cat "$state/tag"
        ;;
      */git/refs/tags/apk-latest)
        printf '%s' "$sha" > "$state/tag"
        printf '%s' "$force" > "$state/tag_force"
        record "tag-patch"
        ;;
      */git/refs)
        printf '%s' "$sha" > "$state/tag"
        printf '%s' "$ref" > "$state/tag_created"
        record "tag-create"
        ;;
      *) return 9 ;;
    esac
    return 0
  fi

  return 9
}

git() {
  if [ "$1" != "ls-remote" ]; then
    return 9
  fi
  case "$2" in
    *french-grammar-app.git) printf '%s refs/heads/main\\n' "$APP_MAIN_SHA" ;;
    *french-grammar-content-public.git) printf '%s refs/heads/main\\n' "$CONTENT_MAIN_SHA" ;;
    *) return 9 ;;
  esac
}

source "$RELEASE_SCRIPT"
`;

interface Harness {
  root: string;
  state: string;
  apkSha256: string;
  run(overrides?: Record<string, string>): {
    status: number | null;
    stdout: string;
    stderr: string;
    actions: string[];
  };
  reset(): void;
  seedPublished(version: number, assets?: string[]): void;
  seedDraft(assets?: string[]): void;
  body(): string;
  draft(): string;
  prerelease(): string;
  tag(): string;
  assets(): string[];
}

const tempRoots: string[] = [];

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), "fge-release-publish-"));
  tempRoots.push(root);
  const state = path.join(root, "state");
  const releaseDir = path.join(root, "release");
  mkdirSync(state, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  const apk = path.join(releaseDir, "app-public-debug.apk");
  writeFileSync(apk, "fake apk bytes", "utf8");
  const apkSha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");

  const releaseScript = path.join(root, "release.sh");
  writeFileSync(
    releaseScript,
    stepRun("publish-public-release", "Update rolling apk-latest release"),
    "utf8",
  );
  const runner = path.join(root, "runner.sh");
  writeFileSync(
    runner,
    `#!/usr/bin/env bash\nset -e\n${GH_AND_GIT_STUBS}\n`,
    "utf8",
  );

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RELEASE_SCRIPT: releaseScript,
    STATE_DIR: state,
    GH_TOKEN: "test-token",
    GITHUB_REPOSITORY: "dinayuil/french-grammar-app",
    EXPECTED_REPOSITORY: "dinayuil/french-grammar-app",
    CONTENT_PUBLIC_REPOSITORY: "dinayuil/french-grammar-content-public",
    APP_SHA,
    CONTENT_SHA,
    VERSION_CODE: "100",
    VERSION_NAME: "1.0-test.100",
    APK_SHA256: apkSha256,
    APK_PATH: "release/app-public-debug.apk",
    RUN_ID: "12345",
    APP_MAIN_SHA: APP_SHA,
    CONTENT_MAIN_SHA: CONTENT_SHA,
    FAIL_UPLOAD: "",
    HIDE_ASSET: "",
  };

  const reset = () => {
    rmSync(state, { recursive: true, force: true });
    mkdirSync(state, { recursive: true });
  };

  const read = (name: string) => readFileSync(path.join(state, name), "utf8");

  return {
    root,
    state,
    apkSha256,
    reset,
    seedPublished(version, assets = ["app-public-debug.apk", "app-public-debug.apk.sha256"]) {
      reset();
      writeFileSync(path.join(state, "release"), "", "utf8");
      writeFileSync(path.join(state, "draft"), "false", "utf8");
      writeFileSync(path.join(state, "prerelease"), "true", "utf8");
      writeFileSync(
        path.join(state, "body"),
        `## notes\n\n- versionCode: \`${version}\`\n- versionName: \`1.0-test.${version}\`\n`,
        "utf8",
      );
      writeFileSync(path.join(state, "assets"), `${assets.join("\n")}\n`, "utf8");
      writeFileSync(path.join(state, "tag"), OLD_TAG_SHA, "utf8");
    },
    seedDraft(assets = []) {
      reset();
      writeFileSync(path.join(state, "release"), "", "utf8");
      writeFileSync(path.join(state, "draft"), "true", "utf8");
      writeFileSync(path.join(state, "prerelease"), "true", "utf8");
      writeFileSync(
        path.join(state, "body"),
        "Draft placeholder without version marker",
        "utf8",
      );
      writeFileSync(
        path.join(state, "assets"),
        assets.length ? `${assets.join("\n")}\n` : "",
        "utf8",
      );
      writeFileSync(path.join(state, "tag"), OLD_TAG_SHA, "utf8");
    },
    body: () => read("body"),
    draft: () => read("draft"),
    prerelease: () => read("prerelease"),
    tag: () => read("tag"),
    assets: () =>
      readFileSync(path.join(state, "assets"), "utf8")
        .split("\n")
        .filter(Boolean)
        .sort(),
    run(overrides = {}) {
      rmSync(path.join(state, "actions"), { force: true });
      const result = spawnSync(BASH ?? "bash", [runner], {
        cwd: root,
        env: { ...baseEnv, ...overrides },
        encoding: "utf8",
        timeout: 120_000,
      });
      const actionsPath = path.join(state, "actions");
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        actions: existsSync(actionsPath)
          ? readFileSync(actionsPath, "utf8").split("\n").filter(Boolean)
          : [],
      };
    },
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function assertOrder(actions: string[], markers: string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const index = actions.indexOf(marker);
    expect(index, `missing action ${marker} in ${actions.join(", ")}`).toBeGreaterThan(
      previous,
    );
    previous = index;
  }
}

describe("rolling apk-latest publish ordering and recovery", () => {
  it.skipIf(!BASH)(
    "keeps the published version marker until uploads, verification and tag succeed, then recovers on rerun",
    () => {
      const harness = createHarness();
      harness.seedPublished(50);

      const failed = harness.run({
        FAIL_UPLOAD: "app-public-debug.apk.sha256",
      });
      expect(failed.status).not.toBe(0);
      expect(failed.actions).toContain("upload:app-public-debug.apk");
      expect(failed.actions).toContain(
        "upload-failed:app-public-debug.apk.sha256",
      );
      expect(failed.actions).not.toContain("tag-patch");
      expect(failed.actions.some((action) => action.startsWith("edit:"))).toBe(
        false,
      );
      expect(harness.body()).toContain("versionCode: `50`");
      expect(harness.tag()).toBe(OLD_TAG_SHA);

      const retry = harness.run();
      expect(retry.status, retry.stderr).toBe(0);
      assertOrder(retry.actions, [
        "upload:app-public-debug.apk",
        "upload:app-public-debug.apk.sha256",
        "view:assets",
        "tag-patch",
        "edit:draft=",
      ]);
      expect(harness.body()).toContain("versionCode: `100`");
      expect(harness.tag()).toBe(APP_SHA);
      expect(harness.draft()).toBe("false");

      const third = harness.run();
      expect(third.status).toBe(0);
      expect(third.actions.some((action) => action.startsWith("upload"))).toBe(
        false,
      );
      expect(third.actions).not.toContain("tag-patch");
      expect(third.actions.some((action) => action.startsWith("edit:"))).toBe(
        false,
      );
    },
    180_000,
  );

  it.skipIf(!BASH)(
    "keeps a new release as a draft until assets verify, then publishes and cannot be locked by a failed draft",
    () => {
      const harness = createHarness();

      const failed = harness.run({
        FAIL_UPLOAD: "app-public-debug.apk.sha256",
      });
      expect(failed.status).not.toBe(0);
      expect(failed.actions).toContain("tag-create");
      expect(failed.actions).toContain("create:true");
      expect(failed.actions).not.toContain("edit:draft=false");
      expect(harness.draft()).toBe("true");
      expect(harness.body()).not.toContain("versionCode");
      expect(harness.assets()).toEqual(["app-public-debug.apk"]);

      const retry = harness.run();
      expect(retry.status, retry.stderr).toBe(0);
      assertOrder(retry.actions, [
        "upload:app-public-debug.apk",
        "upload:app-public-debug.apk.sha256",
        "view:assets",
        "edit:draft=false",
      ]);
      expect(harness.draft()).toBe("false");
      expect(harness.prerelease()).toBe("true");
      expect(harness.body()).toContain("versionCode: `100`");
      expect(harness.assets()).toEqual([
        "app-public-debug.apk",
        "app-public-debug.apk.sha256",
      ]);

      const third = harness.run();
      expect(third.status).toBe(0);
      expect(third.actions.some((action) => action.startsWith("upload"))).toBe(
        false,
      );
      expect(third.actions).not.toContain("tag-patch");
    },
    180_000,
  );

  it.skipIf(!BASH)(
    "recognizes an existing draft and completes it without a published-version skip",
    () => {
      const harness = createHarness();
      harness.seedDraft(["app-public-debug.apk"]);

      const result = harness.run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.actions).toContain("tag-patch");
      assertOrder(result.actions, [
        "tag-patch",
        "upload:app-public-debug.apk",
        "upload:app-public-debug.apk.sha256",
        "view:assets",
        "edit:draft=false",
      ]);
      expect(harness.draft()).toBe("false");
      expect(harness.prerelease()).toBe("true");
      expect(harness.body()).toContain("versionCode: `100`");
      expect(harness.tag()).toBe(APP_SHA);
    },
    180_000,
  );

  it.skipIf(!BASH)(
    "skips published versions that are not older and stale app/content builds",
    () => {
      const harness = createHarness();
      harness.seedPublished(100);
      const same = harness.run();
      expect(same.status).toBe(0);
      expect(same.actions).toEqual(["view:isDraft", "view:body"]);
      expect(harness.body()).toContain("versionCode: `100`");

      const newer = harness.run();
      expect(newer.status).toBe(0);
      expect(newer.actions).toEqual(["view:isDraft", "view:body"]);

      const staleApp = harness.run({ APP_MAIN_SHA: "c".repeat(40) });
      expect(staleApp.status).toBe(0);
      expect(staleApp.actions).toEqual([]);

      const staleContent = harness.run({
        CONTENT_MAIN_SHA: "c".repeat(40),
      });
      expect(staleContent.status).toBe(0);
      expect(staleContent.actions).toEqual([]);
    },
    180_000,
  );

  it.skipIf(!BASH)(
    "fails closed when the published notes version marker is inconsistent",
    () => {
      const harness = createHarness();
      harness.seedPublished(50);
      writeFileSync(
        path.join(harness.state, "body"),
        "## notes\n\n- versionCode: `50`\n- versionName: `1.0-test.49`\n",
        "utf8",
      );

      const result = harness.run();
      expect(result.status).not.toBe(0);
      expect(result.actions).toEqual(["view:isDraft", "view:body"]);
      expect(result.stdout).toMatch(/versionName does not match/);
      expect(harness.body()).toContain("versionCode: `50`");
    },
    180_000,
  );

  it.skipIf(!BASH)(
    "does not move the tag or published marker when post-upload asset verification fails",
    () => {
      const harness = createHarness();
      harness.seedPublished(50);

      const result = harness.run({
        HIDE_ASSET: "app-public-debug.apk.sha256",
      });
      expect(result.status).not.toBe(0);
      expect(result.actions).toContain("upload:app-public-debug.apk");
      expect(result.actions).toContain(
        "upload:app-public-debug.apk.sha256",
      );
      expect(result.actions).not.toContain("tag-patch");
      expect(result.actions.some((action) => action.startsWith("edit:"))).toBe(
        false,
      );
      expect(harness.body()).toContain("versionCode: `50`");
      expect(harness.tag()).toBe(OLD_TAG_SHA);
    },
    180_000,
  );

});
