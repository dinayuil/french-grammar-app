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
const ERRORS_PATH = path.join(
  APP_ROOT,
  'android/app/src/main/java/com/fge/app/FgeSyncErrors.java',
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

import java.io.IOException;

public final class FgeSyncPolicyProbe {
    private interface Throwing { void run(); }

    private static void eq(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError("expected " + expected + " but got " + actual);
        }
    }

    private static void checkPayload(
        String expectedCode,
        String expectedOperation,
        String expectedMessage,
        FgeSyncErrors.Payload payload
    ) {
        eq(expectedCode, payload.code);
        eq(expectedOperation, String.valueOf(payload.params.get("operation")));
        eq(expectedMessage, payload.message);
    }

    private static void checkNoTransportLeak(FgeSyncErrors.Payload payload) {
        final String text =
            payload.code + "|" + payload.message + "|" + payload.params.toString();
        for (String marker : new String[] {
            "https://",
            "http://",
            "dav.example.com",
            "fge-progress",
            "token=",
            "/private/",
        }) {
            if (text.contains(marker)) {
                throw new AssertionError("native payload leaked " + marker + ": " + text);
            }
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

        FgeSyncErrors.Payload credentials = FgeSyncErrors.forFailure(
            new FgeSyncErrors.FgeSyncException(
                FgeSyncErrors.CREDENTIALS_REQUIRED,
                "需要重新输入密码"
            ).withParam("status", 401),
            "syncWriteConfig",
            FgeSyncErrors.STORAGE_FAILED,
            "同步失败"
        );
        checkPayload(
            "native.credentials_required",
            "syncWriteConfig",
            "需要重新输入密码",
            credentials
        );
        eq("401", String.valueOf(credentials.params.get("status")));

        checkPayload(
            "native.config_invalid",
            "syncRequest",
            "同步请求无效",
            FgeSyncErrors.forFailure(
                new IllegalArgumentException("同步请求无效"),
                "syncRequest",
                FgeSyncErrors.STORAGE_FAILED,
                "同步失败"
            )
        );
        checkPayload(
            "native.network_failed",
            "syncRequest",
            "连接失败",
            FgeSyncErrors.forFailure(
                new IOException("连接失败"),
                "syncRequest",
                FgeSyncErrors.STORAGE_FAILED,
                "同步失败"
            )
        );
        checkPayload(
            "native.storage_failed",
            "syncReadConfig",
            "无法读取同步配置",
            FgeSyncErrors.forFailure(
                new IllegalStateException("无法读取同步配置"),
                "syncReadConfig",
                FgeSyncErrors.STORAGE_FAILED,
                "同步失败"
            )
        );
        checkPayload(
            "native.unknown",
            "syncReadConfig",
            "同步失败",
            FgeSyncErrors.forFailure(
                new RuntimeException(""),
                "syncReadConfig",
                FgeSyncErrors.STORAGE_FAILED,
                "同步失败"
            )
        );

        final String sensitive =
            "GET https://dav.example.com/private/fge-progress-public.json?token=secret failed";

        FgeSyncErrors.Payload networkLeak = FgeSyncErrors.forRequestFailure(
            new IOException(sensitive),
            "request"
        );
        checkPayload(
            "native.network_failed",
            "request",
            "同步请求失败，请检查网络或服务器",
            networkLeak
        );
        checkNoTransportLeak(networkLeak);

        FgeSyncErrors.Payload runtimeLeak = FgeSyncErrors.forRequestFailure(
            new RuntimeException(sensitive),
            "request"
        );
        checkPayload("native.unknown", "request", "同步请求失败", runtimeLeak);
        checkNoTransportLeak(runtimeLeak);

        FgeSyncErrors.Payload credentialsLeak = FgeSyncErrors.forRequestFailure(
            new FgeSyncErrors.FgeSyncException(
                FgeSyncErrors.CREDENTIALS_REQUIRED,
                sensitive
            ),
            "request"
        );
        checkPayload(
            "native.credentials_required",
            "request",
            "同步凭据不可用",
            credentialsLeak
        );
        checkNoTransportLeak(credentialsLeak);

        FgeSyncErrors.Payload stateLeak = FgeSyncErrors.forRequestFailure(
            new IllegalStateException(sensitive),
            "request"
        );
        checkPayload(
            "native.config_invalid",
            "request",
            "同步请求无效",
            stateLeak
        );
        checkNoTransportLeak(stateLeak);

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
  let errorsSource;
  try {
    policySource = readFileSync(POLICY_PATH, 'utf8');
    targetsSource = readFileSync(TARGETS_PATH, 'utf8');
    errorsSource = readFileSync(ERRORS_PATH, 'utf8');
  } catch (error) {
    assert.fail(`FgeSyncPolicy/Targets/Errors.java is missing: ${error.message}`);
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'fge-sync-policy-'));
  try {
    const packageDir = path.join(root, 'src', 'com', 'fge', 'app');
    const classesDir = path.join(root, 'classes');
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(classesDir, { recursive: true });
    const policyFile = path.join(packageDir, 'FgeSyncPolicy.java');
    const targetsFile = path.join(packageDir, 'FgeSyncTargets.java');
    const errorsFile = path.join(packageDir, 'FgeSyncErrors.java');
    const probeFile = path.join(packageDir, 'FgeSyncPolicyProbe.java');
    writeFileSync(policyFile, policySource, 'utf8');
    writeFileSync(targetsFile, targetsSource, 'utf8');
    writeFileSync(errorsFile, errorsSource, 'utf8');
    writeFileSync(probeFile, PROBE, 'utf8');

    const compiled = spawnSync(
      javac,
      [
        '-encoding',
        'UTF-8',
        '-d',
        classesDir,
        policyFile,
        targetsFile,
        errorsFile,
        probeFile,
      ],
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
