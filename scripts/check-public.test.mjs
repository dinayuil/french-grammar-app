// Focused tests for the public-only inventory/provenance guard.
// Every case builds an isolated temporary sandbox; the live working tree is
// never used as fixture truth.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublic, RULES } from "./check-public.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, "check-public.mjs");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JAR_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
// Split so this test file itself never contains a contiguous PDF/private-key
// signature that the real-tree guard would flag.
const PDF_BYTES = Buffer.from("%PD" + "F-1.7\nsynthetic fixture\n", "utf8");
const PRIVATE_KEY_HEADER = "-----BEGIN " + "PRIVATE KEY-----";

async function writeAt(root, rel, content) {
  const file = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function chapter({
  id = "synthetic-chapter",
  source = "原创测试",
  questionIds = ["synthetic-q1"],
} = {}) {
  return {
    id,
    title: "合成章节",
    titleFr: "Chapitre synthétique",
    cards: [],
    lessons: [
      {
        id: `${id}-lesson`,
        title: "合成关卡",
        kind: "lesson",
        source,
        questions: questionIds.map((questionId) => ({
          id: questionId,
          prompt: "Choisissez la réponse correcte.",
          explain: "说明文字仅用于测试。",
          type: "choice",
          options: ["a", "b"],
          answer: 0,
        })),
      },
    ],
    challenges: [],
  };
}

async function makeApp(root) {
  const texts = {
    ".gitattributes": "* text=auto\n",
    ".gitignore": "node_modules/\ndist/\n",
    "README.md": "# Synthetic fixture app\n",
    "capacitor.config.ts": "export default { appId: 'com.fge.open' };\n",
    "index.html": '<div id="root"></div>\n',
    "package.json": JSON.stringify({ name: "fixture", private: true, scripts: {} }, null, 2),
    "package-lock.json": JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} }, null, 2),
    "start.bat": "@echo off\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    "vite.config.ts": "export default {};\n",
    "build/content.ts": "export const fixture = true;\n",
    "build/run-mode.test.mjs": "export const fixtureTest = true;\n",
    "scripts/edition.mjs": "export function resolveEdition() { return 'public'; }\n",
    "scripts/edition.d.mts": "export type Edition = 'public';\n",
    "src/App.tsx": "export function App() { return null; }\n",
    "src/main.tsx": "export {};\n",
    "src/styles.css": "body { margin: 0; }\n",
    "src/test/fixtures.ts": "export const synthetic = true;\n",
    "android/.gitignore": "/build\n",
    "android/app/.gitignore": "/build\n",
    "android/app/build.gradle": "android {}\n",
    "android/app/proguard-rules.pro": "# synthetic rules\n",
    "android/app/src/main/AndroidManifest.xml": "<manifest />\n",
    "android/app/src/main/java/com/fge/open/MainActivity.java": "package com.fge.open; class MainActivity {}\n",
    "android/app/src/main/res/drawable/ic_launcher_background.xml": "<shape />\n",
    "android/app/src/main/res/values/strings.xml": "<resources />\n",
    "android/app/src/public/res/values/strings.xml": "<resources />\n",
    "android/app/src/internal/res/values/strings.xml": "<resources />\n",
    "android/build.gradle": "// root\n",
    "android/gradle.properties": "org.gradle.jvmargs=-Xmx1g\n",
    "android/gradle/wrapper/gradle-wrapper.properties":
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\n",
    "android/gradlew": "#!/bin/sh\n",
    "android/gradlew.bat": "@echo off\n",
    "android/settings.gradle": "// settings\n",
    "android/variables.gradle": "ext {}\n",
  };
  for (const [rel, text] of Object.entries(texts)) await writeAt(root, rel, text);
  await writeAt(root, "android/gradle/wrapper/gradle-wrapper.jar", JAR_MAGIC);
  await writeAt(root, "android/app/src/main/res/mipmap-hdpi/ic_launcher.png", PNG_MAGIC);
}

async function setupPublic(root, { chapters = {}, manifestPatch = {} } = {}) {
  await writeAt(root, "README.md", "# 合成公开题库（测试夹具）\n");
  await writeAt(root, ".gitignore", "*.tmp\n");
  const paths = Object.keys(chapters);
  for (const [rel, value] of Object.entries(chapters)) {
    await writeAt(root, rel, JSON.stringify(value, null, 2));
  }
  const questionCount = paths.reduce((total, rel) => {
    const value = chapters[rel];
    return (
      total +
      [...value.lessons, ...value.challenges].reduce(
        (sum, lesson) => sum + lesson.questions.length,
        0
      )
    );
  }, 0);
  const manifest = {
    schemaVersion: 1,
    edition: "public",
    chapters: paths,
    expectedChapterCount: paths.length,
    expectedQuestionCount: questionCount,
    ...manifestPatch,
  };
  await writeAt(root, "manifest.json", JSON.stringify(manifest, null, 2));
  return manifest;
}

