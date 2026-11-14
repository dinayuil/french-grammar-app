// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import config, {
  EDITION_IDENTITIES,
  resolveEditionIdentity,
} from "../capacitor.config";
import {
  EDITIONS,
  packageApk,
  resolvePackagingEdition,
} from "../scripts/build-apk.mjs";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoots: string[] = [];

function appFile(...parts: string[]): string {
  return path.join(APP_ROOT, ...parts);
}

function readAppFile(...parts: string[]): string {
  return readFileSync(appFile(...parts), "utf8");
}

function findGroovyJar(): string | undefined {
  const gradleUserHome =
    process.env.GRADLE_USER_HOME ?? path.join(homedir(), ".gradle");
  const roots = [
    process.env.GRADLE_HOME
      ? path.join(process.env.GRADLE_HOME, "lib")
      : undefined,
    path.join(gradleUserHome, "wrapper", "dists"),
  ].filter((value): value is string => Boolean(value));

  const walk = (directory: string): string | undefined => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isFile() && /^groovy-\d+\.\d+\.\d+\.jar$/.test(entry.name)) {
        return full;
      }
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      }
    }
    return undefined;
  };

  for (const root of roots) {
    const found = walk(root);
    if (found) return found;
  }
  return undefined;
}

const GROOVY_JAR = findGroovyJar();
const CI_REQUIRES_GROOVY =
  process.env.CI === "true" || process.env.CI === "1";

const JAVA_BIN = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";

function groovyString(value: string): string {
  return JSON.stringify(value);
}

function groovyEnv(env: Record<string, string>): string {
  const entries = Object.entries(env);
  if (entries.length === 0) return "[:]";
  return `[${entries
    .map(([key, value]) => `${groovyString(key)}: ${groovyString(value)}`)
    .join(", ")}]`;
}

interface PublicConfigCase {
  label: string;
  env: Record<string, string>;
}

interface GroovyRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runGroovy(script: string, args: string[]): GroovyRun {
  if (!GROOVY_JAR) throw new Error("Gradle Groovy jar is unavailable");
  const scriptDir = mkdtempSync(path.join(tmpdir(), "fge-groovy-run-"));
  tempRoots.push(scriptDir);
  const scriptPath = path.join(scriptDir, "driver.groovy");
  writeFileSync(scriptPath, script, "utf8");
  const result = spawnSync(
    JAVA_BIN,
    ["-cp", GROOVY_JAR, "groovy.ui.GroovyMain", scriptPath, ...args],
    { encoding: "utf8", timeout: 90_000 },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(
      `Groovy driver failed (status=${String(result.status)}):\n${[
        stdout,
        stderr,
        result.error?.message,
      ]
        .filter(Boolean)
        .join("\n")}`,
    );
  }
  return { stdout, stderr, status: result.status };
}

interface PublicConfigResult {
  version: Record<
    string,
    { status: string; versionCode?: string; versionName?: string; error?: string }
  >;
  signing: Record<
    string,
    {
      status: string;
      storeFile?: string;
      storePassword?: string;
      keyAlias?: string;
      keyPassword?: string;
      error?: string;
    }
  >;
}

/**
 * Execute android/app/fge-public-config.gradle with Gradle's own Groovy runtime.
 * Strings are generated as Groovy literals so this exercises the real helper
 * instead of mirroring its validation in TypeScript.
 */
