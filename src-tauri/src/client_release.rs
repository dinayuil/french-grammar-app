#[tauri::command]
pub fn open_client_release(app: tauri::AppHandle) -> Result<(), String> {
    if app.config().identifier != "com.fge.open" {
        return Err("Public Windows client is not available".to_string());
    }
    open_release_in_browser()
}

#[cfg(windows)]
fn open_release_in_browser() -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let url: Vec<u16> = "https://github.com/dinayuil/french-grammar-app/releases/tag/client-latest"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // ShellExecuteW dispatches the fixed HTTPS URL to the system handler.
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            ptr::null(),
            url.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err("Could not open the release page".to_string())
    }
}

#[cfg(not(windows))]
fn open_release_in_browser() -> Result<(), String> {
    Err("Only Windows is supported".to_string())
}