async function sandbox(t) {
  const root = await mkdtemp(path.join(tmpdir(), "fge-check-public-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const appRoot = path.join(root, "app");
  const publicRoot = path.join(root, "content-public");
  await mkdir(appRoot, { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await makeApp(appRoot);
  return { root, appRoot, publicRoot };
}

function errorsOf(result) {
  return result.errors.join("\n");
}

function assertFails(result, pattern, label = "") {
  assert.equal(result.ok, false, `${label} should fail but passed`);
  assert.match(errorsOf(result), pattern, `${label}: unexpected errors:\n${errorsOf(result)}`);
}

test("exported rules document the allowlists and the guard's limits", () => {
  assert.ok(Array.isArray(RULES));
  const text = RULES.join("\n");
  assert.match(text, /package\.json/);
  assert.match(text, /src\/\*\*/);
  assert.match(text, /manifest\.json/);
  assert.match(text, /skipped/i);
  assert.match(text, /not proof/i);
});

test("a legitimate empty public bank passes with normal generic templates", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);

  const result = await checkPublic({ appRoot, publicRoot });

  assert.equal(result.ok, true, errorsOf(result));
  assert.equal(result.stats.chapters, 0);
  assert.equal(result.stats.questions, 0);
  assert.ok(result.stats.appFiles > 10);
  assert.ok(result.inventory.app.includes("android/gradle/wrapper/gradle-wrapper.jar"));
  assert.ok(result.inventory.app.includes("android/app/src/main/res/mipmap-hdpi/ic_launcher.png"));
  assert.deepEqual(result.inventory.public.sort(), [".gitignore", "README.md", "manifest.json"]);
});

test("a synthetic original chapter bank passes and reports real counts", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot, {
    chapters: { "chapters/01-original.json": chapter({ questionIds: ["q1", "q2"] }) },
  });

  const result = await checkPublic({ appRoot, publicRoot });

  assert.equal(result.ok, true, errorsOf(result));
  assert.equal(result.stats.chapters, 1);
  assert.equal(result.stats.questions, 2);
  assert.deepEqual(result.inventory.public.sort(), [
    ".gitignore",
    "README.md",
    "chapters/01-original.json",
    "manifest.json",
  ]);
});

test("a missing public bank fails closed", async (t) => {
  const { appRoot, root } = await sandbox(t);
  const result = await checkPublic({ appRoot, publicRoot: path.join(root, "missing-content-public") });
  assertFails(result, /public.*(?:missing|not exist|does not exist)|不存在/i, "missing public bank");
});

test("manifest schema, edition, paths, and counts are enforced", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot, {
    chapters: { "chapters/01.json": chapter() },
    manifestPatch: { expectedQuestionCount: 9 },
  });
  assertFails(await checkPublic({ appRoot, publicRoot }), /expectedQuestionCount|question count/i, "counts");

  await setupPublic(publicRoot, { manifestPatch: { edition: "internal" } });
  assertFails(await checkPublic({ appRoot, publicRoot }), /edition|internal|public/i, "edition");

  await setupPublic(publicRoot, { manifestPatch: { schemaVersion: 2 } });
  assertFails(await checkPublic({ appRoot, publicRoot }), /schemaVersion/i, "schemaVersion");

  await setupPublic(publicRoot, { manifestPatch: { chapters: ["../outside/leak.json"] } });
  const traversal = await checkPublic({ appRoot, publicRoot });
  assertFails(traversal, /outside|traversal|escape|\.\./i, "traversal");

  await setupPublic(publicRoot, {
    manifestPatch: {
      chapters: ["manifest.json"],
      expectedChapterCount: 1,
      expectedQuestionCount: 0,
    },
  });
  assertFails(await checkPublic({ appRoot, publicRoot }), /root metadata|collides|chapter path/i, "manifest collision");
});

test("malformed manifest and declared chapter JSON fail closed", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(publicRoot, "manifest.json", '{ "schemaVersion": 1, ');

  assertFails(
    await checkPublic({ appRoot, publicRoot }),
    /manifest\.json.*invalid JSON|invalid JSON.*manifest\.json/i,
    "malformed manifest"
  );

  await setupPublic(publicRoot, {
    chapters: { "chapters/01-broken.json": chapter() },
  });
  await writeAt(publicRoot, "chapters/01-broken.json", '{ "id": ');

  assertFails(
    await checkPublic({ appRoot, publicRoot }),
    /chapters[\\/]01-broken\.json.*invalid JSON|invalid JSON.*chapters[\\/]01-broken\.json/i,
    "malformed declared chapter"
  );
});

