package com.fge.app;

/**
 * Pure WebDAV target policy. The user configures a root; directory methods are
 * pinned to FrenchGrammarExercise/ and file methods to the fixed edition file
 * inside it. There is no fallback to writing the user's root.
 */
final class FgeSyncTargets {

    static final String APP_DIRECTORY = "FrenchGrammarExercise";

    private FgeSyncTargets() {}

    static String appDirectoryUrl(String rootUrl) {
        return FgeSyncPolicy.normalizeDirectoryUrl(rootUrl) + "/" + APP_DIRECTORY + "/";
    }

    static String fileUrl(String rootUrl, String filename) {
        validateFilename(filename);
        return appDirectoryUrl(rootUrl) + filename;
    }

    static String targetFor(String rootUrl, String method, String filename) {
        validateFilename(filename);
        if ("GET".equals(method) || "PUT".equals(method)) {
            return fileUrl(rootUrl, filename);
        }
        if ("MKCOL".equals(method) || "PROPFIND".equals(method)) {
            return appDirectoryUrl(rootUrl);
        }
        throw new IllegalArgumentException("同步请求方法无效");
    }

    static void validateFilename(String filename) {
        if (
            filename == null ||
            !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]*") ||
            filename.contains("..")
        ) {
            throw new IllegalArgumentException("同步文件名无效");
        }
    }
}