function runPublicConfigHelper(
  versionCases: PublicConfigCase[],
  signingCases: PublicConfigCase[],
): PublicConfigResult {
  if (!GROOVY_JAR) throw new Error("Gradle Groovy jar is unavailable");
  const scriptDir = mkdtempSync(path.join(tmpdir(), "fge-public-config-"));
  tempRoots.push(scriptDir);
  const keystore = path.join(scriptDir, "fixture.keystore");
  writeFileSync(keystore, "fixture keystore bytes", "utf8");
  const missingKeystore = path.join(scriptDir, "missing.keystore");
  const withKeystore = (env: Record<string, string>) => {
    if (!Object.hasOwn(env, "FGE_PUBLIC_KEYSTORE_PATH")) return env;
    if (env.FGE_PUBLIC_KEYSTORE_PATH === "<fixture>") {
      return { ...env, FGE_PUBLIC_KEYSTORE_PATH: keystore };
    }
    if (env.FGE_PUBLIC_KEYSTORE_PATH === "<missing>") {
      return { ...env, FGE_PUBLIC_KEYSTORE_PATH: missingKeystore };
    }
    return env;
  };

  const literalCases = (cases: PublicConfigCase[]) =>
    `[${cases
      .map(
        (entry) =>
          `[label: ${groovyString(entry.label)}, env: ${groovyEnv(withKeystore(entry.env))}]`,
      )
      .join(", ")}]`;

  const driver = `
def loader = new GroovyClassLoader()
loader.parseClass(new File(args[0]))
def cls = loader.loadClass('FgePublicConfig')
def projectDir = new File(args[1])

def versionCases = ${literalCases(versionCases)}
versionCases.each { c ->
    try {
        def result = cls.resolveVersion(c.env)
        println 'VERSION|' + c.label + '|OK|' + (result.versionCode == null ? 'null' : result.versionCode) + '|' + (result.versionName == null ? 'null' : result.versionName)
    } catch (IllegalArgumentException error) {
        println 'VERSION|' + c.label + '|ERR|' + error.message
    }
}

def signingCases = ${literalCases(signingCases)}
signingCases.each { c ->
    try {
        def result = cls.resolveSigning(c.env, projectDir)
        def config = result.config
        if (config == null) {
            println 'SIGNING|' + c.label + '|NONE|' + (result.error == null ? '' : result.error)
        } else {
            println 'SIGNING|' + c.label + '|OK|' + config.storeFile.canonicalPath + '|' + config.storePassword + '|' + config.keyAlias + '|' + config.keyPassword + '|' + (result.error == null ? '' : result.error)
        }
    } catch (IllegalArgumentException error) {
        println 'SIGNING|' + c.label + '|ERR|' + error.message
    }
}
`;

  const run = runGroovy(driver, [
    appFile("android", "app", "fge-public-config.gradle"),
    appFile("android", "app"),
  ]);
  const version: PublicConfigResult["version"] = {};
  const signing: PublicConfigResult["signing"] = {};
  for (const line of run.stdout.split(/\r?\n/)) {
    if (line.startsWith("VERSION|")) {
      const parts = line.split("|");
      const [, label, status, third, fourth] = parts;
      version[label] =
        status === "OK"
          ? { status, versionCode: third, versionName: fourth }
          : { status, error: third };
      continue;
    }
    if (line.startsWith("SIGNING|")) {
      const parts = line.split("|");
      const [, label, status] = parts;
      if (status === "OK") {
        signing[label] = {
          status,
          storeFile: parts[3],
          storePassword: parts[4],
          keyAlias: parts[5],
          keyPassword: parts[6],
          error: parts[7] || undefined,
        };
      } else {
        signing[label] = { status, error: parts[3] };
      }
    }
  }
  return { version, signing };
}

function createProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "fge-apk-test-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, "android", "app", "src", "main", "assets", "public"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "android", "gradlew.bat"), "");
  writeFileSync(path.join(root, "android", "gradlew"), "");
  return root;
}

function readJson<T = Record<string, unknown>>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function fakeResolver(raw: string | undefined): "public" | "internal" {
  if (raw === "public" || raw === "internal") return raw;
  throw new Error(`unknown edition: ${String(raw)}`);
}

type Phase = "build" | "sync" | "gradle";

interface FakeCall {
  command: string;
  args: string[];
  cwd?: string;
  edition?: string;
  phase: Phase;
}

interface FakeOptions {
  failPhase?: Phase;
  capConfig?: Record<string, unknown>;
  markerEdition?: string;
  skipApk?: boolean;
}

function classify(command: string, args: string[]): Phase {
  const joined = [command, ...args].join(" ").replaceAll("\\", "/");
  if (joined.includes("run-mode.mjs")) return "build";
  if (joined.includes("@capacitor/cli/bin/capacitor")) return "sync";
  if (joined.includes("gradlew")) return "gradle";
  throw new Error(`unexpected fake command: ${joined}`);
}

function fakeRunner(root: string, calls: FakeCall[], options: FakeOptions = {}) {
  return async (
    command: string,
    args: string[],
    spawnOptions: { cwd?: string; env?: Record<string, string> } = {},
  ) => {
    const edition = spawnOptions.env?.FGE_EDITION as "public" | "internal";
    const phase = classify(command, args);
    calls.push({
      command,
      args: [...args],
      cwd: spawnOptions.cwd,
      edition,
      phase,
    });

    if (options.failPhase === phase) {
      throw new Error(`fake ${phase} failure`);
    }

    const identity = EDITIONS[edition];
    if (phase === "build") {
      const distDir = path.join(root, identity.webDir);
      mkdirSync(distDir, { recursive: true });
      writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");
    }

    if (phase === "sync") {
      const assetsDir = path.join(root, "android", "app", "src", "main", "assets");
      const assetsPublic = path.join(assetsDir, "public");
      const distMarker = path.join(root, identity.webDir, "fge-edition.json");
      const marker = readJson<Record<string, unknown>>(distMarker);
      if (options.markerEdition) marker.edition = options.markerEdition;
      mkdirSync(assetsPublic, { recursive: true });
      writeFileSync(path.join(assetsPublic, "index.html"), "<!doctype html>");
      writeFileSync(
        path.join(assetsPublic, "fge-edition.json"),
        `${JSON.stringify(marker, null, 2)}\n`,
      );
      writeFileSync(
        path.join(assetsDir, "capacitor.config.json"),
        `${JSON.stringify(
          options.capConfig ?? {
            appId: identity.appId,
            appName: identity.appName,
            webDir: identity.webDir,
          },
          null,
          2,
        )}\n`,
      );
    }

    if (phase === "gradle" && !options.skipApk) {
      const apkPath = path.join(root, identity.apkPath);
      mkdirSync(path.dirname(apkPath), { recursive: true });
      writeFileSync(apkPath, "fake apk");
    }
  };
}

