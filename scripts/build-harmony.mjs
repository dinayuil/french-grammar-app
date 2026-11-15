/**
 * Build a local unsigned HarmonyOS debug HAP for one explicit edition.
 *
 * The version-controlled `harmony/` directory is a source template only. Every
 * run copies it into an ignored per-edition build root, injects the edition
 * identity, mirrors only `dist/<edition>` into `rawfile/web`, validates the
 * result, then invokes OHPM/Hvigor with process-scoped tools.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveEdition } from "./edition.mjs";

export const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const TEMPLATE_ROOT = path.join(APP_ROOT, "harmony");
export const BUILD_ROOT = path.join(APP_ROOT, ".fge-build", "harmony");

  const EDITIONS = {
  public: {
    bundleName: "com.fge.open",
    appName: "法语语法练习",
  },
  internal: {
    bundleName: "com.fge.app",
    appName: "法语语法练习·内部版",
  },
};

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".json5",
  ".ts",
  ".ets",
  ".md",
  ".txt",
  ".gitignore",
  ".properties",
]);
const FORBIDDEN_TEMPLATE_SEGMENTS = new Set([
  "rawfile",
  "build",
  "oh_modules",
  "node_modules",
  "dist",
  ".hvigor",
  ".fge-build",
  ".idea",
  "signing",
]);
const FORBIDDEN_TEMPLATE_FILES = new Set([
  "local.properties",
  "oh-package-lock.json5",
  "package-lock.json",
  "signing-config.json5",
]);
const FORBIDDEN_PACKAGE_EXTENSIONS = new Set([
  ".hap",
  ".har",
  ".hsp",
  ".app",
  ".p12",
  ".cer",
  ".p7b",
  ".p7c",
  ".jks",
  ".keystore",
]);
const MACHINE_PATH_RE = /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/;
const REMOTE_REF_RE = /^(?:https?:)?\/\//i;
const HTML_REF_RE = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const CSS_REF_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function editionConfig(rawEdition) {
  const edition = resolveEdition(rawEdition);
  return { edition, ...EDITIONS[edition] };
}

export function projectDirFor(appRoot, rawEdition) {
  const { edition } = editionConfig(rawEdition);
  return path.join(path.resolve(appRoot), ".fge-build", "harmony", edition, "project");
}

function toPortable(relative) {
  return relative.split(path.sep).join("/");
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function walkFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function readText(file) {
  return readFileSync(file, "utf8");
}

/**
 * Resolve every local HTML/CSS reference and require a non-empty contained
 * file. Remote, protocol-relative, absolute and traversal references fail.
 * Returns the sorted portable list of referenced files and index.html.
 */
