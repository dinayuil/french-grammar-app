import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APP_ROOT,
  TEMPLATE_ROOT,
  assertTemplateClean,
  buildHarmony,
  editionConfig,
  projectDirFor,
  validateEditionMarker,
  validateEditionProvenance,
  validateRawfileMirror,
  validateReferencedAssets,
} from "./build-harmony.mjs";

function withTempDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "fge-harmony-test-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("public and internal editions have isolated identities and project dirs", () => {
  const pub = editionConfig("public");
  const internal = editionConfig("internal");

  assert.deepEqual(pub, {
    edition: "public",
    bundleName: "com.fge.open",
    appName: "法语语法练习",
  });
  assert.deepEqual(internal, {
    edition: "internal",
    bundleName: "com.fge.app",
    appName: "法语语法练习·内部版",
  });

  const appRoot = path.resolve("/tmp/fge-app");
  const publicDir = projectDirFor(appRoot, "public");
  const internalDir = projectDirFor(appRoot, "internal");
  assert.notEqual(publicDir, internalDir);
  assert.match(publicDir, /[\\/]public[\\/]project$/);
  assert.match(internalDir, /[\\/]internal[\\/]project$/);

  assert.throws(() => editionConfig("prod"), /public.*internal/i);
});

test("referenced assets must exist, be non-empty, local and contained", () => {
  withTempDir((dist) => {
    write(path.join(dist, "index.html"),
      '<script type="module" src="./assets/app.js"></script>' +
      '<link rel="stylesheet" href="./assets/app.css">');
    write(path.join(dist, "assets", "app.js"), "console.log('ok');");
    write(
      path.join(dist, "assets", "app.css"),
      "body{background:url('./img/bg.png')}"
    );
    write(path.join(dist, "assets", "img", "bg.png"), "png");
    assert.deepEqual(validateReferencedAssets(dist).sort(), [
      "assets/app.css",
      "assets/app.js",
      "assets/img/bg.png",
      "index.html",
    ]);

    writeFileSync(path.join(dist, "assets", "app.js"), "");
    assert.throws(() => validateReferencedAssets(dist), /empty|空|non-empty/i);
  });
});

test("missing and escaping references fail before packaging", () => {
  withTempDir((dist) => {
    write(path.join(dist, "index.html"),
      '<script src="./assets/missing.js"></script>');
    assert.throws(() => validateReferencedAssets(dist), /missing|不存在/i);

    write(path.join(dist, "assets", "missing.js"), "ok");
    write(path.join(dist, "index.html"),
      '<img src="../outside.png">');
    assert.throws(() => validateReferencedAssets(dist), /outside|越界|contained/i);

    write(path.join(dist, "index.html"),
      '<script src="https://cdn.example.test/app.js"></script>');
    assert.throws(() => validateReferencedAssets(dist), /remote|远程|外部|origin/i);

    write(path.join(dist, "index.html"),
      '<script src="/assets/absolute.js"></script>');
    assert.throws(() => validateReferencedAssets(dist), /absolute|相对/i);
  });
});

test("edition marker must match the generated bundle", () => {
  withTempDir((dir) => {
    const marker = path.join(dir, "fge-edition.json");
    const expected = { edition: "public", bundleName: "com.fge.open" };
    write(marker, JSON.stringify({
      format: "fge-harmony",
      version: 1,
      ...expected,
    }));

    assert.doesNotThrow(() => validateEditionMarker(marker, expected));
    assert.throws(
      () => validateEditionMarker(marker, {
        edition: "internal",
        bundleName: "com.fge.app",
      }),
      /edition|bundle/i
    );

    write(marker, JSON.stringify({
      format: "fge-harmony",
      version: 1,
      edition: "internal",
      bundleName: "com.fge.open",
    }));
    assert.throws(
      () => validateEditionMarker(marker, expected),
      /edition|bundle/i
    );
  });
});

test("provenance must belong to the selected edition and stay content-relative", () => {
  withTempDir((appRoot) => {
    const writeProvenance = (edition, contentRoot, files) => {
      write(
        path.join(appRoot, ".fge-build", `content-${edition}.json`),
        JSON.stringify({
          schemaVersion: 1,
          edition,
          contentRoot,
          watchedContentFiles: files,
        })
      );
    };

    writeProvenance("public", "@content", [
      "@content/manifest.json",
      "@content/chapters/pub-c01.json",
    ]);
    assert.equal(
      validateEditionProvenance(appRoot, "public").edition,
      "public"
    );

    writeProvenance("public", "C:/private/content-private", [
      "@content/manifest.json",
    ]);
    assert.throws(
      () => validateEditionProvenance(appRoot, "public"),
      /contentRoot|relative/i
    );

    writeProvenance("public", "@content", ["@content/../content-private/x.json"]);
    assert.throws(
      () => validateEditionProvenance(appRoot, "public"),
      /traversal|\.\./i
    );

    write(
      path.join(appRoot, ".fge-build", "content-public.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "internal",
        contentRoot: "@content",
        watchedContentFiles: ["@content/manifest.json"],
      })
    );
    assert.throws(
      () => validateEditionProvenance(appRoot, "public"),
      /edition|public/i
    );
  });
});