async function run(
  root: string,
  rawEdition: string | undefined,
  options: FakeOptions = {},
) {
  const calls: FakeCall[] = [];
  const log: string[] = [];
  const result = await packageApk({
    rawEdition,
    projectRoot: root,
    resolveEdition: fakeResolver,
    runCommand: fakeRunner(root, calls, options),
    log: (line: string) => log.push(line),
  });
  return { result, calls, log };
}

afterEach(() => {
  delete process.env.FGE_EDITION;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Capacitor edition identity", () => {
  it("keeps the old server/loading configuration untouched", () => {
    expect(config).not.toHaveProperty("server");
    expect(config).not.toHaveProperty("android");
    expect(config).not.toHaveProperty("ios");
    const source = readAppFile("capacitor.config.ts");
    expect(source).not.toMatch(/^\s*server\s*:/m);
    expect(source).not.toMatch(/androidScheme|cleartext/);
  });

  it("defaults to the public identity", () => {
    expect(resolveEditionIdentity(undefined)).toEqual(EDITION_IDENTITIES.public);
    expect(resolveEditionIdentity("public")).toEqual(EDITION_IDENTITIES.public);
  });

  it("uses the internal identity only when explicitly selected", () => {
    expect(resolveEditionIdentity("internal")).toEqual({
      appId: "com.fge.app",
      appName: "法语语法练习·内部版",
      webDir: "dist/internal",
    });
  });

  it("rejects unknown or non-canonical editions", () => {
    for (const raw of ["", "staging", "public ", "INTERNAL", "internal\n"]) {
      expect(() => resolveEditionIdentity(raw)).toThrow(/edition/i);
    }
  });

  it("binds the default export to FGE_EDITION", async () => {
    process.env.FGE_EDITION = "internal";
    vi.resetModules();
    const internal = await import("../capacitor.config");
    expect(internal.default.appId).toBe("com.fge.app");
    expect(internal.default.webDir).toBe("dist/internal");
  });

  it("keeps config and packaging identity tables in lockstep", () => {
    for (const edition of ["public", "internal"] as const) {
      expect(EDITION_IDENTITIES[edition]).toEqual({
        appId: EDITIONS[edition].appId,
        appName: EDITIONS[edition].appName,
        webDir: EDITIONS[edition].webDir,
      });
    }
  });
});

