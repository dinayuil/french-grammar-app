import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { validateChapter } from "../src/content/validate";
import {
  collectLocalizationGaps,
  formatLocalizationGap,
  type LocalizationGap,
  type SectionKeyRegistry,
  type SharedFieldRegistry,
} from "../src/content/localizationCoverage";
import { CONTENT_LOCALES, UI_LOCALES, type UiLocale } from "../src/i18n/types";
import { assertMessageCatalogsComplete } from "../src/i18n/messages";
import { SECTION_MAP } from "../src/learning/sections";
import type { Chapter } from "../src/types";
import { resolveEdition as resolveEditionFromScripts } from "../scripts/edition.mjs";
import type { Edition as EditionFromScripts } from "../scripts/edition.mjs";

export type Edition = EditionFromScripts;
export { resolveEditionFromScripts as resolveEdition };

export interface LoadedBank {
  chapters: Chapter[];
  files: string[];
  /** manifest 声明的可用语言；旧 manifest 缺省仅 zh-CN。 */
  supportedLocales: readonly UiLocale[];
}

interface Manifest {
  schemaVersion: 1;
  edition: Edition;
  chapters: string[];
  expectedChapterCount: number;
  expectedQuestionCount: number;
  supportedLocales?: UiLocale[];
  localizationSharedFields?: Record<string, SharedFieldRegistry>;
}

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VIRTUAL_MODULE_ID = "virtual:fge-content";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

/**
 * app 已登记的小章 key 是内容元数据的唯一合法键集合。综合区标签来自
 * UI 文案目录，不进入 sectionTitles；私有版不新增分区。
 */
const SECTION_KEYS: SectionKeyRegistry = Object.fromEntries(
  Object.entries(SECTION_MAP).map(([chapterId, blueprint]) => [
    chapterId,
    blueprint.sections.map((section) => section.key),
  ])
);

/** 可被 manifest 显式裁定复用的展示字段（不包含 source、ID 和评分字段）。 */
const SHARED_FIELD_NAMES = new Set([
  "title",
  "body",
  "prompt",
  "example",
  "explain",
  "translation",
  "options",
]);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertEdition(value: string): asserts value is Edition {
  if (value !== "public" && value !== "internal") {
    throw new Error(
      `edition 非法: ${JSON.stringify(value)}；只能是 public 或 internal`
    );
  }
}

/**
 * Resolve the selected content repository. Only the variable belonging to the
 * selected edition is read; the other repository is never probed.
 */
export function resolveContentRoot(
  edition: Edition,
  env: Record<string, string | undefined> = process.env
): string {
  assertEdition(edition);
  const variable =
    edition === "public" ? "FGE_PUBLIC_CONTENT_DIR" : "FGE_INTERNAL_CONTENT_DIR";
  const configured = env[variable];
  if (configured !== undefined && configured.trim() !== "") {
    return path.resolve(APP_ROOT, configured);
  }
  return path.resolve(
    APP_ROOT,
    "..",
    edition === "public" ? "content-public" : "content-private"
  );
}

function isContained(rootReal: string, candidateReal: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const root = normalize(rootReal);
  const candidate = normalize(candidateReal);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

/**
 * Resolve a manifest-relative chapter path. Absolute paths, drive-relative
 * paths and any `..` segment are rejected before touching the filesystem.
 */
function safeRelativePath(entry: unknown, location: string): string {
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new Error(`${location}: 章节路径必须是非空字符串`);
  }
  if (entry.includes("\0")) {
    throw new Error(`${location}: 章节路径含非法字符`);
  }
  if (
    /^[A-Za-z]:/.test(entry) ||
    path.posix.isAbsolute(entry) ||
    path.win32.isAbsolute(entry)
  ) {
    throw new Error(`${location}: 章节路径不能是绝对路径 (${entry})`);
  }
  const segments = entry.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw new Error(`${location}: 章节路径越界，不允许 ".." (${entry})`);
  }
  const relative = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  if (relative === "") {
    throw new Error(`${location}: 章节路径为空`);
  }
  if (!relative.toLowerCase().endsWith(".json")) {
    throw new Error(`${location}: 章节文件必须是 JSON (${entry})`);
  }
  return relative;
}

