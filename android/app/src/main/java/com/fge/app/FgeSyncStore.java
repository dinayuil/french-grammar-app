package com.fge.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * WebDAV 同步配置存储。
 *
 * URL 与自动同步开关放在应用私有 Preferences;用户名和应用密码一起用
 * AndroidKeyStore 中不可导出的 AES-256-GCM 密钥加密后保存,磁盘上只有
 * IV 与密文,绝不落明文密码。读取失败(例如系统恢复后密钥丢失)按未保存
 * 凭据处理,不删除学习进度,也不阻塞用户重新连接。
 */
final class FgeSyncStore {

    static final String EDITION_PUBLIC = "public";
    static final String EDITION_INTERNAL = "internal";

    private static final String APP_ID_PUBLIC = "com.fge.open";
    private static final String APP_ID_INTERNAL = "com.fge.app";
    private static final String PREF_NAME = "fge-sync";
    private static final String KEY_URL = "url";
    private static final String KEY_AUTO_SYNC = "autoSync";
    private static final String KEY_CREDENTIAL = "credential";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "fge-sync-credentials-v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    private static final String CREDENTIAL_USERNAME = "username";
    private static final String CREDENTIAL_PASSWORD = "password";

    static final class Config {
        final String url;
        final String username;
        final boolean autoSync;
        final boolean hasPassword;

        Config(String url, String username, boolean autoSync, boolean hasPassword) {
            this.url = url;
            this.username = username;
            this.autoSync = autoSync;
            this.hasPassword = hasPassword;
        }
    }

    static final class Snapshot {
        final String url;
        final String username;
        final String password;
        final String filename;

        Snapshot(String url, String username, String password, String filename) {
            this.url = url;
            this.username = username;
            this.password = password;
            this.filename = filename;
        }
    }

    private static final class Credentials {
        final String username;
        final String password;

        Credentials(String username, String password) {
            this.username = username;
            this.password = password;
        }
    }

    /** 固定文件名由安装包身份决定,不接受调用方自定义。 */
    static String filename(Context context) {
        return "fge-progress-" + edition(context) + ".json";
    }

    static String edition(Context context) {
        final String appId = context.getPackageName();
        if (APP_ID_PUBLIC.equals(appId)) return EDITION_PUBLIC;
        if (APP_ID_INTERNAL.equals(appId)) return EDITION_INTERNAL;
        throw new IllegalStateException("未知应用版本");
    }

    synchronized Config read(Context context) {
        final SharedPreferences prefs = prefs(context);
        final String url = prefs.getString(KEY_URL, null);
        if (url == null || url.isEmpty()) return null;

        String username = "";
        String password = "";
        try {
            final Credentials credentials = readCredentials(prefs);
            username = credentials.username;
            password = credentials.password;
        } catch (RuntimeException error) {
            // 凭据不可解密时只报告未保存密码,绝不把密文当明文返回。
            username = "";
        }
        return new Config(
            url,
            username,
            prefs.getBoolean(KEY_AUTO_SYNC, false),
            !password.isEmpty()
        );
    }

    /**
     * 保存配置。password 为 null 表示保留已有密码;空字符串表示清除密码。
     */
    synchronized void write(
        Context context,
        String url,
        String username,
        boolean autoSync,
        String password,
        boolean updatePassword
    ) {
        final SharedPreferences prefs = prefs(context);
        final String previousUrl = prefs.getString(KEY_URL, null);
        final boolean previousAutoSync = prefs.getBoolean(KEY_AUTO_SYNC, false);
        final String previousCredential = prefs.getString(KEY_CREDENTIAL, null);

        String previousUsername = "";
        String previousPassword = "";
        try {
            final Credentials previous = readCredentials(prefs);
            previousUsername = previous.username;
            previousPassword = previous.password;
        } catch (RuntimeException error) {
            previousUsername = "";
            previousPassword = "";
        }

        // 目标改变且未重新输入密码时在此抛出,不会触碰已保存配置。
        final String effectivePassword = FgeSyncPolicy.resolvePassword(
            previousUrl,
            previousUsername,
            previousPassword,
            url,
            username,
            updatePassword,
            password
        );

        // 先完成全部加密,再一次性提交 URL、开关和凭据。
        final String encodedCredential;
        if (username.isEmpty() && effectivePassword.isEmpty()) {
            encodedCredential = null;
        } else {
            final byte[] encrypted = encryptCredentials(context, username, effectivePassword);
            encodedCredential = Base64.encodeToString(encrypted, Base64.NO_WRAP);
        }

        final SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_URL, url.trim());
        editor.putBoolean(KEY_AUTO_SYNC, autoSync);
        if (encodedCredential == null) {
            editor.remove(KEY_CREDENTIAL);
        } else {
            editor.putString(KEY_CREDENTIAL, encodedCredential);
        }

