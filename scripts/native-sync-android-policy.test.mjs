/**
 * Executes the pure Android sync policy with a real JVM.
 *
 * The policy class has no Android dependencies, so this test compiles it and a
 * tiny Java probe in a temporary directory. It verifies credential retention
 * only for the same normalized directory + username and rejects reuse when the
 * target changes. Skipped when no JDK is available.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const POLICY_PATH = path.join(
  APP_ROOT,
  'android/app/src/main/java/com/fge/app/FgeSyncPolicy.java',
);
const TARGETS_PATH = path.join(
  APP_ROOT,
  'android/app/src/main/java/com/fge/app/FgeSyncTargets.java',
);

function javaTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', executable);
    if (existsSync(candidate)) return candidate;
  }
  const probe = spawnSync(executable, ['-version'], { encoding: 'utf8' });
  if (!probe.error) return executable;
  return null;
}

const PROBE = `package com.fge.app;

public final class FgeSyncPolicyProbe {
    private interface Throwing { void run(); }

    private static void eq(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError("expected " + expected + " but got " + actual);
        }
    }

    private static void expectIae(Throwing action) {
        try {
            action.run();
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("expected IllegalArgumentException");
    }

    public static void main(String[] args) {
        eq(
            "https://dav.example.com/dav",
            FgeSyncPolicy.normalizeDirectoryUrl("https://dav.example.com/dav//")
        );
        eq(
            FgeSyncPolicy.normalizeDirectoryUrl("https://DAV.Example.com:443/dav/"),
            FgeSyncPolicy.normalizeDirectoryUrl("https://dav.example.com/dav")
        );
        eq(
            "http://dav.example.com:8080/dav",
            FgeSyncPolicy.normalizeDirectoryUrl("http://dav.example.com:8080/dav/")
        );
        eq(
            FgeSyncPolicy.normalizeDirectoryUrl("http://DAV.Example.com:80/dav/"),
            FgeSyncPolicy.normalizeDirectoryUrl("http://dav.example.com/dav")
        );
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("ftp://dav.example.com/dav"));
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("http://user:password@dav.example.com/dav"));
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("http://dav.example.com/dav?x=1"));
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("http://dav.example.com/dav#x"));
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("http://dav.example.com/a/%2e%2e/b"));
        expectIae(() -> FgeSyncPolicy.normalizeDirectoryUrl("https://dav.example.com/a/../b"));

        eq(
            "http://dav.example.com/dav/FrenchGrammarExercise/",
            FgeSyncTargets.targetFor(
                "http://dav.example.com/dav/",
                "MKCOL",
                "fge-progress-public.json"
            )
        );
        eq(
            "https://dav.example.com/dav/FrenchGrammarExercise/",
            FgeSyncTargets.targetFor(
                "https://dav.example.com/dav",
                "PROPFIND",
                "fge-progress-public.json"
            )
        );
        eq(
            "http://dav.example.com/dav/FrenchGrammarExercise/fge-progress-public.json",
            FgeSyncTargets.targetFor(
                "http://dav.example.com/dav",
                "GET",
                "fge-progress-public.json"
            )
        );
        eq(
            "https://dav.example.com/dav/FrenchGrammarExercise/fge-progress-public.json",
            FgeSyncTargets.targetFor(
                "https://dav.example.com/dav",
                "PUT",
                "fge-progress-public.json"
            )
        );
        expectIae(() -> FgeSyncTargets.targetFor(
            "https://dav.example.com/dav",
            "DELETE",
            "fge-progress-public.json"
        ));
        expectIae(() -> FgeSyncTargets.targetFor(
            "https://dav.example.com/dav",
            "MKCOL",
            "../fge-progress-public.json"
        ));

        eq(
            "old-password",
            FgeSyncPolicy.resolvePassword(
                "https://dav.example.com/dav/",
                "learner",
                "old-password",
                "https://dav.example.com/dav",
                "learner",
                false,
                null
            )
        );
        expectIae(() -> FgeSyncPolicy.resolvePassword(
            "https://dav.example.com/dav",
            "learner",
            "old-password",
            "https://dav.example.com/other",
            "learner",
            false,
            null
        ));
        expectIae(() -> FgeSyncPolicy.resolvePassword(
            "https://dav.example.com/dav",
            "learner",
            "old-password",
            "https://dav.example.com/dav",
            "other",
            false,
            null
        ));
        expectIae(() -> FgeSyncPolicy.resolvePassword(
            "https://dav.example.com/dav",
            "learner",
            "old-password",
            "https://dav.example.com/other",
            "learner",
            true,
            ""
        ));
        eq(
            "new-password",
            FgeSyncPolicy.resolvePassword(
                "https://dav.example.com/dav",
                "learner",
                "old-password",
                "https://dav.example.com/other",
                "learner",
                true,
                "new-password"
            )
        );
        eq(
            "",
            FgeSyncPolicy.resolvePassword(
                null,
                null,
                null,
                "https://dav.example.com/dav",
                "learner",
                false,
                null
            )
        );
        eq(
            "",
            FgeSyncPolicy.resolvePassword(
                "https://dav.example.com/dav",
                "learner",
                "",
                "https://dav.example.com/other",
                "learner",
                false,
                null
            )
        );
        System.out.println("FgeSyncPolicyProbe OK");
    }
}
`;

test('Android sync policy keeps passwords only for the same target', (t) => {
  const javac = javaTool('javac');
  const java = javaTool('java');
  if (!javac || !java) {
    t.skip('JDK not available');
    return;
  }

  let policySource;
  let targetsSource;
  try {
    policySource = readFileSync(POLICY_PATH, 'utf8');
    targetsSource = readFileSync(TARGETS_PATH, 'utf8');
  } catch (error) {
    assert.fail(`FgeSyncPolicy/Targets.java is missing: ${error.message}`);
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'fge-sync-policy-'));
  try {
    const packageDir = path.join(root, 'src', 'com', 'fge', 'app');
    const classesDir = path.join(root, 'classes');
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(classesDir, { recursive: true });
    const policyFile = path.join(packageDir, 'FgeSyncPolicy.java');
    const targetsFile = path.join(packageDir, 'FgeSyncTargets.java');
    const probeFile = path.join(packageDir, 'FgeSyncPolicyProbe.java');
    writeFileSync(policyFile, policySource, 'utf8');
    writeFileSync(targetsFile, targetsSource, 'utf8');
    writeFileSync(probeFile, PROBE, 'utf8');

    const compiled = spawnSync(
      javac,
      ['-encoding', 'UTF-8', '-d', classesDir, policyFile, targetsFile, probeFile],
      { encoding: 'utf8' },
    );
    assert.equal(
      compiled.status,
      0,
      `javac failed:\n${compiled.stdout}\n${compiled.stderr}`,
    );

    const run = spawnSync(java, ['-cp', classesDir, 'com.fge.app.FgeSyncPolicyProbe'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `probe failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /FgeSyncPolicyProbe OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
