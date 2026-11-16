package com.fge.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor WebDAV 同步桥。
 *
 * JS 侧只传固定请求描述;地址校验、Authorization 构造、重定向与大小限制
 * 都在原生完成。凭据由 {@link FgeSyncStore} 用 AndroidKeyStore AES-GCM
 * 加密保存,任何方法都不会把密码返回给 JS。
 */
@CapacitorPlugin(name = "FgeSync")
public class FgeSyncPlugin extends Plugin {

    private static final String TAG = "FgeSync";
    private static final String PASSWORD_KEY = "password";
    private static final int MAX_USERNAME_LENGTH = 256;

    private final FgeSyncStore store = new FgeSyncStore();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void readConfig(PluginCall call) {
        executor.execute(() -> {
            try {
                final FgeSyncStore.Config config = store.read(getContext());
                final JSObject result = new JSObject();
                if (config == null) {
                    result.put("config", JSONObject.NULL);
                } else {
                    result.put("config", toJson(config));
                }
                call.resolve(result);
            } catch (RuntimeException error) {
                rejectWith(
                    call,
                    error,
                    "readConfig",
                    FgeSyncErrors.STORAGE_FAILED,
                    "无法读取同步配置"
                );
            }
        });
    }

    @PluginMethod
    public void writeConfig(PluginCall call) {
        final JSObject config = call.getObject("config");
        if (config == null) {
            rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "writeConfig", "同步配置无效");
            return;
        }

