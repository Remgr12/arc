use parking_lot::Mutex;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::{self, SharedState};

/// Auto checks run at most once every 12 hours since the last check.
const CHECK_INTERVAL_SECS: i64 = 12 * 60 * 60;

static PENDING: Mutex<Option<Update>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
pub struct UpdateNotice {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub installable: bool,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Updater applies to AppImage / NSIS-MSI / app installs; Flatpak and system
/// packages (deb/rpm) are updated by their own tooling.
fn supported_platform() -> bool {
    if std::path::Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some() {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        return std::env::var_os("APPIMAGE").is_some();
    }
    #[allow(unreachable_code)]
    true
}

/// Launch a check from app setup if 12+ hours have passed since the last one.
pub fn maybe_check_on_startup(app: AppHandle) {
    if !supported_platform() {
        return;
    }
    let shared = app.state::<SharedState>();
    let now = now_secs();
    let due = {
        let s = shared.lock();
        s.settings
            .updater_last_check
            .map_or(true, |last| now - last >= CHECK_INTERVAL_SECS)
    };
    if !due {
        return;
    }
    touch_last_check(&shared, now);
    let handle = app.clone();
    std::thread::spawn(move || {
        // Give the webview time to attach so the notice event is not missed.
        std::thread::sleep(std::time::Duration::from_secs(8));
        tauri::async_runtime::block_on(async move {
            let _ = check_and_notify(&handle).await;
        });
    });
}

fn touch_last_check(shared: &SharedState, now: i64) {
    let snapshot = {
        let mut s = shared.lock();
        s.settings.updater_last_check = Some(now);
        (s.settings.clone(), s.settings_path.clone())
    };
    if let (settings, Some(path)) = snapshot {
        state::save_settings(&path, &settings);
    }
}

/// Run one update check and surface the result to the frontend. Results are
/// both emitted as `arc://update` and cached so the frontend polling fallback
/// (`get_state`) still sees the notice.
async fn check_and_notify(app: &AppHandle) -> Result<UpdateNotice, String> {
    let notice = check(app).await?;
    let _ = app.emit("arc://update", &notice);
    Ok(notice)
}

async fn check(app: &AppHandle) -> Result<UpdateNotice, String> {
    if !supported_platform() {
        let notice = UpdateNotice {
            available: false,
            version: None,
            notes: Some("Updates are handled by the package manager on this install type".into()),
            installable: false,
        };
        app.manage::<UpdateNoticeCache>(UpdateNoticeCache(Some(notice.clone())));
        return Ok(notice);
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let notice = UpdateNotice {
                available: true,
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                installable: true,
            };
            *PENDING.lock() = Some(update);
            app.manage::<UpdateNoticeCache>(UpdateNoticeCache(Some(notice.clone())));
            Ok(notice)
        }
        Ok(None) => {
            let notice = UpdateNotice {
                available: false,
                version: None,
                notes: Some("You are on the latest version".into()),
                installable: false,
            };
            app.manage::<UpdateNoticeCache>(UpdateNoticeCache(Some(notice.clone())));
            Ok(notice)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Cache that keeps the last notice around for the frontend polling fallback.
pub struct UpdateNoticeCache(pub Option<UpdateNotice>);

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateNotice, String> {
    let shared = app.state::<SharedState>();
    touch_last_check(&shared, now_secs());
    check_and_notify(&app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = PENDING.lock().take().ok_or("No update available")?;
    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
        let message = e.to_string();
        *PENDING.lock() = Some(update);
        return Err(message);
    }
    app.restart();
    #[allow(unreachable_code)]
    {
        Ok(())
    }
}
