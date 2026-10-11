//! User-configured shortcuts open one URL, app, or folder without a command shell.
#[tauri::command]
pub fn hub_open_target(target: String) -> bool {
    if target.is_empty() || target.len() > 2048 || target.chars().any(|c| c == '\0' || c == '\r' || c == '\n') { return false; }
    let web = reqwest::Url::parse(&target).ok().is_some_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some());
    let protocol = target == "spotify:" || target.strip_prefix("spotify:").is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == ':'));
    let folder = matches!(target.as_str(), "shell:Personal" | "shell:Downloads" | "shell:Desktop");
    let path = std::path::Path::new(&target);
    let local = path.is_absolute() && path.exists();
    if !(web || protocol || folder || local) { return false; }
    #[cfg(windows)]
    {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let target = HSTRING::from(target);
        let verb = HSTRING::from("open");
        unsafe { ShellExecuteW(None, PCWSTR(verb.as_ptr()), PCWSTR(target.as_ptr()), None, None, SW_SHOWNORMAL).0 as isize > 32 }
    }
    #[cfg(not(windows))]
    { if web { crate::platform::open_url(&target); true } else { false } }
}

#[cfg(test)]
mod tests {
    #[test]
    fn shortcut_targets_cannot_be_commands() {
        for target in ["cmd /c whoami", "powershell.exe -Command whoami", "javascript:alert(1)", "file:///missing", "https://example.com\ncmd"] {
            assert!(!super::hub_open_target(target.to_string()));
        }
    }
}
