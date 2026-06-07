use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fmt, fs, io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const LOCAL_CACHE_DB_FILE: &str = "langram-local-cache.sqlite3";
const SCHEMA_VERSION_KEY: &str = "schema_version";
const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitLocalCacheResult {
    db_path: String,
    schema_version: i64,
    initialized: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCacheStatus {
    db_path: String,
    exists: bool,
    schema_version: Option<i64>,
}

#[tauri::command]
pub fn init_local_cache(app: AppHandle) -> Result<InitLocalCacheResult, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    init_database_at_path(&db_path)
        .map(|schema_version| InitLocalCacheResult {
            db_path: db_path.to_string_lossy().to_string(),
            schema_version,
            initialized: true,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_local_cache_status(app: AppHandle) -> Result<LocalCacheStatus, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    get_status_at_path(&db_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_local_cache(app: AppHandle) -> Result<LocalCacheStatus, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    clear_local_cache_at_path(&db_path).map_err(|error| error.to_string())?;
    get_status_at_path(&db_path).map_err(|error| error.to_string())
}

fn local_cache_path(app: &AppHandle) -> Result<PathBuf, LocalCacheError> {
    Ok(app.path().app_data_dir()?.join(LOCAL_CACHE_DB_FILE))
}

fn init_database_at_path(db_path: &Path) -> Result<i64, LocalCacheError> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    migrate_connection(&connection)?;
    read_schema_version(&connection)?.ok_or(LocalCacheError::MissingSchemaVersion)
}

fn get_status_at_path(db_path: &Path) -> Result<LocalCacheStatus, LocalCacheError> {
    if !db_path.exists() {
        return Ok(LocalCacheStatus {
            db_path: db_path.to_string_lossy().to_string(),
            exists: false,
            schema_version: None,
        });
    }

    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let schema_version = if has_table(&connection, "local_cache_meta")? {
        read_schema_version(&connection)?
    } else {
        None
    };
    Ok(LocalCacheStatus {
        db_path: db_path.to_string_lossy().to_string(),
        exists: true,
        schema_version,
    })
}

fn clear_local_cache_at_path(db_path: &Path) -> Result<(), LocalCacheError> {
    init_database_at_path(db_path)?;

    let mut connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "
        DELETE FROM cached_messages;
        DELETE FROM cached_conversations;
        DELETE FROM local_clear_watermarks;
        ",
    )?;
    transaction.commit()?;

    Ok(())
}

fn enable_foreign_keys(connection: &Connection) -> Result<(), LocalCacheError> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

fn has_table(connection: &Connection, table_name: &str) -> Result<bool, LocalCacheError> {
    let exists = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![table_name],
        |row| row.get::<_, bool>(0),
    )?;
    Ok(exists)
}