function realFile(rootReal: string, candidate: string, location: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch (error) {
    throw new Error(
      `${location}: 文件不存在或无法解析 (${candidate}): ${describeError(error)}`
    );
  }
  if (!isContained(rootReal, resolved)) {
    throw new Error(
      `${location}: 路径经 reparse/symlink 指向题库根目录之外 (${candidate})`
    );
  }
  let stats;
  try {
    stats = statSync(resolved);
  } catch (error) {
    throw new Error(`${location}: 无法读取文件信息 (${candidate}): ${describeError(error)}`);
  }
  if (!stats.isFile()) {
    throw new Error(`${location}: 不是普通文件 (${candidate})`);
  }
  return resolved;
}

function readJson(file: string, location: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`${location}: 无法读取文件 (${file}): ${describeError(error)}`);
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${location}: JSON 解析失败 (${file}): ${describeError(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSupportedLocales(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("supportedLocales 必须是数组");
    return;
  }
  const allowed: readonly string[] = UI_LOCALES;
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !allowed.includes(raw)) {
      errors.push(
        `supportedLocales 含非法语言值 ${JSON.stringify(raw)}；只允许 ${UI_LOCALES.join(", ")}`
      );
      continue;
    }
    if (seen.has(raw)) {
      errors.push(`supportedLocales 含重复语言值 ${JSON.stringify(raw)}`);
      continue;
    }
    seen.add(raw);
  }
  if (!seen.has("zh-CN")) {
    errors.push("supportedLocales 必须包含 zh-CN");
  }
}

function validateLocalizationSharedFields(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("localizationSharedFields 必须是对象");
    return;
  }
  const contentLocales: readonly string[] = CONTENT_LOCALES;
  for (const [locale, entities] of Object.entries(value)) {
    if (!contentLocales.includes(locale)) {
      errors.push(
        `localizationSharedFields.${locale}: 未注册的内容语言，只允许 ${CONTENT_LOCALES.join(", ")}`
      );
      continue;
    }
    if (!isRecord(entities)) {
      errors.push(`localizationSharedFields.${locale} 必须是实体 ID 到字段数组的对象`);
      continue;
    }
    for (const [entityId, fields] of Object.entries(entities)) {
      if (!entityId.trim()) {
        errors.push(`localizationSharedFields.${locale} 含空实体 ID`);
        continue;
      }
      if (!Array.isArray(fields)) {
        errors.push(
          `localizationSharedFields.${locale}.${entityId}: 字段列表必须是数组`
        );
        continue;
      }
      const seen = new Set<string>();
      for (const field of fields) {
        if (typeof field !== "string" || !SHARED_FIELD_NAMES.has(field)) {
          errors.push(
            `localizationSharedFields.${locale}.${entityId}: 未知字段 ${JSON.stringify(field)}`
          );
          continue;
        }
        if (seen.has(field)) {
          errors.push(
            `localizationSharedFields.${locale}.${entityId}: 重复字段 ${JSON.stringify(field)}`
          );
          continue;
        }
        seen.add(field);
      }
    }
  }
}

function validateManifest(value: unknown, edition: Edition): asserts value is Manifest {
  const location = "manifest.json";
  if (!isRecord(value)) {
    throw new Error(`${location}: 清单必须是 JSON 对象`);
  }
  const errors: string[] = [];
  if (value.schemaVersion !== 1) {
    errors.push(`schemaVersion 必须为 1，实际为 ${JSON.stringify(value.schemaVersion)}`);
  }
  if (value.edition !== edition) {
    errors.push(
      `edition 必须为 ${JSON.stringify(edition)}，实际为 ${JSON.stringify(value.edition)}`
    );
  }
  if (
    !Array.isArray(value.chapters) ||
    value.chapters.some((entry) => typeof entry !== "string")
  ) {
    errors.push("chapters 必须是字符串路径数组");
  }
  for (const field of ["expectedChapterCount", "expectedQuestionCount"] as const) {
    const count = value[field];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      errors.push(`${field} 必须是非负整数，实际为 ${JSON.stringify(count)}`);
    }
  }
  validateSupportedLocales(value.supportedLocales, errors);
  validateLocalizationSharedFields(value.localizationSharedFields, errors);
  if (errors.length > 0) {
    throw new Error(`${location}: 清单校验失败: ${errors.join("; ")}`);
  }
}

function claimId(
  seen: Map<string, string>,
  id: unknown,
  location: string,
  kind: string
): void {
  if (typeof id !== "string" || id === "") return;
  const previous = seen.get(id);
  if (previous) {
    throw new Error(
      `${location}: 全库重复 ID ${JSON.stringify(id)} (${kind})，首次出现在 ${previous}`
    );
  }
  seen.set(id, `${location}#${kind}`);
}

