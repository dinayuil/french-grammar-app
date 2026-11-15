//! Narrow native save command for backup JSON and stats PNG exports.
//!
//! The webview never receives filesystem access: it sends bounded bytes, the
//! user picks a destination with the native dialog, and only that one file is
//! written. Cancellation is a normal result, not an error.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;

use std::path::PathBuf;

const MAX_JSON_BYTES: usize = 5 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
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

#[derive(Debug)]
struct PreparedExport {
    bytes: Vec<u8>,
    filter_name: &'static str,
    extension: &'static str,
}

fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() || filename.len() > 128 {
        return Err("导出文件名长度无效".to_string());
    }
    if filename == "." || filename == ".." || filename.starts_with('.') {
        return Err("导出文件名无效".to_string());
    }
    if filename.ends_with(' ') || filename.ends_with('.') {
        return Err("导出文件名无效".to_string());
    }
    if !filename
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err("导出文件名只能包含字母、数字、点、横线和下划线".to_string());
    }
    if filename.contains('/') || filename.contains('\\') || filename.contains(':') {
        return Err("导出文件名不能包含路径".to_string());
    }
    let stem = filename.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err("导出文件名无效".to_string());
    }
    Ok(())
}

fn prepare_export(
    filename: &str,
    mime_type: &str,
    encoding: &str,
    data: &str,
) -> Result<PreparedExport, String> {
    validate_filename(filename)?;

    match (encoding, mime_type) {
        ("utf8", "application/json") => {
            if !filename.to_ascii_lowercase().ends_with(".json") {
                return Err("JSON 导出文件名必须以 .json 结尾".to_string());
            }
            if data.is_empty() {
                return Err("导出内容为空".to_string());
            }
            if data.len() > MAX_JSON_BYTES {
                return Err("备份文件超过 5 MB 上限".to_string());
            }
            Ok(PreparedExport {
                bytes: data.as_bytes().to_vec(),
                filter_name: "JSON",
                extension: "json",
            })
        }
        ("base64", "image/png") => {
            if !filename.to_ascii_lowercase().ends_with(".png") {
                return Err("PNG 导出文件名必须以 .png 结尾".to_string());
            }
            if !data.is_ascii() {
                return Err("PNG 导出内容不是有效 base64".to_string());
            }
            let bytes = BASE64
                .decode(data.as_bytes())
                .map_err(|_| "PNG 导出内容不是有效 base64".to_string())?;
            if bytes.is_empty() || bytes.len() > MAX_PNG_BYTES {
                return Err("PNG 导出内容大小无效".to_string());
            }
            if !bytes.starts_with(PNG_SIGNATURE) {
                return Err("PNG 导出内容缺少 PNG 标识".to_string());
            }
            Ok(PreparedExport {
                bytes,
                filter_name: "PNG",
                extension: "png",
            })
        }
        _ => Err("不支持的导出文件类型".to_string()),
    }
}

fn write_with_dialog(
    filename: &str,
    prepared: PreparedExport,
) -> Result<Option<()>, String> {
    let destination: Option<PathBuf> = rfd::FileDialog::new()
        .set_title("保存导出文件")
        .set_file_name(filename)
        .add_filter(prepared.filter_name, &[prepared.extension])
        .save_file();
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(&destination, &prepared.bytes)
        .map_err(|_| "无法写入导出文件".to_string())?;
    Ok(Some(()))
}

/// Save one UTF-8 JSON or base64 PNG export chosen by the user.
#[tauri::command]
pub async fn save_export_file(
    filename: String,
    mime_type: String,
    encoding: String,
    data: String,
) -> Result<SaveFileResult, String> {
    let prepared = prepare_export(&filename, &mime_type, &encoding, &data)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        write_with_dialog(&filename, prepared)
    })
    .await
    .map_err(|_| "无法打开文件保存对话框".to_string())??;

    Ok(SaveFileResult {
        status: if result.is_some() { "saved" } else { "cancelled" },
    })
}

#[cfg(test)]
mod tests {
    use super::{prepare_export, validate_filename, MAX_JSON_BYTES};

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
            assert!(validate_filename(name).is_err(), "{name} should be rejected");
        }
        assert!(prepare_export("fge.json.exe", "application/json", "utf8", "{}").is_err());
        assert!(prepare_export("fge.png", "application/json", "utf8", "{}").is_err());
        assert!(prepare_export("fge.json", "image/png", "base64", PNG_1X1).is_err());
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
