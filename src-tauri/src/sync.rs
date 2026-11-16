//! WebDAV sync commands for the Windows shell.
//!
//! The webview only receives a redacted config and HTTP status/body/ETag.
//! Credentials live in a DPAPI-encrypted blob under the edition's local app
//! data directory, are decrypted only for the duration of one request, and are
//! never returned to JS or written to logs. Request shape is deliberately
//! narrow: HTTP or HTTPS, no userinfo/query/fragment, no redirects, fixed
//! edition filename, a fixed application folder, whitelisted headers, and a
//! 5 MB body/response bound.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::header::HeaderMap;
use reqwest::redirect::Policy;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::dpapi;

const MAX_SYNC_BYTES: usize = 5 * 1024 * 1024;
const MAX_CONFIG_BYTES: usize = 64 * 1024;
const MAX_URL_LENGTH: usize = 2048;
const MAX_USERNAME_LENGTH: usize = 256;
const MAX_PASSWORD_LENGTH: usize = 4096;
const MAX_HEADER_VALUE_LENGTH: usize = 1024;
const APP_DIRECTORY: &str = "FrenchGrammarExercise";
const PROPFIND_RESOURCETYPE_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>";
const ALLOWED_HEADERS: [&str; 5] = [
    "accept",
    "content-type",
    "depth",
    "if-match",
    "if-none-match",
];
const NATIVE_CONFIG_INVALID: &str = "native.config_invalid";
const NATIVE_CREDENTIALS_REQUIRED: &str = "native.credentials_required";
const NATIVE_STORAGE_FAILED: &str = "native.storage_failed";
const NATIVE_NETWORK_FAILED: &str = "native.network_failed";
const NATIVE_UNSUPPORTED: &str = "native.unsupported";

/// Stable native error payload. `message` remains the original diagnostic so
/// legacy JS can display it; new JS maps `code` to a localized main prompt and
/// keeps `message` as expandable detail.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCommandError {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<BTreeMap<String, String>>,
    pub message: String,
    pub diagnostic: String,
}

fn native_error(code: &'static str, message: impl Into<String>) -> NativeCommandError {
    let message = message.into();
    NativeCommandError {
        code,
        params: None,
        diagnostic: message.clone(),
        message,
    }
}

#[derive(Default)]
pub struct SyncState {
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub url: String,
    pub username: String,
    pub auto_sync: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub url: String,
    pub username: String,
    pub auto_sync: bool,
    pub has_password: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub method: String,
    pub filename: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    version: u8,
    edition: String,
    identifier: String,
    url: String,
    username: String,
    auto_sync: bool,
    password_enc: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edition {
    Public,
    Internal,
}

impl Edition {
    fn from_identifier(identifier: &str) -> Option<Self> {
        match identifier {
            "com.fge.open" => Some(Self::Public),
            "com.fge.app" => Some(Self::Internal),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Internal => "internal",
        }
    }

