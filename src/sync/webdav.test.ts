import { describe, expect, test } from "vitest";
import { createBackup, parseBackup } from "../backup/progressBackup";
import type { Progress } from "../types";
import {
  MAX_SYNC_BYTES,
  SyncError,
  buildGetRequest,
  buildMkcolRequest,
  buildPropfindRequest,
  buildPutRequest,
  encodeSyncDocument,
  getHeader,
  getStrongEtag,
  hasLearningProgress,
  isDavCollectionPropfind,
  parseSyncDocument,
  sameProgress,
  syncFilename,
} from "./webdav";
import { DAV_PROPERTY_QUERY, SYNC_APP_FOLDER } from "./types";

const PROGRESS: Progress = {
  xp: 42,
  dailyGoal: 30,
  sound: true,
  translationEnabled: true,
  translationTiming: "after",
  shareCardContent: "both",
  days: {
    "2026-11-14": {
      xp: 8,
      earnedQids: ["ch1-l1-q1"],
      bonusIds: [],
      readSeconds: 30,
    },
  },
  lessons: { "ch1-l1": { completed: true, stars: 2 } },
  mistakes: { "ch1-l1-q2": { lastWrong: "2026-11-14", count: 1 } },
};

const backup = (progress: Progress = PROGRESS, exportedAt = "2026-11-14T08:00:00.000Z") => ({
  ...createBackup(progress),
  exportedAt,
});

describe("syncFilename", () => {
  test("按 edition 固定文件名", () => {
    expect(syncFilename("public")).toBe("fge-progress-public.json");
    expect(syncFilename("internal")).toBe("fge-progress-internal.json");
  });
});

describe("sync document", () => {
  test("外层包装 version 1 备份并可原样解析", () => {
    const encoded = encodeSyncDocument(backup());
    const raw = JSON.parse(encoded) as Record<string, unknown>;
    expect(raw.format).toBe("fge-sync");
    expect(raw.version).toBe(1);
    expect(parseSyncDocument(encoded).progress).toEqual(PROGRESS);
  });

  test("拒绝错误格式、版本或损坏的备份", () => {
    expect(() =>
      parseSyncDocument(
        JSON.stringify({ format: "other", version: 1, backup: backup() })
      )
    ).toThrow(SyncError);
    expect(() =>
      parseSyncDocument(
        JSON.stringify({ format: "fge-sync", version: 2, backup: backup() })
      )
    ).toThrow(SyncError);
    expect(() =>
      parseSyncDocument(
        JSON.stringify({
          format: "fge-sync",
          version: 1,
          backup: { ...backup(), progress: { xp: -1 } },
        })
      )
    ).toThrow();
    expect(() => parseSyncDocument("{bad json")).toThrow(SyncError);
  });

  test("拒绝超过同步大小上限的文本", () => {
    const huge = "x".repeat(MAX_SYNC_BYTES + 1);
    expect(() => parseSyncDocument(huge)).toThrow(SyncError);
  });

  test("编码结果超出上限时拒绝", () => {
    // 共享的 Progress 校验会拒绝超大输入,这里直接伪造一个刚好超限的备份。
    const backupWithHugeText = {
      ...backup(),
      progress: { ...PROGRESS, extra: "x".repeat(MAX_SYNC_BYTES) },
    } as unknown as ReturnType<typeof backup>;
    expect(() => encodeSyncDocument(backupWithHugeText)).toThrow(SyncError);
  });
});

