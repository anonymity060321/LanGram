use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

mod local_cache;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "langram-main-tray";
const TRAY_MENU_SHOW_ID: &str = "tray-show";
const TRAY_MENU_SETTINGS_ID: &str = "tray-settings";
const TRAY_MENU_UNREAD_ID: &str = "tray-unread";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";
const TRAY_OPEN_SETTINGS_EVENT: &str = "tray-open-settings";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientConfig {
    server_url: String,
    theme: ThemePreference,
    language: LanguagePreference,
    device_id: String,
    #[serde(default)]
    download_dir: Option<String>,
    #[serde(default = "default_enable_notifications")]
    enable_notifications: bool,
    #[serde(default = "default_close_to_tray")]
    close_to_tray: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadDirectoryStatus {
    configured_dir: Option<String>,
    effective_dir: String,
    is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
    device_identifier: String,
    name: Option<String>,
    platform: Option<String>,
}

#[derive(Clone)]
struct AppRuntimeState {
    is_quitting: Arc<AtomicBool>,
    close_to_tray: Arc<AtomicBool>,
    is_authenticated: Arc<AtomicBool>,
    unread_count: Arc<AtomicU32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ThemePreference {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum LanguagePreference {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

#[tauri::command]
fn get_client_config(app: AppHandle) -> Result<ClientConfig, String> {
    read_or_create_config(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_client_config(app: AppHandle, config: ClientConfig) -> Result<ClientConfig, String> {
    let mut next_config = config;
    if next_config.device_id.trim().is_empty() {
        next_config.device_id = create_device_id();
    }

    write_config(&app, &next_config).map_err(|error| error.to_string())?;
    Ok(next_config)
}

#[tauri::command]
fn get_device_identity(app: AppHandle) -> Result<DeviceIdentity, String> {
    let config = read_or_create_config(&app).map_err(|error| error.to_string())?;
    Ok(DeviceIdentity {
        device_identifier: config.device_id,
        name: Some(String::from("LanGram Windows Client")),
        platform: Some(String::from("windows")),
    })
}

#[tauri::command]
fn update_tray_unread_count(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    unread_count: u32,
) -> Result<(), String> {
    let next_unread_count = unread_count.min(9999);
    state
        .unread_count
        .store(next_unread_count, Ordering::SeqCst);

    update_tray_state(
        &app,
        state.is_authenticated.load(Ordering::SeqCst),
        next_unread_count,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_tray_authenticated(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    authenticated: bool,
) -> Result<(), String> {
    state
        .is_authenticated
        .store(authenticated, Ordering::SeqCst);
    if !authenticated {
        state.unread_count.store(0, Ordering::SeqCst);
    }

    update_tray_state(
        &app,
        authenticated,
        state.unread_count.load(Ordering::SeqCst),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_close_to_tray(state: State<'_, AppRuntimeState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn get_download_directory_status(app: AppHandle) -> Result<DownloadDirectoryStatus, String> {
    let config = read_or_create_config(&app).map_err(|error| error.to_string())?;
    download_directory_status(&app, &config).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_download_directory(app: AppHandle, path: String) -> Result<DownloadDirectoryStatus, String> {
    let directory = ensure_download_directory_input(&path)?;
    let mut config = read_or_create_config(&app).map_err(|error| error.to_string())?;
    config.download_dir = Some(path_to_config_string(&directory));
    write_config(&app, &config).map_err(|error| error.to_string())?;
    download_directory_status(&app, &config).map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_download_directory(app: AppHandle) -> Result<DownloadDirectoryStatus, String> {
    let mut config = read_or_create_config(&app).map_err(|error| error.to_string())?;
    config.download_dir = None;
    write_config(&app, &config).map_err(|error| error.to_string())?;
    download_directory_status(&app, &config).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let close_to_tray = read_or_create_config(app.handle())
                .map(|config| config.close_to_tray)
                .unwrap_or_else(|_| default_close_to_tray());
            let runtime_state = AppRuntimeState {
                is_quitting: Arc::new(AtomicBool::new(false)),
                close_to_tray: Arc::new(AtomicBool::new(close_to_tray)),
                is_authenticated: Arc::new(AtomicBool::new(false)),
                unread_count: Arc::new(AtomicU32::new(0)),
            };
            setup_tray(app.handle(), runtime_state.is_quitting.clone())?;
            setup_main_window_close_handler(
                app.handle(),
                runtime_state.is_quitting.clone(),
                runtime_state.close_to_tray.clone(),
            );
            app.manage(runtime_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_client_config,
            save_client_config,
            get_device_identity,
            update_tray_unread_count,
            update_tray_authenticated,
            update_close_to_tray,
            get_download_directory_status,
            set_download_directory,
            reset_download_directory,
            local_cache::init_local_cache,
            local_cache::get_local_cache_status,
            local_cache::clear_local_cache,
            local_cache::upsert_cached_conversations,
            local_cache::list_cached_conversations,
            local_cache::upsert_cached_messages,
            local_cache::update_cached_message_state,
            local_cache::list_cached_messages,
            local_cache::upsert_local_file_record,
            local_cache::list_local_file_records,
            local_cache::get_local_file_record
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LanGram client");
}

fn setup_tray(app: &AppHandle, is_quitting: Arc<AtomicBool>) -> tauri::Result<()> {
    let menu = build_tray_menu(app, false, 0)?;
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::InvalidIcon(io::Error::new(
            io::ErrorKind::NotFound,
            "default window icon is unavailable",
        ))
    })?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("LanGram")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => {
                let _ = show_main_window(app);
            }
            TRAY_MENU_SETTINGS_ID => {
                let _ = show_main_window(app);
                let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_OPEN_SETTINGS_EVENT, ());
            }
            TRAY_MENU_QUIT_ID => {
                is_quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
                return;
            }

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn build_tray_menu(
    app: &AppHandle,
    authenticated: bool,
    unread_count: u32,
) -> tauri::Result<Menu<tauri::Wry>> {
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "退出程序", true, None::<&str>)?;
    if !authenticated {
        return Menu::with_items(app, &[&quit_item]);
    }

    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW_ID, "显示 LanGram", true, None::<&str>)?;
    let settings_item =
        MenuItem::with_id(app, TRAY_MENU_SETTINGS_ID, "打开设置", true, None::<&str>)?;
    let unread_item = MenuItem::with_id(
        app,
        TRAY_MENU_UNREAD_ID,
        format_tray_unread_menu_text(unread_count),
        false,
        None::<&str>,
    )?;

    Menu::with_items(app, &[&show_item, &settings_item, &unread_item, &quit_item])
}

fn setup_main_window_close_handler(
    app: &AppHandle,
    is_quitting: Arc<AtomicBool>,
    close_to_tray: Arc<AtomicBool>,
) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let main_window = window.clone();
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !is_quitting.load(Ordering::SeqCst) {
                    if close_to_tray.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = main_window.hide();
                    } else {
                        is_quitting.store(true, Ordering::SeqCst);
                        app_handle.exit(0);
                    }
                }
            }
        });
    }
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }

    Ok(())
}

fn update_tray_state(app: &AppHandle, authenticated: bool, unread_count: u32) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(format_tray_tooltip(authenticated, unread_count)))?;
        tray.set_menu(Some(build_tray_menu(app, authenticated, unread_count)?))?;
    }

    Ok(())
}