export function validateReferencedAssets(distDir) {
  const root = path.resolve(distDir);
  const index = path.join(root, "index.html");
  if (!existsSync(index)) {
    throw new Error(`dist 缺少 index.html: ${index}`);
  }
  if (statSync(index).size === 0) {
    throw new Error("dist/index.html 为空");
  }

  const discovered = new Set(["index.html"]);
  const queue = [index];

  const addReference = (rawReference, sourceFile) => {
    const reference = rawReference.trim();
    if (reference === "" || reference.startsWith("#")) return;
    if (/^(?:data|blob):/i.test(reference)) return;
    if (REMOTE_REF_RE.test(reference)) {
      throw new Error(
        `远程资源引用不被允许 (${sourceFile}): ${reference}`
      );
    }
    if (reference.startsWith("/") || /^[A-Za-z]:/.test(reference)) {
      throw new Error(
        `资源引用必须是相对路径 (${sourceFile}): ${reference}`
      );
    }

    let pathname = reference;
    const query = pathname.indexOf("?");
    if (query >= 0) pathname = pathname.substring(0, query);
    const hash = pathname.indexOf("#");
    if (hash >= 0) pathname = pathname.substring(0, hash);
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new Error(`资源引用编码非法 (${sourceFile}): ${reference}`);
    }
    if (decoded.includes("\\") || decoded.split("/").some((part) => part === "..")) {
      throw new Error(`资源引用越界 (${sourceFile}): ${reference}`);
    }

    const resolved = path.resolve(path.dirname(sourceFile), decoded);
    if (!isContained(root, resolved)) {
      throw new Error(`资源引用越界 (${sourceFile}): ${reference}`);
    }
    if (!existsSync(resolved)) {
      throw new Error(`引用的资源不存在 (${sourceFile}): ${reference}`);
    }
    if (!statSync(resolved).isFile()) {
      throw new Error(`引用的资源不是文件 (${sourceFile}): ${reference}`);
    }
    if (statSync(resolved).size === 0) {
      throw new Error(`引用的资源为空 (${sourceFile}): ${reference}`);
    }

    const portable = toPortable(path.relative(root, resolved));
    discovered.add(portable);
    if (portable.endsWith(".html") || portable.endsWith(".css")) {
      queue.push(resolved);
    }
  };

  while (queue.length > 0) {
    const sourceFile = queue.shift();
    const portableSource = toPortable(path.relative(root, sourceFile));
    const text = readText(sourceFile);
    const regex = sourceFile.endsWith(".css") ? CSS_REF_RE : HTML_REF_RE;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      addReference(sourceFile.endsWith(".css") ? match[2] : match[1], sourceFile);
    }
  }

  return [...discovered].sort();
}

export function validateEditionMarker(markerFile, expected) {
  if (!existsSync(markerFile)) {
    throw new Error(`缺少 edition marker: ${markerFile}`);
  }
  let marker;
  try {
    marker = JSON.parse(readText(markerFile));
  } catch {
    throw new Error(`edition marker 不是有效 JSON: ${markerFile}`);
  }
  if (marker.format !== "fge-harmony" || marker.version !== 1) {
    throw new Error("edition marker 格式或版本不匹配");
  }
  if (marker.edition !== expected.edition) {
    throw new Error(
      `edition marker edition 不匹配: ${marker.edition} != ${expected.edition}`
    );
  }
  if (marker.bundleName !== expected.bundleName) {
    throw new Error(
      `edition marker bundleName 不匹配: ${marker.bundleName} != ${expected.bundleName}`
    );
  }
  if (expected.appName !== undefined && marker.appName !== expected.appName) {
    throw new Error(
      `edition marker appName 不匹配: ${marker.appName} != ${expected.appName}`
    );
  }
  return marker;
}

export function validateEditionProvenance(appRoot, rawEdition) {
  const { edition } = editionConfig(rawEdition);
  const file = path.join(appRoot, ".fge-build", `content-${edition}.json`);
  if (!existsSync(file)) {
    throw new Error(`缺少 ${edition} 题库构建追溯文件: ${file}`);
  }
  let record;
  try {
    record = JSON.parse(readText(file));
  } catch {
    throw new Error(`题库追溯文件不是有效 JSON: ${file}`);
  }
  if (record.schemaVersion !== 1) {
    throw new Error(`题库追溯 schemaVersion 不符: ${record.schemaVersion}`);
  }
  if (record.edition !== edition) {
    throw new Error(
      `题库追溯 edition 不符: ${record.edition} != ${edition}`
    );
  }
  if (record.contentRoot !== "@content") {
    throw new Error(
      `题库追溯 contentRoot 必须为 @content，实际为 ${JSON.stringify(record.contentRoot)}`
    );
  }
  if (
    !Array.isArray(record.watchedContentFiles) ||
    record.watchedContentFiles.length === 0
  ) {
    throw new Error("题库追溯 watchedContentFiles 必须非空");
  }
  for (const entry of record.watchedContentFiles) {
    if (typeof entry !== "string" || !entry.startsWith("@content/")) {
      throw new Error(`题库追溯路径不是相对 @content: ${String(entry)}`);
    }
    const parts = entry.substring("@content/".length).split("/");
    if (parts.some((part) => part === ".." || part === "")) {
      throw new Error(`题库追溯路径含 traversal 或空段: ${entry}`);
    }
    if (/^[A-Za-z]:/.test(entry) || entry.includes("\\")) {
      throw new Error(`题库追溯路径必须是 portable 相对路径: ${entry}`);
    }
  }
  return record;
}

