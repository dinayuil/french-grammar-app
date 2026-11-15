package com.fge.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Objects;

/**
 * Pure configuration policy, kept free of Android APIs so it can be verified
 * with a plain JVM test.
 *
 * The stored password may only be reused when both the normalized directory URL
 * and the username are unchanged. Pointing the same credentials at a different
 * server or account must be an explicit new credential.
 */
final class FgeSyncPolicy {

    private static final int MAX_URL_LENGTH = 4_096;

    private FgeSyncPolicy() {}

    /** Canonical HTTP/HTTPS root URL: lowercase authority, default port removed, no trailing slash. */
    static String normalizeDirectoryUrl(String baseUrl) {
        if (baseUrl == null) {
            throw new IllegalArgumentException("同步地址无效");
        }
        final String trimmed = baseUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_URL_LENGTH || containsControl(trimmed)) {
            throw new IllegalArgumentException("同步地址无效");
        }

        final URI uri;
        try {
            uri = new URI(trimmed);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("同步地址无效");
        }
        final String scheme = uri.getScheme() == null
            ? ""
            : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            throw new IllegalArgumentException("同步地址必须使用 HTTP 或 HTTPS");
        }
        if (uri.isOpaque() || uri.getHost() == null || uri.getHost().isEmpty()) {
            throw new IllegalArgumentException("同步地址无效");
        }
        if (uri.getRawUserInfo() != null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("同步地址不能包含账号信息");
        }
        if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("同步地址不能包含查询或片段");
        }

        final String rawPath = uri.getRawPath() == null ? "" : uri.getRawPath();
        validatePath(rawPath);

        String basePath = rawPath;
        while (basePath.endsWith("/")) {
            basePath = basePath.substring(0, basePath.length() - 1);
        }

        String authority = uri.getRawAuthority() == null
            ? ""
            : uri.getRawAuthority().toLowerCase(Locale.ROOT);
        final String defaultPort = "https".equals(scheme) ? ":443" : ":80";
        if (authority.endsWith(defaultPort)) {
            authority = authority.substring(0, authority.length() - defaultPort.length());
        }
        if (authority.isEmpty()) {
            throw new IllegalArgumentException("同步地址无效");
        }
        return scheme + "://" + authority + basePath;
    }

    /**
     * Returns the password to persist, or rejects when a changed target would
     * inherit the old password. `passwordProvided` distinguishes an omitted
     * password (retain only for the same target) from an explicit empty one.
     */
    static String resolvePassword(
        String previousUrl,
        String previousUsername,
        String previousPassword,
        String newUrl,
        String newUsername,
        boolean passwordProvided,
        String newPassword
    ) {
        final String normalizedNew = normalizeDirectoryUrl(newUrl);
        final boolean hasPrevious = previousUrl != null && !previousUrl.trim().isEmpty();
        boolean sameTarget = false;
        if (hasPrevious) {
            try {
                sameTarget = normalizeDirectoryUrl(previousUrl).equals(normalizedNew)
                    && Objects.equals(previousUsername, newUsername);
            } catch (IllegalArgumentException error) {
                sameTarget = false;
            }
        }

        final String existingPassword = previousPassword == null ? "" : previousPassword;
        final boolean hadPassword = !existingPassword.isEmpty();

        if (!passwordProvided) {
            if (!sameTarget && hadPassword) {
                throw new IllegalArgumentException("更换同步地址或用户名时，请重新输入应用密码");
            }
            return sameTarget ? existingPassword : "";
        }

        final String provided = newPassword == null ? "" : newPassword;
        if (!sameTarget && hadPassword && provided.isEmpty()) {
            throw new IllegalArgumentException("更换同步地址或用户名时，请重新输入应用密码");
        }
        return provided;
    }

    private static void validatePath(String rawPath) {
        if (
            rawPath.indexOf('\\') >= 0 ||
            containsControl(rawPath) ||
            rawPath.indexOf(' ') >= 0
        ) {
            throw new IllegalArgumentException("同步地址无效");
        }

        final String lower = rawPath.toLowerCase(Locale.ROOT);
        if (
            lower.contains("%2e") ||
            lower.contains("%2f") ||
            lower.contains("%5c") ||
            lower.contains("%00")
        ) {
            throw new IllegalArgumentException("同步地址无效");
        }

        final String decoded;
        try {
            decoded = URLDecoder.decode(rawPath, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("同步地址无效");
        }
        if (decoded.indexOf('\\') >= 0 || containsControl(decoded)) {
            throw new IllegalArgumentException("同步地址无效");
        }
        for (String segment : decoded.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                throw new IllegalArgumentException("同步地址无效");
            }
        }
    }

    private static boolean containsControl(String value) {
        for (int index = 0; index < value.length(); index++) {
            final char character = value.charAt(index);
            if (character < 0x20 || character == 0x7f) return true;
        }
        return false;
    }
}
