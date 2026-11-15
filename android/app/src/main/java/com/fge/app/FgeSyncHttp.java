package com.fge.app;

import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.RequestBody;

/**
 * 受限 WebDAV 传输层。
 *
 * OkHttp 支持真实的 MKCOL/PROPFIND 请求方法(HttpURLConnection 只接受标准
 * 方法)。只访问配置根下的 FrenchGrammarExercise/ 固定目录与当前 edition
 * 固定文件;HTTP/HTTPS 均允许,但拒绝账号/查询/片段、跨源重定向、非白名单
 * 头和非 PUT/PROPFIND 正文。Authorization 始终由原生凭据构造。
 */
final class FgeSyncHttp {

    static final int MAX_SYNC_BYTES = 5 * 1024 * 1024;
    private static final int TIMEOUT_SECONDS = 20;
    private static final int MAX_HEADER_LENGTH = 8_192;
    private static final Set<String> ALLOWED_HEADERS =
        Set.of("accept", "content-type", "if-match", "if-none-match", "depth");

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        // 不跟随任何重定向,避免把 Authorization 带到别处。
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .callTimeout(TIMEOUT_SECONDS + 5, TimeUnit.SECONDS)
        .build();

    static final class Request {
        final String method;
        final String url;
        final Map<String, String> headers;
        final byte[] body;
        final String authorization;

        private Request(
            String method,
            String url,
            Map<String, String> headers,
            byte[] body,
            String authorization
        ) {
            this.method = method;
            this.url = url;
            this.headers = headers;
            this.body = body;
            this.authorization = authorization;
        }
    }

    static final class Response {
        final int status;
        final Map<String, String> headers;
        final String body;

        private Response(int status, Map<String, String> headers, String body) {
            this.status = status;
            this.headers = headers;
            this.body = body;
        }
    }

    private FgeSyncHttp() {}

    static void validateBaseUrl(String baseUrl) {
        FgeSyncPolicy.normalizeDirectoryUrl(baseUrl);
    }

    static Request prepare(
        String baseUrl,
        String username,
        String password,
        String expectedFilename,
        String method,
        String filename,
        JSONObject headers,
        String body
    ) {
        if (
            !"GET".equals(method) &&
            !"PUT".equals(method) &&
            !"MKCOL".equals(method) &&
            !"PROPFIND".equals(method)
        ) {
            throw new IllegalArgumentException("同步请求方法无效");
        }
        if (
            filename == null ||
            !filename.equals(expectedFilename) ||
            !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]*") ||
            filename.contains("..")
        ) {
            throw new IllegalArgumentException("同步文件名无效");
        }

        final String target = FgeSyncTargets.targetFor(baseUrl, method, filename);
        final Map<String, String> safeHeaders = sanitizeHeaders(headers, method);
        final String authorization = buildAuthorization(username, password);

        final byte[] bodyBytes;
        if (body == null || body.isEmpty()) {
            bodyBytes = new byte[0];
        } else {
            bodyBytes = body.getBytes(StandardCharsets.UTF_8);
        }
        if (bodyBytes.length > MAX_SYNC_BYTES) {
            throw new IllegalArgumentException("同步请求超过大小上限");
        }
        if (!"PUT".equals(method) && !"PROPFIND".equals(method) && bodyBytes.length > 0) {
            throw new IllegalArgumentException("同步请求不能携带请求体");
        }

        return new Request(method, target, safeHeaders, bodyBytes, authorization);
    }

    static Response execute(Request request) throws IOException {
        final okhttp3.Request.Builder builder = new okhttp3.Request.Builder().url(request.url);
        RequestBody requestBody = null;
        final boolean sendsBody =
            "PUT".equals(request.method) ||
            ("PROPFIND".equals(request.method) && request.body.length > 0);
        if (sendsBody) {
            final String contentType = headerValue(request.headers, "content-type");
            final MediaType mediaType =
                contentType == null ? null : MediaType.parse(contentType);
            if (contentType != null && mediaType == null) {
                throw new IllegalArgumentException("同步请求头无效");
            }
            requestBody = RequestBody.create(request.body, mediaType);
        }
        builder.method(request.method, requestBody);

        for (Map.Entry<String, String> header : request.headers.entrySet()) {
            builder.header(header.getKey(), header.getValue());
        }
        if (request.authorization != null) {
            builder.header("Authorization", request.authorization);
        }

        try (okhttp3.Response response = CLIENT.newCall(builder.build()).execute()) {
            if (response.isRedirect()) {
                // 绝不跟随;把 3xx 原样交给上层处理。
                return new Response(response.code(), readHeaders(response), "");
            }

            final okhttp3.ResponseBody responseBody = response.body();
            final long declaredLength = responseBody == null ? 0 : responseBody.contentLength();
            if (declaredLength > MAX_SYNC_BYTES) {
                throw new IOException("同步响应超过大小上限");
            }
            final byte[] bytes = responseBody == null
                ? new byte[0]
                : readBounded(responseBody.byteStream());
            return new Response(
                response.code(),
                readHeaders(response),
                new String(bytes, StandardCharsets.UTF_8)
            );
        }
    }

    private static Map<String, String> sanitizeHeaders(JSONObject raw, String method) {
        final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        if (raw == null) return headers;

        final Iterator<String> names = raw.keys();
        while (names.hasNext()) {
            final String name = names.next();
            final String lower = name.toLowerCase(Locale.ROOT);
            final Object value = raw.opt(name);
            if (
                !ALLOWED_HEADERS.contains(lower) ||
                headers.containsKey(name) ||
                !(value instanceof String)
            ) {
                throw new IllegalArgumentException("同步请求头无效");
            }
            final String text = (String) value;
            if (
                text.length() > MAX_HEADER_LENGTH ||
                containsControl(text) ||
                ("depth".equals(lower) && (!"PROPFIND".equals(method) || !"0".equals(text)))
            ) {
                throw new IllegalArgumentException("同步请求头无效");
            }
            headers.put(name, text);
        }
        return headers;
    }

    private static String headerValue(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (name.equalsIgnoreCase(header.getKey())) return header.getValue();
        }
        return null;
    }

    private static String buildAuthorization(String username, String password) {
        final String user = username == null ? "" : username;
        final String pass = password == null ? "" : password;
        if (containsControl(user) || containsControl(pass) || user.indexOf(':') >= 0) {
            throw new IllegalArgumentException("同步凭据无效");
        }
        if (user.isEmpty() && pass.isEmpty()) return null;
        final String token = Base64.encodeToString(
            (user + ":" + pass).getBytes(StandardCharsets.UTF_8),
            Base64.NO_WRAP
        );
        return "Basic " + token;
    }

    private static Map<String, String> readHeaders(okhttp3.Response response) {
        final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (String name : response.headers().names()) {
            headers.put(name, String.join(", ", response.headers(name)));
        }
        return headers;
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            final byte[] buffer = new byte[8_192];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_SYNC_BYTES) {
                    throw new IOException("同步响应超过大小上限");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
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
