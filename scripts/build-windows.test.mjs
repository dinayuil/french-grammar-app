// Focused tests for the isolated Tauri/NSIS Windows build plan.
// These never invoke Cargo, Vite, or an installer; they pin the build
// boundary, identity, output isolation, and fail-closed packaging checks.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  WINDOWS_BUILD_ROOT,
  WINDOWS_EDITIONS,
  PACKAGE_AFTER_STEP,
  windowsEditionIdentity,
  windowsEditionPaths,
  createWindowsPlan,
  validateWindowsConfigs,
  validateBuildMarker,
  writeBuildMarker,
  validateWebPayload,
  validatePackageSet,
  selectInstaller,
} from "./build-windows.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const FAKE_CARGO = path.join(APP_ROOT, ".fge-build", "test-cargo", "cargo.exe");

function assertContained(parent, child, label) {
  const relative = path.relative(parent, child);
  assert.ok(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} escapes ${parent}: ${child}`
  );
}

test("Windows edition identities stay aligned with the app identity table", () => {
  assert.deepEqual(WINDOWS_EDITIONS.public, {
    identifier: "com.fge.open",
    productName: "法语语法练习",
    webFolder: "public",
  });
  assert.deepEqual(WINDOWS_EDITIONS.internal, {
    identifier: "com.fge.app",
    productName: "法语语法练习·内部版",
    webFolder: "internal",
  });
  assert.notEqual(
    WINDOWS_EDITIONS.public.identifier,
    WINDOWS_EDITIONS.internal.identifier,
    "public and internal installers must not share an app identity or data origin"
  );
  assert.throws(() => windowsEditionIdentity("private"), /edition/i);
});

test("per-edition output stays under .fge-build/windows and away from dist", () => {
  const seen = new Set();
  for (const edition of ["public", "internal"]) {
    const paths = windowsEditionPaths(APP_ROOT, edition);
    assertContained(WINDOWS_BUILD_ROOT, paths.root, `${edition} root`);
    assertContained(paths.root, paths.web, `${edition} web`);
    assertContained(paths.root, paths.target, `${edition} target`);
    assertContained(paths.root, paths.packages, `${edition} packages`);
    assert.ok(!path.resolve(paths.web).startsWith(path.join(APP_ROOT, "dist")));
    assert.ok(!path.resolve(paths.target).startsWith(path.join(APP_ROOT, "dist")));
    assert.equal(seen.has(paths.web), false, "editions must not share a frontend directory");
    seen.add(paths.web);
  }
});

test("build plan compiles one frontend, then bundles standard and offline NSIS", () => {
  const plan = createWindowsPlan(APP_ROOT, "public", {
    cargoBin: FAKE_CARGO,
    env: { USERPROFILE: "C:\\Users\\fixture" },
  });

  assert.equal(plan.edition, "public");
  assert.equal(plan.identity.identifier, "com.fge.open");
  assert.equal(plan.env.FGE_EDITION, "public");
  assert.equal(plan.env.CARGO_TARGET_DIR, plan.paths.target);
  assert.ok(plan.env.PATH.toLowerCase().includes(path.dirname(FAKE_CARGO).toLowerCase()));

  const labels = plan.steps.map((step) => step.label);
  assert.deepEqual(labels, [
    "typecheck",
    "typecheck-tools",
    "frontend",
    "compile",
    "bundle-standard",
    "bundle-offline",
  ]);

  const frontend = plan.steps.find((step) => step.label === "frontend");
  const outDirIndex = frontend.args.indexOf("--outDir");
  assert.ok(outDirIndex >= 0, "frontend step must pin --outDir");
  assert.equal(
    path.resolve(APP_ROOT, frontend.args[outDirIndex + 1]),
    plan.paths.web
  );
  assert.ok(frontend.args.includes("--emptyOutDir"));

  const compile = plan.steps.find((step) => step.label === "compile");
  assert.ok(compile.args.includes("build"));
  assert.ok(compile.args.includes("--no-bundle"));
  assert.ok(compile.args.includes("--ci"));
  assert.ok(compile.args.includes("src-tauri/tauri.public.conf.json"));

  for (const [label, modeConfig] of [
    ["bundle-standard", "tauri.installer-standard.conf.json"],
    ["bundle-offline", "tauri.installer-offline.conf.json"],
  ]) {
    const step = plan.steps.find((entry) => entry.label === label);
    assert.ok(step.args.includes("bundle"));
    assert.ok(step.args.includes("nsis"));
    assert.ok(step.args.includes("src-tauri/tauri.public.conf.json"), label);
    assert.ok(step.args.includes(`src-tauri/${modeConfig}`), label);
    assert.equal(step.env.CARGO_TARGET_DIR, plan.paths.target);
  }

  const internal = createWindowsPlan(APP_ROOT, "internal", {
    cargoBin: FAKE_CARGO,
    env: {},
  });
  assert.equal(internal.env.FGE_EDITION, "internal");
  assert.ok(
    internal.steps
      .find((step) => step.label === "compile")
      .args.includes("src-tauri/tauri.internal.conf.json")
  );
  assert.notEqual(internal.paths.web, plan.paths.web);

  assert.deepEqual(PACKAGE_AFTER_STEP, {
    "bundle-standard": "standard",
    "bundle-offline": "offline",
  });
});

test("real Tauri configs are identity-consistent, NSIS-only, and narrowly scoped", async () => {
  const configs = await validateWindowsConfigs(APP_ROOT);
  assert.equal(configs.public.identifier, "com.fge.open");
  assert.equal(configs.internal.identifier, "com.fge.app");
  assert.equal(configs.public.productName, "法语语法练习");
  assert.equal(configs.internal.productName, "法语语法练习·内部版");
  assert.equal(configs.public.webDir, windowsEditionPaths(APP_ROOT, "public").web);
  assert.equal(configs.internal.webDir, windowsEditionPaths(APP_ROOT, "internal").web);
  assert.deepEqual(configs.bundleTargets, ["nsis"]);
  assert.deepEqual(configs.webviewInstallModes, {
    standard: "downloadBootstrapper",
    offline: "offlineInstaller",
  });
  assert.equal(configs.withGlobalTauri, false);
  assert.ok(configs.csp && configs.csp.length > 0, "CSP must not be disabled");
  for (const permission of configs.permissions) {
    assert.doesNotMatch(
      permission,
      /^(?:fs|dialog|shell|http|upload|process|os|clipboard):/,
      `unexpected broad permission: ${permission}`
    );
  }
  assert.deepEqual(configs.permissions, [
    "core:default",
    "core:window:allow-set-theme",
    "core:window:allow-set-title",
  ]);
  assert.deepEqual(configs.icons, ["icons/icon.ico"]);
});

test("build marker round-trips and rejects stale or cross-edition packaging", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "fge-windows-marker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = windowsEditionPaths(root, "internal");
  await mkdir(paths.web, { recursive: true });
  await writeFile(path.join(paths.web, "index.html"), "<!doctype html><div id=root></div>");

  const marker = await writeBuildMarker(root, "internal");
  assert.equal(marker.format, "fge-windows");
  assert.equal(marker.version, 1);
  assert.equal(marker.edition, "internal");
  assert.equal(marker.identifier, "com.fge.app");
  assert.equal(marker.webDir, ".fge-build/windows/internal/web");

  assert.equal(validateBuildMarker(root, "internal").edition, "internal");
  assert.throws(() => validateBuildMarker(root, "public"), /marker|edition|identity/i);

  const stored = JSON.parse(await readFile(paths.marker, "utf8"));
  stored.identifier = "com.fge.open";
  await writeFile(paths.marker, JSON.stringify(stored));
  assert.throws(() => validateBuildMarker(root, "internal"), /identifier|identity/i);
});

test("web payload validation fails closed before packaging", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "fge-windows-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const web = path.join(root, "web");

  await assert.rejects(() => validateWebPayload(web), /index\.html/i);
  await mkdir(web, { recursive: true });
  await writeFile(path.join(web, "index.html"), "");
  await assert.rejects(() => validateWebPayload(web), /index\.html/i);
  await writeFile(path.join(web, "index.html"), "<!doctype html><div id=root></div>");
  const result = await validateWebPayload(web);
  assert.equal(result.files, 1);
  assert.ok(result.bytes > 0);
});

test("installer selection and package records reject ambiguity and tampering", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "fge-windows-pkg-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const nsis = path.join(root, "release", "bundle", "nsis");
  await mkdir(nsis, { recursive: true });
  assert.equal(await selectInstaller(nsis, "standard"), null);

  const setup = path.join(nsis, "法语语法练习_0.1.0_x64-setup.exe");
  await writeFile(setup, Buffer.from("synthetic installer"));
  assert.equal(await selectInstaller(nsis, "standard"), setup);

  await writeFile(path.join(nsis, "second-setup.exe"), Buffer.from("ambiguous"));
  await assert.rejects(() => selectInstaller(nsis, "standard"), /多个|multiple/i);

  const digest = createHash("sha256")
    .update(await readFile(setup))
    .digest("hex");
  const records = [
    { variant: "standard", path: setup, size: 18, sha256: digest },
    {
      variant: "offline",
      path: path.join(root, "offline.exe"),
      size: 100,
      sha256: "a".repeat(64),
    },
  ];
  const validated = validatePackageSet(records, { minOfflineBytes: 50 });
  assert.equal(validated.standard.path, setup);
  assert.equal(validated.offline.size, 100);

  assert.throws(
    () => validatePackageSet([records[0]], { minOfflineBytes: 50 }),
    /offline|standard/i
  );
  assert.throws(
    () =>
      validatePackageSet(
        [records[0], { ...records[1], sha256: "not-a-hash" }],
        { minOfflineBytes: 50 }
      ),
    /sha256/i
  );
  assert.throws(
    () =>
      validatePackageSet(
        [records[0], { ...records[1], size: 10 }],
        { minOfflineBytes: 50 }
      ),
    /offline|大小|size/i
  );
});