describe("Android template resources and flavors", () => {
  it("requires the Gradle Groovy runtime in CI", () => {
    if (CI_REQUIRES_GROOVY) {
      expect(
        GROOVY_JAR,
        "CI must run `bash ./gradlew --version` before `npm test`; the Groovy helper tests must not silently skip.",
      ).toBeTruthy();
    }
  });

  it.skipIf(!GROOVY_JAR && !CI_REQUIRES_GROOVY)(
    "passes the installed Gradle Groovy syntax parser",
    () => {
      const scriptDir = mkdtempSync(path.join(tmpdir(), "fge-groovy-parse-"));
      tempRoots.push(scriptDir);
      const scriptPath = path.join(scriptDir, "parse.groovy");
      writeFileSync(
        scriptPath,
        `
import org.codehaus.groovy.control.CompilationUnit
import org.codehaus.groovy.control.Phases

args.each { name ->
    def file = new File(name)
    try {
        def unit = new CompilationUnit()
        unit.addSource(file.name, file.getText("UTF-8"))
        unit.compile(Phases.CONVERSION)
        println "SYNTAX_OK " + file.name
    } catch (Throwable error) {
        System.err.println("SYNTAX_FAIL " + error.message)
        System.exit(1)
    }
}
`,
        "utf8",
      );

      const result = spawnSync(
        JAVA_BIN,
        [
          "-cp",
          GROOVY_JAR,
          "groovy.ui.GroovyMain",
          scriptPath,
          appFile("android", "app", "build.gradle"),
          appFile("android", "app", "fge-public-config.gradle"),
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      const output = [
        result.stdout,
        result.stderr,
        result.error?.message,
      ]
        .filter(Boolean)
        .join("\n");
      if (result.status !== 0 || !output.includes("SYNTAX_OK")) {
        throw new Error(
          `Gradle Groovy syntax parse failed:\n${output || "<no output>"}`,
        );
      }
      expect(result.status).toBe(0);
    },
    90_000,
  );

  it("defines explicit public/internal flavors with a stable namespace", () => {
    const gradle = readAppFile("android", "app", "build.gradle");
    expect(gradle).toMatch(/namespace\s*=\s*["']com\.fge\.app["']/);
    expect(gradle).toMatch(/flavorDimensions\s+["']edition["']/);
    expect(gradle).toMatch(
      /create\(\s*["']public["']\s*\)\s*\{[\s\S]*?applicationId\s+["']com\.fge\.open["']/,
    );
    expect(gradle).toMatch(
      /create\(\s*["']internal["']\s*\)\s*\{[\s\S]*?applicationId\s+["']com\.fge\.app["']/,
    );
    expect(gradle).not.toMatch(/^\s*(?:public|internal)\s*\{/m);
  });

  it("gives the public flavor the base display name", () => {
    const publicStrings = readAppFile(
      "android",
      "app",
      "src",
      "public",
      "res",
      "values",
      "strings.xml",
    );
    expect(publicStrings).toContain(
      '<string name="app_name">法语语法练习</string>',
    );
    expect(publicStrings).toContain(
      '<string name="title_activity_main">法语语法练习</string>',
    );
    expect(publicStrings).not.toContain("内部版");
    expect(publicStrings).toContain(
      '<string name="package_name">com.fge.open</string>',
    );
    expect(publicStrings).toContain(
      '<string name="custom_url_scheme">com.fge.open</string>',
    );
  });

  it("guards direct flavor assembly against stale synchronized assets", () => {
    const gradle = readAppFile("android", "app", "build.gradle");
    expect(gradle).toContain("prePublicDebugBuild");
    expect(gradle).toContain("preInternalDebugBuild");
    expect(gradle).toContain("fge-edition.json");
    expect(gradle).toContain("capacitor.config.json");
    expect(gradle).toMatch(/GradleException/);
  });

  it("gives the internal flavor the internal display name", () => {
    const strings = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml",
    );
    expect(strings).toContain('<string name="app_name">法语语法练习·内部版</string>');
    expect(strings).toContain(
      '<string name="title_activity_main">法语语法练习·内部版</string>',
    );
    expect(strings).toContain('<string name="package_name">com.fge.app</string>');
    expect(strings).not.toContain("公开版");
  });

  it("provides every color referenced by the app theme", () => {
    const colorsPath = appFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "colors.xml",
    );
    expect(existsSync(colorsPath)).toBe(true);
    const colors = readFileSync(colorsPath, "utf8");
    const styles = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "styles.xml",
    );
    const referenced = [...styles.matchAll(/@color\/([A-Za-z0-9_]+)/g)].map(
      (match) => match[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(colors).toMatch(
        new RegExp(`<color name="${name}">#[0-9A-Fa-f]{6,8}</color>`),
      );
    }
  });

  it("provides night colors and a theme-aware webview background", () => {
    const light = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "colors.xml",
    );
    expect(light).toContain('<color name="colorPrimary">#f6f4ef</color>');
    expect(light).toContain('<color name="colorPrimaryDark">#f6f4ef</color>');
    expect(light).toContain('<color name="colorAccent">#21409a</color>');

    const night = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values-night",
      "colors.xml",
    );
    expect(night).toContain('<color name="colorPrimary">#0e1420</color>');
    expect(night).toContain('<color name="colorPrimaryDark">#0e1420</color>');
    expect(night).toContain('<color name="colorAccent">#4560d2</color>');

    const layout = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "layout",
      "capacitor_bridge_layout_main.xml",
    );
    const webView =
      layout.match(/<com\.getcapacitor\.CapacitorWebView[\s\S]*?\/>/)?.[0] ??
      "";
    expect(webView).toContain('android:id="@+id/webview"');
    expect(webView).toContain('android:background="?android:attr/colorBackground"');

    const styles = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "styles.xml",
    );
    const activeTheme =
      styles.match(/<style name="AppTheme\.NoActionBar"[\s\S]*?<\/style>/)?.[0] ??
      "";
    expect(activeTheme).toContain(
      'parent="Theme.AppCompat.DayNight.NoActionBar"',
    );
    expect(activeTheme).toContain(
      '<item name="colorPrimary">@color/colorPrimary</item>',
    );
    expect(activeTheme).toContain(
      '<item name="colorPrimaryDark">@color/colorPrimaryDark</item>',
    );
    expect(activeTheme).toContain(
      '<item name="colorAccent">@color/colorAccent</item>',
    );
  });

  it("keeps the app bridge layout in sync with the Capacitor package except the WebView background", () => {
    const appLayout = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "layout",
      "capacitor_bridge_layout_main.xml",
    ).replace(/\r\n/g, "\n");
    const packageLayoutPath = appFile(
      "node_modules",
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "res",
      "layout",
      "capacitor_bridge_layout_main.xml",
    );
    expect(existsSync(packageLayoutPath)).toBe(true);
    const packageLayout = readFileSync(packageLayoutPath, "utf8").replace(
      /\r\n/g,
      "\n",
    );

    expect(appLayout.match(/android:background="[^"]*"/g)).toEqual([
      'android:background="?android:attr/colorBackground"',
    ]);
    const withoutBackground = appLayout.replace(
      /\s*android:background="[^"]*"/,
      "",
    );
    expect(withoutBackground).toBe(packageLayout);
  });

  it("leaves MainActivity and manifest labels on the stable namespace", () => {
    const activity = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "MainActivity.java",
    );
    expect(activity).toContain("package com.fge.app;");
    const manifest = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml",
    );
    expect(manifest).toContain('android:label="@string/app_name"');
    expect(manifest).toContain('android:label="@string/title_activity_main"');
  });
});