    fn filename(self) -> &'static str {
        match self {
            Self::Public => "fge-progress-public.json",
            Self::Internal => "fge-progress-internal.json",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyncMethod {
    Get,
    Put,
    Mkcol,
    Propfind,
}

fn method_for(method: SyncMethod) -> Method {
    match method {
        SyncMethod::Get => Method::GET,
        SyncMethod::Put => Method::PUT,
        // reqwest accepts custom methods; WebDAV verbs are not enum variants.
        SyncMethod::Mkcol => Method::from_bytes(b"MKCOL").expect("static DAV method"),
        SyncMethod::Propfind => Method::from_bytes(b"PROPFIND").expect("static DAV method"),
    }
}

#[derive(Debug)]
struct ValidatedRequest {
    method: SyncMethod,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

fn current_edition(app: &AppHandle) -> Result<Edition, NativeCommandError> {
    Edition::from_identifier(&app.config().identifier)
        .ok_or_else(|| native_error(NATIVE_UNSUPPORTED, "当前应用标识不支持 WebDAV 同步"))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, NativeCommandError> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法定位同步配置目录"))?;
    Ok(dir.join("sync.json"))
}

fn entropy_for(identifier: &str) -> String {
    format!("fge-sync-v1:{identifier}")
}

fn validate_username(username: &str) -> Result<(), NativeCommandError> {
    if username.len() > MAX_USERNAME_LENGTH {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步用户名过长"));
    }
    if username
        .chars()
        .any(|ch| ch == ':' || ch == '\0' || ch == '\r' || ch == '\n')
    {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步用户名包含非法字符"));
    }
    Ok(())
}

fn validate_password(value: &str) -> Result<(), NativeCommandError> {
    if value.is_empty() || value.len() > MAX_PASSWORD_LENGTH {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步密码长度无效"));
    }
    if value
        .chars()
        .any(|ch| ch == '\0' || ch == '\r' || ch == '\n')
    {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步密码包含非法字符"));
    }
    Ok(())
}

fn validate_sync_url(raw: &str) -> Result<Url, NativeCommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_LENGTH {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址长度无效"));
    }
    let url = Url::parse(trimmed).map_err(|_| native_error(NATIVE_CONFIG_INVALID, "同步地址不是有效 URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址必须使用 HTTP 或 HTTPS"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址不能包含用户名或密码"));
    }
    if url.query().is_some() {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址不能包含查询参数"));
    }
    if url.fragment().is_some() {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址不能包含片段"));
    }
    if url.cannot_be_a_base() || url.host_str().map(str::is_empty).unwrap_or(true) {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址缺少主机名"));
    }
    Ok(url)
}

fn validate_base_for_edition(raw: &str, edition: Edition) -> Result<String, NativeCommandError> {
    canonical_sync_directory(raw, edition)
}

/// Normalize only the trailing slashes of an existing directory URL. Path
/// case, escapes and other components stay untouched, so a credential is
/// retained only for the same normalized target directory.
fn canonical_sync_directory(raw: &str, edition: Edition) -> Result<String, NativeCommandError> {
    let url = validate_sync_url(raw)?;
    let last = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or("");
    if last.eq_ignore_ascii_case(edition.filename()) {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步地址必须是目录，不能直接指向同步文件"));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn sync_target_url(
    base: &str,
    edition: Edition,
    method: SyncMethod,
) -> Result<Url, NativeCommandError> {
    let mut url = validate_sync_url(base)?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| native_error(NATIVE_CONFIG_INVALID, "同步地址不是有效目录 URL"))?;
        segments.pop_if_empty().push(APP_DIRECTORY);
        if matches!(method, SyncMethod::Mkcol | SyncMethod::Propfind) {
            segments.push("");
        } else {
            segments.push(edition.filename());
        }
    }
    Ok(url)
}

fn normalize_headers(
    headers: &HashMap<String, String>,
) -> Result<Vec<(String, String)>, NativeCommandError> {
    let allowed: HashSet<&str> = ALLOWED_HEADERS.iter().copied().collect();
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if !allowed.contains(lower.as_str()) {
            return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求包含不允许的请求头"));
        }
        if !seen.insert(lower.clone()) {
            return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求包含重复的请求头"));
        }
        if value.is_empty()
            || value.len() > MAX_HEADER_VALUE_LENGTH
            || value
                .chars()
                .any(|ch| ch == '\0' || ch == '\r' || ch == '\n')
        {
            return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求头值无效"));
        }
        if lower == "depth" && value != "0" {
            return Err(native_error(NATIVE_CONFIG_INVALID, "Depth 请求头只允许 0"));
        }
        normalized.push((lower, value.clone()));
    }
    normalized.sort();
    Ok(normalized)
}

fn validate_request(request: &SyncRequest, edition: Edition) -> Result<ValidatedRequest, NativeCommandError> {
    if request.filename != edition.filename() {
        return Err(native_error(NATIVE_CONFIG_INVALID, "同步文件名与当前版本不匹配"));
    }
    let method = match request.method.as_str() {
        "GET" => SyncMethod::Get,
        "PUT" => SyncMethod::Put,
        "MKCOL" => SyncMethod::Mkcol,
        "PROPFIND" => SyncMethod::Propfind,
        _ => return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求只支持 GET、PUT、MKCOL 或 PROPFIND")),
    };
    let headers = normalize_headers(&request.headers)?;
    if method == SyncMethod::Propfind
        && !headers
            .iter()
            .any(|(name, value)| name == "depth" && value == "0")
    {
        return Err(native_error(NATIVE_CONFIG_INVALID, "PROPFIND 必须携带 Depth: 0"));
    }
    let body = match (method, &request.body) {
        (SyncMethod::Get, None) => None,
        (SyncMethod::Get, Some(_)) => {
            return Err(native_error(NATIVE_CONFIG_INVALID, "GET 同步请求不能携带正文"))
        }
        (SyncMethod::Put, Some(body)) => {
            if body.is_empty() {
                return Err(native_error(NATIVE_CONFIG_INVALID, "PUT 同步请求正文为空"));
            }
            if body.len() > MAX_SYNC_BYTES {
                return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求正文超过 5 MB 上限"));
            }
            Some(body.clone())
        }
        (SyncMethod::Put, None) => {
            return Err(native_error(NATIVE_CONFIG_INVALID, "PUT 同步请求缺少正文"))
        }
        (SyncMethod::Mkcol, None) => None,
        (SyncMethod::Mkcol, Some(_)) => {
            return Err(native_error(NATIVE_CONFIG_INVALID, "MKCOL 同步请求不能携带正文"))
        }
        (SyncMethod::Propfind, None) => Some(PROPFIND_RESOURCETYPE_BODY.to_string()),
        (SyncMethod::Propfind, Some(body)) => {
            if body.is_empty() {
                return Err(native_error(NATIVE_CONFIG_INVALID, "PROPFIND 同步请求正文为空"));
            }
            if body.len() > MAX_SYNC_BYTES {
                return Err(native_error(NATIVE_CONFIG_INVALID, "同步请求正文超过 5 MB 上限"));
            }
            Some(body.clone())
        }
    };
    Ok(ValidatedRequest {
        method,
        headers,
        body,
    })
}

fn load_stored(app: &AppHandle) -> Result<Option<StoredConfig>, NativeCommandError> {
    let path = config_path(app)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(native_error(NATIVE_STORAGE_FAILED, "无法读取同步配置")),
    };
    if !metadata.is_file() || metadata.len() as usize > MAX_CONFIG_BYTES {
        return Err(native_error(NATIVE_STORAGE_FAILED, "同步配置损坏"));
    }
    let text = fs::read_to_string(&path).map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法读取同步配置"))?;
    let stored: StoredConfig =
        serde_json::from_str(&text).map_err(|_| native_error(NATIVE_STORAGE_FAILED, "同步配置损坏"))?;
    let edition = current_edition(app)?;
    if stored.version != 1
        || stored.edition != edition.as_str()
        || stored.identifier != app.config().identifier
    {
        return Err(native_error(NATIVE_STORAGE_FAILED, "同步配置与当前版本不匹配"));
    }
    Ok(Some(stored))
}

fn write_stored(path: &Path, stored: &StoredConfig) -> Result<(), NativeCommandError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法创建同步配置目录"))?;
    }
    let bytes = serde_json::to_vec_pretty(stored)
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法序列化同步配置"))?;
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err(native_error(NATIVE_STORAGE_FAILED, "同步配置过大"));
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, &bytes).map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法保存同步配置"))?;
    replace_file(&temporary, path).map_err(|_| {
        // The destination still holds the previous config; remove only the
        // temporary copy after a failed atomic replacement.
        let _ = fs::remove_file(&temporary);
        native_error(NATIVE_STORAGE_FAILED, "无法保存同步配置")
    })
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}


