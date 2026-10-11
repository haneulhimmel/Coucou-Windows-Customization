//! Windows media sessions: the hub controls the selected player, never every player.
use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    id: String,
    app: String,
    title: String,
    artist: String,
    artwork: Option<String>,
    playing: bool,
    position: f64,
    duration: f64,
    sampled_at: f64,
    can_play: bool,
    can_pause: bool,
    can_next: bool,
    can_previous: bool,
    can_seek: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    sessions: Vec<MediaSession>,
    current_id: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn media_refresh() -> MediaSnapshot {
    tauri::async_runtime::spawn_blocking(snapshot).await.unwrap_or_default()
}

#[tauri::command]
pub async fn media_control(id: String, action: String, value: Option<f64>) -> bool {
    tauri::async_runtime::spawn_blocking(move || control(&id, &action, value)).await.unwrap_or(false)
}

pub fn start(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        if let Err(error) = win::watch(&app) {
            use tauri::Emitter;
            let _ = app.emit("hub-media", MediaSnapshot {
                error: Some(format!("Windows media access is unavailable: {error}")),
                ..Default::default()
            });
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}

fn snapshot() -> MediaSnapshot {
    #[cfg(windows)]
    {
        match win::read() {
            Ok(s) => s,
            Err(e) => MediaSnapshot { error: Some(format!("Windows media access is unavailable: {e}")), ..Default::default() },
        }
    }
    #[cfg(not(windows))]
    MediaSnapshot::default()
}

fn control(id: &str, action: &str, value: Option<f64>) -> bool {
    #[cfg(windows)]
    { win::control(id, action, value).unwrap_or(false) }
    #[cfg(not(windows))]
    { let _ = (id, action, value); false }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn windows_media_access_works_without_a_provider_login() {
        let snapshot = super::snapshot();
        assert!(snapshot.error.is_none(), "{:?}", snapshot.error);
        for session in snapshot.sessions {
            assert!(!session.id.is_empty());
            assert!(session.position.is_finite() && session.position >= 0.0);
            assert!(session.duration.is_finite() && session.duration >= 0.0);
        }
    }
    #[test]
    fn a_closed_or_missing_player_cannot_control_another_session() {
        assert!(!super::control("coucou-test-session-that-does-not-exist", "pause", None));
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use base64::Engine;
    use std::sync::mpsc;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::Emitter;
    use windows::core::Result;
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, InputStreamOptions};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    // WinRT operations run on dedicated MTA threads; a reused Tokio worker can
    // have a different apartment, so commands create their own short-lived thread.
    fn initialize() -> Result<()> { unsafe { RoInitialize(RO_INIT_MULTITHREADED) } }
    fn manager() -> Result<Manager> { Manager::RequestAsync()?.get() }
    fn milliseconds() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as f64 }
    fn app_name(id: &str) -> String {
        let lower = id.to_ascii_lowercase();
        if lower.contains("spotify") { "Spotify".into() }
        else if lower.contains("applemusic") { "Apple Music".into() }
        else if lower.contains("chrome") { "Chrome".into() }
        else if lower.contains("msedge") { "Edge".into() }
        else if lower.contains("firefox") { "Firefox".into() }
        else { id.split('!').next().unwrap_or(id).to_string() }
    }
    fn artwork(session: &Session) -> Result<Option<String>> {
        let properties = session.TryGetMediaPropertiesAsync()?.get()?;
        let thumbnail = match properties.Thumbnail() { Ok(t) => t, Err(_) => return Ok(None) };
        let stream = thumbnail.OpenReadAsync()?.get()?;
        let size = stream.Size()?;
        if size == 0 || size > 3 * 1024 * 1024 { return Ok(None); }
        let content_type = stream.ContentType()?.to_string();
        if !matches!(content_type.as_str(), "image/jpeg" | "image/png" | "image/webp") { return Ok(None); }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.SetInputStreamOptions(InputStreamOptions::None)?;
        let loaded = reader.LoadAsync(size as u32)?.get()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(Some(format!("data:{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
    }
    fn describe(session: &Session) -> Result<MediaSession> {
        let id = session.SourceAppUserModelId()?.to_string();
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls()?;
        let timeline = session.GetTimelineProperties()?;
        Ok(MediaSession {
            app: app_name(&id), id,
            title: props.Title()?.to_string(), artist: props.Artist()?.to_string(),
            artwork: artwork(session).ok().flatten(),
            playing: info.PlaybackStatus()? == Status::Playing,
            position: (timeline.Position()?.Duration as f64 / 10_000_000.0).max(0.0),
            duration: (timeline.EndTime()?.Duration as f64 / 10_000_000.0).max(0.0),
            sampled_at: milliseconds(),
            can_play: controls.IsPlayEnabled()?, can_pause: controls.IsPauseEnabled()?,
            can_next: controls.IsNextEnabled()?, can_previous: controls.IsPreviousEnabled()?,
            can_seek: controls.IsPlaybackPositionEnabled()?,
        })
    }
    fn collect(manager: &Manager) -> Result<MediaSnapshot> {
        let mut sessions = Vec::new();
        for session in manager.GetSessions()? {
            if let Ok(s) = describe(&session) { sessions.push(s); }
        }
        let current_id = manager.GetCurrentSession().ok().and_then(|s| s.SourceAppUserModelId().ok()).map(|s| s.to_string());
        Ok(MediaSnapshot { sessions, current_id, error: None })
    }
    pub fn read() -> Result<MediaSnapshot> {
        std::thread::spawn(|| { initialize()?; collect(&manager()?) }).join()
            .unwrap_or_else(|_| Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))))
    }
    pub fn control(id: &str, action: &str, value: Option<f64>) -> Result<bool> {
        let id = id.to_owned(); let action = action.to_owned();
        std::thread::spawn(move || {
            initialize()?;
            for session in manager()?.GetSessions()? {
                if session.SourceAppUserModelId()?.to_string() != id { continue; }
                let controls = session.GetPlaybackInfo()?.Controls()?;
                return match action.as_str() {
                    "play" if controls.IsPlayEnabled()? => session.TryPlayAsync()?.get(),
                    "pause" if controls.IsPauseEnabled()? => session.TryPauseAsync()?.get(),
                    "next" if controls.IsNextEnabled()? => session.TrySkipNextAsync()?.get(),
                    "previous" if controls.IsPreviousEnabled()? => session.TrySkipPreviousAsync()?.get(),
                    "seek" if controls.IsPlaybackPositionEnabled()? => {
                        let Some(at) = value.filter(|n| n.is_finite() && *n >= 0.0) else { return Ok(false) };
                        let end = session.GetTimelineProperties()?.EndTime()?.Duration;
                        let ticks = (at * 10_000_000.0).min(end.max(0) as f64) as i64;
                        session.TryChangePlaybackPositionAsync(ticks)?.get()
                    },
                    _ => Ok(false),
                };
            }
            Ok(false)
        }).join().unwrap_or(Ok(false))
    }
    pub fn watch(app: &AppHandle) -> Result<()> {
        initialize()?;
        let manager = manager()?;
        let (tx, rx) = mpsc::channel::<()>();
        let send = tx.clone();
        let _sessions = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| { let _ = send.send(()); Ok(()) }))?;
        let send = tx.clone();
        let _current = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| { let _ = send.send(()); Ok(()) }))?;
        loop {
            let mut registrations = Vec::new();
            for session in manager.GetSessions()? {
                let send = tx.clone();
                let media = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| { let _ = send.send(()); Ok(()) }))?;
                let send = tx.clone();
                let playback = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| { let _ = send.send(()); Ok(()) }))?;
                let send = tx.clone();
                let timeline = session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| { let _ = send.send(()); Ok(()) }))?;
                registrations.push((session, media, playback, timeline));
            }
            let _ = app.emit("hub-media", collect(&manager)?);
            // No polling: native changes wake the worker. The webview extrapolates progress.
            if rx.recv().is_err() { return Ok(()); }
            // Coalesce simultaneous metadata/playback/timeline notifications.
            while rx.try_recv().is_ok() {}
            for (session, media, playback, timeline) in registrations {
                let _ = session.RemoveMediaPropertiesChanged(media);
                let _ = session.RemovePlaybackInfoChanged(playback);
                let _ = session.RemoveTimelinePropertiesChanged(timeline);
            }
        }
    }
}
