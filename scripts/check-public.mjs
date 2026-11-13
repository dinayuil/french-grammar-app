#!/usr/bin/env node
/**
 * Public inventory/provenance guard.
 *
 * This scanner is deliberately public-only: by default it reads the app tree
 * and the sibling `../content-public` repository. It never derives a path from
 * FGE_INTERNAL_CONTENT_DIR, the archive, or any other private location. A
 * caller may pass explicit roots; the guard still only walks those roots and
 * rejects links instead of following them.
 *
 * It is not a copyright-originality proof. The parent workflow must separately
 * compare the private corpus, audit all reachable Git history and inspect APK
 * and generated output.
 */
import { lstat, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_PUBLIC_ROOT = path.resolve(DEFAULT_APP_ROOT, "..", "content-public");
const GRADLE_WRAPPER_JAR = "android/gradle/wrapper/gradle-wrapper.jar";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_BINARY_BYTES = 20 * 1024 * 1024;
const MAX_JSON_NODES = 500_000;
const HEAD_BYTES = 1024;
const GITFILE_MAX_BYTES = 1024;
const GITFILE_PREFIX = "gitdir: ";
const SUBMODULE_GITDIR_PREFIX = "../.git/modules/";

const APP_ROOT_TEXT_FILES = new Set([
  ".gitattributes",
  ".gitignore",
  "README.md",
  "build-apk.bat",
  "capacitor.config.ts",
  "index.html",
  "package.json",
  "package-lock.json",
  "start.bat",
  "tsconfig.json",
  "tsconfig.tools.json",
  "vite.config.ts",
]);

const APP_ROOT_JSON_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", "tsconfig.tools.json"]);
// Exact workflow allowlist: no wildcards, no nested directories, no .yaml
// duplicates, and no hidden files. Anything else under .github is rejected.
const ALLOWED_APP_WORKFLOWS = new Set([
  ".github/workflows/build-public-apk.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-pages.yml",
]);
const APP_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const APP_BUILD_EXTENSIONS = new Set([".ts", ".mjs", ".mts"]);
const APP_SCRIPT_EXTENSIONS = new Set([".mjs", ".mts"]);
const APP_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const ANDROID_TEXT_FILES = new Set([
  "android/.gitignore",
  "android/app/.gitignore",
  "android/app/build.gradle",
  "android/app/fge-public-config.gradle",
  "android/app/proguard-rules.pro",
  "android/app/src/main/AndroidManifest.xml",
  "android/build.gradle",
  "android/gradle.properties",
  "android/gradle/wrapper/gradle-wrapper.properties",
  "android/gradlew",
  "android/gradlew.bat",
  "android/settings.gradle",
  "android/variables.gradle",
]);

const ANDROID_EXACT_DIRS = new Set([
  "android",
  "android/app",
  "android/app/src",
  "android/app/src/main",
  "android/app/src/main/assets",
  "android/app/src/main/java",
  "android/app/src/main/res",
  "android/gradle",
  "android/gradle/wrapper",
]);

const PUBLIC_ROOT_FILES = new Set([".gitattributes", ".gitignore", "README.md", "manifest.json"]);
// The public bank needs exactly one operational workflow to notify the app of
// content updates. Keep this an exact allowlist: every other .github path is
// still rejected by the public scanner.
const PUBLIC_OPERATIONAL_FILES = new Set([".github/workflows/notify-app.yml"]);

// Exact generated locations only. Arbitrary gitignored or dot directories are
// not skipped: an unknown file/directory is a hard failure.
const APP_SKIP_PREFIXES = [
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".fge-build",
  "android/.gradle",
  "android/build",
  "android/app/build",
  "android/app/src/main/assets/public",
  "android/capacitor-cordova-android-plugins",
];
const PUBLIC_SKIP_PREFIXES = [".git"];

// Known outputs rewritten by `cap sync`; they are not committed source and are
// audited with the generated/APK output by the parent instead.
const APP_GENERATED_FILES = new Set([
  "android/capacitor.settings.gradle",
  "android/app/capacitor.build.gradle",
  "android/app/src/main/assets/capacitor.config.json",
  "android/app/src/main/assets/capacitor.plugins.json",
  "android/app/src/main/res/xml/config.xml",
]);

const FORBIDDEN_EXTENSIONS = new Map([
  [".pdf", "PDF files are not allowed"],
  [".map", "source maps are not allowed"],
  [".jks", "signing keys/keystores are not allowed"],
  [".keystore", "signing keys/keystores are not allowed"],
  [".p12", "signing keys/keystores are not allowed"],
  [".pfx", "signing keys/keystores are not allowed"],
  [".pem", "key/certificate material is not allowed"],
  [".key", "key material is not allowed"],
  [".der", "key/certificate material is not allowed"],
  [".crt", "key/certificate material is not allowed"],
  [".cer", "key/certificate material is not allowed"],
  [".p8", "key material is not allowed"],
  [".mobileprovision", "provisioning material is not allowed"],
  [".apk", "compiled Android artifacts are not allowed in source trees"],
  [".aab", "compiled Android artifacts are not allowed in source trees"],
  [".aar", "compiled Android libraries are not allowed in source trees"],
  [".ipa", "compiled Apple artifacts are not allowed in source trees"],
  [".dex", "compiled Android artifacts are not allowed in source trees"],
  [".class", "compiled JVM artifacts are not allowed in source trees"],
  [".hprof", "internal runtime artifacts are not allowed in source trees"],
]);

const FORBIDDEN_BASENAMES = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "local.properties",
]);

