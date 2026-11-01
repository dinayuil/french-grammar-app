// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Chapter, Question } from "../src/types";
import viteConfig from "../vite.config";

const readLog = vi.hoisted(() => [] as string[]);
const writeLog = vi.hoisted(() => [] as Array<{ file: string; data: string }>);

// Record every read so a test can prove the loader never touches the
// unselected content repository. Evidence writes are captured but not
// committed to the real .fge-build during tests.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const wrap = (fn: (...args: any[]) => any) =>
    (first: any, ...rest: any[]) => {
      readLog.push(typeof first === "string" ? first : String(first));
      return fn(first, ...rest);
    };
  const realpathSync = wrap(actual.realpathSync as any) as typeof actual.realpathSync & {
    native: typeof actual.realpathSync.native;
  };
  realpathSync.native = wrap((actual.realpathSync as any).native);
  return {
    ...actual,
    readFileSync: wrap(actual.readFileSync as any),
    realpathSync,
    writeFileSync: (file: any, data: any, ...rest: any[]) => {
      writeLog.push({ file: String(file), data: String(data) });
      if (String(file).includes(".fge-build")) return;
      return (actual.writeFileSync as any)(file, data, ...rest);
    },
  };
});

import {
  contentPlugin,
  loadBank,
  portableRelativePath,
  resolveContentRoot,
  resolveEdition,
} from "./content";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE_DIR = mkdtempSync(path.join(tmpdir(), "fge-content-test-"));
let fixtureCounter = 0;

afterAll(() => {
  rmSync(BASE_DIR, { recursive: true, force: true });
});