export function assertTemplateClean(templateRoot) {
  const root = path.resolve(templateRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`鸿蒙模板目录不存在: ${root}`);
  }
  for (const file of walkFiles(root)) {
    const relative = toPortable(path.relative(root, file));
    const segments = relative.split("/");
    const basename = segments[segments.length - 1];
    const extension = path.extname(basename).toLowerCase();

    for (const segment of segments.slice(0, -1)) {
      if (FORBIDDEN_TEMPLATE_SEGMENTS.has(segment)) {
        throw new Error(`模板包含生成/依赖目录: ${relative}`);
      }
    }
    if (FORBIDDEN_TEMPLATE_SEGMENTS.has(basename)) {
      throw new Error(`模板包含生成/依赖目录: ${relative}`);
    }
    if (FORBIDDEN_TEMPLATE_FILES.has(basename)) {
      throw new Error(`模板包含本地配置或锁文件: ${relative}`);
    }
    if (FORBIDDEN_PACKAGE_EXTENSIONS.has(extension)) {
      throw new Error(`模板包含安装包或签名材料: ${relative}`);
    }
    if (segments.some((segment) => segment === "signing")) {
      throw new Error(`模板包含签名目录: ${relative}`);
    }
    if (
      TEXT_EXTENSIONS.has(extension) ||
      basename === ".gitignore" ||
      basename === "hvigorfile.ts"
    ) {
      if (MACHINE_PATH_RE.test(readText(file))) {
        throw new Error(`模板含机器绝对路径: ${relative}`);
      }
    }
  }
}

export function validateRawfileMirror(distDir, rawfileDir) {
  const distRoot = path.resolve(distDir);
  const rawRoot = path.resolve(rawfileDir);
  if (!existsSync(rawRoot)) {
    throw new Error(`rawfile 镜像目录不存在: ${rawRoot}`);
  }
  const expected = walkFiles(distRoot);
  const actual = walkFiles(rawRoot);
  const expectedMap = new Map(
    expected.map((file) => [toPortable(path.relative(distRoot, file)), file])
  );
  const actualMap = new Map(
    actual.map((file) => [toPortable(path.relative(rawRoot, file)), file])
  );

  for (const [relative, file] of expectedMap) {
    if (!actualMap.has(relative)) {
      throw new Error(`rawfile 缺少资源: ${relative}`);
    }
    if (statSync(file).size === 0) {
      throw new Error(`dist 资源为空: ${relative}`);
    }
    const mirrored = actualMap.get(relative);
    if (statSync(mirrored).size === 0) {
      throw new Error(`rawfile 资源为空: ${relative}`);
    }
    const expectedHash = createHash("sha256").update(readFileSync(file)).digest("hex");
    const actualHash = createHash("sha256").update(readFileSync(mirrored)).digest("hex");
    if (expectedHash !== actualHash) {
      throw new Error(`rawfile 资源内容不一致: ${relative}`);
    }
  }
  for (const [relative] of actualMap) {
    if (!expectedMap.has(relative)) {
      throw new Error(`rawfile 含多余资源: ${relative}`);
    }
  }
  let total = 0;
  for (const file of actual) total += statSync(file).size;
  if (total === 0) {
    throw new Error("rawfile 资源总大小为 0");
  }
  return { files: actual.length, bytes: total };
}

function replaceTokens(root, replacements) {
  for (const file of walkFiles(root)) {
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(file) !== "hvigorfile.ts") {
      continue;
    }
    let text = readText(file);
    let changed = false;
    for (const [token, value] of Object.entries(replacements)) {
      if (text.includes(token)) {
        text = text.split(token).join(value);
        changed = true;
      }
    }
    if (changed) writeFileSync(file, text, "utf8");
  }
}

