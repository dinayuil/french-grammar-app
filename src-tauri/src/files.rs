//! Narrow native save command for backup JSON and stats PNG exports.
//!
//! The webview never receives filesystem access: it sends bounded bytes, the
//! user picks a destination with the native dialog, and only that one file is
//! written. Cancellation is a normal result, not an error.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;

use std::collections::BTreeMap;
use std::path::PathBuf;

const MAX_JSON_BYTES: usize = 5 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
const MAX_DIALOG_TITLE_LENGTH: usize = 200;
const DEFAULT_DIALOG_TITLE: &str = "保存导出文件";
const NATIVE_FILE_FAILED: &str = "native.file_failed";
const NATIVE_UNSUPPORTED: &str = "native.unsupported";
const SAVE_OPERATION: &str = "save";
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileResult {
    pub status: &'static str,
}

/// Stable native error payload. `message` stays the original diagnostic so a
/// legacy webview can still display it; new JS maps `code` to a localized
/// main prompt and shows `message` only as expandable detail.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCommandError {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<BTreeMap<String, String>>,
    pub message: String,
    pub diagnostic: String,
}

impl NativeCommandError {
    fn save(code: &'static str, message: impl Into<String>) -> Self {
        let mut params = BTreeMap::new();
        params.insert("operation".into(), SAVE_OPERATION.into());
        let message = message.into();
        Self {
            code,
            params: Some(params),
            diagnostic: message.clone(),
            message,
        }
    }
}

#[derive(Debug)]
struct PreparedExport {
    bytes: Vec<u8>,
    filter_name: &'static str,
    extension: &'static str,
}

fn validate_filename(filename: &str) -> Result<(), NativeCommandError> {
    if filename.is_empty() || filename.len() > 128 {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名长度无效",
        ));
    }
    if filename == "." || filename == ".." || filename.starts_with('.') {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名无效",
        ));
    }
    if filename.ends_with(' ') || filename.ends_with('.') {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名无效",
        ));
    }
    if !filename
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名只能包含字母、数字、点、横线和下划线",
        ));
    }
    if filename.contains('/') || filename.contains('\\') || filename.contains(':') {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名不能包含路径",
        ));
    }
    let stem = filename.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(NativeCommandError::save(
            NATIVE_FILE_FAILED,
            "导出文件名无效",
        ));
    }
    Ok(())
}

fn prepare_export(
    filename: &str,
    mime_type: &str,
    encoding: &str,
    data: &str,
) -> Result<PreparedExport, NativeCommandError> {
    validate_filename(filename)?;

    match (encoding, mime_type) {
        ("utf8", "application/json") => {
            if !filename.to_ascii_lowercase().ends_with(".json") {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "JSON 导出文件名必须以 .json 结尾",
                ));
            }
            if data.is_empty() {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "导出内容为空",
                ));
            }
            if data.len() > MAX_JSON_BYTES {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "备份文件超过 5 MB 上限",
                ));
            }
            Ok(PreparedExport {
                bytes: data.as_bytes().to_vec(),
                filter_name: "JSON",
                extension: "json",
            })
        }
        ("base64", "image/png") => {
            if !filename.to_ascii_lowercase().ends_with(".png") {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "PNG 导出文件名必须以 .png 结尾",
                ));
            }
            if !data.is_ascii() {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "PNG 导出内容不是有效 base64",
                ));
            }
            let bytes = BASE64.decode(data.as_bytes()).map_err(|_| {
                NativeCommandError::save(NATIVE_FILE_FAILED, "PNG 导出内容不是有效 base64")
            })?;
            if bytes.is_empty() || bytes.len() > MAX_PNG_BYTES {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "PNG 导出内容大小无效",
                ));
            }
            if !bytes.starts_with(PNG_SIGNATURE) {
                return Err(NativeCommandError::save(
                    NATIVE_FILE_FAILED,
                    "PNG 导出内容缺少 PNG 标识",
                ));
            }
            Ok(PreparedExport {
                bytes,
                filter_name: "PNG",
                extension: "png",
            })
        }
        _ => Err(NativeCommandError::save(
            NATIVE_UNSUPPORTED,
            "不支持的导出文件类型",
        )),
    }
}

/// Missing, blank, overlong or control-character titles fall back to the old
/// default so an older caller remains compatible.
fn resolve_dialog_title(title: Option<&str>) -> String {
    match title {
        Some(value)
            if !value.trim().is_empty()
                && value.chars().count() <= MAX_DIALOG_TITLE_LENGTH
                && !value.chars().any(char::is_control) =>
        {
            value.to_owned()
        }
        _ => DEFAULT_DIALOG_TITLE.to_owned(),
    }
}

fn write_with_dialog(
    filename: &str,
    dialog_title: &str,
    prepared: PreparedExport,
) -> Result<Option<()>, NativeCommandError> {
    let destination: Option<PathBuf> = rfd::FileDialog::new()
        .set_title(dialog_title)
        .set_file_name(filename)
        .add_filter(prepared.filter_name, &[prepared.extension])
        .save_file();
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(&destination, &prepared.bytes)
        .map_err(|_| NativeCommandError::save(NATIVE_FILE_FAILED, "无法写入导出文件"))?;
    Ok(Some(()))
}