describe("etag", () => {
  test("只接受非空强 ETag", () => {
    expect(getStrongEtag({ ETag: '"abc"' })).toBe('"abc"');
    expect(getStrongEtag({ etag: '"abc"' })).toBe('"abc"');
    expect(getStrongEtag({ ETag: 'W/"abc"' })).toBeNull();
    expect(getStrongEtag({ ETag: "" })).toBeNull();
    expect(getStrongEtag({})).toBeNull();
  });

  test("只接受单个合法带双引号的强 ETag", () => {
    expect(getStrongEtag({ ETag: '  "abc"  ' })).toBe('"abc"');
    expect(getStrongEtag({ ETag: '""' })).toBe('""');
    expect(getStrongEtag({ ETag: '"a,b"' })).toBe('"a,b"');
    expect(getStrongEtag({ ETag: '"a\\b"' })).toBe('"a\\b"');

    expect(getStrongEtag({ ETag: "*" })).toBeNull();
    expect(getStrongEtag({ ETag: "abc" })).toBeNull();
    expect(getStrongEtag({ ETag: 'W/"abc"' })).toBeNull();
    expect(getStrongEtag({ ETag: 'w/"abc"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"a", "b"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"a","b"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"a" trailing' })).toBeNull();
    expect(getStrongEtag({ ETag: '"a"\r\nX: injected' })).toBeNull();
    expect(getStrongEtag({ ETag: '"a b"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\t"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u0000"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u001f"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u007f"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u0100"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u4e2d"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\uD800"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\uDC00"' })).toBeNull();
    expect(getStrongEtag({ ETag: '"\u00e9"' })).toBe('"\u00e9"');
    expect(getStrongEtag({ ETag: "'abc'" })).toBeNull();
  });

  test("header 查找大小写不敏感", () => {
    expect(getHeader({ "If-Match": '"1"' }, "if-match")).toBe('"1"');
    expect(getHeader(undefined, "etag")).toBeNull();
  });
});

describe("requests", () => {
  test("GET 只请求固定文件,不携带凭据", () => {
    const request = buildGetRequest("fge-progress-public.json");
    expect(request.method).toBe("GET");
    expect(request.filename).toBe("fge-progress-public.json");
    expect(request.headers.Accept).toContain("application/json");
    expect(JSON.stringify(request.headers)).not.toMatch(/authorization|password/i);
    expect(request.body).toBeUndefined();
  });

  test("覆盖使用 If-Match,新建使用 If-None-Match: *", () => {
    const overwrite = buildPutRequest(backup(), { ifMatch: '"v1"' });
    expect(overwrite.method).toBe("PUT");
    expect(overwrite.headers["If-Match"]).toBe('"v1"');
    expect(overwrite.headers["If-None-Match"]).toBeUndefined();
    expect(parseSyncDocument(overwrite.body ?? "").progress).toEqual(PROGRESS);

    const create = buildPutRequest(backup(), { ifNoneMatch: "*" });
    expect(create.headers["If-None-Match"]).toBe("*");
    expect(create.headers["If-Match"]).toBeUndefined();
  });

  test("构建 If-Match 时再次拒绝非单个强 ETag", () => {
    for (const bad of ["*", 'W/"v1"', '"a", "b"', '"a b"', "v1", '"v1"\r\n']) {
      expect(() => buildPutRequest(backup(), { ifMatch: bad })).toThrow(SyncError);
    }
  });
});