test("PDFs and key/keystore material fail anywhere", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "src/notes.pdf", PDF_BYTES);
  await writeAt(appRoot, "src/build-output.apk", Buffer.from("synthetic fixture", "utf8"));
  await writeAt(appRoot, "android/app/release.keystore", Buffer.from([0, 1, 2, 3]));
  await writeAt(publicRoot, "keys/server.key", "synthetic-not-a-real-key\n");

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /PDF/i, "pdf");
  assert.match(errorsOf(result), /key|keystore|signing/i);
  assert.match(errorsOf(result), /APK|compiled Android/i);
});

test("a PDF renamed to an allowed image suffix is still rejected", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "android/app/src/main/res/mipmap-hdpi/ic_launcher.png", PDF_BYTES);

  assertFails(await checkPublic({ appRoot, publicRoot }), /PDF/i, "renamed pdf");
});

test("private/internal manifest JSON is rejected in app source and unused public paths", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  const privateManifest = {
    schemaVersion: 1,
    edition: "internal",
    chapters: [],
    expectedChapterCount: 0,
    expectedQuestionCount: 0,
  };
  await writeAt(appRoot, "src/copied-bank.json", JSON.stringify(privateManifest, null, 2));
  await writeAt(publicRoot, "unused-bank.json", JSON.stringify(privateManifest, null, 2));
  await writeAt(publicRoot, "unused/private-bank.json", JSON.stringify(privateManifest, null, 2));

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /internal|private/i, "private manifests");
  assert.match(errorsOf(result), /copied-bank\.json/);
  assert.match(errorsOf(result), /unused-bank\.json/);
  assert.match(errorsOf(result), /unused[\\/]private-bank\.json/);
  assert.match(errorsOf(result), /JSON.*forbidden|unreferenced|not declared|unexpected/i);
});

test("copied private content directories are rejected without being treated as data", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "content-private/manifest.json", "{}");
  await writeAt(publicRoot, "content-private/manifest.json", "{}");

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /private.*directory|directory.*private|content-private/i, "private dir");
});

test("symlink or junction traversal is rejected", async (t) => {
  const { root, appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot, {
    manifestPatch: {
      chapters: ["chapters/01.json"],
      expectedChapterCount: 1,
      expectedQuestionCount: 1,
    },
  });
  const outside = path.join(root, "outside");
  await mkdir(outside, { recursive: true });
  await writeAt(outside, "01.json", JSON.stringify(chapter()));
  await writeAt(outside, "leaked.ts", "export const leaked = true;\n");
  try {
    await symlink(outside, path.join(publicRoot, "chapters"), process.platform === "win32" ? "junction" : "dir");
    await symlink(outside, path.join(appRoot, "src", "imported-private"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error.code)) {
      t.skip(`symlink/junction creation unsupported: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /symbolic link|junction|reparse/i, "symlink");
});

test("skipped generated path names cannot be symlinks or junctions", async (t) => {
  const { root, appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  const outside = path.join(root, "outside-skipped");
  await mkdir(outside, { recursive: true });
  await writeAt(outside, "leaked.ts", "export const leaked = true;\n");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await symlink(outside, path.join(appRoot, "node_modules"), linkType);
    await symlink(outside, path.join(appRoot, "dist"), linkType);
    await symlink(outside, path.join(publicRoot, ".git"), linkType);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error.code)) {
      t.skip(`symlink/junction creation unsupported: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /symbolic link|junction|reparse/i, "skipped links");
  const text = errorsOf(result);
  assert.match(text, /app: node_modules:/);
  assert.match(text, /app: dist:/);
  assert.match(text, /public: \.git:/);
});

test("plain files at generated paths and directories at generated files are rejected", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "dist", "synthetic non-directory\n");
  await writeAt(appRoot, ".git", "gitdir: synthetic-worktree-pointer\n");
  await writeAt(publicRoot, ".git", "synthetic non-directory\n");
  await writeAt(
    appRoot,
    "android/app/src/main/assets/capacitor.plugins.json/note.txt",
    "synthetic directory at a generated-file path\n"
  );

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(
    result,
    /generated (?:directory|file) skip expects a regular (?:directory|file)|not a regular directory/i,
    "generated path type"
  );
  const text = errorsOf(result);
  assert.match(text, /app: dist:/);
  assert.match(text, /app: \.git:/);
  assert.match(text, /public: \.git:/);
  assert.match(text, /capacitor\.plugins\.json/);
});