function assertNoTokens(root, tokens) {
  for (const file of walkFiles(root)) {
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(file) !== "hvigorfile.ts") {
      continue;
    }
    const text = readText(file);
    for (const token of tokens) {
      if (text.includes(token)) {
        throw new Error(`生成工程仍含占位符 ${token}: ${file}`);
      }
    }
  }
}

function treeDigest(appRoot, relativeEntries) {
  const hash = createHash("sha256");
  for (const relative of relativeEntries) {
    const full = path.join(appRoot, relative);
    if (!existsSync(full)) continue;
    const stats = statSync(full);
    if (stats.isFile()) {
      hash.update(relative).update("\0").update(readFileSync(full));
      continue;
    }
    for (const file of walkFiles(full)) {
      hash.update(toPortable(path.relative(appRoot, file)))
        .update("\0")
        .update(readFileSync(file));
    }
  }
  return hash.digest("hex");
}

function runCommand(label, command, args, options) {
  let result;
  if (process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command)) {
    const quote = (value) => `"${value}"`;
    const line = [quote(command), ...args.map(quote)].join(" ");
    result = spawnSync(line, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: true,
      shell: true,
    });
  } else {
    result = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: true,
    });
  }
  if (result.error) {
    throw new Error(`${label} 无法执行: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${result.status ?? "unknown"}`);
  }
}

function acquireEditionLock(lockFile, edition) {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    const fd = openSync(lockFile, "wx");
    writeFileSync(fd, JSON.stringify({
      pid: process.pid,
      edition,
      startedAt: new Date().toISOString(),
    }), "utf8");
    closeSync(fd);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(
        `已有 ${edition} 鸿蒙构建在运行（锁文件 ${lockFile}）。` +
        "确认无并发进程后删除该锁文件再重试。"
      );
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      rmSync(lockFile, { force: true });
    } catch {
      // A leftover lock is safer than deleting an unrelated one.
    }
  };
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

function studioCandidates(env) {
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    env.DEVECO_STUDIO_HOME,
    path.join(programFiles, "Huawei", "DevEco Studio"),
    path.join(programFiles, "Huawei", "DevEco Studio 26.0"),
    path.join(programFiles, "Huawei", "DevEco Studio 25.0"),
    path.join(programFilesX86, "Huawei", "DevEco Studio"),
  ];
}