test("rawfile mirror must be byte-identical and never contain empty assets", () => {
  withTempDir((dir) => {
    const dist = path.join(dir, "dist");
    const raw = path.join(dir, "rawfile", "web");
    write(path.join(dist, "index.html"), "<html>ok</html>");
    write(path.join(dist, "assets", "app.js"), "x");
    write(path.join(raw, "index.html"), "<html>ok</html>");
    write(path.join(raw, "assets", "app.js"), "x");

    assert.doesNotThrow(() => validateRawfileMirror(dist, raw));

    write(path.join(raw, "assets", "app.js"), "");
    assert.throws(() => validateRawfileMirror(dist, raw), /empty|空/i);

    write(path.join(raw, "assets", "app.js"), "x");
    write(path.join(raw, "assets", "extra.js"), "x");
    assert.throws(() => validateRawfileMirror(dist, raw), /extra|unexpected|多/i);
  });
});

test("template must not contain generated resources, packages or local config", () => {
  withTempDir((template) => {
    write(path.join(template, "AppScope", "app.json5"), "{}");
    write(path.join(template, "entry", "src", "main", "ets", "pages", "Index.ets"), "//");
    assert.doesNotThrow(() => assertTemplateClean(template));

    write(path.join(template, "entry", "src", "main", "resources", "rawfile", "web", "index.html"), "x");
    assert.throws(() => assertTemplateClean(template), /rawfile/i);
  });

  withTempDir((template) => {
    write(path.join(template, "AppScope", "app.json5"), "{}");
    write(path.join(template, "release.hap"), "x");
    assert.throws(() => assertTemplateClean(template), /\.hap|package/i);
  });

  withTempDir((template) => {
    write(path.join(template, "AppScope", "app.json5"), "{}");
    write(path.join(template, "local.properties"), "sdk.dir=C:/machine");
    assert.throws(() => assertTemplateClean(template), /local\.properties|config/i);
  });
});

test("the checked-in template is clean and keeps its identity placeholders", () => {
  assert.doesNotThrow(() => assertTemplateClean(TEMPLATE_ROOT));
  assert.equal(APP_ROOT, path.dirname(TEMPLATE_ROOT));
});

test("isolated web-dist staging ignores a poisoned shared dist", () => {
  withTempDir((appRoot) => {
    const template = path.join(appRoot, "harmony");
    write(
      path.join(template, "AppScope", "app.json5"),
      '{"app":{"bundleName":"__FGE_BUNDLE_NAME__"}}'
    );
    write(
      path.join(template, "AppScope", "resources", "base", "element", "string.json"),
      '{"string":[{"name":"app_name","value":"__FGE_APP_NAME__"}]}'
    );
    write(
      path.join(appRoot, ".fge-build", "content-public.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "public",
        contentRoot: "@content",
        watchedContentFiles: ["@content/manifest.json"],
      })
    );
    write(
      path.join(appRoot, "dist", "public", "index.html"),
      '<script src="/french-grammar-app/assets/old.js"></script>'
    );

    let seenOutDir = "";
    const hap = path.join(
      appRoot,
      ".fge-build",
      "harmony",
      "public",
      "project",
      "entry",
      "build",
      "default",
      "outputs",
      "default",
      "entry-default-unsigned.hap"
    );

    const fakeRun = (label, _command, args, options) => {
      if (label === "Vite build") {
        const index = args.indexOf("--outDir");
        assert.notEqual(index, -1, "Vite build must receive --outDir");
        seenOutDir = args[index + 1];
        write(
          path.join(seenOutDir, "index.html"),
          '<script type="module" src="./assets/app.js"></script>'
        );
        write(path.join(seenOutDir, "assets", "app.js"), "console.log('stage');");
        // Simulate another npm build/apk task replacing shared dist after the
        // staged build. It must never reach rawfile/web or the marker.
        write(
          path.join(appRoot, "dist", "public", "index.html"),
          '<script src="/french-grammar-app/assets/poison.js"></script>'
        );
        write(
          path.join(appRoot, "dist", "public", "assets", "poison.js"),
          "poison"
        );
        return;
      }
      if (label === "Hvigor assembleHap") {
        mkdirSync(path.dirname(hap), { recursive: true });
        writeFileSync(hap, "fake-hap");
      }
    };

    const result = buildHarmony("public", {
      appRoot,
      templateRoot: template,
      toolchain: { ohpm: "ohpm", hvigor: "hvigor", env: {} },
      runCommand: fakeRun,
    });

    assert.match(
      seenOutDir,
      /[\\/]\.fge-build[\\/]harmony[\\/]public[\\/]web-dist$/i
    );
    assert.equal(result.webDistDir, path.resolve(seenOutDir));
    assert.equal(
      result.webDistDir,
      path.join(appRoot, ".fge-build", "harmony", "public", "web-dist")
    );

    const rawIndex = readFileSync(path.join(result.rawfileDir, "index.html"), "utf8");
    assert.match(rawIndex, /\.\/assets\/app\.js/);
    assert.doesNotMatch(rawIndex, /french-grammar-app|poison/);
    assert.ok(existsSync(result.hap));
    assert.equal(result.edition, "public");
  });
});
