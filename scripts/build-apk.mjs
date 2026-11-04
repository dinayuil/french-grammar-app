#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class PackagingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PackagingError';
  }
}

export const EDITIONS = Object.freeze({
  public: Object.freeze({
    appId: 'com.fge.open',
    appName: '法语语法练习',
    webDir: 'dist/public',
    gradleTask: 'assemblePublicDebug',
    apkPath: path.join(
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'public',
      'debug',
      'app-public-debug.apk',
    ),
  }),
  internal: Object.freeze({
    appId: 'com.fge.app',
    appName: '法语语法练习·内部版',
    webDir: 'dist/internal',
    gradleTask: 'assembleInternalDebug',
    apkPath: path.join(
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'internal',
      'debug',
      'app-internal-debug.apk',
    ),
  }),
});

const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYNC_MARKER = 'fge-edition.json';
const LOCK_RELATIVE = path.join('android', '.fge-apk.lock');

function requireExplicitEdition(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new PackagingError(
      'APK packaging requires an explicit edition: "public" or "internal". Pass it from the packaging command; there is no default and stale assets are never reused.',
    );
  }
  return raw;
}

async function loadSharedEditionModule() {
  return import('./edition.mjs');
}

/**
 * Resolve the packaging edition through the Task 3 resolver.
 * The loader is injectable only for focused tests; production always loads
 * scripts/edition.mjs.
 */
export async function resolvePackagingEdition(
  raw,
  load = loadSharedEditionModule,
) {
  const requested = requireExplicitEdition(raw);
  let shared;
  try {
    shared = await load();
  } catch (error) {
    throw new PackagingError(
      `Cannot load the shared edition resolver scripts/edition.mjs: ${error.message}`,
      { cause: error },
    );
  }
  if (typeof shared.resolveEdition !== 'function') {
    throw new PackagingError(
      'scripts/edition.mjs must export resolveEdition(raw) for packaging.',
    );
  }

  const resolved = shared.resolveEdition(requested);
  if (resolved !== requested) {
    throw new PackagingError(
      `Shared edition resolver returned "${resolved}" for explicit edition "${requested}"; the selected edition does not match.`,
    );
  }
  if (!Object.hasOwn(EDITIONS, resolved)) {
    throw new PackagingError(
      `Unsupported packaging edition ${JSON.stringify(resolved)}. Expected "public" or "internal".`,
    );
  }
  return resolved;
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: options.shell ?? false,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit ${code}`;
      reject(
        new PackagingError(
          `Command failed (${reason}): ${command} ${args.join(' ')}`,
        ),
      );
    });
  });
}

async function acquirePackagingLock(projectRoot, edition) {
  const lockPath = path.join(projectRoot, LOCK_RELATIVE);
  if (!existsSync(path.dirname(lockPath))) {
    throw new PackagingError(
      `Android project not found at ${path.dirname(lockPath)}.`,
    );
  }

  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      let owner = '';
      try {
        owner = (await readFile(lockPath, 'utf8')).trim();
      } catch {
        owner = '<unreadable lock file>';
      }
      throw new PackagingError(
        `APK packaging lock is already held: ${lockPath}\n${owner}\nWait for the active packaging or Gradle run to finish. If no build is running, inspect the process and delete the lock file manually; never delete it while assets are being synchronized.`,
        { cause: error },
      );
    }
    throw error;
  }

  const lock = {
    path: lockPath,
    token: `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };

  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pid: process.pid,
          edition,
          token: lock.token,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
    throw error;
  }

  await handle.close();
  return lock;
}

async function releasePackagingLock(lock) {
  try {
    const data = JSON.parse(await readFile(lock.path, 'utf8'));
    if (data.token !== lock.token) return;
  } catch {
    // A missing lock is already released.
  }
  await rm(lock.path, { force: true });
}

function stageEnvironment(edition) {
  return { ...process.env, FGE_EDITION: edition };
}

function gradleInvocation(projectRoot, edition, platform = process.platform) {
  const wrapper = path.join(
    projectRoot,
    'android',
    platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  if (!existsSync(wrapper)) {
    throw new PackagingError(`Gradle wrapper not found: ${wrapper}`);
  }
  return {
    command: platform === 'win32' ? `"${wrapper}"` : wrapper,
    args: [EDITIONS[edition].gradleTask],
    shell: platform === 'win32',
  };
}

async function readJsonFile(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new PackagingError(
      `${label} is missing or invalid: ${file}\n${error.message}`,
      { cause: error },
    );
  }
}

/**
 * Verify that cap sync wrote exactly the selected edition before Gradle runs.
 */