fn encrypt_password(identifier: &str, value: &str) -> Result<String, NativeCommandError> {
    let blob = dpapi::protect(value.as_bytes(), entropy_for(identifier).as_bytes())
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "无法保存同步凭据"))?;
    Ok(BASE64.encode(blob))
}

fn decrypt_password(identifier: &str, encoded: &str) -> Result<String, NativeCommandError> {
    let blob = BASE64
        .decode(encoded.as_bytes())
        .map_err(|_| native_error(NATIVE_CREDENTIALS_REQUIRED, "无法读取同步凭据"))?;
    let bytes = dpapi::unprotect(&blob, entropy_for(identifier).as_bytes())
        .map_err(|_| native_error(NATIVE_CREDENTIALS_REQUIRED, "无法读取同步凭据"))?;
    String::from_utf8(bytes).map_err(|_| native_error(NATIVE_CREDENTIALS_REQUIRED, "无法读取同步凭据"))
}

/// Decide whether an omitted password may reuse the stored ciphertext.
/// Reuse is allowed only for the same canonical directory URL and username;
/// a changed target must supply a new password, and a rejected save never
/// touches the existing config file.
fn resolve_encrypted_password(
    existing: Result<Option<StoredConfig>, NativeCommandError>,
    new_password: Option<&str>,
    identifier: &str,
    normalized_url: &str,
    username: &str,
    edition: Edition,
) -> Result<Option<String>, NativeCommandError> {
    if let Some(value) = new_password {
        validate_password(value)?;
        return Ok(Some(encrypt_password(identifier, value)?));
    }

    match existing {
        Err(error) => Err(error),
        Ok(None) => Ok(None),
        Ok(Some(stored)) => {
            let same_url = canonical_sync_directory(&stored.url, edition)
                .map(|url| url == normalized_url)
                .unwrap_or(false);
            if same_url && stored.username == username {
                Ok(stored.password_enc)
            } else {
                Err(native_error(NATIVE_CREDENTIALS_REQUIRED, "修改同步地址或用户名时必须重新输入密码"))
            }
        }
    }
}

fn collect_response_headers(headers: &HeaderMap) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for name in ["etag", "content-type"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            result.insert(name.to_string(), value.to_string());
        }
    }
    result
}