fn format_tray_tooltip(authenticated: bool, unread_count: u32) -> String {
    if !authenticated {
        return String::from("LanGram");
    }

    match unread_count {
        0 => String::from("LanGram"),
        1..=99 => format!("({unread_count}) LanGram"),
        _ => String::from("(99+) LanGram"),
    }
}

fn format_tray_unread_menu_text(unread_count: u32) -> String {
    match unread_count {
        0..=99 => format!("未读消息：{unread_count}"),
        _ => String::from("未读消息：99+"),
    }
}

fn default_config() -> ClientConfig {
    ClientConfig {
        server_url: String::from("http://localhost:8080/api"),
        theme: ThemePreference::System,
        language: LanguagePreference::System,
        device_id: create_device_id(),
        download_dir: None,
        enable_notifications: default_enable_notifications(),
        close_to_tray: default_close_to_tray(),
    }
}

fn default_enable_notifications() -> bool {
    true
}

fn default_close_to_tray() -> bool {
    true
}

fn read_or_create_config(app: &AppHandle) -> Result<ClientConfig, ConfigError> {
    let path = config_path(app)?;
    if !path.exists() {
        let config = default_config();
        write_config(app, &config)?;
        return Ok(config);
    }

    let content = fs::read_to_string(path)?;
    let mut config: ClientConfig = serde_json::from_str(&content)?;
    if config.device_id.trim().is_empty() {
        config.device_id = create_device_id();
        write_config(app, &config)?;
    }

    Ok(config)
}

fn write_config(app: &AppHandle, config: &ClientConfig) -> Result<(), ConfigError> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, ConfigError> {
    let directory = app.path().app_config_dir()?;
    Ok(directory.join("client-config.json"))
}

fn download_directory_status(
    app: &AppHandle,
    config: &ClientConfig,
) -> Result<DownloadDirectoryStatus, ConfigError> {
    match config
        .download_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(configured_dir) => {
            let directory = ensure_directory(PathBuf::from(configured_dir))
                .map_err(ConfigError::InvalidDownloadDirectory)?;
            Ok(build_download_directory_status(
                Some(directory.clone()),
                directory,
            ))
        }
        None => {
            let directory = ensure_directory(default_download_directory(app)?)
                .map_err(ConfigError::InvalidDownloadDirectory)?;
            Ok(build_download_directory_status(None, directory))
        }
    }
}