export async function validateSynchronizedEdition(projectRoot, edition) {
  const identity = EDITIONS[edition];
  if (!identity) {
    throw new PackagingError(
      `Unsupported synchronized edition ${JSON.stringify(edition)}.`,
    );
  }

  const assetsDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'assets',
  );
  const indexFile = path.join(assetsDir, 'public', 'index.html');
  const markerFile = path.join(assetsDir, 'public', SYNC_MARKER);
  const configFile = path.join(assetsDir, 'capacitor.config.json');

  if (!existsSync(indexFile)) {
    throw new PackagingError(
      `Synchronized web assets are missing index.html: ${indexFile}. Cap sync did not copy the ${edition} build.`,
    );
  }

  const marker = await readJsonFile(
    markerFile,
    `Synchronized web marker for ${edition}`,
  );
  if (
    marker.edition !== edition ||
    marker.appId !== identity.appId ||
    marker.appName !== identity.appName ||
    marker.webDir !== identity.webDir
  ) {
    throw new PackagingError(
      `Synchronized web marker does not match the ${edition} edition (marker edition=${marker.edition}, appId=${marker.appId}, webDir=${marker.webDir}). Refusing to assemble stale assets.`,
    );
  }

  const capConfig = await readJsonFile(
    configFile,
    `Synchronized Capacitor config for ${edition}`,
  );
  if (
    capConfig.appId !== identity.appId ||
    capConfig.appName !== identity.appName ||
    capConfig.webDir !== identity.webDir
  ) {
    throw new PackagingError(
      `Synchronized Capacitor config does not match the ${edition} edition (appId=${capConfig.appId}, appName=${capConfig.appName}, webDir=${capConfig.webDir}). Refusing to assemble stale assets.`,
    );
  }
  if (Object.hasOwn(capConfig, 'server')) {
    throw new PackagingError(
      'Synchronized Capacitor config contains a server block. WebView origin and loading behavior must stay unchanged.',
    );
  }

  return { marker, capConfig };
}

function markerFor(edition) {
  const identity = EDITIONS[edition];
  return {
    schemaVersion: 1,
    edition,
    appId: identity.appId,
    appName: identity.appName,
    webDir: identity.webDir,
  };
}

function capCliPath(projectRoot) {
  return path.join(
    projectRoot,
    'node_modules',
    '@capacitor',
    'cli',
    'bin',
    'capacitor',
  );
}

/**
 * Serial packaging:
 * web build -> cap sync -> validate synchronized edition -> selected Gradle flavor.
 * Any failure rejects immediately; there is no fallback edition.
 */
export async function packageApk({
  rawEdition,
  projectRoot = DEFAULT_PROJECT_ROOT,
  resolveEdition = resolvePackagingEdition,
  runCommand: run = runCommand,
  log = console.log,
} = {}) {
  const requested = requireExplicitEdition(rawEdition);
  const edition = await resolveEdition(requested);
  if (edition !== requested || !Object.hasOwn(EDITIONS, edition)) {
    throw new PackagingError(
      `Edition resolver returned ${JSON.stringify(edition)} for explicit edition ${JSON.stringify(requested)}; refusing to continue.`,
    );
  }

  const identity = EDITIONS[edition];
  const distDir = path.join(projectRoot, identity.webDir);
  const markerFile = path.join(distDir, SYNC_MARKER);
  const env = stageEnvironment(edition);
  const lock = await acquirePackagingLock(projectRoot, edition);

  try {
    // Never let a marker from an earlier run vouch for a failed build.
    await rm(markerFile, { force: true });

    log(`[apk] web build (${edition})`);
    await run(
      process.execPath,
      [path.join(projectRoot, 'scripts', 'run-mode.mjs'), 'build', edition],
      { cwd: projectRoot, env },
    );

    if (!existsSync(path.join(distDir, 'index.html'))) {
      throw new PackagingError(
        `Web build did not produce ${path.join(distDir, 'index.html')} for ${edition}.`,
      );
    }
    await mkdir(distDir, { recursive: true });
    await writeFile(
      markerFile,
      `${JSON.stringify(markerFor(edition), null, 2)}\n`,
      'utf8',
    );

    log(`[apk] cap sync android (${edition})`);
    await run(process.execPath, [capCliPath(projectRoot), 'sync', 'android'], {
      cwd: projectRoot,
      env,
    });

    await validateSynchronizedEdition(projectRoot, edition);

    log(`[apk] ${identity.gradleTask} (${edition})`);
    const gradle = gradleInvocation(projectRoot, edition);
    await run(gradle.command, gradle.args, {
      cwd: path.join(projectRoot, 'android'),
      env,
      shell: gradle.shell,
    });

    const apkPath = path.join(projectRoot, identity.apkPath);
    if (!existsSync(apkPath)) {
      throw new PackagingError(
        `APK not found at expected path: ${apkPath}. Gradle ${identity.gradleTask} finished without the expected artifact.`,
      );
    }

    log(`[apk] ${edition} APK ready: ${apkPath}`);
    return {
      edition,
      appId: identity.appId,
      appName: identity.appName,
      webDir: identity.webDir,
      gradleTask: identity.gradleTask,
      distDir,
      apkPath,
    };
  } finally {
    await releasePackagingLock(lock);
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  packageApk({ rawEdition: process.argv[2] }).catch((error) => {
    console.error(`[apk] ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