fn migrate_connection(connection: &Connection) -> Result<(), LocalCacheError> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS local_cache_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cached_conversations (
            id TEXT PRIMARY KEY,
            conversation_type TEXT NOT NULL,
            peer_user_id TEXT,
            title TEXT,
            avatar_url TEXT,
            last_message_id TEXT,
            last_message_at TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cached_messages (
            id TEXT PRIMARY KEY,
            client_message_id TEXT,
            conversation_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            message_type TEXT NOT NULL,
            status TEXT NOT NULL,
            ciphertext TEXT,
            nonce TEXT,
            encryption_version TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            delivered_at TEXT,
            read_at TEXT,
            edited_at TEXT,
            recalled_at TEXT,
            local_deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS local_clear_watermarks (
            conversation_id TEXT PRIMARY KEY,
            cleared_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cached_messages_conversation_created
            ON cached_messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_cached_messages_client_message_id
            ON cached_messages(client_message_id);
        CREATE INDEX IF NOT EXISTS idx_cached_conversations_updated
            ON cached_conversations(updated_at);
        ",
    )?;

    connection.execute(
        "
        INSERT INTO local_cache_meta(key, value, updated_at)
        VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        ",
        params![SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

fn read_schema_version(connection: &Connection) -> Result<Option<i64>, LocalCacheError> {
    let value = connection
        .query_row(
            "SELECT value FROM local_cache_meta WHERE key = ?1",
            params![SCHEMA_VERSION_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    value
        .map(|raw_value| {
            raw_value
                .parse::<i64>()
                .map_err(|_| LocalCacheError::InvalidSchemaVersion)
        })
        .transpose()
}

#[derive(Debug)]
enum LocalCacheError {
    Io(io::Error),
    Sqlite(rusqlite::Error),
    Tauri(tauri::Error),
    MissingSchemaVersion,
    InvalidSchemaVersion,
}

impl fmt::Display for LocalCacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "local cache I/O error: {error}"),
            Self::Sqlite(error) => write!(formatter, "local cache SQLite error: {error}"),
            Self::Tauri(error) => write!(formatter, "local cache Tauri error: {error}"),
            Self::MissingSchemaVersion => {
                write!(formatter, "local cache schema version is missing")
            }
            Self::InvalidSchemaVersion => {
                write!(formatter, "local cache schema version is invalid")
            }
        }
    }
}

impl From<io::Error> for LocalCacheError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for LocalCacheError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<tauri::Error> for LocalCacheError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn initializes_database_and_schema_version() {
        let db_path = test_db_path("init");
        let schema_version = init_database_at_path(&db_path).expect("database should initialize");

        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION);

        let status = get_status_at_path(&db_path).expect("status should be readable");
        assert!(status.exists);
        assert_eq!(status.schema_version, Some(CURRENT_SCHEMA_VERSION));

        cleanup_test_db(&db_path);
    }

    #[test]
    fn repeated_initialization_is_idempotent() {
        let db_path = test_db_path("idempotent");

        init_database_at_path(&db_path).expect("first init should succeed");
        let schema_version =
            init_database_at_path(&db_path).expect("second init should also succeed");

        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION);

        cleanup_test_db(&db_path);
    }

    #[test]
    fn cached_messages_has_no_plaintext_columns() {
        let db_path = test_db_path("no-plaintext");
        init_database_at_path(&db_path).expect("database should initialize");

        let connection = Connection::open(&db_path).expect("database should open");
        let mut statement = connection
            .prepare("PRAGMA table_info(cached_messages)")
            .expect("table info should prepare");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("columns should collect");

        assert!(!columns.iter().any(|column| {
            let normalized = column.to_ascii_lowercase();
            normalized.contains("plain") || normalized.contains("decrypted")
        }));

        cleanup_test_db(&db_path);
    }

    #[test]
    fn clears_cached_rows_without_resetting_schema() {
        let db_path = test_db_path("clear");
        init_database_at_path(&db_path).expect("database should initialize");

        let connection = Connection::open(&db_path).expect("database should open");
        connection
            .execute(
                "
                INSERT INTO cached_conversations(
                    id,
                    conversation_type,
                    peer_user_id,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4)
                ",
                params![
                    "conversation-1",
                    "direct",
                    "user-2",
                    "2026-06-07T00:00:00.000Z"
                ],
            )
            .expect("conversation should insert");
        connection
            .execute(
                "
                INSERT INTO cached_messages(
                    id,
                    conversation_id,
                    sender_id,
                    message_type,
                    status,
                    ciphertext,
                    nonce,
                    encryption_version,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ",
                params![
                    "message-1",
                    "conversation-1",
                    "user-1",
                    "text",
                    "sent",
                    "ciphertext",
                    "nonce",
                    "mvp-v1",
                    "2026-06-07T00:00:00.000Z",
                    "2026-06-07T00:00:00.000Z"
                ],
            )
            .expect("message should insert");

        clear_local_cache_at_path(&db_path).expect("cache should clear");

        let message_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cached_messages", [], |row| row.get(0))
            .expect("message count should query");
        let conversation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cached_conversations", [], |row| {
                row.get(0)
            })
            .expect("conversation count should query");
        let status = get_status_at_path(&db_path).expect("status should be readable");

        assert_eq!(message_count, 0);
        assert_eq!(conversation_count, 0);
        assert_eq!(status.schema_version, Some(CURRENT_SCHEMA_VERSION));

        cleanup_test_db(&db_path);
    }

    fn test_db_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("langram-local-cache-test-{name}-{timestamp}"))
            .join(LOCAL_CACHE_DB_FILE)
    }

    fn cleanup_test_db(db_path: &Path) {
        if let Some(parent) = db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