function makeRoot(label: string): string {
  const dir = path.join(BASE_DIR, `${label}-${fixtureCounter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fileIn(root: string, rel: string): string {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

function writeRaw(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}

function writeJson(file: string, value: unknown): string {
  return writeRaw(file, JSON.stringify(value, null, 2));
}

function choiceQuestion(id: string): Question {
  return {
    id,
    prompt: `SYNTHETIC PROMPT ${id}`,
    explain: "SYNTHETIC EXPLANATION",
    type: "choice",
    options: ["a", "b"],
    answer: 0,
  };
}

function makeChapter(id: string, questionIds: string[] = [`${id}-q1`]): Chapter {
  return {
    id,
    title: `SYNTHETIC CHAPTER ${id}`,
    titleFr: `SYNTHETIC TITLE ${id}`,
    cards: [],
    lessons: [
      {
        id: `${id}-lesson`,
        title: "SYNTHETIC LESSON",
        kind: "lesson",
        source: "SYNTHETIC SOURCE",
        questions: questionIds.map(choiceQuestion),
      },
    ],
    challenges: [],
  };
}

function countQuestions(chapters: Chapter[]): number {
  return chapters.reduce(
    (total, chapter) =>
      total +
      [...chapter.lessons, ...chapter.challenges].reduce(
        (sum, lesson) => sum + lesson.questions.length,
        0
      ),
    0
  );
}

function manifestFor(chapters: Chapter[], patch: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    edition: "public",
    chapters: chapters.map((_, index) => `chapters/ch${index + 1}.json`),
    expectedChapterCount: chapters.length,
    expectedQuestionCount: countQuestions(chapters),
    ...patch,
  };
}

function writeBank(
  root: string,
  chapters: Chapter[],
  manifestPatch: Record<string, unknown> = {}
): { manifest: ReturnType<typeof manifestFor>; chapterFiles: string[] } {
  const chapterFiles = chapters.map((chapter, index) => {
    const rel = `chapters/ch${index + 1}.json`;
    return writeJson(fileIn(root, rel), chapter);
  });
  const manifest = manifestFor(chapters, manifestPatch);
  writeJson(path.join(root, "manifest.json"), manifest);
  return { manifest, chapterFiles };
}

function expectLoadFailure(root: string, edition: "public" | "internal", pattern: RegExp): void {
  expect(() => loadBank(root, edition)).toThrow(pattern);
}

describe("resolveEdition and content root selection", () => {
  it("defaults an unset edition to public", () => {
    expect(resolveEdition(undefined)).toBe("public");
  });

  it("accepts only exact public/internal values", () => {
    expect(resolveEdition("public")).toBe("public");
    expect(resolveEdition("internal")).toBe("internal");
    for (const raw of ["", "Public", "INTERNAL", "private", " public", "public "]) {
      expect(() => resolveEdition(raw)).toThrow(/FGE_EDITION|edition|public|internal/i);
    }
  });

  it("selects only the environment variable for the chosen edition", () => {
    const publicDir = path.join(BASE_DIR, "env-public");
    const internalDir = path.join(BASE_DIR, "env-internal");
    const env = {
      FGE_PUBLIC_CONTENT_DIR: publicDir,
      FGE_INTERNAL_CONTENT_DIR: internalDir,
    };
    expect(resolveContentRoot("public", env)).toBe(publicDir);
    expect(resolveContentRoot("internal", env)).toBe(internalDir);
  });

  it("rejects an invalid runtime edition before selecting a root", () => {
    expect(() => resolveContentRoot("private" as never, {})).toThrow(/edition|public|internal/i);
  });
});

describe("portable provenance labels", () => {
  it("drops cross-drive or escaping path.relative results with path.win32", () => {
    expect(portableRelativePath("D:\\app", "D:\\app\\src\\main.tsx", path.win32)).toBe(
      "src/main.tsx"
    );
    expect(
      portableRelativePath("D:\\app", "E:\\content\\manifest.json", path.win32)
    ).toBeNull();
    expect(portableRelativePath("D:\\app", "D:\\app\\..\\outside", path.win32)).toBeNull();
  });
});

describe("Vite configuration binding", () => {
  it("binds the compile constant, virtual module, output and fs allowlist to one edition", () => {
    const edition = resolveEdition(process.env.FGE_EDITION);
    const other = edition === "public" ? "internal" : "public";
    const config = viteConfig as {
      define?: Record<string, string>;
      build?: { outDir?: string };
      server?: { fs?: { allow?: string[] } };
      test?: { exclude?: string[] };
    };

    expect(__FGE_EDITION__).toBe(edition);
    expect(config.define?.__FGE_EDITION__).toBe(JSON.stringify(edition));
    expect(config.build?.outDir).toBe(path.resolve(APP_ROOT, "dist", edition));
    expect(config.server?.fs?.allow).toEqual([
      APP_ROOT,
      resolveContentRoot(edition),
    ]);
    expect(config.server?.fs?.allow).not.toContain(resolveContentRoot(other));
    expect(config.test?.exclude).toContain("scripts/**/*.test.mjs");
  });
});

describe("loadBank: valid banks", () => {
  it("loads a valid public bank and exposes manifest plus selected files", () => {
    const root = makeRoot("valid-public");
    const chapters = [makeChapter("ch-a"), makeChapter("ch-b")];
    const { chapterFiles } = writeBank(root, chapters);

    const bank = loadBank(root, "public");

    expect(bank.chapters.map((chapter) => chapter.id)).toEqual(["ch-a", "ch-b"]);
    expect(bank.files).toEqual([
      path.join(root, "manifest.json"),
      ...chapterFiles,
    ]);
  });

  it("accepts a legal empty public bank", () => {
    const root = makeRoot("empty-public");
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "public",
      chapters: [],
      expectedChapterCount: 0,
      expectedQuestionCount: 0,
    });

    const bank = loadBank(root, "public");

    expect(bank.chapters).toEqual([]);
    expect(bank.files).toEqual([path.join(root, "manifest.json")]);
  });

  it("rejects an empty internal bank", () => {
    const root = makeRoot("empty-internal");
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "internal",
      chapters: [],
      expectedChapterCount: 0,
      expectedQuestionCount: 0,
    });

    expectLoadFailure(root, "internal", /internal.*(空|至少).*(章|题)/i);
  });

  it("rejects an internal bank with no questions even when chapters exist", () => {
    const root = makeRoot("empty-internal-questions");
    const chapter: Chapter = {
      id: "ch-no-questions",
      title: "SYNTHETIC EMPTY CHAPTER",
      titleFr: "SYNTHETIC EMPTY TITLE",
      cards: [],
      lessons: [],
      challenges: [],
    };
    writeBank(root, [chapter], { edition: "internal" });

    expectLoadFailure(root, "internal", /internal.*(空|至少|题目).*(章|题|question)/i);
  });

  it("reads only the selected repository root", () => {
    for (const edition of ["public", "internal"] as const) {
      const selectedRoot = makeRoot(`selected-${edition}`);
      const unselectedRoot = makeRoot(`unselected-${edition}`);
      writeBank(selectedRoot, [makeChapter(`${edition}-selected`)], { edition });
      writeBank(unselectedRoot, [makeChapter(`${edition}-unselected`)], { edition });

      readLog.length = 0;
      const bank = loadBank(selectedRoot, edition);

      expect(bank.chapters.map((chapter) => chapter.id)).toEqual([`${edition}-selected`]);
      expect(readLog.length).toBeGreaterThan(0);
      const forbidden = unselectedRoot.toLowerCase();
      for (const accessed of readLog) {
        expect(accessed.toLowerCase().startsWith(forbidden)).toBe(false);
      }
    }
  });

  it("does not fall back to another repository when the selected root is missing", () => {
    const missingRoot = path.join(BASE_DIR, "fallback-missing");
    const otherRoot = makeRoot("fallback-other");
    writeBank(otherRoot, [makeChapter("ch-other")], { edition: "public" });

    readLog.length = 0;
    expect(() => loadBank(missingRoot, "public")).toThrow();

    const forbidden = otherRoot.toLowerCase();
    for (const accessed of readLog) {
      expect(accessed.toLowerCase().startsWith(forbidden)).toBe(false);
    }
  });
});

describe("loadBank: missing and malformed input", () => {
  it("rejects a missing content root", () => {
    const missing = path.join(BASE_DIR, "does-not-exist");
    expectLoadFailure(missing, "public", /根目录|不存在|directory|no such/i);
  });

  it("rejects a missing manifest", () => {
    const root = makeRoot("missing-manifest");
    expectLoadFailure(root, "public", /manifest\.json|清单|不存在/i);
  });

  it("rejects malformed manifest JSON with its location", () => {
    const root = makeRoot("bad-manifest-json");
    writeRaw(path.join(root, "manifest.json"), '{ "schemaVersion": 1, ');
    expectLoadFailure(root, "public", /manifest\.json.*JSON|JSON.*manifest\.json/i);
  });

  it("rejects malformed chapter JSON with its location", () => {
    const root = makeRoot("bad-chapter-json");
    const chapter = makeChapter("ch-bad");
    writeJson(path.join(root, "manifest.json"), manifestFor([chapter]));
    writeRaw(fileIn(root, "chapters/ch1.json"), '{ "id": ');
    expectLoadFailure(root, "public", /chapters[\\/]ch1\.json.*JSON|JSON.*chapters[\\/]ch1\.json/i);
  });
});

describe("loadBank: manifest contract", () => {
  it("rejects an unsupported schema version", () => {
    const root = makeRoot("bad-version");
    writeBank(root, [makeChapter("ch-a")], { schemaVersion: 2 });
    expectLoadFailure(root, "public", /schemaVersion|版本/i);
  });

  it("rejects a manifest for the other edition", () => {
    const root = makeRoot("wrong-edition");
    writeBank(root, [makeChapter("ch-a")], { edition: "internal" });
    expectLoadFailure(root, "public", /edition|public|internal/i);
  });

  it("rejects non-integer or negative expected counts", () => {
    for (const patch of [
      { expectedChapterCount: -1 },
      { expectedQuestionCount: 1.5 },
      { expectedQuestionCount: "1" },
    ]) {
      const root = makeRoot("bad-count-type");
      writeBank(root, [makeChapter("ch-a")], patch);
      expectLoadFailure(root, "public", /expectedChapterCount|expectedQuestionCount|整数|数量/i);
    }
  });

  it("rejects a chapter count mismatch", () => {
    const root = makeRoot("bad-chapter-count");
    writeBank(root, [makeChapter("ch-a"), makeChapter("ch-b")], {
      expectedChapterCount: 1,
    });
    expectLoadFailure(root, "public", /expectedChapterCount|章节.*数量|数量.*章节/i);
  });

  it("rejects a question count mismatch", () => {
    const root = makeRoot("bad-question-count");
    writeBank(root, [makeChapter("ch-a", ["ch-a-q1", "ch-a-q2"])], {
      expectedQuestionCount: 1,
    });
    expectLoadFailure(root, "public", /expectedQuestionCount|题目.*数量|数量.*题目/i);
  });

  it("rejects a missing chapter file", () => {
    const root = makeRoot("missing-chapter");
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "public",
      chapters: ["chapters/nope.json"],
      expectedChapterCount: 1,
      expectedQuestionCount: 1,
    });
    expectLoadFailure(root, "public", /chapters[\\/]nope\.json|不存在|无法读取/i);
  });

  it("rejects a bank with an empty lesson", () => {
    const root = makeRoot("empty-lesson");
    const chapter = makeChapter("ch-empty", []);
    writeBank(root, [chapter]);
    expectLoadFailure(root, "public", /questions 为空|空/i);
  });
});

describe("loadBank: paths and identity", () => {
  it("rejects duplicate manifest paths", () => {
    const root = makeRoot("duplicate-path");
    const chapter = makeChapter("ch-dup");
    writeJson(fileIn(root, "chapters/ch1.json"), chapter);
    writeJson(
      path.join(root, "manifest.json"),
      manifestFor([chapter, chapter], {
        chapters: ["chapters/ch1.json", "./chapters/ch1.json"],
      })
    );
    expectLoadFailure(root, "public", /重复的章节路径|duplicate path/i);
  });

  it("rejects traversal paths", () => {
    const root = makeRoot("traversal-root");
    const outside = makeRoot("traversal-outside");
    writeJson(path.join(outside, "leak.json"), makeChapter("ch-leak"));
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "public",
      chapters: [`../${path.basename(outside)}/leak.json`],
      expectedChapterCount: 1,
      expectedQuestionCount: 1,
    });
    expectLoadFailure(root, "public", /越界|traversal|\.\.|非法路径/i);
  });

  it("rejects absolute paths even when the target exists", () => {
    const root = makeRoot("absolute-root");
    const outside = makeRoot("absolute-outside");
    const outsideFile = writeJson(path.join(outside, "leak.json"), makeChapter("ch-leak"));
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "public",
      chapters: [outsideFile],
      expectedChapterCount: 1,
      expectedQuestionCount: 1,
    });
    expectLoadFailure(root, "public", /绝对路径|absolute|非法路径/i);
  });

  it("rejects a path that resolves through a reparse point outside the root", () => {
    const root = makeRoot("link-root");
    const outside = makeRoot("link-outside");
    writeJson(path.join(outside, "leak.json"), makeChapter("ch-leak"));
    const link = path.join(root, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      edition: "public",
      chapters: ["linked/leak.json"],
      expectedChapterCount: 1,
      expectedQuestionCount: 1,
    });

    try {
      expectLoadFailure(root, "public", /symlink|reparse|越界|根外|非法路径/i);
    } finally {
      rmSync(link, { recursive: true, force: true });
    }
  });

  it("rejects duplicate IDs across different chapters", () => {
    const root = makeRoot("duplicate-global-id");
    writeBank(root, [
      makeChapter("ch-one", ["shared-question"]),
      makeChapter("ch-two", ["shared-question"]),
    ]);
    expectLoadFailure(root, "public", /全库|重复.*ID|ID.*重复/i);
  });
});

describe("contentPlugin", () => {
  it("serves CHAPTERS as a JSON-only virtual module and watches selected files", () => {
    const root = makeRoot("plugin-public");
    const chapter = makeChapter("ch-plugin");
    const { chapterFiles } = writeBank(root, [chapter]);
    const plugin = contentPlugin({ edition: "public", root });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    const load = plugin.load as (this: unknown, id: string) => unknown;

    expect(resolveId("virtual:fge-content")).toBe("\0virtual:fge-content");
    expect(resolveId("other")).toBeNull();

    const watched: string[] = [];
    const result = load.call(
      { addWatchFile: (file: string) => watched.push(file) },
      "\0virtual:fge-content"
    ) as { code: string; map: null };

    expect(watched).toEqual([
      path.join(root, "manifest.json"),
      ...chapterFiles,
    ]);
    expect(result.code.startsWith("export const CHAPTERS = ")).toBe(true);
    expect(result.code).not.toMatch(/\bimport\s|\brequire\s*\(|\beval\s*\(/);
    const payload = result.code
      .replace(/^export const CHAPTERS = /, "")
      .replace(/;\s*$/, "");
    expect(JSON.parse(payload)).toEqual([chapter]);
  });

  it("records watched content separately from the actual Rollup module graph", () => {
    const root = makeRoot("plugin-provenance");
    const chapter = makeChapter("ch-provenance");
    writeBank(root, [chapter]);
    const plugin = contentPlugin({ edition: "public", root });
    const load = plugin.load as (this: unknown, id: string) => unknown;

    load.call({ addWatchFile: () => {} }, "\0virtual:fge-content");
    writeLog.length = 0;

    const moduleIds = [
      "\0virtual:fge-content",
      `\0${path.join(APP_ROOT, "src", "hidden-null.ts")}`,
      path.join(APP_ROOT, "src", "main.tsx"),
      path.join(APP_ROOT, "node_modules", "react", "index.js"),
      "vite/modulepreload-polyfill.js",
      path.resolve(APP_ROOT, "..", "external-module.js"),
    ];
    let getModuleIdsCalls = 0;
    const generateBundle = plugin.generateBundle as (this: unknown) => void;
    generateBundle.call({
      getModuleIds: () => {
        getModuleIdsCalls += 1;
        return moduleIds[Symbol.iterator]();
      },
    });

    expect(getModuleIdsCalls).toBe(1);
    const entry = writeLog.find((item) => item.file.endsWith("content-public.json"));
    expect(entry).toBeTruthy();
    const record = JSON.parse(entry!.data);

    expect(record).toMatchObject({
      schemaVersion: 1,
      edition: "public",
      contentRoot: "@content",
      virtualModuleId: "virtual:fge-content",
      watchedContentFiles: [
        "@content/manifest.json",
        "@content/chapters/ch1.json",
      ],
      actualRollupModuleIds: [
        "@app/node_modules/react/index.js",
        "@app/src/hidden-null.ts",
        "@app/src/main.tsx",
        "@external/external-module.js",
        "virtual:fge-content",
        "vite/modulepreload-polyfill.js",
      ],
    });
    expect(record).not.toHaveProperty("dependencies");
    expect(record).not.toHaveProperty("chapterModules");
    expect(record.actualRollupModuleIds).not.toContain("@content/chapters/ch1.json");
    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(serialized).not.toContain("content-private");
  });

  it("keeps manifest and chapter labels when the selected root is a junction", () => {
    const targetRoot = makeRoot("plugin-junction-target");
    const chapter = makeChapter("ch-junction");
    writeBank(targetRoot, [chapter]);
    const linkRoot = path.join(BASE_DIR, `plugin-junction-link-${fixtureCounter++}`);
    symlinkSync(
      targetRoot,
      linkRoot,
      process.platform === "win32" ? "junction" : "dir"
    );

    try {
      const plugin = contentPlugin({ edition: "public", root: linkRoot });
      const load = plugin.load as (this: unknown, id: string) => unknown;
      load.call({ addWatchFile: () => {} }, "\0virtual:fge-content");
      writeLog.length = 0;

      const generateBundle = plugin.generateBundle as (this: unknown) => void;
      generateBundle.call({
        getModuleIds: () => ["\0virtual:fge-content"][Symbol.iterator](),
      });

      const entry = writeLog.find((item) =>
        item.file.endsWith("content-public.json")
      );
      expect(entry).toBeTruthy();
      const record = JSON.parse(entry!.data);

      expect(record.contentRoot).toBe("@content");
      expect(record.watchedContentFiles).toEqual([
        "@content/manifest.json",
        "@content/chapters/ch1.json",
      ]);
      expect(record.actualRollupModuleIds).toContain("virtual:fge-content");
      expect(JSON.stringify(record)).not.toMatch(/[A-Za-z]:[\\/]/);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
    }
  });
});