/// Save one UTF-8 JSON or base64 PNG export chosen by the user.
#[tauri::command]
pub async fn save_export_file(
    filename: String,
    mime_type: String,
    encoding: String,
    data: String,
    dialog_title: Option<String>,
) -> Result<SaveFileResult, NativeCommandError> {
    let prepared = prepare_export(&filename, &mime_type, &encoding, &data)?;
    let title = resolve_dialog_title(dialog_title.as_deref());
    let result = tauri::async_runtime::spawn_blocking(move || {
        write_with_dialog(&filename, &title, prepared)
    })
    .await
    .map_err(|_| {
        NativeCommandError::save(NATIVE_FILE_FAILED, "无法打开文件保存对话框")
    })??;

    Ok(SaveFileResult {
        status: if result.is_some() { "saved" } else { "cancelled" },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        prepare_export, resolve_dialog_title, validate_filename, MAX_JSON_BYTES,
    };

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    fn filename_error_code(filename: &str) -> &'static str {
        validate_filename(filename).expect_err("invalid filename").code
    }

    #[test]
    fn accepts_the_two_export_shapes() {
        let json = prepare_export(
            "fge-progress-public-2026-11-15.json",
            "application/json",
            "utf8",
            "{\"format\":\"fge-progress\"}",
        )
        .expect("json");
        assert_eq!(json.extension, "json");
        assert!(!json.bytes.is_empty());

        let png = prepare_export("fge-stats-2026-11-15.png", "image/png", "base64", PNG_1X1)
            .expect("png");
        assert_eq!(png.extension, "png");
        assert!(png.bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn rejects_paths_reserved_names_and_wrong_extensions() {
        for name in [
            "../evil.json",
            "sub/evil.json",
            "sub\\evil.json",
            "C:evil.json",
            ".hidden.json",
            "CON.json",
            "",
        ] {
            assert_eq!(filename_error_code(name), "native.file_failed", "{name}");
        }
        assert!(prepare_export("fge.json.exe", "application/json", "utf8", "{}").is_err());
        assert!(prepare_export("fge.png", "application/json", "utf8", "{}").is_err());
        assert!(prepare_export("fge.json", "image/png", "base64", PNG_1X1).is_err());
    }

    #[test]
    fn native_errors_use_fixed_codes_and_non_sensitive_params() {
        let error = validate_filename("../evil.json").expect_err("invalid filename");
        assert_eq!(error.code, "native.file_failed");
        assert_eq!(
            error
                .params
                .as_ref()
                .and_then(|params| params.get("operation"))
                .map(String::as_str),
            Some("save")
        );
        assert!(error.message.contains("文件名"));

        let unsupported =
            prepare_export("fge.txt", "text/plain", "utf8", "hello").expect_err("unsupported");
        assert_eq!(unsupported.code, "native.unsupported");
        assert_eq!(
            unsupported
                .params
                .as_ref()
                .and_then(|params| params.get("operation"))
                .map(String::as_str),
            Some("save")
        );

        let payload = serde_json::to_value(&error).expect("native error serializes");
        assert_eq!(payload["code"], "native.file_failed");
        assert_eq!(payload["message"], error.message);
        assert_eq!(payload["diagnostic"], error.message);
        assert_eq!(payload["params"]["operation"], "save");
    }

    #[test]
    fn dialog_title_is_optional_and_never_touches_the_file_payload() {
        assert_eq!(resolve_dialog_title(None), "保存导出文件");
        assert_eq!(resolve_dialog_title(Some("")), "保存导出文件");
        assert_eq!(resolve_dialog_title(Some("   ")), "保存导出文件");
        assert_eq!(
            resolve_dialog_title(Some("Enregistrer l'export")),
            "Enregistrer l'export"
        );
        assert_eq!(
            resolve_dialog_title(Some("Titre\ninjecté")),
            "保存导出文件"
        );
        assert_eq!(
            resolve_dialog_title(Some(&"t".repeat(201))),
            "保存导出文件"
        );

        let prepared = prepare_export(
            "fge-progress-public-2026-11-16.json",
            "application/json",
            "utf8",
            "{\"format\":\"fge-progress\"}",
        )
        .expect("json");
        assert_eq!(prepared.extension, "json");
        assert_eq!(
            prepared.bytes,
            b"{\"format\":\"fge-progress\"}".to_vec(),
            "dialog title must not alter exported data"
        );
    }

    #[test]
    fn rejects_bad_base64_and_non_png_bytes() {
        assert!(prepare_export("fge.png", "image/png", "base64", "!!!").is_err());
        let not_png = base64_encode(b"not a png");
        assert!(prepare_export("fge.png", "image/png", "base64", &not_png).is_err());
    }

    #[test]
    fn enforces_export_size_limits() {
        let oversized = "x".repeat(MAX_JSON_BYTES + 1);
        assert!(prepare_export("fge.json", "application/json", "utf8", &oversized).is_err());
    }

    fn base64_encode(bytes: &[u8]) -> String {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine;
        BASE64.encode(bytes)
    }
}
