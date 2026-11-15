//! Windows DPAPI wrapper for the WebDAV app password.
//!
//! Only the encrypted blob is persisted. A fixed per-edition entropy string
//! binds the blob to this application identity; failures return a generic
//! message so no plaintext, DPAPI detail or path can reach the webview/logs.

#[cfg(windows)]
pub fn protect(plaintext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    imp::protect(plaintext, entropy)
}

#[cfg(windows)]
pub fn unprotect(blob: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    imp::unprotect(blob, entropy)
}

#[cfg(not(windows))]
pub fn protect(_plaintext: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    Err("仅支持 Windows".to_string())
}

#[cfg(not(windows))]
pub fn unprotect(_blob: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    Err("仅支持 Windows".to_string())
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN,
        CRYPT_INTEGER_BLOB,
    };

    const MAX_PLAINTEXT_BYTES: usize = 64 * 1024;
    const MAX_BLOB_BYTES: usize = 128 * 1024;

    fn input_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    unsafe fn take_output(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if out.pbData.is_null() || out.cbData == 0 {
            return Vec::new();
        }
        let value = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as *mut c_void);
        value
    }

    pub fn protect(plaintext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        if plaintext.is_empty() || plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err("同步凭据长度无效".to_string());
        }
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input_blob(plaintext),
                ptr::null(),
                &input_blob(entropy),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err("无法加密同步凭据".to_string());
        }
        let value = unsafe { take_output(out) };
        if value.is_empty() || value.len() > MAX_BLOB_BYTES {
            return Err("无法加密同步凭据".to_string());
        }
        Ok(value)
    }

    pub fn unprotect(blob: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        if blob.is_empty() || blob.len() > MAX_BLOB_BYTES {
            return Err("无法读取同步凭据".to_string());
        }
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input_blob(blob),
                ptr::null_mut(),
                &input_blob(entropy),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err("无法读取同步凭据".to_string());
        }
        let value = unsafe { take_output(out) };
        if value.is_empty() || value.len() > MAX_PLAINTEXT_BYTES {
            return Err("无法读取同步凭据".to_string());
        }
        Ok(value)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{protect, unprotect};

    const ENTROPY: &[u8] = b"fge-sync-v1:com.fge.open";

    #[test]
    fn dpapi_round_trip_hides_plaintext() {
        let secret = "app-password-测试-123".as_bytes();
        let encrypted = protect(secret, ENTROPY).expect("protect");
        assert!(!encrypted
            .windows(secret.len())
            .any(|window| window == secret));
        let decrypted = unprotect(&encrypted, ENTROPY).expect("unprotect");
        assert_eq!(decrypted, secret);
    }

    #[test]
    fn dpapi_rejects_wrong_entropy_and_corrupt_blob() {
        let encrypted = protect(b"secret", ENTROPY).expect("protect");
        assert!(unprotect(&encrypted, b"another-entropy").is_err());
        assert!(unprotect(b"not-a-dpapi-blob", ENTROPY).is_err());
        assert!(protect(b"", ENTROPY).is_err());
    }
}