        if (!editor.commit()) {
            restore(prefs, previousUrl, previousAutoSync, previousCredential);
            throw new IllegalStateException("无法保存同步配置");
        }
    }

    private static void restore(
        SharedPreferences prefs,
        String url,
        boolean autoSync,
        String credential
    ) {
        final SharedPreferences.Editor editor = prefs.edit().clear();
        if (url != null) editor.putString(KEY_URL, url);
        editor.putBoolean(KEY_AUTO_SYNC, autoSync);
        if (credential != null) editor.putString(KEY_CREDENTIAL, credential);
        // 尽力恢复内存值;持久化失败时下一次启动仍读取旧文件。
        editor.commit();
    }

    /** 请求开始时读取不可变的地址与凭据快照。 */
    synchronized Snapshot snapshot(Context context) {
        final SharedPreferences prefs = prefs(context);
        final String url = prefs.getString(KEY_URL, null);
        if (url == null || url.isEmpty()) {
            throw new IllegalStateException("尚未配置同步");
        }
        final Credentials credentials = readCredentials(prefs);
        return new Snapshot(url, credentials.username, credentials.password, filename(context));
    }

    /** 断开同步只清凭据与配置,不触碰学习进度或云端文件。 */
    synchronized void disconnect(Context context) {
        final SharedPreferences prefs = prefs(context);
        if (!prefs.edit().clear().commit()) {
            throw new IllegalStateException("无法清除同步配置");
        }
        try {
            final KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        } catch (Exception ignored) {
            // 密文已经删除;删不掉旧密钥也不会暴露任何凭据。
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    private static Credentials readCredentials(SharedPreferences prefs) {
        final String stored = prefs.getString(KEY_CREDENTIAL, null);
        if (stored == null || stored.isEmpty()) {
            return new Credentials("", "");
        }

        final byte[] plaintext;
        try {
            plaintext = decrypt(Base64.decode(stored, Base64.NO_WRAP));
        } catch (Exception error) {
            throw new IllegalStateException("同步凭据不可用");
        }

        try {
            final JSONObject object = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
            final Object username = object.opt(CREDENTIAL_USERNAME);
            final Object password = object.opt(CREDENTIAL_PASSWORD);
            if (!(username instanceof String) || !(password instanceof String)) {
                throw new IllegalStateException("同步凭据不可用");
            }
            return new Credentials((String) username, (String) password);
        } catch (RuntimeException error) {
            throw new IllegalStateException("同步凭据不可用");
        } catch (Exception error) {
            throw new IllegalStateException("同步凭据不可用");
        }
    }

    private static byte[] encryptCredentials(Context context, String username, String password) {
        try {
            final JSONObject object = new JSONObject();
            object.put(CREDENTIAL_USERNAME, username);
            object.put(CREDENTIAL_PASSWORD, password);
            return encrypt(object.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("无法保存同步凭据");
        }
    }

    private static SecretKey getOrCreateKey() throws Exception {
        final KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            final KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                throw new IllegalStateException("同步密钥不可用");
            }
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        final KeyGenerator generator =
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    private static byte[] encrypt(byte[] plaintext) throws Exception {
        // AndroidKeyStore 按应用 UID 隔离,密钥不可导出。
        final SecretKey key = getOrCreateKey();
        final Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        final byte[] nonce = cipher.getIV();
        final byte[] ciphertext = cipher.doFinal(plaintext);
        final byte[] combined = new byte[nonce.length + ciphertext.length];
        System.arraycopy(nonce, 0, combined, 0, nonce.length);
        System.arraycopy(ciphertext, 0, combined, nonce.length, ciphertext.length);
        return combined;
    }

    private static byte[] decrypt(byte[] combined) throws Exception {
        if (combined.length <= 12) {
            throw new IllegalStateException("同步凭据不可用");
        }
        final byte[] nonce = new byte[12];
        final byte[] ciphertext = new byte[combined.length - nonce.length];
        System.arraycopy(combined, 0, nonce, 0, nonce.length);
        System.arraycopy(combined, nonce.length, ciphertext, 0, ciphertext.length);

        final SecretKey key = getOrCreateKey();
        final Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
        return cipher.doFinal(ciphertext);
    }
}
