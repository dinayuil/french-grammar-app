package com.fge.app;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Stable native error protocol for the WebDAV bridge.
 *
 * <p>Messages stay diagnostic-only. The JS layer maps {@code code} to the
 * current UI language and shows {@code message} as expandable detail. Do not
 * infer a code from message text: classify by exception type at the origin.
 */
final class FgeSyncErrors {

    static final String CONFIG_INVALID = "native.config_invalid";
    static final String CREDENTIALS_REQUIRED = "native.credentials_required";
    static final String STORAGE_FAILED = "native.storage_failed";
    static final String NETWORK_FAILED = "native.network_failed";
    static final String FILE_FAILED = "native.file_failed";
    static final String UNSUPPORTED = "native.unsupported";
    static final String UNKNOWN = "native.unknown";

    private FgeSyncErrors() {}

    /** Origin-classified failure with optional non-sensitive parameters. */
    static final class FgeSyncException extends RuntimeException {
        final String code;
        final Map<String, Object> params = new LinkedHashMap<>();

        FgeSyncException(String code, String message) {
            super(message);
            this.code = code;
        }

        FgeSyncException withParam(String name, Object value) {
            params.put(name, value);
            return this;
        }
    }

    /** Plain rejection payload; no Android or Capacitor API required. */
    static final class Payload {
        final String code;
        final Map<String, Object> params;
        final String message;

        Payload(String code, Map<String, Object> params, String message) {
            this.code = code;
            this.params = params;
            this.message = message;
        }
    }

    private static String codeFor(Throwable error, String fallbackCode) {
        if (error instanceof FgeSyncException) {
            return ((FgeSyncException) error).code;
        }
        if (error instanceof IOException) {
            return NETWORK_FAILED;
        }
        if (error instanceof IllegalArgumentException) {
            return CONFIG_INVALID;
        }
        if (error instanceof IllegalStateException) {
            return fallbackCode;
        }
        return UNKNOWN;
    }

    /**
     * Request transport/runtime failures may contain the target URL, host,
     * path, query or response text. Never copy that text into the payload;
     * keep only the actionable code and a fixed diagnostic.
     */
    static Payload forRequestFailure(Throwable error, String operation) {
        final String code = codeFor(error, CONFIG_INVALID);
        final String diagnostic;
        switch (code) {
            case CONFIG_INVALID:
                diagnostic = "同步请求无效";
                break;
            case CREDENTIALS_REQUIRED:
                diagnostic = "同步凭据不可用";
                break;
            case STORAGE_FAILED:
                diagnostic = "无法读取同步配置";
                break;
            case NETWORK_FAILED:
                diagnostic = "同步请求失败，请检查网络或服务器";
                break;
            case FILE_FAILED:
                diagnostic = "同步请求文件不可用";
                break;
            case UNSUPPORTED:
                diagnostic = "当前版本不支持同步";
                break;
            default:
                diagnostic = "同步请求失败";
                break;
        }
        final Map<String, Object> params = new LinkedHashMap<>();
        if (operation != null && !operation.isEmpty()) {
            params.put("operation", operation);
        }
        return new Payload(code, params, diagnostic);
    }

    static Payload forFailure(
        Throwable error,
        String operation,
        String fallbackCode,
        String fallbackMessage
    ) {
        final String code = codeFor(error, fallbackCode);

        final String rawMessage = error.getMessage();
        final String message =
            rawMessage == null || rawMessage.isEmpty() ? fallbackMessage : rawMessage;

        final Map<String, Object> params = new LinkedHashMap<>();
        if (operation != null && !operation.isEmpty()) {
            params.put("operation", operation);
        }
        if (error instanceof FgeSyncException) {
            params.putAll(((FgeSyncException) error).params);
        }
        return new Payload(code, params, message);
    }
}