describe("public APK version and signing configuration", () => {
  const versionCases: PublicConfigCase[] = [
    { label: "defaults", env: {} },
    {
      label: "valid",
      env: {
        FGE_PUBLIC_VERSION_CODE: "42",
        FGE_PUBLIC_VERSION_NAME: "1.0-test.42",
      },
    },
    {
      label: "minimum",
      env: {
        FGE_PUBLIC_VERSION_CODE: "1",
        FGE_PUBLIC_VERSION_NAME: "1.0-test.1",
      },
    },
    {
      label: "maximum",
      env: {
        FGE_PUBLIC_VERSION_CODE: "2100000000",
        FGE_PUBLIC_VERSION_NAME: "1.0-test.2100000000",
      },
    },
    { label: "zero", env: { FGE_PUBLIC_VERSION_CODE: "0", FGE_PUBLIC_VERSION_NAME: "1.0-test.0" } },
    { label: "negative", env: { FGE_PUBLIC_VERSION_CODE: "-1", FGE_PUBLIC_VERSION_NAME: "1.0-test.-1" } },
    {
      label: "too-large",
      env: { FGE_PUBLIC_VERSION_CODE: "2100000001", FGE_PUBLIC_VERSION_NAME: "1.0-test.2100000001" },
    },
    { label: "leading-zero", env: { FGE_PUBLIC_VERSION_CODE: "042", FGE_PUBLIC_VERSION_NAME: "1.0-test.42" } },
    { label: "non-numeric", env: { FGE_PUBLIC_VERSION_CODE: "abc", FGE_PUBLIC_VERSION_NAME: "1.0-test.abc" } },
    { label: "code-only", env: { FGE_PUBLIC_VERSION_CODE: "42" } },
    { label: "name-only", env: { FGE_PUBLIC_VERSION_NAME: "1.0-test.42" } },
    { label: "space-name", env: { FGE_PUBLIC_VERSION_CODE: "42", FGE_PUBLIC_VERSION_NAME: "1.0 test 42" } },
    { label: "slash-name", env: { FGE_PUBLIC_VERSION_CODE: "42", FGE_PUBLIC_VERSION_NAME: "1.0/test" } },
    { label: "newline-name", env: { FGE_PUBLIC_VERSION_CODE: "42", FGE_PUBLIC_VERSION_NAME: "1.0-test.42\ninjected" } },
    {
      label: "too-long-name",
      env: { FGE_PUBLIC_VERSION_CODE: "42", FGE_PUBLIC_VERSION_NAME: `1.${"a".repeat(64)}` },
    },
  ];

  const signingCases: PublicConfigCase[] = [
    { label: "defaults", env: {} },
    { label: "required-missing", env: { FGE_REQUIRE_PUBLIC_SIGNING: "1" } },
    { label: "zero-is-optional", env: { FGE_REQUIRE_PUBLIC_SIGNING: "0" } },
    { label: "partial-path", env: { FGE_PUBLIC_KEYSTORE_PATH: "<fixture>" } },
    {
      label: "partial-password",
      env: {
        FGE_PUBLIC_KEYSTORE_PATH: "<fixture>",
        FGE_PUBLIC_KEYSTORE_PASSWORD: "store-password",
        FGE_PUBLIC_KEY_ALIAS: "public-test",
      },
    },
    {
      label: "valid",
      env: {
        FGE_PUBLIC_KEYSTORE_PATH: "<fixture>",
        FGE_PUBLIC_KEYSTORE_PASSWORD: "store-password",
        FGE_PUBLIC_KEY_ALIAS: "public-test",
        FGE_PUBLIC_KEY_PASSWORD: "key-password",
      },
    },
    {
      label: "valid-required",
      env: {
        FGE_REQUIRE_PUBLIC_SIGNING: "1",
        FGE_PUBLIC_KEYSTORE_PATH: "<fixture>",
        FGE_PUBLIC_KEYSTORE_PASSWORD: "store-password",
        FGE_PUBLIC_KEY_ALIAS: "public-test",
        FGE_PUBLIC_KEY_PASSWORD: "key-password",
      },
    },
    {
      label: "missing-file",
      env: {
        FGE_PUBLIC_KEYSTORE_PATH: "<missing>",
        FGE_PUBLIC_KEYSTORE_PASSWORD: "store-password",
        FGE_PUBLIC_KEY_ALIAS: "public-test",
        FGE_PUBLIC_KEY_PASSWORD: "key-password",
      },
    },
    { label: "invalid-required-flag", env: { FGE_REQUIRE_PUBLIC_SIGNING: "true" } },
  ];

  it.skipIf(!GROOVY_JAR && !CI_REQUIRES_GROOVY)(
    "validates and returns public version inputs with the real Gradle helper",
    () => {
      const { version } = runPublicConfigHelper(versionCases, signingCases);
      expect(version.defaults).toEqual({
        status: "OK",
        versionCode: "null",
        versionName: "null",
      });
      expect(version.valid).toEqual({
        status: "OK",
        versionCode: "42",
        versionName: "1.0-test.42",
      });
      expect(version.minimum).toEqual({
        status: "OK",
        versionCode: "1",
        versionName: "1.0-test.1",
      });
      expect(version.maximum).toEqual({
        status: "OK",
        versionCode: "2100000000",
        versionName: "1.0-test.2100000000",
      });
      for (const label of [
        "zero",
        "negative",
        "too-large",
        "leading-zero",
        "non-numeric",
        "code-only",
        "name-only",
        "space-name",
        "slash-name",
        "newline-name",
        "too-long-name",
      ]) {
        expect(version[label]?.status, label).toBe("ERR");
        expect(version[label]?.error, label).toBeTruthy();
      }
      expect(version["code-only"]?.error).toMatch(/must be set together/i);
      expect(version["name-only"]?.error).toMatch(/must be set together/i);
      expect(version.zero?.error).toMatch(/positive|integer/i);
      expect(version["too-long-name"]?.error).toMatch(/VERSION_NAME/);
    },
    120_000,
  );

  it.skipIf(!GROOVY_JAR && !CI_REQUIRES_GROOVY)(
    "requires complete public signing without weakening local defaults",
    () => {
      const { signing } = runPublicConfigHelper(versionCases, signingCases);
      expect(signing.defaults).toEqual({ status: "NONE", error: "" });
      expect(signing["zero-is-optional"]).toEqual({ status: "NONE", error: "" });
      expect(signing["required-missing"]?.status).toBe("NONE");
      expect(signing["required-missing"]?.error).toMatch(/required/i);
      expect(signing["partial-path"]?.status).toBe("NONE");
      expect(signing["partial-path"]?.error).toMatch(/incomplete/i);
      expect(signing["partial-password"]?.status).toBe("NONE");
      expect(signing["partial-password"]?.error).toMatch(
        /FGE_PUBLIC_KEY_PASSWORD/,
      );
      expect(signing["invalid-required-flag"]?.status).toBe("NONE");
      expect(signing["invalid-required-flag"]?.error).toMatch(/must be 1 or 0/i);
      expect(signing["missing-file"]?.status).toBe("NONE");
      expect(signing["missing-file"]?.error).toMatch(/not a readable file/i);

      expect(signing.valid?.status).toBe("OK");
      expect(path.basename(signing.valid?.storeFile ?? "")).toBe(
        "fixture.keystore",
      );
      expect(signing.valid?.storePassword).toBe("store-password");
      expect(signing.valid?.keyAlias).toBe("public-test");
      expect(signing.valid?.keyPassword).toBe("key-password");
      expect(signing.valid?.error).toBeUndefined();
      expect(signing["valid-required"]?.status).toBe("OK");
    },
    120_000,
  );

  it("wires version and signing inputs into only the public debug build", () => {
    const gradle = readAppFile("android", "app", "build.gradle");
    expect(gradle).toContain(
      "apply from: 'fge-public-config.gradle'",
    );
    expect(gradle).toContain("fgePublicConfig.resolveVersion(System.getenv())");
    expect(gradle).toContain(
      "fgePublicConfig.resolveSigning(System.getenv(), file('.'))",
    );
    expect(gradle).toMatch(/versionCode\s+1\b/);
    expect(gradle).toMatch(/versionName\s+["']1\.0["']/);
    expect(gradle).toMatch(
      /create\(\s*["']public["']\s*\)\s*\{[\s\S]*?if\s*\(\s*fgePublicVersion\.versionCode\s*!=\s*null\s*\)[\s\S]*?versionCode\s+fgePublicVersion\.versionCode[\s\S]*?versionName\s+fgePublicVersion\.versionName/,
    );
    expect(gradle).toMatch(
      /onVariants\(\s*selector\(\)\.withBuildType\(\s*["']debug["']\s*\)\.withFlavor\(\s*["']edition["']\s*,\s*["']public["']\s*\)/,
    );
    expect(gradle).toMatch(/variant\.signingConfig\.setConfig\(/);
    expect(gradle).toMatch(
      /prePublicDebugBuild[\s\S]*?verifyPublicBuildInputs\(\)/,
    );
    expect(gradle).not.toMatch(/preInternalDebugBuild[\s\S]{0,200}verifyPublicBuildInputs/);
    expect(gradle).not.toMatch(/storePassword|keyPassword/);
  });

  it("keeps the helper free of embedded credentials or machine paths", () => {
    const helper = readAppFile("android", "app", "fge-public-config.gradle");
    expect(helper).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(helper).not.toMatch(/-----BEGIN/);
    expect(helper).not.toMatch(
      /(?:storePassword|keyPassword)\s*=\s*["'][^"']+["']/,
    );
  });
});

describe("AppTheme plugin", () => {
  it("registers AppThemePlugin in MainActivity", () => {
    const activity = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "MainActivity.java",
    );
    expect(activity).toContain("registerPlugin(AppThemePlugin.class)");
    expect(activity).toContain("super.onCreate(savedInstanceState)");
  });

  it("declares the AppTheme plugin with an apply method", () => {
    const plugin = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "AppThemePlugin.java",
    );
    expect(plugin).toContain('@CapacitorPlugin(name = "AppTheme")');
    expect(plugin).toContain("@PluginMethod");
    expect(plugin).toContain("apply");
    expect(plugin).toContain("setStatusBarColor");
    expect(plugin).toContain("setNavigationBarColor");
    expect(plugin).toContain("#F6F4EF");
    expect(plugin).toContain("#0E1420");
  });

  it("不重建 Activity,避免 WebView 重载", () => {
    const plugin = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "AppThemePlugin.java",
    );
    expect(plugin).not.toContain("recreate()");
  });

  it("re-applies the forced theme after configuration changes", () => {
    const plugin = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "AppThemePlugin.java",
    );
    expect(plugin).toMatch(
      /protected\s+void\s+handleOnConfigurationChanged\s*\(\s*Configuration\s+newConfig\s*\)/,
    );
    expect(plugin).toContain("super.handleOnConfigurationChanged(newConfig)");
    expect(plugin).toContain("executeOnMainThread");
  });

  it("keeps the forced bar colors in sync with theme.ts", () => {
    const plugin = readAppFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "fge",
      "app",
      "AppThemePlugin.java",
    );
    const theme = readAppFile("src", "theme.ts").toLowerCase();
    const colors = [
      ...plugin.matchAll(/Color\.parseColor\("(#[0-9A-Fa-f]{6})"\)/g),
    ].map((match) => match[1].toLowerCase());
    expect(colors).toHaveLength(2);
    for (const color of colors) {
      expect(theme).toContain(color);
    }
  });
});

describe("packaging wrapper", () => {
  it("only delegates to the Node packaging script and propagates errors", () => {
    const batch = readAppFile("build-apk.bat");
    expect(batch).toMatch(
      /node\s+"%~dp0scripts\\build-apk\.mjs"\s+%\*/i,
    );
    expect(batch).toMatch(/exit \/b %ERRORLEVEL%/i);
    expect(batch).not.toMatch(/npm run build|cap sync|assembleDebug/i);
  });

  it("keeps machine paths, keys and generated assets out of tracked files", () => {
    const tracked = [
      "capacitor.config.ts",
      "build-apk.bat",
      "scripts/build-apk.mjs",
      "android/app/build.gradle",
      "android/.gitignore",
    ];
    for (const relative of tracked) {
      const text = readAppFile(...relative.split("/"));
      expect(text).not.toMatch(/[A-Za-z]:\\Users\\/);
      expect(text).not.toMatch(/sdk\.dir\s*=/);
      expect(text).not.toMatch(/storePassword|keyPassword/);
    }
  });

  it("ignores the packaging lock and generated Android artifacts", () => {
    const androidIgnore = readAppFile("android", ".gitignore");
    expect(androidIgnore).toContain(".fge-apk.lock");
    const rootIgnore = readAppFile(".gitignore");
    for (const pattern of [
      "android/app/build/",
      "android/app/src/main/assets/public/",
      "android/local.properties",
      "*.apk",
    ]) {
      expect(rootIgnore).toContain(pattern);
    }
  });
});

describe("serial APK stages", () => {
  it("builds public web, syncs, validates and assembles the public flavor", async () => {
    const root = createProject();
    const { result, calls } = await run(root, "public");

    expect(calls.map((call) => call.phase)).toEqual([
      "build",
      "sync",
      "gradle",
    ]);
    expect(calls[0].args).toEqual([
      path.join(root, "scripts", "run-mode.mjs"),
      "build",
      "public",
    ]);
    expect(calls[0].edition).toBe("public");
    expect(calls[1].edition).toBe("public");
    expect(calls[1].args).toContain("sync");
    expect(calls[1].args).toContain("android");
    expect(calls[2].edition).toBe("public");
    expect(calls[2].args).toEqual(["assemblePublicDebug"]);
    expect(calls[0].cwd).toBe(root);
    expect(calls[1].cwd).toBe(root);
    expect(calls[2].cwd).toBe(path.join(root, "android"));

    const distMarker = readJson(
      path.join(root, "dist", "public", "fge-edition.json"),
    );
    expect(distMarker).toMatchObject({
      edition: "public",
      appId: "com.fge.open",
      webDir: "dist/public",
    });
    expect(result.edition).toBe("public");
    expect(result.apkPath).toBe(path.join(root, EDITIONS.public.apkPath));
    expect(existsSync(path.join(root, "android", ".fge-apk.lock"))).toBe(false);
  });

  it("builds the internal flavor with the internal identity and task", async () => {
    const root = createProject();
    const { result, calls } = await run(root, "internal");

    expect(calls.map((call) => call.phase)).toEqual([
      "build",
      "sync",
      "gradle",
    ]);
    expect(calls[0].args).toEqual([
      path.join(root, "scripts", "run-mode.mjs"),
      "build",
      "internal",
    ]);
    expect(calls[2].args).toEqual(["assembleInternalDebug"]);
    expect(calls[0].cwd).toBe(root);
    expect(calls[1].cwd).toBe(root);
    expect(calls[2].cwd).toBe(path.join(root, "android"));
    expect(result.appId).toBe("com.fge.app");
    expect(result.apkPath).toBe(path.join(root, EDITIONS.internal.apkPath));
  });

  it("requires an explicit canonical edition before touching the lock", async () => {
    const root = createProject();
    let resolverCalls = 0;
    const resolveEdition = (raw: string | undefined) => {
      resolverCalls += 1;
      return fakeResolver(raw);
    };

    await expect(
      packageApk({
        rawEdition: undefined,
        projectRoot: root,
        resolveEdition,
        runCommand: async () => {
          throw new Error("must not run");
        },
      }),
    ).rejects.toThrow(/explicit edition/i);
    expect(resolverCalls).toBe(0);

    await expect(
      packageApk({
        rawEdition: "staging",
        projectRoot: root,
        resolveEdition,
        runCommand: async () => {
          throw new Error("must not run");
        },
      }),
    ).rejects.toThrow(/unknown edition/i);
    expect(existsSync(path.join(root, "android", ".fge-apk.lock"))).toBe(false);
  });

  it("stops after a web build failure and releases the lock", async () => {
    const root = createProject();
    const calls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: root,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(root, calls, { failPhase: "build" }),
      }),
    ).rejects.toThrow(/fake build failure/);

    expect(calls.map((call) => call.phase)).toEqual(["build"]);
    expect(existsSync(path.join(root, "android", ".fge-apk.lock"))).toBe(false);
    expect(
      existsSync(path.join(root, "dist", "public", "fge-edition.json")),
    ).toBe(false);
  });

  it("stops before Gradle when cap sync fails", async () => {
    const root = createProject();
    const calls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: root,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(root, calls, { failPhase: "sync" }),
      }),
    ).rejects.toThrow(/fake sync failure/);

    expect(calls.map((call) => call.phase)).toEqual(["build", "sync"]);
    expect(existsSync(path.join(root, "android", ".fge-apk.lock"))).toBe(false);
  });

  it("stops before Gradle on a mismatched synchronized config or marker", async () => {
    const wrongConfig = createProject();
    const wrongConfigCalls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: wrongConfig,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(wrongConfig, wrongConfigCalls, {
          capConfig: {
            appId: "com.fge.app",
            appName: "法语语法练习",
            webDir: "dist/internal",
          },
        }),
      }),
    ).rejects.toThrow(/synchronized Capacitor config/i);
    expect(wrongConfigCalls.map((call) => call.phase)).toEqual([
      "build",
      "sync",
    ]);
    expect(existsSync(path.join(wrongConfig, "android", ".fge-apk.lock"))).toBe(
      false,
    );

    const wrongMarker = createProject();
    const wrongMarkerCalls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "internal",
        projectRoot: wrongMarker,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(wrongMarker, wrongMarkerCalls, {
          markerEdition: "public",
        }),
      }),
    ).rejects.toThrow(/synchronized web marker/i);
    expect(wrongMarkerCalls.map((call) => call.phase)).toEqual([
      "build",
      "sync",
    ]);
    expect(existsSync(path.join(wrongMarker, "android", ".fge-apk.lock"))).toBe(
      false,
    );
  });

  it("propagates Gradle failure and missing APK output", async () => {
    const gradleFailure = createProject();
    const gradleCalls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: gradleFailure,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(gradleFailure, gradleCalls, {
          failPhase: "gradle",
        }),
      }),
    ).rejects.toThrow(/fake gradle failure/);
    expect(gradleCalls.map((call) => call.phase)).toEqual([
      "build",
      "sync",
      "gradle",
    ]);
    expect(
      existsSync(path.join(gradleFailure, "android", ".fge-apk.lock")),
    ).toBe(false);

    const missingApk = createProject();
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: missingApk,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(missingApk, [], { skipApk: true }),
      }),
    ).rejects.toThrow(/APK.*not found/i);
    expect(existsSync(path.join(missingApk, "android", ".fge-apk.lock"))).toBe(
      false,
    );
  });

  it("refuses to run while another packaging lock is held", async () => {
    const root = createProject();
    const lockPath = path.join(root, "android", ".fge-apk.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 1234, edition: "public" }),
      "utf8",
    );
    const calls: FakeCall[] = [];
    await expect(
      packageApk({
        rawEdition: "public",
        projectRoot: root,
        resolveEdition: fakeResolver,
        runCommand: fakeRunner(root, calls),
      }),
    ).rejects.toThrow(/lock/i);
    expect(calls).toEqual([]);
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe("shared edition resolver wiring", () => {
  it("loads scripts/edition.mjs and rejects a non-echoed result", async () => {
    const loaded: string[] = [];
    const edition = await resolvePackagingEdition("internal", async () => {
      loaded.push("loaded");
      return { resolveEdition: (raw: string) => raw };
    });
    expect(edition).toBe("internal");
    expect(loaded).toEqual(["loaded"]);

    await expect(
      resolvePackagingEdition("public", async () => ({
        resolveEdition: () => "internal",
      })),
    ).rejects.toThrow(/does not match/i);

    await expect(
      resolvePackagingEdition("", async () => {
        throw new Error("must not load");
      }),
    ).rejects.toThrow(/explicit edition/i);
  });

  it.skipIf(!existsSync(appFile("scripts", "edition.mjs")))(
    "uses the Task 3 resolver when Task 3 is present",
    async () => {
      await expect(resolvePackagingEdition("public")).resolves.toBe("public");
      await expect(resolvePackagingEdition("internal")).resolves.toBe(
        "internal",
      );
      await expect(resolvePackagingEdition("staging")).rejects.toThrow();
      await expect(resolvePackagingEdition("")).rejects.toThrow(
        /explicit edition/i,
      );

      const { resolveEdition } = await import("../scripts/edition.mjs");
      expect(resolveEdition(undefined)).toBe("public");
      expect(resolveEdition("public")).toBe("public");
      expect(resolveEdition("internal")).toBe("internal");
      expect(() => resolveEdition("")).toThrow();
      expect(() => resolveEdition("staging")).toThrow();
      expect(() => resolveEditionIdentity("")).toThrow();
      expect(() => resolveEditionIdentity("staging")).toThrow();
    },
  );
});
