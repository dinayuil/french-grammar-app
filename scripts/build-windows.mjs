/**
 * Build unsigned Windows Tauri 2 / WebView2 installers for one edition.
 *
 * The checked-in source lives in `src-tauri/`; generated web assets, Cargo
 * target files and NSIS packages stay under `.fge-build/windows/<edition>/`
 * so the Windows lane never reads or writes `dist/public` or `dist/internal`.
 *
 * Two installers are produced from the same compiled binary and the same app
 * identity: a standard NSIS package that downloads the WebView2 bootstrapper
 * when needed, and a full package embedding the offline WebView2 installer.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveEdition } from "./edition.mjs";

export const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const WINDOWS_BUILD_ROOT = path.join(APP_ROOT, ".fge-build", "windows");

export const WINDOWS_EDITIONS = Object.freeze({
  public: {
    identifier: "com.fge.open",
    productName: "法语语法练习",
    webFolder: "public",
  },
  internal: {
    identifier: "com.fge.app",
    productName: "法语语法练习·内部版",
    webFolder: "internal",
  },
});

const TAURI_CLI = path.join(APP_ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
const TAURI_SOURCE = "src-tauri";
const MIN_OFFLINE_BYTES = 40 * 1024 * 1024;

// Both NSIS variants are written to the same path, so each must be copied out
// immediately after its bundle step, before the next variant overwrites it.
export const PACKAGE_AFTER_STEP = Object.freeze({
  "bundle-standard": "standard",
  "bundle-offline": "offline",
});

export function windowsEditionIdentity(rawEdition) {
  const edition = resolveEdition(rawEdition);
  return { edition, ...WINDOWS_EDITIONS[edition] };
}

export function windowsEditionPaths(appRoot, rawEdition) {
  const { edition } = windowsEditionIdentity(rawEdition);
  const root = path.join(path.resolve(appRoot), ".fge-build", "windows", edition);
  return {
    edition,
    root,
    web: path.join(root, "web"),
    target: path.join(root, "target"),
    packages: path.join(root, "packages"),
    marker: path.join(root, "build.json"),
  };
}

function toPortable(relative) {
  return relative.split(path.sep).join("/");
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertInsideBuildRoot(appRoot, target) {
  const buildRoot = path.resolve(appRoot, ".fge-build", "windows");
  if (!isContained(buildRoot, target)) {
    throw new Error(`拒绝清理 Windows 输出目录之外的路径: ${target}`);
  }
}

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`缺少${label}: ${file}`);
  }
}

function readJson(file, label) {
  requireFile(file, label);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label}不是有效 JSON: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function resolveCargoBin(env = process.env) {
  const candidates = [];
  if (env.CARGO) candidates.push(env.CARGO);
  if (env.CARGO_HOME) candidates.push(path.join(env.CARGO_HOME, "bin", "cargo.exe"));
  if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, ".cargo", "bin", "cargo.exe"));
  if (env.HOME) candidates.push(path.join(env.HOME, ".cargo", "bin", "cargo"));
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }
  // A PATH-resolved cargo is valid when it is not in a conventional location.
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["cargo"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) return first;
  }
  throw new Error(
    "未找到 Rust 工具链 cargo。请安装 rustup 的稳定 MSVC 工具链，" +
      "或设置 CARGO_HOME / CARGO 指向 cargo。"
  );
}

export function createWindowsPlan(appRoot, rawEdition, options = {}) {
  const identity = windowsEditionIdentity(rawEdition);
  const paths = windowsEditionPaths(appRoot, identity.edition);
  const env = { ...(options.env ?? process.env) };
  const cargoBin = options.cargoBin ?? resolveCargoBin(env);
  const nodePath = options.nodePath ?? process.execPath;
  const tauriCli = options.tauriCli ?? path.join(path.resolve(appRoot), "node_modules", "@tauri-apps", "cli", "tauri.js");
  const basePath = env.PATH ?? env.Path ?? "";
  const stepEnv = {
    ...env,
    FGE_EDITION: identity.edition,
    CARGO_TARGET_DIR: paths.target,
    PATH: basePath
      ? `${path.dirname(cargoBin)}${path.delimiter}${basePath}`
      : path.dirname(cargoBin),
  };

  const editionConfig = `${TAURI_SOURCE}/tauri.${identity.edition}.conf.json`;
  const webOut = toPortable(path.relative(path.resolve(appRoot), paths.web));

  const steps = [
    {
      label: "typecheck",
      bin: nodePath,
      args: [path.join(appRoot, "node_modules", "typescript", "bin", "tsc")],
    },
    {
      label: "typecheck-tools",
      bin: nodePath,
      args: [
        path.join(appRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.tools.json",
      ],
    },
    {
      label: "frontend",
      bin: nodePath,
      args: [
        path.join(appRoot, "node_modules", "vite", "bin", "vite.js"),
        "build",
        "--outDir",
        webOut,
        "--emptyOutDir",
      ],
    },
    {
      label: "compile",
      bin: nodePath,
      args: [tauriCli, "build", "--config", editionConfig, "--no-bundle", "--ci"],
    },
    {
      label: "bundle-standard",
      bin: nodePath,
      args: [
        tauriCli,
        "bundle",
        "--bundles",
        "nsis",
        "--config",
        editionConfig,
        "--config",
        `${TAURI_SOURCE}/tauri.installer-standard.conf.json`,
        "--ci",
      ],
    },
    {
      label: "bundle-offline",
      bin: nodePath,
      args: [
        tauriCli,
        "bundle",
        "--bundles",
        "nsis",
        "--config",
        editionConfig,
        "--config",
        `${TAURI_SOURCE}/tauri.installer-offline.conf.json`,
        "--ci",
      ],
    },
  ].map((step) => ({ ...step, env: stepEnv }));

  return { edition: identity.edition, identity, paths, env: stepEnv, steps };
}

export async function validateWebPayload(webDir) {
  const root = path.resolve(webDir);
  const index = path.join(root, "index.html");
  let indexStats;
  try {
    indexStats = await lstat(index);
  } catch {
    throw new Error(`Windows 前端缺少 index.html: ${index}`);
  }
  if (!indexStats.isFile() || indexStats.size === 0) {
    throw new Error(`Windows 前端 index.html 为空或不是普通文件: ${index}`);
  }

  let files = 0;
  let bytes = 0;
  async function visit(dir) {
    const entries = await readdir(dir);
    for (const name of entries.sort()) {
      const full = path.join(dir, name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) {
        throw new Error(`Windows 前端含符号链接/联接: ${toPortable(path.relative(root, full))}`);
      }
      if (stats.isDirectory()) {
        await visit(full);
      } else if (stats.isFile()) {
        if (stats.size === 0) {
          throw new Error(`Windows 前端含空文件: ${toPortable(path.relative(root, full))}`);
        }
        files += 1;
        bytes += stats.size;
      } else {
        throw new Error(`Windows 前端含不支持的条目: ${toPortable(path.relative(root, full))}`);
      }
    }
  }
  await visit(root);
  return { files, bytes };
}

export async function writeBuildMarker(appRoot, rawEdition) {
  const identity = windowsEditionIdentity(rawEdition);
  const paths = windowsEditionPaths(appRoot, identity.edition);
  await mkdir(paths.root, { recursive: true });
  const marker = {
    format: "fge-windows",
    version: 1,
    edition: identity.edition,
    identifier: identity.identifier,
    productName: identity.productName,
    webDir: toPortable(path.relative(path.resolve(appRoot), paths.web)),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(paths.marker, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

export function validateBuildMarker(appRoot, rawEdition) {
  const identity = windowsEditionIdentity(rawEdition);
  const paths = windowsEditionPaths(appRoot, identity.edition);
  const marker = readJson(paths.marker, "Windows 构建 marker");
  if (marker.format !== "fge-windows" || marker.version !== 1) {
    throw new Error("Windows 构建 marker 格式或版本不匹配");
  }
  if (marker.edition !== identity.edition) {
    throw new Error(
      `Windows 构建 marker edition 不匹配: ${marker.edition} != ${identity.edition}`
    );
  }
  if (marker.identifier !== identity.identifier) {
    throw new Error(
      `Windows 构建 marker identifier 不匹配: ${marker.identifier} != ${identity.identifier}`
    );
  }
  if (marker.productName !== identity.productName) {
    throw new Error(
      `Windows 构建 marker productName 不匹配: ${marker.productName} != ${identity.productName}`
    );
  }
  const expectedWeb = toPortable(path.relative(path.resolve(appRoot), paths.web));
  if (marker.webDir !== expectedWeb) {
    throw new Error(
      `Windows 构建 marker webDir 不匹配: ${marker.webDir} != ${expectedWeb}`
    );
  }
  return marker;
}

export async function validateEditionProvenance(appRoot, rawEdition) {
  const { edition } = windowsEditionIdentity(rawEdition);
  const file = path.join(path.resolve(appRoot), ".fge-build", `content-${edition}.json`);
  const record = readJson(file, `${edition} 题库构建追溯文件`);
  if (record.schemaVersion !== 1 || record.edition !== edition) {
    throw new Error(`题库构建追溯文件与 ${edition} edition 不匹配`);
  }
  if (record.contentRoot !== "@content") {
    throw new Error("题库构建追溯文件 contentRoot 必须为 @content");
  }
  if (!Array.isArray(record.watchedContentFiles) || record.watchedContentFiles.length === 0) {
    throw new Error("题库构建追溯文件 watchedContentFiles 必须非空");
  }
  return record;
}

async function readJsonFile(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label}读取失败: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertIdentifier(identity, config, edition) {
  if (config.identifier !== identity.identifier) {
    throw new Error(
      `${edition} Tauri identifier 不匹配: ${String(config.identifier)} != ${identity.identifier}`
    );
  }
  if (config.productName !== identity.productName) {
    throw new Error(
      `${edition} Tauri productName 不匹配: ${String(config.productName)} != ${identity.productName}`
    );
  }
}

export async function validateWindowsConfigs(appRoot) {
  const root = path.resolve(appRoot);
  const source = path.join(root, TAURI_SOURCE);
  const base = await readJsonFile(path.join(source, "tauri.conf.json"), "Tauri 基础配置");
  const result = {};

  for (const edition of ["public", "internal"]) {
    const identity = WINDOWS_EDITIONS[edition];
    const config = await readJsonFile(
      path.join(source, `tauri.${edition}.conf.json`),
      `${edition} Tauri 配置`
    );
    assertIdentifier(identity, config, edition);
    const frontendDist = config.build?.frontendDist;
    if (typeof frontendDist !== "string" || frontendDist.trim() === "") {
      throw new Error(`${edition} Tauri 配置缺少 build.frontendDist`);
    }
    const webDir = path.resolve(source, frontendDist);
    const expected = windowsEditionPaths(root, edition).web;
    if (webDir !== expected) {
      throw new Error(
        `${edition} Tauri frontendDist 必须指向独立输出 ${expected}，实际为 ${webDir}`
      );
    }
    if (webDir === path.join(root, "dist") || webDir.startsWith(`${path.join(root, "dist")}${path.sep}`)) {
      throw new Error(`${edition} Tauri 前端输出不得使用 dist/: ${webDir}`);
    }
    result[edition] = {
      identifier: identity.identifier,
      productName: identity.productName,
      webDir,
    };
  }

  if (result.public.identifier === result.internal.identifier) {
    throw new Error("公开版与内部版不得共享 Tauri identifier");
  }
  if (result.public.webDir === result.internal.webDir) {
    throw new Error("公开版与内部版不得共享前端输出目录");
  }

  const targets = base.bundle?.targets;
  if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== "nsis") {
    throw new Error('Tauri 基础配置 bundle.targets 必须只包含 "nsis"');
  }
  if (base.bundle?.active !== true) {
    throw new Error("Tauri bundle.active 必须为 true");
  }
  const icons = base.bundle?.icon;
  if (!Array.isArray(icons) || icons.length !== 1 || icons[0] !== "icons/icon.ico") {
    throw new Error('Tauri bundle.icon 必须只包含 "icons/icon.ico"');
  }

  const standard = await readJsonFile(
    path.join(source, "tauri.installer-standard.conf.json"),
    "标准安装包配置"
  );
  const offline = await readJsonFile(
    path.join(source, "tauri.installer-offline.conf.json"),
    "离线安装包配置"
  );
  const standardMode = standard.bundle?.windows?.webviewInstallMode?.type;
  const offlineMode = offline.bundle?.windows?.webviewInstallMode?.type;
  if (standardMode !== "downloadBootstrapper") {
    throw new Error(`标准安装包必须使用 downloadBootstrapper，实际为 ${String(standardMode)}`);
  }
  if (offlineMode !== "offlineInstaller") {
    throw new Error(`完整安装包必须使用 offlineInstaller，实际为 ${String(offlineMode)}`);
  }

  const capabilities = await readJsonFile(
    path.join(source, "capabilities", "main.json"),
    "Tauri capability 配置"
  );
  if (!Array.isArray(capabilities.permissions)) {
    throw new Error("Tauri capability permissions 必须是数组");
  }
  for (const permission of capabilities.permissions) {
    if (typeof permission !== "string") {
      throw new Error("Tauri capability 只允许字符串权限");
    }
  }
  if (base.app?.withGlobalTauri === true) {
    throw new Error("Tauri 不得把全局 API 注入 WebView");
  }
  const csp = base.app?.security?.csp;
  if (typeof csp !== "string" || csp.trim() === "") {
    throw new Error("Tauri CSP 不得关闭");
  }

  return {
    ...result,
    bundleTargets: targets,
    webviewInstallModes: { standard: standardMode, offline: offlineMode },
    withGlobalTauri: base.app?.withGlobalTauri === true,
    csp,
    permissions: capabilities.permissions,
    icons,
  };
}

export async function selectInstaller(nsisDir, variant) {
  const dir = path.resolve(nsisDir);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const matches = [];
  for (const name of names.sort()) {
    if (!/-setup\.exe$/i.test(name)) continue;
    const full = path.join(dir, name);
    const stats = await lstat(full);
    if (stats.isFile()) matches.push(full);
  }
  if (matches.length > 1) {
    throw new Error(`NSIS ${variant} 输出含多个 setup.exe，无法确定安装包: ${matches.join(", ")}`);
  }
  return matches[0] ?? null;
}

export function validatePackageSet(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("安装包记录必须是数组");
  const byVariant = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") throw new Error("安装包记录无效");
    if (record.variant !== "standard" && record.variant !== "offline") {
      throw new Error(`未知安装包类型: ${String(record.variant)}`);
    }
    if (byVariant.has(record.variant)) {
      throw new Error(`重复的 ${record.variant} 安装包记录`);
    }
    if (typeof record.path !== "string" || record.path.trim() === "") {
      throw new Error(`${record.variant} 安装包路径为空`);
    }
    if (!Number.isSafeInteger(record.size) || record.size <= 0) {
      throw new Error(`${record.variant} 安装包大小无效`);
    }
    if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error(`${record.variant} 安装包 sha256 无效`);
    }
    byVariant.set(record.variant, record);
  }
  const standard = byVariant.get("standard");
  const offline = byVariant.get("offline");
  if (!standard || !offline) {
    throw new Error("必须同时存在 standard 与 offline 安装包");
  }
  const minOfflineBytes = options.minOfflineBytes ?? 0;
  if (minOfflineBytes > 0 && offline.size < minOfflineBytes) {
    throw new Error(
      `offline 安装包大小 ${offline.size} 小于完整 WebView2 安装包下限 ${minOfflineBytes}`
    );
  }
  if (standard.size >= offline.size) {
    throw new Error(
      `standard 安装包不应不小于 offline 安装包（${standard.size} >= ${offline.size}）`
    );
  }
  return { standard, offline };
}

function runStep(step, appRoot) {
  const result = spawnSync(step.bin, step.args, {
    cwd: appRoot,
    env: step.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${step.label} 无法执行: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${step.label} 失败，退出码 ${result.status ?? "unknown"}`);
  }
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function packageVariant(appRoot, edition, variant, label) {
  const paths = windowsEditionPaths(appRoot, edition);
  const nsisDir = path.join(paths.target, "release", "bundle", "nsis");
  const installer = await selectInstaller(nsisDir, variant);
  if (!installer) {
    throw new Error(`${label} 未生成 NSIS 安装包: ${nsisDir}`);
  }
  await mkdir(paths.packages, { recursive: true });
  const destination = path.join(
    paths.packages,
    `fge-windows-${edition}-${variant}-setup.exe`
  );
  await copyFile(installer, destination);
  const size = statSync(destination).size;
  const sha256 = hashFile(destination);
  return { variant, path: path.relative(appRoot, destination).split(path.sep).join("/"), size, sha256 };
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const [rawEdition] = argv;
  if (!rawEdition) {
    console.error("用法: node scripts/build-windows.mjs <public|internal>");
    return 1;
  }

  try {
    const plan = createWindowsPlan(APP_ROOT, rawEdition, options);
    const paths = plan.paths;
    assertInsideBuildRoot(APP_ROOT, paths.root);
    // Keep the per-edition Cargo target for fast incremental builds; only
    // generated web assets, markers and packages are rebuilt from scratch.
    for (const generated of [paths.web, paths.packages, paths.marker]) {
      rmSync(generated, { recursive: true, force: true });
    }
    mkdirSync(paths.root, { recursive: true });

    console.log(`[fge] windows build edition=${plan.edition} identifier=${plan.identity.identifier}`);
    const configs = await validateWindowsConfigs(APP_ROOT);
    const identity = windowsEditionIdentity(plan.edition);
    assertIdentifier(identity, {
      identifier: configs[plan.edition].identifier,
      productName: configs[plan.edition].productName,
    }, plan.edition);

    const records = [];
    for (const step of plan.steps) {
      console.log(`[fge] ${step.label}`);
      runStep(step, APP_ROOT);
      if (step.label === "frontend") {
        await validateEditionProvenance(APP_ROOT, plan.edition);
        const web = await validateWebPayload(paths.web);
        console.log(`[fge] web ${web.files} files, ${web.bytes} bytes`);
        await writeBuildMarker(APP_ROOT, plan.edition);
        validateBuildMarker(APP_ROOT, plan.edition);
      }
      // Tauri writes both variants to the same filename, so copy each one
      // immediately after its bundle step, before the next variant overwrites it.
      const variant = PACKAGE_AFTER_STEP[step.label];
      if (variant === "standard") {
        records.push(await packageVariant(APP_ROOT, plan.edition, "standard", "标准安装包"));
      }
      if (variant === "offline") {
        records.push(await packageVariant(APP_ROOT, plan.edition, "offline", "完整离线安装包"));
      }
    }

    const packages = validatePackageSet(records, { minOfflineBytes: MIN_OFFLINE_BYTES });

    const manifest = {
      format: "fge-windows-packages",
      version: 1,
      edition: plan.edition,
      identifier: plan.identity.identifier,
      productName: plan.identity.productName,
      webviewInstallModes: configs.webviewInstallModes,
      generatedAt: new Date().toISOString(),
      packages: [packages.standard, packages.offline],
    };
    const manifestFile = path.join(paths.packages, "manifest.json");
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    for (const record of manifest.packages) {
      console.log(
        `[fge] ${record.variant}: ${record.path} (${record.size} bytes) sha256=${record.sha256}`
      );
    }
    console.log(`[fge] manifest: ${path.relative(APP_ROOT, manifestFile)}`);
    return 0;
  } catch (error) {
    console.error(`[fge] windows build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await main();
}