export function resolveToolchain(env = process.env) {
  const studioRoot = firstExisting(studioCandidates(env));
  if (!studioRoot) {
    throw new Error(
      "未找到 DevEco Studio。请设置 DEVECO_STUDIO_HOME 指向安装目录，" +
      "或安装到默认的 Program Files\\Huawei\\DevEco Studio。"
    );
  }

  const sdkRoot = path.resolve(env.DEVECO_SDK_HOME || path.join(studioRoot, "sdk"));
  const sdkPackage = path.join(sdkRoot, "default", "sdk-pkg.json");
  if (!existsSync(sdkPackage)) {
    throw new Error(
      `未找到 HarmonyOS SDK：${sdkPackage}。请设置 DEVECO_SDK_HOME 指向 SDK 根目录。`
    );
  }

  const nodeHome = path.resolve(env.NODE_HOME || path.join(studioRoot, "tools", "node"));
  const nodeExe = path.join(nodeHome, "node.exe");
  if (!existsSync(nodeExe)) {
    throw new Error(`未找到 Node：${nodeExe}。请设置 NODE_HOME。`);
  }

  const javaHome = path.resolve(env.JAVA_HOME || path.join(studioRoot, "jbr"));
  const javaExe = path.join(javaHome, "bin", "java.exe");
  if (!existsSync(javaExe)) {
    throw new Error(`未找到 Java：${javaExe}。请设置 JAVA_HOME。`);
  }

  const hvigor = path.resolve(
    env.HVIGOR_BIN || path.join(studioRoot, "tools", "hvigor", "bin", "hvigorw.bat")
  );
  if (!existsSync(hvigor)) {
    throw new Error(`未找到 Hvigor：${hvigor}。请设置 HVIGOR_BIN。`);
  }

  const ohpm = path.resolve(
    env.OHPM_BIN || path.join(studioRoot, "tools", "ohpm", "bin", "ohpm.bat")
  );
  if (!existsSync(ohpm)) {
    throw new Error(`未找到 OHPM：${ohpm}。请设置 OHPM_BIN。`);
  }

  const processEnv = {
    ...env,
    DEVECO_SDK_HOME: sdkRoot,
    NODE_HOME: nodeHome,
    JAVA_HOME: javaHome,
    PATH: [
      path.join(javaHome, "bin"),
      nodeHome,
      env.PATH || "",
    ].filter(Boolean).join(path.delimiter),
  };

  return {
    studioRoot,
    sdkRoot,
    nodeHome,
    javaHome,
    hvigor,
    ohpm,
    env: processEnv,
  };
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function countFiles(root) {
  return walkFiles(root).length;
}

/**
 * Build one edition. Throws before producing a HAP when any validation fails.
 */
export function buildHarmony(rawEdition, options = {}) {
  const config = editionConfig(rawEdition);
  const appRoot = path.resolve(options.appRoot ?? APP_ROOT);
  const templateRoot = path.resolve(options.templateRoot ?? path.join(appRoot, "harmony"));
  const buildRoot = path.join(appRoot, ".fge-build", "harmony", config.edition);
  const projectDir = path.join(buildRoot, "project");
  const webDistDir = path.join(buildRoot, "web-dist");
  const provenanceSnapshot = path.join(buildRoot, "provenance.json");
  const rawfileWeb = path.join(
    projectDir,
    "entry",
    "src",
    "main",
    "resources",
    "rawfile",
    "web"
  );
  const markerFile = path.join(
    projectDir,
    "entry",
    "src",
    "main",
    "resources",
    "rawfile",
    "fge-edition.json"
  );
  const lockFile = path.join(buildRoot, ".build.lock");

  const toolchain = options.toolchain ?? resolveToolchain(options.env ?? process.env);
  const runCommandFn = options.runCommand ?? runCommand;
  assertTemplateClean(templateRoot);

  const releaseLock = acquireEditionLock(lockFile, config.edition);
  try {
    const sourceEntries = [
      "src",
      "index.html",
      "vite.config.ts",
      "build",
      "scripts/edition.mjs",
      "tsconfig.json",
      "tsconfig.tools.json",
    ];
    const sourceDigestBefore = treeDigest(appRoot, sourceEntries);

    rmSync(webDistDir, { recursive: true, force: true });
    rmSync(provenanceSnapshot, { force: true });
    const runMode = path.join(appRoot, "scripts", "run-mode.mjs");
    console.log(
      `[harmony] edition=${config.edition} vite build -> ${webDistDir}`
    );
    runCommandFn(
      "Vite build",
      process.execPath,
      [
        runMode,
        "build",
        config.edition,
        "--base=./",
        "--outDir",
        webDistDir,
      ],
      { cwd: appRoot, env: { ...toolchain.env, FGE_EDITION: config.edition } }
    );

    const sourceDigestAfter = treeDigest(appRoot, sourceEntries);
    if (sourceDigestBefore !== sourceDigestAfter) {
      throw new Error(
        "源码在 Vite 构建期间发生变化，生成的 dist 可能混合版本；请等源码写入完成后重试。"
      );
    }

    const provenance = validateEditionProvenance(appRoot, config.edition);
    // Snapshot the validated provenance inside this edition's locked build
    // root. Later npm/apk builds may overwrite .fge-build/content-*.json.
    writeFileSync(
      provenanceSnapshot,
      `${JSON.stringify(provenance, null, 2)}\n`,
      "utf8"
    );
    const referenced = validateReferencedAssets(webDistDir);
    console.log(`[harmony] stage references ${referenced.length} non-empty files`);

    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(projectDir, { recursive: true });
    cpSync(templateRoot, projectDir, { recursive: true });
    assertTemplateClean(projectDir);

    replaceTokens(projectDir, {
      __FGE_BUNDLE_NAME__: config.bundleName,
      __FGE_APP_NAME__: config.appName,
    });
    assertNoTokens(projectDir, ["__FGE_BUNDLE_NAME__", "__FGE_APP_NAME__"]);

    mkdirSync(path.dirname(rawfileWeb), { recursive: true });
    cpSync(webDistDir, rawfileWeb, { recursive: true });
    const rawfileReferenced = validateReferencedAssets(rawfileWeb);
    if (rawfileReferenced.join("\n") !== referenced.join("\n")) {
      throw new Error("rawfile/web 的引用资源与构建 stage 不一致");
    }
    const mirror = validateRawfileMirror(webDistDir, rawfileWeb);

    const marker = {
      format: "fge-harmony",
      version: 1,
      edition: config.edition,
      bundleName: config.bundleName,
      appName: config.appName,
      builtAt: new Date().toISOString(),
      dist: {
        files: mirror.files,
        bytes: mirror.bytes,
        referencedFiles: referenced.length,
      },
      provenance: {
        sha256: sha256File(provenanceSnapshot),
        watchedFiles: provenance.watchedContentFiles.length,
      },
    };
    writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    validateEditionMarker(markerFile, config);
    if (existsSync(path.join(projectDir, ".fge-build"))) {
      throw new Error("生成工程混入了 .fge-build 追溯目录");
    }

    console.log(`[harmony] ohpm install (${config.edition})`);
    runCommandFn("OHPM install", toolchain.ohpm, ["install", "--all"], {
      cwd: projectDir,
      env: toolchain.env,
    });

    console.log(`[harmony] hvigor assembleHap (${config.edition}, debug, unsigned)`);
    runCommandFn(
      "Hvigor assembleHap",
      toolchain.hvigor,
      [
        "--mode", "module",
        "-p", "product=default",
        "-p", "module=entry@default",
        "-p", "buildMode=debug",
        "assembleHap",
        "--no-daemon",
      ],
      { cwd: projectDir, env: toolchain.env }
    );

    const hap = path.join(
      projectDir,
      "entry",
      "build",
      "default",
      "outputs",
      "default",
      "entry-default-unsigned.hap"
    );
    if (!existsSync(hap) || statSync(hap).size === 0) {
      throw new Error(`未生成非空 HAP: ${hap}`);
    }

    return {
      edition: config.edition,
      bundleName: config.bundleName,
      appName: config.appName,
      projectDir,
      webDistDir,
      rawfileDir: rawfileWeb,
      provenanceSnapshot,
      hap,
      hapBytes: statSync(hap).size,
      hapSha256: sha256File(hap),
      sourceDigest: sourceDigestBefore,
      provenance: {
        watchedFiles: provenance.watchedContentFiles.length,
        sha256: marker.provenance.sha256,
      },
      dist: marker.dist,
    };
  } finally {
    releaseLock();
  }
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = buildHarmony(argv[0]);
    console.log("");
    console.log("HarmonyOS local build complete");
    console.log(`  edition:     ${result.edition}`);
    console.log(`  bundleName:  ${result.bundleName}`);
    console.log(`  appName:     ${result.appName}`);
    console.log(`  project:     ${result.projectDir}`);
    console.log(
      `  web stage:   ${result.webDistDir} (${result.dist.files} files)`
    );
    console.log(`  rawfile:     ${result.rawfileDir}`);
    console.log(`  provenance:  ${result.provenance.watchedFiles} content files`);
    console.log(`  HAP:         ${result.hap}`);
    console.log(`  HAP bytes:   ${result.hapBytes}`);
    console.log(`  HAP sha256:  ${result.hapSha256}`);
    console.log("  signing:     none (local unsigned debug HAP only)");
    return 0;
  } catch (error) {
    console.error(`[harmony] build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = main();
}