const FORBIDDEN_DIR_NAMES = new Set([
  ".archive",
  ".internal",
  ".private",
  ".secrets",
  ".superpowers",
  "archive",
  "content-internal",
  "content-private",
  "content_internal",
  "content_private",
  "internal",
  "internal-content",
  "private",
  "private-content",
  "secrets",
]);

const BOOK_PAGE_SOURCE_PATTERN =
  /(?:\b(?:p|pp|page|pages)\.?\s*\d{1,4}\b|第\s*\d{1,4}\s*页)/i;
const BOOK_SOURCE_PATTERN = /\b(?:livre|manuel|textbook|coursebook|workbook)\b/i;
const PRIVATE_SOURCE_PATTERN = /\b(?:internal|private|confidential|proprietary)\b/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const PRIVATE_EDITION_PATTERN = /^(?:internal|private)$/i;
const PDF_SIGNATURE = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

export const RULES = Object.freeze([
  "App root source/config allowlist: .gitattributes, .gitignore, README.md, capacitor.config.ts, index.html, package.json, package-lock.json, start.bat, tsconfig.json, tsconfig.tools.json, vite.config.ts, build-apk.bat.",
  "App code allowlist: src/**/*.{ts,tsx,css}, build/**/*.{ts,mjs,mts}, scripts/**/*.{mjs,mts}.",
  "GitHub Actions workflow allowlist: exactly .github/workflows/deploy-pages.yml, .github/workflows/ci.yml, and .github/workflows/build-public-apk.yml; other workflow files, nested workflow directories, .yaml duplicates, hidden files, and other .github files are rejected.",
  "Android template allowlist: the checked-in Gradle wrapper/config files, Java under android/app/src/main/java/**, XML/images under android/app/src/main/res/** or android/app/src/{public,internal}/res/**, and only the exact Gradle wrapper JAR under android/gradle/wrapper/.",
  "Public bank allowlist: root manifest.json, README.md, .gitignore, .gitattributes, exactly .github/workflows/notify-app.yml, plus exactly the chapter JSON paths declared by manifest.json. No other public file is allowed.",
  "Named app JSON allowlist: package.json, package-lock.json, tsconfig.json, tsconfig.tools.json only; any other app JSON is treated as real content and rejected.",
  "Forbidden everywhere: PDFs, key/keystore/signing material, secrets, internal/private manifests, private content directories, source maps, APK/AAB/internal build artifacts, symlinks/junctions, and unknown files.",
  "Skipped exact generated locations (not audited by this guard): .git, node_modules, dist, coverage, .fge-build, android/.gradle, android/build, android/app/build, android/app/src/main/assets/public, android/capacitor-cordova-android-plugins, and known Capacitor-generated files. A top-level .git ordinary file is skipped only when it is a single-line safe submodule gitdir pointer into ../.git/modules/<name> (LF/CRLF, at most 1024 bytes); its target Git directory is never followed or inventoried.",
  "This guard is an inventory/provenance check, not proof of copyright originality. Private-corpus comparison, all-history review, APK contents and generated output must be audited separately.",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinRel(prefix, name) {
  return prefix ? `${prefix}/${name}` : name;
}

function hasPrefix(rel, prefix) {
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

function hasAnyPrefix(rel, prefixes) {
  return prefixes.some((prefix) => hasPrefix(rel, prefix));
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function fileExtension(rel) {
  return path.posix.extname(rel).toLowerCase();
}

function fileName(rel) {
  return path.posix.basename(rel).toLowerCase();
}

function forbiddenDirectoryReason(name) {
  const normalized = name.toLowerCase();
  if (FORBIDDEN_DIR_NAMES.has(normalized)) {
    return "forbidden private/internal/archive directory name";
  }
  if (
    normalized.includes("content-private") ||
    normalized.includes("content-internal") ||
    normalized.includes("private-content") ||
    normalized.includes("internal-content") ||
    /(?:^|[-_.])(?:private|internal)(?:$|[-_.])/.test(normalized)
  ) {
    return "forbidden private/internal directory name";
  }
  return null;
}

function forbiddenFileReason(rel) {
  const ext = fileExtension(rel);
  const base = fileName(rel);
  if (FORBIDDEN_EXTENSIONS.has(ext)) return FORBIDDEN_EXTENSIONS.get(ext);
  if (ext === ".jar" && rel !== GRADLE_WRAPPER_JAR) {
    return "JAR binaries are only allowed for the exact Android Gradle wrapper";
  }
  if (FORBIDDEN_BASENAMES.has(base)) {
    return "local configuration or credential file is not allowed";
  }
  if (base.startsWith(".env.")) return "environment/secret files are not allowed";
  return null;
}

function isAllowedAppDirectory(rel) {
  if (rel === "src" || rel.startsWith("src/")) return true;
  if (rel === "build" || rel.startsWith("build/")) return true;
  if (rel === "scripts" || rel.startsWith("scripts/")) return true;
  if (rel === ".github" || rel === ".github/workflows") return true;
  if (ANDROID_EXACT_DIRS.has(rel)) return true;
  if (rel.startsWith("android/app/src/main/java/")) return true;
  if (rel.startsWith("android/app/src/main/res/")) return true;
  if (isAndroidFlavorRoot(rel)) return true;
  if (isAndroidFlavorResourceDir(rel)) return true;
  return false;
}

function isAndroidFlavorRoot(rel) {
  return rel === "android/app/src/public" || rel === "android/app/src/internal";
}

function isAndroidFlavorResourceDir(rel) {
  return (
    rel === "android/app/src/public/res" ||
    rel === "android/app/src/internal/res" ||
    rel.startsWith("android/app/src/public/res/") ||
    rel.startsWith("android/app/src/internal/res/")
  );
}

function isAndroidFlavorResPath(rel) {
  return (
    rel.startsWith("android/app/src/public/res/") ||
    rel.startsWith("android/app/src/internal/res/")
  );
}

function isAllowedAppTextFile(rel) {
  const ext = fileExtension(rel);
  if (APP_ROOT_TEXT_FILES.has(rel) && !ext.endsWith(".json")) return true;
  if (rel.startsWith("src/") && APP_SOURCE_EXTENSIONS.has(ext)) return true;
  if (rel.startsWith("build/") && APP_BUILD_EXTENSIONS.has(ext)) return true;
  if (rel.startsWith("scripts/") && APP_SCRIPT_EXTENSIONS.has(ext)) return true;
  if (ALLOWED_APP_WORKFLOWS.has(rel)) return true;
  if (ANDROID_TEXT_FILES.has(rel)) return true;
  if (rel.startsWith("android/app/src/main/java/") && ext === ".java") return true;
  if (rel.startsWith("android/app/src/main/res/") && ext === ".xml") return true;
  if (isAndroidFlavorResPath(rel) && ext === ".xml") return true;
  return false;
}

function isAllowedAppBinary(rel) {
  const ext = fileExtension(rel);
  if (rel === GRADLE_WRAPPER_JAR) return true;
  if (rel.startsWith("android/app/src/main/res/") && APP_IMAGE_EXTENSIONS.has(ext)) return true;
  if (isAndroidFlavorResPath(rel) && APP_IMAGE_EXTENSIONS.has(ext)) return true;
  return false;
}

function skippedAppPathKind(rel) {
  if (APP_GENERATED_FILES.has(rel)) return "file";
  if (hasAnyPrefix(rel, APP_SKIP_PREFIXES)) return "directory";
  return null;
}

function skippedPublicPathKind(rel) {
  if (hasAnyPrefix(rel, PUBLIC_SKIP_PREFIXES)) return "directory";
  return null;
}

// A top-level `.git` ordinary file is the pointer Git writes after
// `git submodule absorbgitdirs` or in a recursive clone. This exemption is
// metadata-only: it accepts a bounded, syntactically safe pointer generated by
// Git and never opens or inventories the target Git directory. It is not proof
// that the target is an authentic repository.
function isSafeSubmoduleName(name) {
  if (name.includes("..")) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(name);
}

function gitfilePointerReason(text) {
  if (text.includes("\0")) return "contains binary content";
  let line = text;
  if (line.endsWith("\r\n")) line = line.slice(0, -2);
  else if (line.endsWith("\n")) line = line.slice(0, -1);
  if (/[\r\n\u2028\u2029]/.test(line)) return "is not a single-line submodule gitdir pointer";
  if (!line.startsWith(GITFILE_PREFIX)) return "is not a single-line submodule gitdir pointer";
  const target = line.slice(GITFILE_PREFIX.length);
  if (!target.startsWith(SUBMODULE_GITDIR_PREFIX)) {
    return "does not point into ../.git/modules/";
  }
  if (!isSafeSubmoduleName(target.slice(SUBMODULE_GITDIR_PREFIX.length))) {
    return "uses an unsafe submodule name";
  }
  return null;
}

async function isSafeSubmoduleGitFile(rel, abs, size, label, errors) {
  if (rel !== ".git") return false;
  if (size > GITFILE_MAX_BYTES) {
    addError(
      errors,
      `${label}: ${rel}: submodule gitfile is too large to inspect safely (${size} bytes > ${GITFILE_MAX_BYTES})`
    );
    return false;
  }
  let handle;
  try {
    handle = await open(abs, "r");
    const buffer = Buffer.alloc(GITFILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > GITFILE_MAX_BYTES) {
      addError(
        errors,
        `${label}: ${rel}: submodule gitfile is too large to inspect safely (> ${GITFILE_MAX_BYTES} bytes)`
      );
      return false;
    }
    const reason = gitfilePointerReason(buffer.toString("utf8", 0, bytesRead));
    if (reason) {
      addError(errors, `${label}: ${rel}: invalid submodule gitfile (${reason})`);
      return false;
    }
    return true;
  } catch (error) {
    addError(errors, `${label}: ${rel}: cannot read file (${errorMessage(error)})`);
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function entryKind(stats) {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "regular file";
  if (stats.isSymbolicLink()) return "symbolic link/junction";
  return "unsupported filesystem entry";
}

function hasPdfMagic(buffer) {
  return buffer.indexOf(PDF_SIGNATURE) !== -1;
}

function hasZipMagic(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

function hasPngMagic(buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function hasJpegMagic(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasWebpMagic(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

function looksLikePrivateSource(value) {
  return (
    BOOK_PAGE_SOURCE_PATTERN.test(value) ||
    BOOK_SOURCE_PATTERN.test(value) ||
    PRIVATE_SOURCE_PATTERN.test(value)
  );
}

function addError(errors, message) {
  errors.push(message);
}

function scanJsonMarkers(value, rel, label, errors, sourceMarkers) {
  const stack = [{ node: value, path: "$" }];
  let visited = 0;
  while (stack.length > 0) {
    const { node, path: nodePath } = stack.pop();
    visited += 1;
    if (visited > MAX_JSON_NODES) {
      addError(errors, `${label}: ${rel}: JSON is too large to inspect safely`);
      return;
    }
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        const child = node[index];
        if (isPlainObject(child) || Array.isArray(child)) {
          stack.push({ node: child, path: `${nodePath}[${index}]` });
        }
      }
      continue;
    }
    if (!isPlainObject(node)) continue;
    if (
      Object.prototype.hasOwnProperty.call(node, "edition") &&
      typeof node.edition === "string" &&
      PRIVATE_EDITION_PATTERN.test(node.edition.trim())
    ) {
      addError(
        errors,
        `${label}: ${rel}: internal/private manifest marker at ${nodePath}.edition`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(node, "visibility") &&
      typeof node.visibility === "string" &&
      PRIVATE_EDITION_PATTERN.test(node.visibility.trim())
    ) {
      addError(
        errors,
        `${label}: ${rel}: internal/private visibility marker at ${nodePath}.visibility`
      );
    }
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${nodePath}.${key}`;
      if (sourceMarkers && /^source$/i.test(key) && typeof child === "string") {
        if (looksLikePrivateSource(child)) {
          addError(
            errors,
            `${label}: ${rel}: ${childPath} looks like a private/book-page source marker; public content must use original provenance`
          );
        }
      }
      if (isPlainObject(child) || Array.isArray(child)) {
        stack.push({ node: child, path: childPath });
      }
    }
  }
}

function parseJsonText(text, rel, label, errors, sourceMarkers) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let value;
  try {
    value = JSON.parse(withoutBom);
  } catch (error) {
    addError(
      errors,
      `${label}: ${rel}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
    );
    return { ok: false, value: undefined };
  }
  scanJsonMarkers(value, rel, label, errors, sourceMarkers);
  return { ok: true, value };
}

async function readHead(abs, rel, label, errors) {
  let handle;
  try {
    handle = await open(abs, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    addError(errors, `${label}: ${rel}: cannot read file (${errorMessage(error)})`);
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function readUtf8File(abs, rel, size, label, errors) {
  if (size > MAX_TEXT_BYTES) {
    addError(
      errors,
      `${label}: ${rel}: text file is too large to inspect (${size} bytes > ${MAX_TEXT_BYTES})`
    );
    return null;
  }
  let buffer;
  try {
    buffer = await readFile(abs);
  } catch (error) {
    addError(errors, `${label}: ${rel}: cannot read file (${errorMessage(error)})`);
    return null;
  }
  if (buffer.includes(0)) {
    addError(errors, `${label}: ${rel}: binary content found in an allowlisted text file`);
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    addError(errors, `${label}: ${rel}: text file is not valid UTF-8`);
    return null;
  }
}

async function readBinaryFile(abs, rel, size, label, errors) {
  if (size > MAX_BINARY_BYTES) {
    addError(
      errors,
      `${label}: ${rel}: binary file is too large to inspect (${size} bytes > ${MAX_BINARY_BYTES})`
    );
    return null;
  }
  try {
    return await readFile(abs);
  } catch (error) {
    addError(errors, `${label}: ${rel}: cannot read file (${errorMessage(error)})`);
    return null;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function scanTextSecrets(text, rel, label, errors) {
  if (PRIVATE_KEY_PATTERN.test(text)) {
    addError(errors, `${label}: ${rel}: contains a private key block header`);
  }
}

function validateBinarySignature(rel, buffer, errors) {
  const ext = fileExtension(rel);
  if (rel === GRADLE_WRAPPER_JAR) {
    if (!hasZipMagic(buffer)) {
      addError(errors, `app: ${rel}: Gradle wrapper JAR does not have a JAR/ZIP signature`);
    }
    return;
  }
  if (ext === ".png" && !hasPngMagic(buffer)) {
    addError(errors, `app: ${rel}: file ending in .png is not a PNG image`);
  } else if ((ext === ".jpg" || ext === ".jpeg") && !hasJpegMagic(buffer)) {
    addError(errors, `app: ${rel}: file ending in ${ext} is not a JPEG image`);
  } else if (ext === ".webp" && !hasWebpMagic(buffer)) {
    addError(errors, `app: ${rel}: file ending in .webp is not a WebP image`);
  }
}

async function inspectAppFile(rel, abs, size, label, errors) {
  const ext = fileExtension(rel);

  if (ext === ".pdf") {
    addError(errors, `${label}: ${rel}: PDF files are not allowed`);
    return;
  }

  const head = await readHead(abs, rel, label, errors);
  if (head === null) return;
  if (hasPdfMagic(head)) {
    addError(errors, `${label}: ${rel}: PDF content is not allowed (extension independent)`);
    return;
  }

  const forbidden = forbiddenFileReason(rel);
  if (forbidden) {
    addError(errors, `${label}: ${rel}: ${forbidden}`);
    return;
  }

  if (ext === ".json") {
    const isNamedConfig = APP_ROOT_JSON_FILES.has(rel);
    const text = await readUtf8File(abs, rel, size, label, errors);
    if (text !== null) {
      parseJsonText(text, rel, label, errors, !isNamedConfig);
      if (isNamedConfig) {
        scanTextSecrets(text, rel, label, errors);
      }
    }
    if (!isNamedConfig) {
      addError(
        errors,
        `${label}: ${rel}: real content JSON is forbidden; only named app config/lock/package JSON is allowed (package.json, package-lock.json, tsconfig.json)`
      );
    }
    return;
  }

  if (isAllowedAppTextFile(rel)) {
    const text = await readUtf8File(abs, rel, size, label, errors);
    if (text !== null) scanTextSecrets(text, rel, label, errors);
    return;
  }

  if (isAllowedAppBinary(rel)) {
    const buffer = await readBinaryFile(abs, rel, size, label, errors);
    if (buffer !== null) validateBinarySignature(rel, buffer, errors);
    return;
  }

  addError(
    errors,
    `${label}: ${rel}: non-allowlisted app file (see --rules for allowed source/config/Android paths)`
  );
}

async function scanApp(appRoot) {
  const errors = [];
  const inventory = [];
  const skipped = [];

  async function visit(relDir) {
    const absDir = path.join(appRoot, ...relDir.split("/").filter(Boolean));
    let names;
    try {
      names = await readdir(absDir);
    } catch (error) {
      addError(errors, `app: ${relDir || "."}: cannot list directory (${errorMessage(error)})`);
      return;
    }
    names.sort();
    for (const name of names) {
      const rel = joinRel(relDir, name);
      const abs = path.join(absDir, name);
      let stats;
      try {
        stats = await lstat(abs);
      } catch (error) {
        addError(errors, `app: ${rel}: cannot stat file (${errorMessage(error)})`);
        continue;
      }
      if (stats.isSymbolicLink()) {
        addError(errors, `app: ${rel}: symbolic link/junction is not allowed`);
        continue;
      }
      if (rel === ".git" && stats.isFile()) {
        if (await isSafeSubmoduleGitFile(rel, abs, stats.size, "app", errors)) {
          skipped.push(rel);
        }
        continue;
      }
      const skippedKind = skippedAppPathKind(rel);
      if (skippedKind) {
        if (
          (skippedKind === "directory" && stats.isDirectory()) ||
          (skippedKind === "file" && stats.isFile())
        ) {
          skipped.push(rel);
          continue;
        }
        addError(
          errors,
          `app: ${rel}: generated ${skippedKind} skip expects a regular ${skippedKind}; found ${entryKind(stats)}. Links and mismatched entry types are not skipped`
        );
        continue;
      }
      if (stats.isDirectory()) {
        const forbidden = forbiddenDirectoryReason(name);
        if (forbidden && !isAndroidFlavorRoot(rel)) {
          addError(errors, `app: ${rel}: ${forbidden}`);
          continue;
        }
        if (!isAllowedAppDirectory(rel)) {
          addError(
            errors,
            `app: ${rel}: unexpected directory (see --rules for allowed app/Android paths)`
          );
        }
        await visit(rel);
        continue;
      }
      if (!stats.isFile()) {
        addError(errors, `app: ${rel}: unsupported filesystem entry`);
        continue;
      }
      inventory.push(rel);
      await inspectAppFile(rel, abs, stats.size, "app", errors);
    }
  }

  await visit("");
  return { errors, inventory, skipped };
}

function normalizeChapterPath(raw, publicRoot) {
  if (typeof raw !== "string" || raw.length === 0) {
    return { error: "chapter path must be a non-empty string" };
  }
  if (raw !== raw.trim()) {
    return { error: "chapter path must not contain leading/trailing whitespace" };
  }
  if (/[\u0000-\u001f]/.test(raw)) {
    return { error: "chapter path contains control characters" };
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
    return { error: "absolute chapter paths are not allowed" };
  }
  if (raw.includes("\\")) {
    return { error: "chapter paths must use forward slashes and stay inside the public bank" };
  }
  if (!raw.toLowerCase().endsWith(".json")) {
    return { error: "chapter path must point to a .json file" };
  }
  const segments = raw.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { error: "chapter path contains an empty, current-directory, or traversal segment" };
  }
  if (
    segments.some((segment) =>
      [".git", "node_modules", "dist", "coverage", ".fge-build"].includes(segment.toLowerCase())
    )
  ) {
    return { error: "chapter path points at a reserved/generated directory" };
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const reason = forbiddenDirectoryReason(segments[index]);
    if (reason) return { error: `chapter path uses a ${reason}` };
  }
  const normalized = segments.join("/");
  if (PUBLIC_ROOT_FILES.has(normalized)) {
    return { error: "chapter path collides with a root metadata file" };
  }
  const absolute = path.resolve(publicRoot, ...segments);
  if (!isPathInside(publicRoot, absolute)) {
    return { error: "chapter path escapes the public bank root" };
  }
  return { value: normalized, absolute };
}

async function readPublicManifest(publicRoot) {
  const errors = [];
  const label = "public";
  const rel = "manifest.json";
  const abs = path.join(publicRoot, "manifest.json");

  let stats;
  try {
    stats = await lstat(abs);
  } catch {
    addError(errors, `${label}: ${rel}: public manifest is missing`);
    return { errors, chapters: [], expectedQuestionCount: null };
  }
  if (stats.isSymbolicLink()) {
    addError(errors, `${label}: ${rel}: symbolic link/junction is not allowed`);
    return { errors, chapters: [], expectedQuestionCount: null };
  }
  if (!stats.isFile()) {
    addError(errors, `${label}: ${rel}: manifest is not a regular file`);
    return { errors, chapters: [], expectedQuestionCount: null };
  }

  const text = await readUtf8File(abs, rel, stats.size, label, errors);
  if (text === null) return { errors, chapters: [], expectedQuestionCount: null };
  scanTextSecrets(text, rel, label, errors);
  const parsed = parseJsonText(text, rel, label, errors, true);
  if (!parsed.ok) return { errors, chapters: [], expectedQuestionCount: null };
  if (!isPlainObject(parsed.value)) {
    addError(errors, `${label}: ${rel}: manifest must be a JSON object`);
    return { errors, chapters: [], expectedQuestionCount: null };
  }

  const manifest = parsed.value;
  if (manifest.schemaVersion !== 1) {
    addError(errors, `${label}: ${rel}: schemaVersion must be 1`);
  }
  if (manifest.edition !== "public") {
    addError(errors, `${label}: ${rel}: edition must be public`);
  }
  if (
    !Number.isInteger(manifest.expectedChapterCount) ||
    manifest.expectedChapterCount < 0
  ) {
    addError(errors, `${label}: ${rel}: expectedChapterCount must be a non-negative integer`);
  }
  if (
    !Number.isInteger(manifest.expectedQuestionCount) ||
    manifest.expectedQuestionCount < 0
  ) {
    addError(errors, `${label}: ${rel}: expectedQuestionCount must be a non-negative integer`);
  }
  if (!Array.isArray(manifest.chapters)) {
    addError(errors, `${label}: ${rel}: chapters must be an array`);
    return { errors, chapters: [], expectedQuestionCount: manifest.expectedQuestionCount };
  }

  if (
    Number.isInteger(manifest.expectedChapterCount) &&
    manifest.expectedChapterCount !== manifest.chapters.length
  ) {
    addError(
      errors,
      `${label}: ${rel}: expectedChapterCount ${manifest.expectedChapterCount} does not match ${manifest.chapters.length} declared paths`
    );
  }

  const chapters = [];
  const seen = new Set();
  for (const raw of manifest.chapters) {
    const normalized = normalizeChapterPath(raw, publicRoot);
    if (normalized.error) {
      addError(
        errors,
        `${label}: ${rel}: invalid chapter path ${JSON.stringify(raw)}: ${normalized.error}`
      );
      continue;
    }
    const key = normalized.value.toLowerCase();
    if (seen.has(key)) {
      addError(
        errors,
        `${label}: ${rel}: duplicate chapter path ${JSON.stringify(normalized.value)}`
      );
      continue;
    }
    seen.add(key);
    chapters.push(normalized.value);
  }

  return {
    errors,
    chapters,
    expectedChapterCount: manifest.expectedChapterCount,
    expectedQuestionCount: manifest.expectedQuestionCount,
  };
}

async function inspectPublicFile(rel, abs, size, declared, chapterValues, errors) {
  const label = "public";
  const ext = fileExtension(rel);

  if (ext === ".pdf") {
    addError(errors, `${label}: ${rel}: PDF files are not allowed`);
    return;
  }

  const head = await readHead(abs, rel, label, errors);
  if (head === null) return;
  if (hasPdfMagic(head)) {
    addError(errors, `${label}: ${rel}: PDF content is not allowed (extension independent)`);
    return;
  }

  const forbidden = forbiddenFileReason(rel);
  if (forbidden) {
    addError(errors, `${label}: ${rel}: ${forbidden}`);
    return;
  }

  if (PUBLIC_ROOT_FILES.has(rel) || PUBLIC_OPERATIONAL_FILES.has(rel)) {
    const text = await readUtf8File(abs, rel, size, label, errors);
    if (text !== null) scanTextSecrets(text, rel, label, errors);
    return;
  }

  if (declared.has(rel)) {
    const text = await readUtf8File(abs, rel, size, label, errors);
    if (text === null) return;
    scanTextSecrets(text, rel, label, errors);
    const parsed = parseJsonText(text, rel, label, errors, true);
    if (parsed.ok) chapterValues.set(rel, parsed.value);
    return;
  }

  if (ext === ".json") {
    const text = await readUtf8File(abs, rel, size, label, errors);
    if (text !== null) {
      scanTextSecrets(text, rel, label, errors);
      parseJsonText(text, rel, label, errors, true);
    }
    addError(
      errors,
      `${label}: ${rel}: unreferenced JSON payload is not allowed; every public JSON other than manifest.json must be a declared chapter path`
    );
    return;
  }

  addError(
    errors,
    `${label}: ${rel}: non-allowlisted public file (only root metadata, the allowlisted public workflow, and declared chapter JSON are allowed)`
  );
}

function countChapterQuestions(value, rel, label, errors) {
  if (!isPlainObject(value)) {
    addError(errors, `${label}: ${rel}: chapter must be a JSON object`);
    return null;
  }
  let total = 0;
  for (const section of ["lessons", "challenges"]) {
    if (!Array.isArray(value[section])) {
      addError(errors, `${label}: ${rel}: chapter.${section} must be an array`);
      return null;
    }
    for (let index = 0; index < value[section].length; index += 1) {
      const lesson = value[section][index];
      if (!isPlainObject(lesson) || !Array.isArray(lesson.questions)) {
        addError(
          errors,
          `${label}: ${rel}: chapter.${section}[${index}].questions must be an array`
        );
        return null;
      }
      total += lesson.questions.length;
    }
  }
  return total;
}

async function scanPublic(publicRoot, manifest) {
  const errors = [];
  const inventory = [];
  const skipped = [];
  const declared = new Set(manifest.chapters);
  const chapterValues = new Map();
  const seen = new Set();

  const allowedDirs = new Set([""]);
  for (const rel of manifest.chapters) {
    const parts = rel.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirs.add(parts.slice(0, index).join("/"));
    }
  }
  for (const rel of PUBLIC_OPERATIONAL_FILES) {
    const parts = rel.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirs.add(parts.slice(0, index).join("/"));
    }
  }

  async function visit(relDir) {
    const absDir = path.join(publicRoot, ...relDir.split("/").filter(Boolean));
    let names;
    try {
      names = await readdir(absDir);
    } catch (error) {
      addError(errors, `public: ${relDir || "."}: cannot list directory (${errorMessage(error)})`);
      return;
    }
    names.sort();
    for (const name of names) {
      const rel = joinRel(relDir, name);
      const abs = path.join(absDir, name);
      let stats;
      try {
        stats = await lstat(abs);
      } catch (error) {
        addError(errors, `public: ${rel}: cannot stat file (${errorMessage(error)})`);
        continue;
      }
      if (stats.isSymbolicLink()) {
        addError(errors, `public: ${rel}: symbolic link/junction is not allowed`);
        continue;
      }
      if (rel === ".git" && stats.isFile()) {
        if (await isSafeSubmoduleGitFile(rel, abs, stats.size, "public", errors)) {
          skipped.push(rel);
        }
        continue;
      }
      const skippedKind = skippedPublicPathKind(rel);
      if (skippedKind) {
        if (skippedKind === "directory" && stats.isDirectory()) {
          skipped.push(rel);
          continue;
        }
        addError(
          errors,
          `public: ${rel}: generated ${skippedKind} skip expects a regular ${skippedKind}; found ${entryKind(stats)}. Links and mismatched entry types are not skipped`
        );
        continue;
      }
      if (stats.isDirectory()) {
        const forbidden = forbiddenDirectoryReason(name);
        if (forbidden) {
          addError(errors, `public: ${rel}: ${forbidden}`);
          continue;
        }
        if (!allowedDirs.has(rel)) {
          addError(
            errors,
            `public: ${rel}: unexpected directory (only manifest-declared chapter directories, root metadata, and the allowlisted public workflow are allowed)`
          );
        }
        await visit(rel);
        continue;
      }
      if (!stats.isFile()) {
        addError(errors, `public: ${rel}: unsupported filesystem entry`);
        continue;
      }
      inventory.push(rel);
      seen.add(rel);
      await inspectPublicFile(rel, abs, stats.size, declared, chapterValues, errors);
    }
  }

  await visit("");

  let questions = 0;
  for (const rel of manifest.chapters) {
    if (!seen.has(rel)) {
      addError(errors, `public: ${rel}: declared chapter file is missing or was not a regular file`);
      continue;
    }
    if (!chapterValues.has(rel)) continue;
    const count = countChapterQuestions(chapterValues.get(rel), rel, "public", errors);
    if (count !== null) questions += count;
  }

  if (
    Number.isInteger(manifest.expectedQuestionCount) &&
    questions !== manifest.expectedQuestionCount
  ) {
    addError(
      errors,
      `public: manifest.json: expectedQuestionCount ${manifest.expectedQuestionCount} does not match ${questions} actual questions`
    );
  }

  return {
    errors,
    inventory,
    skipped,
    chapters: manifest.chapters.length,
    questions,
  };
}

async function checkRoot(root, label) {
  let stats;
  try {
    stats = await lstat(root);
  } catch {
    return [`${label}: root does not exist or is not accessible: ${root}`];
  }
  if (stats.isSymbolicLink()) {
    return [`${label}: root must not be a symbolic link/junction: ${root}`];
  }
  if (!stats.isDirectory()) {
    return [`${label}: root is not a directory: ${root}`];
  }
  return [];
}

export async function checkPublic(options = {}) {
  const result = {
    ok: false,
    appRoot: "",
    publicRoot: "",
    errors: [],
    warnings: [],
    stats: {
      appFiles: 0,
      publicFiles: 0,
      chapters: 0,
      questions: 0,
      skippedGenerated: 0,
    },
    inventory: { app: [], public: [] },
    rules: RULES,
  };

  try {
    const settings = options && typeof options === "object" ? options : {};
    const hasExplicitApp =
      typeof settings.appRoot === "string" && settings.appRoot.trim().length > 0;
    const hasExplicitPublic =
      typeof settings.publicRoot === "string" && settings.publicRoot.trim().length > 0;
    result.appRoot = path.resolve(hasExplicitApp ? settings.appRoot : DEFAULT_APP_ROOT);
    result.publicRoot = path.resolve(
      hasExplicitPublic
        ? settings.publicRoot
        : path.resolve(result.appRoot, "..", "content-public")
    );

    if (result.appRoot === result.publicRoot) {
      result.errors.push("app and public roots must be separate directories");
      return finalize(result);
    }

    const rootErrors = [
      ...(await checkRoot(result.appRoot, "app")),
      ...(await checkRoot(result.publicRoot, "public")),
    ];
    result.errors.push(...rootErrors);
    if (rootErrors.length > 0) return finalize(result);

    const appScan = await scanApp(result.appRoot);
    const manifest = await readPublicManifest(result.publicRoot);
    const publicScan = await scanPublic(result.publicRoot, manifest);

    result.errors.push(...appScan.errors, ...manifest.errors, ...publicScan.errors);
    result.inventory.app.push(...appScan.inventory);
    result.inventory.public.push(...publicScan.inventory);
    result.stats.appFiles = appScan.inventory.length;
    result.stats.publicFiles = publicScan.inventory.length;
    result.stats.chapters = publicScan.chapters;
    result.stats.questions = publicScan.questions;
    result.stats.skippedGenerated = appScan.skipped.length + publicScan.skipped.length;
    if (result.stats.skippedGenerated > 0) {
      result.warnings.push(
        "Exact known generated locations were skipped and are not audited by this guard; parent generated/APK review remains required."
      );
    }
    result.warnings.push(
      "Inventory/provenance only: this is not proof of copyright originality. Parent private-corpus, all-history, and APK audits are independent."
    );
    return finalize(result);
  } catch (error) {
    result.errors.push(`guard failed closed: ${errorMessage(error)}`);
    return finalize(result);
  }
}

function finalize(result) {
  result.errors = [...new Set(result.errors)];
  result.ok = result.errors.length === 0;
  return result;
}

function usage() {
  return [
    "Usage: node scripts/check-public.mjs [--app <dir>] [--public <dir>]",
    "",
    `Default app root:    ${DEFAULT_APP_ROOT}`,
    `Default public root: ${DEFAULT_PUBLIC_ROOT}`,
    "",
    "Options:",
    "  --app <dir>      Explicit app repository root",
    "  --public <dir>   Explicit public content repository root",
    "  --rules          Print the readable allowlist/provenance rules",
    "  -h, --help       Show this help",
    "",
    "The guard never derives a private content path and never follows symlinks or junctions.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  let help = false;
  let rules = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--rules") {
      rules = true;
      continue;
    }
    if (argument === "--app" || argument === "--public") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { error: `${argument} requires a directory value` };
      }
      options[argument === "--app" ? "appRoot" : "publicRoot"] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--app=") || argument.startsWith("--public=")) {
      const [flag, value] = argument.split("=", 2);
      if (!value) return { error: `${flag} requires a directory value` };
      options[flag === "--app" ? "appRoot" : "publicRoot"] = value;
      continue;
    }
    return { error: `unknown argument: ${argument}` };
  }
  return { options, help, rules };
}

async function main(argv) {
  const parsed = parseArguments(argv);
  if (parsed.error) {
    console.error(`check-public: ${parsed.error}`);
    console.error(usage());
    return 2;
  }
  if (parsed.help) {
    console.log(usage());
    return 0;
  }
  if (parsed.rules) {
    console.log(RULES.join("\n"));
    return 0;
  }

  const result = await checkPublic(parsed.options);
  if (!result.ok) {
    console.error(`check-public: FAILED (${result.errors.length} issue(s))`);
    for (const error of result.errors) console.error(`- ${error}`);
    for (const warning of result.warnings) console.error(`  note: ${warning}`);
    console.error("Run with --rules for the allowed paths and guard limits.");
    return 1;
  }

  console.log("check-public: OK");
  console.log(`  app:    ${result.appRoot} (${result.stats.appFiles} files)`);
  console.log(
    `  public: ${result.publicRoot} (${result.stats.publicFiles} files, ${result.stats.chapters} chapters, ${result.stats.questions} questions)`
  );
  for (const warning of result.warnings) console.log(`  note: ${warning}`);
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-public: failed closed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