test("book-page provenance markers in a declared public chapter fail", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot, {
    chapters: { "chapters/01.json": chapter({ source: "Livre p. 42" }) },
  });

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /book|page|source/i, "book page source");
  assert.match(errorsOf(result), /chapters[\\/]01\.json/);
});

test("private provenance markers in a declared public chapter fail", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot, {
    chapters: { "chapters/01.json": chapter({ source: "internal draft 7" }) },
  });

  assertFails(await checkPublic({ appRoot, publicRoot }), /private|internal|source/i, "private source");
});

test("app real content JSON outside the named config files fails", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "src/copied-chapter.json", JSON.stringify(chapter(), null, 2));

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /content JSON|real content|named app config/i, "app json");
});

test("source maps, unknown binaries, and non-allowlisted source fail", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "src/App.js.map", "{}\n");
  await writeAt(appRoot, "src/tool.bin", Buffer.from([0, 1, 2, 3]));
  await writeAt(appRoot, "src/unknown.js", "export {};\n");
  await writeAt(publicRoot, "extra.json", JSON.stringify(chapter(), null, 2));

  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /source map/i, "map");
  assert.match(errorsOf(result), /binary|non-allowlisted|unknown/i);
  assert.match(errorsOf(result), /extra\.json|unreferenced|not declared/i);
});

test("only exact generated directories are skipped; arbitrary ignored-looking dirs still fail", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "dist/bundle.js", "export {};\n");
  await writeAt(appRoot, "node_modules/package/index.json", "{}\n");
  await writeAt(publicRoot, ".git/config", "[core]\n");
  await writeAt(appRoot, "android/app/capacitor.build.gradle", "// generated fixture\n");

  const skipped = await checkPublic({ appRoot, publicRoot });
  assert.equal(skipped.ok, true, errorsOf(skipped));
  assert.ok(skipped.stats.skippedGenerated >= 4);

  await writeAt(appRoot, ".cache/notes.json", JSON.stringify(chapter(), null, 2));
  await writeAt(publicRoot, "tmp/extra.json", JSON.stringify(chapter(), null, 2));
  const result = await checkPublic({ appRoot, publicRoot });
  assertFails(result, /unexpected directory|unexpected.*cache/i, "arbitrary ignored dir");
  assert.match(errorsOf(result), /unreferenced|extra\.json|unexpected/i);
});

test("secrets embedded in otherwise allowed source fail", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "src/leaked.ts", `${PRIVATE_KEY_HEADER}\n`);

  assertFails(await checkPublic({ appRoot, publicRoot }), /private key|secret/i, "secret");
});

test("API derives the public bank as a sibling of an explicit app root", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);

  const result = await checkPublic({ appRoot });

  assert.equal(result.ok, true, errorsOf(result));
  assert.equal(result.publicRoot, path.resolve(appRoot, "..", "content-public"));
});

test("CLI accepts explicit roots and exits non-zero for a bad inventory", async (t) => {
  const { appRoot, publicRoot } = await sandbox(t);
  await setupPublic(publicRoot);
  await writeAt(appRoot, "node_modules/package/index.js", "export {};\n");

  const passing = spawnSync(
    process.execPath,
    [CLI, "--app", appRoot, "--public", publicRoot],
    { encoding: "utf8", timeout: 20_000 }
  );
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /check-public: OK/);
  assert.match(passing.stdout, /not audited/i);
  assert.equal(passing.stderr, "");

  await writeAt(appRoot, "src/tool.bin", Buffer.from([0, 1, 2, 3]));
  const failing = spawnSync(
    process.execPath,
    [CLI, "--app", appRoot, "--public", publicRoot],
    { encoding: "utf8", timeout: 20_000 }
  );
  assert.equal(failing.status, 1, failing.stdout);
  assert.equal(failing.stdout, "");
  assert.match(failing.stderr, /FAILED|non-allowlisted|binary/i);
  assert.match(failing.stderr, /note:.*not audited/i);
});

test("CLI defaults to the app and its sibling content-public", async (t) => {
  const { appRoot } = await sandbox(t);
  await setupPublic(path.join(appRoot, "..", "content-public"));
  // Copy the guard into the sandbox so its default roots resolve entirely
  // inside the synthetic fixture rather than the live working tree.
  await writeAt(appRoot, "scripts/check-public.mjs", await readFile(CLI));

  const run = spawnSync(process.execPath, [path.join(appRoot, "scripts", "check-public.mjs")], {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 20_000,
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /check-public: OK/);
  assert.match(run.stdout.replaceAll("\\", "/"), /content-public/);
});