describe("application folder requests", () => {
  const HREF = `/dav/${SYNC_APP_FOLDER}/`;

  function response(
    options: {
      href?: string;
      status?: string;
      collection?: boolean;
      responseStatus?: string;
    } = {}
  ): string {
    const { href = HREF, status = "HTTP/1.1 200 OK", collection = true } =
      options;
    return [
      "<d:response>",
      `<d:href>${href}</d:href>`,
      "<d:propstat>",
      "<d:prop><d:resourcetype>",
      collection ? "<d:collection/>" : "",
      "</d:resourcetype></d:prop>",
      `<d:status>${status}</d:status>`,
      "</d:propstat>",
      "</d:response>",
    ].join("");
  }

  function multistatus(...responses: string[]): string {
    return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses.join(
      ""
    )}</d:multistatus>`;
  }

  test("MKCOL 只带固定文件名、无请求体", () => {
    const request = buildMkcolRequest();
    expect(request.method).toBe("MKCOL");
    expect(request.filename).toBe(syncFilename());
    expect(request.body).toBeUndefined();
    expect(request.headers).toEqual({});
  });

  test("PROPFIND 使用固定文件名、Depth: 0 和固定属性查询", () => {
    const request = buildPropfindRequest();
    expect(request.method).toBe("PROPFIND");
    expect(request.filename).toBe(syncFilename());
    expect(request.headers.Depth).toBe("0");
    expect(request.headers["Content-Type"]).toContain("application/xml");
    expect(request.body).toBe(DAV_PROPERTY_QUERY);
  });

  test("仅接受 207 中目标目录的成功的 DAV collection", () => {
    expect(isDavCollectionPropfind(multistatus(response()))).toBe(true);
    expect(
      isDavCollectionPropfind(
        multistatus(response({ status: "HTTP/1.1 204 No Content" }))
      )
    ).toBe(true);
    // Depth 0 通常只有一个 response;额外 response 不得掩盖目标目录的成功结果。
    expect(
      isDavCollectionPropfind(
        multistatus(response({ href: "/dav/Other/" }), response())
      )
    ).toBe(true);
    // 个别服务端省略 href;Depth:0 请求目标仍是应用目录。
    expect(
      isDavCollectionPropfind(
        '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
      )
    ).toBe(true);
  });

  test.each([
    ["HTML", "<html><body>created</body></html>"],
    ["空文本", ""],
    ["未闭合 XML", '<d:multistatus xmlns:d="DAV:"><d:response>'],
    ["错误根命名空间", '<multistatus xmlns="urn:not-dav"></multistatus>'],
    ["错误根元素", '<d:ok xmlns:d="DAV:"/>'],
    ["DOCTYPE", `<!DOCTYPE x><d:multistatus xmlns:d="DAV:">${response()}</d:multistatus>`],
    ["没有 collection", multistatus(response({ collection: false }))],
    ["propstat 404", multistatus(response({ status: "HTTP/1.1 404 Not Found" }))],
    ["其它 href", multistatus(response({ href: "/dav/Other/" }))],
    [
      "没有目标 response",
      multistatus(
        response({ href: "/dav/Other/" }),
        response({ href: "/dav/Third/" })
      ),
    ],
    ["没有 response", multistatus()],
  ])("拒绝无效 PROPFIND 207: %s", (_name, xml) => {
    expect(isDavCollectionPropfind(xml)).toBe(false);
  });
});

describe("progress comparison", () => {
  test("忽略导出时间与对象/数组顺序", () => {
    const reordered: Progress = {
      ...PROGRESS,
      days: {
        "2026-11-14": {
          xp: 8,
          bonusIds: [],
          earnedQids: ["ch1-l1-q1"],
          readSeconds: 30,
        },
      },
      mistakes: { ...PROGRESS.mistakes },
    };
    expect(sameProgress(PROGRESS, reordered)).toBe(true);
    expect(
      sameProgress(
        PROGRESS,
        { ...PROGRESS, days: {} } as Progress
      )
    ).toBe(false);
    expect(sameProgress(PROGRESS, { ...PROGRESS, xp: 43 })).toBe(false);
  });

  test("解析后导出的备份与原始进度相等(exportedAt 不参与)", () => {
    const a = backup(PROGRESS, "2026-11-14T08:00:00.000Z");
    const b = parseBackup(JSON.stringify(backup(PROGRESS, "2026-11-15T09:30:00.000Z")));
    expect(sameProgress(a.progress, b.progress)).toBe(true);
  });
});

describe("hasLearningProgress", () => {
  test("默认空进度与纯设置不算学习进度", () => {
    expect(hasLearningProgress({ ...PROGRESS, xp: 0, days: {}, lessons: {}, mistakes: {} })).toBe(false);
  });

  test("XP、课程、错题或学习时长任一存在即算进度", () => {
    expect(hasLearningProgress(PROGRESS)).toBe(true);
    expect(
      hasLearningProgress({
        ...PROGRESS,
        xp: 0,
        lessons: {},
        mistakes: {},
        days: {
          "2026-11-14": {
            xp: 0,
            earnedQids: [],
            bonusIds: [],
            readSeconds: 5,
          },
        },
      })
    ).toBe(true);
    expect(
      hasLearningProgress({ ...PROGRESS, xp: 0, days: {}, mistakes: {} })
    ).toBe(true);
  });
});