        final String url = config.getString("url");
        final String username = config.getString("username");
        final Boolean autoSync = config.getBoolean("autoSync", null);
        if (url == null || username == null || autoSync == null) {
            rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "writeConfig", "同步配置无效");
            return;
        }

        boolean updatePassword = false;
        String updatedPassword = null;
        final JSObject data = call.getData();
        if (data.has(PASSWORD_KEY) && !data.isNull(PASSWORD_KEY)) {
            final Object rawPassword = data.opt(PASSWORD_KEY);
            if (!(rawPassword instanceof String)) {
                rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "writeConfig", "同步密码无效");
                return;
            }
            updatedPassword = (String) rawPassword;
            updatePassword = true;
        }

        try {
            FgeSyncHttp.validateBaseUrl(url);
            validateUsername(username);
            if (updatedPassword != null) {
                validatePassword(updatedPassword);
            }
        } catch (IllegalArgumentException error) {
            rejectWith(
                call,
                error,
                "writeConfig",
                FgeSyncErrors.CONFIG_INVALID,
                "同步配置无效"
            );
            return;
        }

        final boolean update = updatePassword;
        final String passwordForSave = updatedPassword;
        executor.execute(() -> {
            try {
                store.write(getContext(), url, username, autoSync, passwordForSave, update);
                call.resolve();
            } catch (IllegalArgumentException | IllegalStateException error) {
                rejectWith(
                    call,
                    error,
                    "writeConfig",
                    FgeSyncErrors.STORAGE_FAILED,
                    "无法保存同步配置"
                );
            } catch (RuntimeException error) {
                Log.w(TAG, "Failed to save sync config");
                rejectWith(
                    call,
                    error,
                    "writeConfig",
                    FgeSyncErrors.STORAGE_FAILED,
                    "无法保存同步配置"
                );
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> {
            try {
                store.disconnect(getContext());
                call.resolve();
            } catch (IllegalStateException error) {
                rejectWith(
                    call,
                    error,
                    "disconnect",
                    FgeSyncErrors.STORAGE_FAILED,
                    "无法断开同步"
                );
            } catch (RuntimeException error) {
                Log.w(TAG, "Failed to disconnect sync");
                rejectWith(
                    call,
                    error,
                    "disconnect",
                    FgeSyncErrors.STORAGE_FAILED,
                    "无法断开同步"
                );
            }
        });
    }

    @PluginMethod
    public void request(PluginCall call) {
        final JSObject request = call.getObject("request");
        if (request == null) {
            rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "request", "同步请求无效");
            return;
        }

        final String method = request.getString("method");
        final String filename = request.getString("filename");
        final JSONObject headers = request.optJSONObject("headers");
        if (method == null || filename == null || headers == null) {
            rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "request", "同步请求无效");
            return;
        }

        String body = null;
        if (request.has("body") && !request.isNull("body")) {
            final Object rawBody = request.opt("body");
            if (!(rawBody instanceof String)) {
                rejectMessage(call, FgeSyncErrors.CONFIG_INVALID, "request", "同步请求体无效");
                return;
            }
            body = (String) rawBody;
        }

        final String requestMethod = method;
        final String requestFilename = filename;
        final String requestBody = body;
        executor.execute(() -> {
            try {
                final FgeSyncStore.Snapshot snapshot = store.snapshot(getContext());
                final FgeSyncHttp.Request prepared = FgeSyncHttp.prepare(
                    snapshot.url,
                    snapshot.username,
                    snapshot.password,
                    snapshot.filename,
                    requestMethod,
                    requestFilename,
                    headers,
                    requestBody
                );
                final FgeSyncHttp.Response response = FgeSyncHttp.execute(prepared);
                call.resolve(toJson(response));
            } catch (IllegalArgumentException | IllegalStateException error) {
                // 固定诊断:异常原文可能含 URL、主机、路径或响应内容。
                rejectRequest(call, error);
            } catch (IOException error) {
                // 不输出 URL、请求头或响应体:错误保持认证安全。
                rejectRequest(call, error);
            } catch (RuntimeException error) {
                Log.w(TAG, "Sync request failed");
                rejectRequest(call, error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static void validateUsername(String username) {
        if (username.length() > MAX_USERNAME_LENGTH || username.indexOf(':') >= 0) {
            throw new IllegalArgumentException("同步用户名无效");
        }
        for (int index = 0; index < username.length(); index++) {
            final char character = username.charAt(index);
            if (character < 0x20 || character == 0x7f) {
                throw new IllegalArgumentException("同步用户名无效");
            }
        }
    }

    private static void validatePassword(String password) {
        for (int index = 0; index < password.length(); index++) {
            final char character = password.charAt(index);
            if (character < 0x20 || character == 0x7f) {
                throw new IllegalArgumentException("同步密码无效");
            }
        }
    }

    private static JSObject toJson(FgeSyncStore.Config config) {
        final JSObject object = new JSObject();
        object.put("url", config.url);
        object.put("username", config.username);
        object.put("autoSync", config.autoSync);
        object.put("hasPassword", config.hasPassword);
        return object;
    }

    private static JSObject toJson(FgeSyncHttp.Response response) {
        final JSObject headers = new JSObject();
        for (Map.Entry<String, String> header : response.headers.entrySet()) {
            headers.put(header.getKey(), header.getValue());
        }
        final JSObject object = new JSObject();
        object.put("status", response.status);
        object.put("headers", headers);
        object.put("body", response.body);
        return object;
    }

    private static void rejectMessage(
        PluginCall call,
        String code,
        String operation,
        String message
    ) {
        final JSObject params = new JSObject();
        params.put("operation", operation);
        final JSObject data = new JSObject();
        data.put("params", params);
        data.put("diagnostic", message);
        call.reject(message, code, data);
    }

    private static void rejectRequest(PluginCall call, Throwable error) {
        final FgeSyncErrors.Payload payload = FgeSyncErrors.forRequestFailure(
            error,
            "request"
        );
        final JSObject params = new JSObject();
        for (Map.Entry<String, Object> entry : payload.params.entrySet()) {
            params.put(entry.getKey(), entry.getValue());
        }
        final JSObject data = new JSObject();
        data.put("params", params);
        data.put("diagnostic", payload.message);
        call.reject(payload.message, payload.code, data);
    }

    private static void rejectWith(
        PluginCall call,
        Throwable error,
        String operation,
        String fallbackCode,
        String fallbackMessage
    ) {
        final FgeSyncErrors.Payload payload = FgeSyncErrors.forFailure(
            error,
            operation,
            fallbackCode,
            fallbackMessage
        );
        final JSObject params = new JSObject();
        for (Map.Entry<String, Object> entry : payload.params.entrySet()) {
            params.put(entry.getKey(), entry.getValue());
        }
        final JSObject data = new JSObject();
        data.put("params", params);
        data.put("diagnostic", payload.message);
        call.reject(payload.message, payload.code, data);
    }
}