fn map_request_error(error: reqwest::Error) -> NativeCommandError {
    if error.is_timeout() {
        native_error(NATIVE_NETWORK_FAILED, "同步请求超时")
    } else if error.is_connect() {
        native_error(NATIVE_NETWORK_FAILED, "无法连接同步服务器")
    } else {
        native_error(NATIVE_NETWORK_FAILED, "同步网络请求失败")
    }
}

async fn execute_request(
    config: &StoredConfig,
    request: ValidatedRequest,
    edition: Edition,
) -> Result<SyncResponse, NativeCommandError> {
    let url = sync_target_url(&config.url, edition, request.method)?;
    let password = match config.password_enc.as_deref() {
        Some(encoded) => Some(decrypt_password(&config.identifier, encoded)?),
        None => None,
    };

    // No https_only / invalid-certificate override: plain HTTP is allowed by
    // product policy, while HTTPS keeps reqwest's default certificate checks.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .user_agent("fge-sync/1")
        .build()
        .map_err(|_| native_error(NATIVE_NETWORK_FAILED, "无法初始化同步网络请求"))?;

    let method = method_for(request.method);
    let mut builder = client.request(method, url);
    if let Some(password) = password.as_deref() {
        builder = builder.basic_auth(&config.username, Some(password));
    }
    for (name, value) in &request.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(map_request_error)?;
    let status = response.status().as_u16();
    let headers = collect_response_headers(response.headers());
    if response
        .content_length()
        .map(|length| length > MAX_SYNC_BYTES as u64)
        .unwrap_or(false)
    {
        return Err(native_error(NATIVE_NETWORK_FAILED, "同步响应超过 5 MB 上限"));
    }

    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_request_error)? {
        if body.len() + chunk.len() > MAX_SYNC_BYTES {
            return Err(native_error(NATIVE_NETWORK_FAILED, "同步响应超过 5 MB 上限"));
        }
        body.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(body).map_err(|_| native_error(NATIVE_NETWORK_FAILED, "同步响应不是有效文本"))?;

    Ok(SyncResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
pub fn sync_get_config(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<Option<SyncConfig>, NativeCommandError> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "同步配置状态不可用"))?;
    let stored = load_stored(&app)?;
    Ok(stored.map(|config| SyncConfig {
        url: config.url,
        username: config.username,
        auto_sync: config.auto_sync,
        has_password: config.password_enc.is_some(),
    }))
}

#[tauri::command]
pub fn sync_set_config(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
    config: SyncSettings,
    password: Option<String>,
) -> Result<(), NativeCommandError> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "同步配置状态不可用"))?;
    let edition = current_edition(&app)?;
    let identifier = app.config().identifier.clone();
    let normalized_url = validate_base_for_edition(&config.url, edition)?;
    validate_username(&config.username)?;

    let existing = load_stored(&app);
    let encrypted = resolve_encrypted_password(
        existing,
        password.as_deref(),
        &identifier,
        &normalized_url,
        &config.username,
        edition,
    )?;

    let stored = StoredConfig {
        version: 1,
        edition: edition.as_str().to_string(),
        identifier,
        url: normalized_url,
        username: config.username,
        auto_sync: config.auto_sync,
        password_enc: encrypted,
    };
    write_stored(&config_path(&app)?, &stored)
}

#[tauri::command]
pub fn sync_disconnect(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<(), NativeCommandError> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "同步配置状态不可用"))?;
    let path = config_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(native_error(NATIVE_STORAGE_FAILED, "无法清除同步配置")),
    }
}