fn default_download_directory(app: &AppHandle) -> Result<PathBuf, ConfigError> {
    if let Ok(download_dir) = app.path().download_dir() {
        return Ok(download_dir.join("LanGram"));
    }

    if let Ok(documents_dir) = app.path().document_dir() {
        return Ok(documents_dir.join("LanGram"));
    }

    Ok(app.path().app_data_dir()?.join("downloads"))
}

fn ensure_directory(directory: PathBuf) -> Result<PathBuf, String> {
    if directory.exists() && !directory.is_dir() {
        return Err(String::from(
            "Download directory path must point to a directory",
        ));
    }

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create download directory: {error}"))?;

    if !directory.is_dir() {
        return Err(String::from(
            "Download directory path must point to a directory",
        ));
    }

    directory
        .canonicalize()
        .map_err(|error| format!("Failed to normalize download directory: {error}"))
}

fn ensure_download_directory_input(path: &str) -> Result<PathBuf, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err(String::from("Download directory path cannot be empty"));
    }

    ensure_directory(PathBuf::from(trimmed_path))
}

fn build_download_directory_status(
    configured_dir: Option<PathBuf>,
    effective_dir: PathBuf,
) -> DownloadDirectoryStatus {
    DownloadDirectoryStatus {
        configured_dir: configured_dir.as_ref().map(path_to_config_string),
        effective_dir: path_to_config_string(&effective_dir),
        is_default: configured_dir.is_none(),
    }
}

fn path_to_config_string(path: &PathBuf) -> String {
    display_path_string(path)
}

fn display_path_string(path: &Path) -> String {
    strip_windows_extended_path_prefix(path.to_string_lossy().to_string())
}

fn strip_windows_extended_path_prefix(path: String) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }

    path.strip_prefix(r"\\?\")
        .map_or(path.clone(), ToOwned::to_owned)
}

fn create_device_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("langram-{timestamp:x}-{:x}", std::process::id())
}

#[derive(Debug)]
enum ConfigError {
    Io(io::Error),
    Json(serde_json::Error),
    Tauri(tauri::Error),
    InvalidDownloadDirectory(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
            Self::Tauri(error) => write!(formatter, "Tauri error: {error}"),
            Self::InvalidDownloadDirectory(error) => write!(formatter, "{error}"),
        }
    }
}

impl From<io::Error> for ConfigError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ConfigError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<tauri::Error> for ConfigError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_without_download_dir_deserializes() {
        let raw_config = r#"{
            "serverUrl": "http://localhost:8080/api",
            "theme": "system",
            "language": "system",
            "deviceId": "device-1",
            "enableNotifications": true,
            "closeToTray": true
        }"#;

        let config: ClientConfig = serde_json::from_str(raw_config).expect("config should parse");

        assert!(config.download_dir.is_none());
    }

    #[test]
    fn default_download_directory_status_is_default() {
        let directory = unique_test_path("default-status");
        let status = build_download_directory_status(None, directory.clone());

        assert!(status.configured_dir.is_none());
        assert_eq!(status.effective_dir, path_to_config_string(&directory));
        assert!(status.is_default);
    }

    #[test]
    fn ensure_download_directory_input_creates_directory() {
        let directory = unique_test_path("create-directory");

        let normalized = ensure_download_directory_input(&path_to_config_string(&directory))
            .expect("directory should be created");

        assert!(normalized.is_dir());
        let _ = fs::remove_dir_all(normalized);
    }

    #[test]
    fn ensure_download_directory_input_rejects_empty_path() {
        let error = ensure_download_directory_input("   ").expect_err("empty path should fail");

        assert_eq!(error, "Download directory path cannot be empty");
    }

    #[test]
    fn ensure_download_directory_input_rejects_file_path() {
        let file_path = unique_test_path("file-path");
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("test parent should be created");
        }
        fs::write(&file_path, b"not a directory").expect("test file should be created");

        let error = ensure_download_directory_input(&path_to_config_string(&file_path))
            .expect_err("file path should fail");

        assert_eq!(error, "Download directory path must point to a directory");
        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn strip_windows_extended_drive_path_prefix() {
        let path = strip_windows_extended_path_prefix(String::from(r"\\?\D:\Downloads\LanGram"));

        assert_eq!(path, r"D:\Downloads\LanGram");
    }

    #[test]
    fn strip_windows_extended_unc_path_prefix() {
        let path =
            strip_windows_extended_path_prefix(String::from(r"\\?\UNC\server\share\LanGram"));

        assert_eq!(path, r"\\server\share\LanGram");
    }

    fn unique_test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "langram-download-dir-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be valid")
                .as_nanos()
        ))
    }
}
