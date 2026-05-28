use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientConfig {
    server_url: String,
    theme: ThemePreference,
    language: LanguagePreference,
    device_id: String,
    #[serde(default = "default_enable_notifications")]
    enable_notifications: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
    device_identifier: String,
    name: Option<String>,
    platform: Option<String>,
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_client_config,
            save_client_config,
            get_device_identity
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LanGram client");
}

fn default_config() -> ClientConfig {
    ClientConfig {
        server_url: String::from("http://localhost:8080/api"),
        theme: ThemePreference::System,
        language: LanguagePreference::System,
        device_id: create_device_id(),
        enable_notifications: default_enable_notifications(),
    }
}

fn default_enable_notifications() -> bool {
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
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
            Self::Tauri(error) => write!(formatter, "Tauri error: {error}"),
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