#[tauri::command]
pub async fn sync_request(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
    request: SyncRequest,
) -> Result<SyncResponse, NativeCommandError> {
    let edition = current_edition(&app)?;
    let validated = validate_request(&request, edition)?;
    let stored = {
        // Snapshot under the same lock as config writes/disconnect, then drop
        // the guard before any network await so a slow request cannot block
        // saving or disconnecting.
        let _guard = state
            .lock
            .lock()
            .map_err(|_| native_error(NATIVE_STORAGE_FAILED, "同步配置状态不可用"))?;
        load_stored(&app)?.ok_or_else(|| native_error(NATIVE_CONFIG_INVALID, "尚未配置 WebDAV 同步"))?
    };
    execute_request(&stored, validated, edition).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(url: &str) -> SyncSettings {
        SyncSettings {
            url: url.to_string(),
            username: "reader".to_string(),
            auto_sync: true,
        }
    }

    fn request(method: &str, filename: &str) -> SyncRequest {
        SyncRequest {
            method: method.to_string(),
            filename: filename.to_string(),
            headers: HashMap::new(),
            body: None,
        }
    }

    #[test]
    fn edition_identity_selects_exact_filename() {
        assert_eq!(Edition::from_identifier("com.fge.open"), Some(Edition::Public));
        assert_eq!(Edition::from_identifier("com.fge.app"), Some(Edition::Internal));
        assert_eq!(Edition::from_identifier("com.fge.other"), None);
        assert_eq!(Edition::Public.filename(), "fge-progress-public.json");
        assert_eq!(Edition::Internal.filename(), "fge-progress-internal.json");
    }

    #[test]
    fn url_accepts_http_and_https_without_userinfo_query_or_fragment() {
        for url in [
            "https://dav.example.com/fge",
            "https://dav.example.com:8443/fge",
            "http://dav.example.com/fge",
            "http://127.0.0.1:19080/dav",
            "http://192.168.1.20:5005/root/",
        ] {
            assert!(validate_sync_url(url).is_ok(), "{url} should be accepted");
        }
        for url in [
            "ftp://dav.example.com/fge",
            "http://user@dav.example.com/fge",
            "http://user:secret@dav.example.com/fge",
            "http://dav.example.com/fge?token=1",
            "http://dav.example.com/fge#fragment",
            "https://",
            "not a url",
            "",
        ] {
            assert_eq!(
                validate_sync_url(url).expect_err("bad URL").code,
                "native.config_invalid",
                "{url}"
            );
        }
    }

    #[test]
    fn directory_methods_target_the_fixed_app_folder_with_trailing_slash() {
        for base in [
            "https://dav.example.com",
            "https://dav.example.com/",
            "https://dav.example.com/dir",
            "https://dav.example.com/dir/",
            "http://127.0.0.1:19080/root",
        ] {
            let expected_prefix = format!("{}/FrenchGrammarExercise/", base.trim_end_matches('/'));
            for method in [SyncMethod::Mkcol, SyncMethod::Propfind] {
                assert_eq!(
                    sync_target_url(base, Edition::Public, method)
                        .unwrap()
                        .as_str(),
                    expected_prefix,
                    "{method:?} from {base}"
                );
            }
        }
    }

    #[test]
    fn get_and_put_target_the_fixed_file_inside_the_app_folder() {
        let expected = "https://dav.example.com/dir/FrenchGrammarExercise/fge-progress-public.json";
        for base in ["https://dav.example.com/dir", "https://dav.example.com/dir/"] {
            for method in [SyncMethod::Get, SyncMethod::Put] {
                assert_eq!(
                    sync_target_url(base, Edition::Public, method)
                        .unwrap()
                        .as_str(),
                    expected
                );
            }
        }
        assert_eq!(
            sync_target_url(
                "http://127.0.0.1:19080/root/",
                Edition::Internal,
                SyncMethod::Get
            )
            .unwrap()
            .as_str(),
            "http://127.0.0.1:19080/root/FrenchGrammarExercise/fge-progress-internal.json"
        );
    }

    #[test]
    fn custom_dav_methods_are_constructed_without_falling_back_to_known_verbs() {
        assert_eq!(method_for(SyncMethod::Mkcol).as_str(), "MKCOL");
        assert_eq!(method_for(SyncMethod::Propfind).as_str(), "PROPFIND");
        assert_eq!(method_for(SyncMethod::Get).as_str(), "GET");
        assert_eq!(method_for(SyncMethod::Put).as_str(), "PUT");
    }

    #[test]
    fn directory_url_still_rejects_direct_sync_file_targets() {
        assert!(validate_base_for_edition(
            "https://dav.example.com/fge-progress-public.json",
            Edition::Public
        )
        .is_err());
        assert!(validate_base_for_edition(
            "http://dav.example.com/fge-progress-public.json",
            Edition::Public
        )
        .is_err());
        assert!(validate_base_for_edition(
            "https://dav.example.com/fge-progress-internal.json",
            Edition::Public
        )
        .is_ok());
    }

    #[test]
    fn request_filename_must_match_the_edition_for_every_method() {
        for method in ["GET", "PUT", "MKCOL", "PROPFIND"] {
            let mut public = request(method, "fge-progress-public.json");
            if method == "PUT" {
                public.body = Some("{}".to_string());
            }
            if method == "PROPFIND" {
                public
                    .headers
                    .insert("Depth".to_string(), "0".to_string());
            }
            assert!(validate_request(&public, Edition::Public).is_ok(), "{method}");
            assert!(validate_request(&public, Edition::Internal).is_err(), "{method}");
            let mut internal = request(method, "fge-progress-internal.json");
            if method == "PUT" {
                internal.body = Some("{}".to_string());
            }
            if method == "PROPFIND" {
                internal
                    .headers
                    .insert("Depth".to_string(), "0".to_string());
            }
            assert!(
                validate_request(&internal, Edition::Internal).is_ok(),
                "{method}"
            );
        }
    }

    #[test]
    fn all_four_methods_are_accepted_and_others_are_rejected() {
        for method in ["GET", "PUT", "MKCOL", "PROPFIND"] {
            let mut candidate = request(method, "fge-progress-public.json");
            if method == "PUT" {
                candidate.body = Some("{}".to_string());
            }
            if method == "PROPFIND" {
                candidate
                    .headers
                    .insert("Depth".to_string(), "0".to_string());
            }
            assert!(validate_request(&candidate, Edition::Public).is_ok(), "{method}");
        }
        for method in ["POST", "DELETE", "MOVE", "HEAD"] {
            assert!(
                validate_request(&request(method, "fge-progress-public.json"), Edition::Public)
                    .is_err(),
                "{method}"
            );
        }
    }

    #[test]
    fn only_bodies_valid_for_each_method_are_accepted() {
        let mut get_with_body = request("GET", "fge-progress-public.json");
        get_with_body.body = Some("{}".to_string());
        assert!(validate_request(&get_with_body, Edition::Public).is_err());

        let mut put_without_body = request("PUT", "fge-progress-public.json");
        assert!(validate_request(&put_without_body, Edition::Public).is_err());

        put_without_body.body = Some("{}".to_string());
        assert!(validate_request(&put_without_body, Edition::Public).is_ok());

        put_without_body.body = Some("x".repeat(MAX_SYNC_BYTES + 1));
        assert!(validate_request(&put_without_body, Edition::Public).is_err());

        let mkcol = request("MKCOL", "fge-progress-public.json");
        assert!(validate_request(&mkcol, Edition::Public).is_ok());
        let mut mkcol_with_body = request("MKCOL", "fge-progress-public.json");
        mkcol_with_body.body = Some("<mkcol/>".to_string());
        assert!(validate_request(&mkcol_with_body, Edition::Public).is_err());

        let mut propfind = request("PROPFIND", "fge-progress-public.json");
        propfind
            .headers
            .insert("Depth".to_string(), "0".to_string());
        assert!(validate_request(&propfind, Edition::Public).is_ok());
        propfind.body = Some(PROPFIND_RESOURCETYPE_BODY.to_string());
        assert!(validate_request(&propfind, Edition::Public).is_ok());
        propfind.body = Some("x".repeat(MAX_SYNC_BYTES + 1));
        assert!(validate_request(&propfind, Edition::Public).is_err());
    }

    #[test]
    fn propfind_requires_depth_zero_and_other_methods_reject_other_depths() {
        for method in ["GET", "PUT", "MKCOL", "PROPFIND"] {
            let mut candidate = request(method, "fge-progress-public.json");
            if method == "PUT" {
                candidate.body = Some("{}".to_string());
            }
            if method == "PROPFIND" {
                assert!(
                    validate_request(&candidate, Edition::Public).is_err(),
                    "PROPFIND must not default to an infinite depth"
                );
            }
            candidate
                .headers
                .insert("Depth".to_string(), "1".to_string());
            assert!(validate_request(&candidate, Edition::Public).is_err(), "{method}");
            candidate.headers.insert(
                "Depth".to_string(),
                "infinity".to_string(),
            );
            assert!(validate_request(&candidate, Edition::Public).is_err(), "{method}");
            candidate
                .headers
                .insert("Depth".to_string(), "0".to_string());
            assert!(validate_request(&candidate, Edition::Public).is_ok(), "{method}");
        }
    }

    #[test]
    fn only_sync_headers_are_forwarded_and_authorization_is_native_only() {
        let mut req = request("GET", "fge-progress-public.json");
        req.headers.insert("Accept".to_string(), "application/json".to_string());
        req.headers.insert("If-None-Match".to_string(), "\"abc\"".to_string());
        req.headers.insert("Depth".to_string(), "0".to_string());
        let validated = validate_request(&req, Edition::Public).expect("headers");
        assert_eq!(
            validated.headers,
            vec![
                ("accept".to_string(), "application/json".to_string()),
                ("depth".to_string(), "0".to_string()),
                ("if-none-match".to_string(), "\"abc\"".to_string())
            ]
        );

        for (name, value) in [
            ("authorization", "Basic abc"),
            ("cookie", "a=b"),
            ("host", "evil.example"),
            ("x-custom", "1"),
        ] {
            let mut bad = request("GET", "fge-progress-public.json");
            bad.headers.insert(name.to_string(), value.to_string());
            assert!(validate_request(&bad, Edition::Public).is_err(), "{name}");
        }

        let mut injected = request("PUT", "fge-progress-public.json");
        injected.body = Some("{}".to_string());
        injected
            .headers
            .insert("If-Match".to_string(), "\"ok\"\r\nX-Evil: 1".to_string());
        assert!(validate_request(&injected, Edition::Public).is_err());
    }

    #[test]
    fn settings_validate_url_username_and_password_bounds() {
        assert!(validate_base_for_edition("https://dav.example.com/fge", Edition::Public).is_ok());
        assert!(validate_base_for_edition("http://dav.example.com/fge", Edition::Public).is_ok());
        assert!(validate_base_for_edition("http://127.0.0.1:19080/dav/", Edition::Public).is_ok());
        assert!(validate_username("reader").is_ok());
        assert!(validate_username("").is_ok());
        assert!(validate_username("bad\nname").is_err());
        assert!(validate_username(&"x".repeat(MAX_USERNAME_LENGTH + 1)).is_err());
        assert!(validate_password("app-password").is_ok());
        assert!(validate_password("").is_err());
        assert!(validate_password("bad\r\npass").is_err());
        assert!(validate_password(&"x".repeat(MAX_PASSWORD_LENGTH + 1)).is_err());
        assert_eq!(settings("https://dav.example.com/fge").url, "https://dav.example.com/fge");
    }

    #[test]
    fn response_headers_exclude_cookies_and_other_server_state() {
        let mut headers = HeaderMap::new();
        headers.insert("etag", "\"strong\"".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());
        headers.insert("set-cookie", "session=secret".parse().unwrap());
        headers.insert("x-unknown", "value".parse().unwrap());
        let collected = collect_response_headers(&headers);
        assert_eq!(collected.len(), 2);
        assert_eq!(collected.get("etag").map(String::as_str), Some("\"strong\""));
        assert_eq!(
            collected.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert!(!collected.contains_key("set-cookie"));
    }

    fn stored_config(url: &str, username: &str, encrypted: Option<&str>) -> StoredConfig {
        StoredConfig {
            version: 1,
            edition: "public".to_string(),
            identifier: "com.fge.open".to_string(),
            url: url.to_string(),
            username: username.to_string(),
            auto_sync: true,
            password_enc: encrypted.map(str::to_string),
        }
    }

    #[test]
    fn canonical_directory_url_ignores_only_trailing_slashes() {
        assert_eq!(
            canonical_sync_directory("https://dav.example.com/dir/", Edition::Public).unwrap(),
            "https://dav.example.com/dir"
        );
        assert_eq!(
            canonical_sync_directory("https://dav.example.com/dir", Edition::Public).unwrap(),
            "https://dav.example.com/dir"
        );
        assert_eq!(
            canonical_sync_directory("https://dav.example.com/", Edition::Public).unwrap(),
            "https://dav.example.com"
        );
        assert_eq!(
            canonical_sync_directory("https://dav.example.com", Edition::Public).unwrap(),
            "https://dav.example.com"
        );
        assert_ne!(
            canonical_sync_directory("https://dav.example.com/Dir", Edition::Public).unwrap(),
            canonical_sync_directory("https://dav.example.com/dir", Edition::Public).unwrap()
        );
        assert!(canonical_sync_directory(
            "https://dav.example.com/fge-progress-public.json",
            Edition::Public
        )
        .is_err());
    }

    #[test]
    fn changing_url_without_a_new_password_is_rejected_instead_of_reusing_credentials() {
        let existing = Ok(Some(stored_config(
            "https://dav.example.com/old",
            "reader",
            Some("old-ciphertext"),
        )));
        let error = resolve_encrypted_password(
            existing,
            None,
            "com.fge.open",
            "https://dav.example.com/new",
            "reader",
            Edition::Public,
        )
        .expect_err("target change must not reuse the old password");
        assert_eq!(error.code, "native.credentials_required");
        assert!(error.message.contains("密码"), "{}", error.message);
    }

    #[test]
    fn changing_username_without_a_new_password_is_rejected() {
        let existing = Ok(Some(stored_config(
            "https://dav.example.com/dir",
            "reader",
            Some("old-ciphertext"),
        )));
        let error = resolve_encrypted_password(
            existing,
            None,
            "com.fge.open",
            "https://dav.example.com/dir",
            "another-reader",
            Edition::Public,
        )
        .expect_err("username change must not reuse the old password");
        assert_eq!(error.code, "native.credentials_required");
        assert!(error.message.contains("密码"), "{}", error.message);
    }

    #[test]
    fn same_target_may_retain_the_existing_ciphertext_when_password_is_omitted() {
        let existing = Ok(Some(stored_config(
            "https://dav.example.com/dir/",
            "reader",
            Some("old-ciphertext"),
        )));
        let retained = resolve_encrypted_password(
            existing,
            None,
            "com.fge.open",
            "https://dav.example.com/dir",
            "reader",
            Edition::Public,
        )
        .expect("same target keeps the stored credential");
        assert_eq!(retained.as_deref(), Some("old-ciphertext"));
    }

    #[test]
    fn new_or_corrupt_config_without_a_password_never_invents_a_credential() {
        let fresh = resolve_encrypted_password(
            Ok(None),
            None,
            "com.fge.open",
            "https://dav.example.com/dir",
            "reader",
            Edition::Public,
        )
        .expect("anonymous config");
        assert_eq!(fresh, None);

        let corrupt = resolve_encrypted_password(
            Err(native_error(NATIVE_STORAGE_FAILED, "同步配置损坏")),
            None,
            "com.fge.open",
            "https://dav.example.com/dir",
            "reader",
            Edition::Public,
        );
        assert_eq!(
            corrupt.expect_err("corrupt config").code,
            NATIVE_STORAGE_FAILED
        );
    }

    #[test]
    fn native_sync_errors_use_fixed_codes_without_matching_messages() {
        assert_eq!(
            validate_username("bad\nname").expect_err("username").code,
            "native.config_invalid"
        );
        assert_eq!(
            validate_password("").expect_err("empty password").code,
            "native.config_invalid"
        );
        assert_eq!(
            decrypt_password("com.fge.open", "!!!")
                .expect_err("bad credential")
                .code,
            "native.credentials_required"
        );
        let invalid_request = request("DELETE", "fge-progress-public.json");
        assert_eq!(
            validate_request(&invalid_request, Edition::Public)
                .expect_err("bad method")
                .code,
            "native.config_invalid"
        );
        let wrong_filename = request("GET", "fge-progress-internal.json");
        assert_eq!(
            validate_request(&wrong_filename, Edition::Public)
                .expect_err("wrong filename")
                .code,
            "native.config_invalid"
        );

        let payload = serde_json::to_value(native_error(NATIVE_NETWORK_FAILED, "同步请求超时"))
            .expect("native error serializes");
        assert_eq!(payload["code"], "native.network_failed");
        assert_eq!(payload["message"], "同步请求超时");
        assert!(payload.get("params").is_none());
    }

    #[test]
    fn changed_target_with_a_new_password_encrypts_the_new_credential() {
        let encrypted = resolve_encrypted_password(
            Ok(Some(stored_config(
                "https://dav.example.com/old",
                "reader",
                Some("old-ciphertext"),
            ))),
            Some("new-app-password"),
            "com.fge.open",
            "https://dav.example.com/new",
            "reader",
            Edition::Public,
        )
        .expect("new password");
        let encrypted = encrypted.expect("ciphertext");
        assert_ne!(encrypted, "old-ciphertext");
        assert!(!encrypted.contains("new-app-password"));
    }

    #[test]
    fn atomic_replace_keeps_the_previous_config_when_commit_fails() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fge-sync-atomic-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sync.json");
        fs::write(&path, b"old-config").unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();

        let candidate = stored_config(
            "https://dav.example.com/new",
            "reader",
            Some("new-ciphertext"),
        );
        let result = write_stored(&path, &candidate);

        assert_eq!(
            result.expect_err("read-only destination must fail").code,
            "native.storage_failed"
        );
        assert_eq!(fs::read(&path).unwrap(), b"old-config");
        assert!(
            !path.with_extension("json.tmp").exists(),
            "failed commit must not leave the temporary credential file"
        );

        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        let _ = fs::set_permissions(&path, permissions);
        rm_test_dir(&dir);
    }

    #[test]
    fn atomic_replace_switches_to_the_new_config() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fge-sync-atomic-ok-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sync.json");
        fs::write(&path, b"old-config").unwrap();
        let candidate = stored_config(
            "https://dav.example.com/new",
            "reader",
            Some("new-ciphertext"),
        );
        write_stored(&path, &candidate).unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("new-ciphertext"));
        assert!(!written.contains("old-config"));
        assert!(!path.with_extension("json.tmp").exists());
        rm_test_dir(&dir);
    }

    fn rm_test_dir(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stored_config_never_uses_a_plaintext_password_field() {
        let stored = StoredConfig {
            version: 1,
            edition: "public".to_string(),
            identifier: "com.fge.open".to_string(),
            url: "https://dav.example.com/fge".to_string(),
            username: "reader".to_string(),
            auto_sync: true,
            password_enc: Some("ciphertext".to_string()),
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(json.contains("passwordEnc"));
        assert!(!json.contains("\"password\""));
        assert!(!json.contains("app-password"));
    }
}