/**
 * Load and validate one selected bank. The manifest is the only entry point;
 * chapter files are parsed as JSON and never executed.
 */
export function loadBank(root: string, edition: Edition): LoadedBank {
  assertEdition(edition);
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("题库根目录必须是非空路径");
  }

  const rootAbs = path.resolve(root);
  let rootReal: string;
  try {
    rootReal = realpathSync(rootAbs);
  } catch (error) {
    throw new Error(`题库根目录不存在或无法访问 (${rootAbs}): ${describeError(error)}`);
  }
  let rootStats;
  try {
    rootStats = statSync(rootReal);
  } catch (error) {
    throw new Error(`题库根目录无法读取 (${rootAbs}): ${describeError(error)}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`题库根目录不是目录 (${rootAbs})`);
  }

  const manifestFile = realFile(
    rootReal,
    path.join(rootReal, "manifest.json"),
    "manifest.json"
  );
  const rawManifest = readJson(manifestFile, "manifest.json");
  validateManifest(rawManifest, edition);
  const manifest = rawManifest;

  const files = [manifestFile];
  const seenFiles = new Set<string>();
  const rememberFile = (file: string) => {
    seenFiles.add(file);
    if (process.platform === "win32") seenFiles.add(file.toLowerCase());
  };
  rememberFile(manifestFile);
  const chapters: Chapter[] = [];
  const seenIds = new Map<string, string>();

  manifest.chapters.forEach((entry, index) => {
    const location = `manifest.json chapters[${index}]`;
    const relative = safeRelativePath(entry, location);
    const fileLocation = relative;
    const file = realFile(rootReal, path.join(rootReal, ...relative.split("/")), fileLocation);
    const fileKey = process.platform === "win32" ? file.toLowerCase() : file;
    if (seenFiles.has(file) || seenFiles.has(fileKey)) {
      throw new Error(`${location}: 清单中重复的章节路径 (${relative})`);
    }
    rememberFile(file);

    const rawChapter = readJson(file, fileLocation);
    let errors: string[];
    try {
      errors = validateChapter(rawChapter as Chapter);
    } catch (error) {
      throw new Error(
        `${fileLocation}: 章节校验异常 (${file}): ${describeError(error)}`
      );
    }
    if (errors.length > 0) {
      throw new Error(
        `${fileLocation}: 章节校验失败 (${file}):\n - ${errors.join("\n - ")}`
      );
    }
    const chapter = rawChapter as Chapter;

    claimId(seenIds, chapter.id, fileLocation, "chapter");
    for (const lesson of [...chapter.lessons, ...chapter.challenges]) {
      claimId(seenIds, lesson.id, fileLocation, "lesson");
      for (const question of lesson.questions) {
        claimId(seenIds, question.id, fileLocation, "question");
      }
    }
    for (const card of chapter.cards) {
      claimId(seenIds, card.id, fileLocation, "card");
    }

    chapters.push(chapter);
    files.push(file);
  });

  if (chapters.length !== manifest.expectedChapterCount) {
    throw new Error(
      `manifest.json: expectedChapterCount 不符，清单=${manifest.expectedChapterCount}，实际=${chapters.length}`
    );
  }
  const questionCount = chapters.reduce(
    (total, chapter) =>
      total +
      [...chapter.lessons, ...chapter.challenges].reduce(
        (sum, lesson) => sum + lesson.questions.length,
        0
      ),
    0
  );
  if (questionCount !== manifest.expectedQuestionCount) {
    throw new Error(
      `manifest.json: expectedQuestionCount 不符，清单=${manifest.expectedQuestionCount}，实际=${questionCount}`
    );
  }
  if (edition === "internal") {
    if (chapters.length === 0) {
      throw new Error("manifest.json: internal 题库不能为空：至少需要一章");
    }
    if (questionCount === 0) {
      throw new Error("manifest.json: internal 题库不能为空：至少需要一道题");
    }
  }

  const supportedLocales: readonly UiLocale[] =
    manifest.supportedLocales ?? ["zh-CN"];
  const frSupported = supportedLocales.includes("fr");
  let gaps: LocalizationGap[];
  try {
    gaps = collectLocalizationGaps(chapters, "fr", SECTION_KEYS, {
      // 未声明 fr 时不消费共用字段裁定，避免旧中文版被无关声明阻断；
      // 小章 key 属于内容契约，无论是否启用都校验。
      sharedFields: frSupported
        ? manifest.localizationSharedFields?.fr ?? {}
        : {},
    });
  } catch (error) {
    throw new Error(
      `manifest.json: 法语本地化声明无效: ${describeError(error)}`
    );
  }
  if (frSupported && gaps.length > 0) {
    const preview = gaps
      .slice(0, 25)
      .map((gap) => formatLocalizationGap(gap))
      .join("\n - ");
    const more =
      gaps.length > 25 ? `\n ... 另有 ${gaps.length - 25} 项` : "";
    throw new Error(
      `manifest.json: supportedLocales 声明 fr，但 ${edition} 题库法语内容不完整（${gaps.length} 项）:\n - ${preview}${more}`
    );
  }

  // UI 文案目录随 app 构建，完整性不取决于内容是否启用 fr；旧中文版
  // manifest 也校验真实目录，避免未启用的语言键静默缺失。
  assertMessageCatalogsComplete();

  return { chapters, files, supportedLocales };
}

type RelativePathApi = Pick<typeof path, "relative" | "isAbsolute">;

/**
 * Convert a filesystem relationship into a portable, machine-free label.
 * `path.relative` returns an absolute path across Windows drives; treat any
 * absolute/escaping result as unknown instead of leaking a machine path.
 */
export function portableRelativePath(
  base: string,
  target: string,
  pathApi: RelativePathApi = path
): string | null {
  const relative = pathApi.relative(base, target);
  if (relative === "") return "";
  if (pathApi.isAbsolute(relative)) return null;
  const portable = relative.split(/[\\/]+/).join("/");
  if (portable === ".." || portable.startsWith("../")) return null;
  return portable;
}

function portableContentFileLabel(root: string, file: string): string {
  const relative = portableRelativePath(root, file);
  if (relative === null) return "@content/<external>";
  return relative === "" ? "@content" : `@content/${relative}`;
}

function isAbsoluteModuleId(id: string): boolean {
  return path.isAbsolute(id) || path.win32.isAbsolute(id);
}

function portableModuleIdLabel(id: string, contentRoot: string): string {
  if (id.startsWith("\0")) {
    const logical = id.slice(1);
    if (!isAbsoluteModuleId(logical)) return logical;
    id = logical;
  }
  if (!isAbsoluteModuleId(id)) return id;

  const appRelative = portableRelativePath(APP_ROOT, id);
  if (appRelative) return `@app/${appRelative}`;
  const contentRelative = portableRelativePath(contentRoot, id);
  if (contentRelative) return `@content/${contentRelative}`;
  const basename = id.split(/[\\/]/).pop() || "unknown";
  return `@external/${basename}`;
}

function writeProvenance(
  edition: Edition,
  root: string,
  watchedContentFiles: string[],
  actualModuleIds: string[]
): void {
  const canonicalRoot = realpathSync(root);
  const evidenceDir = path.join(APP_ROOT, ".fge-build");
  mkdirSync(evidenceDir, { recursive: true });
  const record = {
    schemaVersion: 1,
    edition,
    contentRoot: "@content",
    virtualModuleId: VIRTUAL_MODULE_ID,
    generatedAt: new Date().toISOString(),
    watchedContentFiles: watchedContentFiles.map((file) =>
      portableContentFileLabel(canonicalRoot, file)
    ),
    actualRollupModuleIds: [
      ...new Set(
        actualModuleIds.map((id) => portableModuleIdLabel(id, canonicalRoot))
      ),
    ].sort(),
  };
  writeFileSync(
    path.join(evidenceDir, `content-${edition}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Vite plugin for the single content entry. It emits CHAPTERS as a JSON-only
 * module and registers every selected file as a watch dependency.
 */
export function contentPlugin(options: {
  edition: Edition;
  root: string;
}): Plugin {
  assertEdition(options.edition);
  const edition = options.edition;
  const root = path.resolve(options.root);
  let loaded: LoadedBank | null = null;

  return {
    name: "fge-content",
    enforce: "pre",
    resolveId(id) {
      return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return null;
      loaded = loadBank(root, edition);
      for (const file of loaded.files) this.addWatchFile(file);
      const payload = JSON.stringify(loaded.chapters)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
      return {
        code: `export const CHAPTERS = ${payload};\nexport const SUPPORTED_LOCALES = ${JSON.stringify(loaded.supportedLocales)};`,
        map: null,
      };
    },
    generateBundle() {
      if (!loaded) return;
      const actualModuleIds = Array.from(this.getModuleIds());
      writeProvenance(edition, root, loaded.files, actualModuleIds);
    },
  };
}
