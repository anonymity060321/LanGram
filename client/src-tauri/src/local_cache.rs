use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedConversationInput {
    id: String,
    conversation_type: String,
    peer_user_id: Option<String>,
    title: Option<String>,
    avatar_url: Option<String>,
    last_message_id: Option<String>,
    last_message_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedConversationRecord {
    id: String,
    conversation_type: String,
    peer_user_id: Option<String>,
    title: Option<String>,
    avatar_url: Option<String>,
    last_message_id: Option<String>,
    last_message_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMessageInput {
    id: String,
    client_message_id: Option<String>,
    conversation_id: String,
    sender_id: String,
    message_type: String,
    status: String,
    ciphertext: Option<String>,
    nonce: Option<String>,
    encryption_version: Option<String>,
    metadata_json: Option<String>,
    created_at: String,
    updated_at: String,
    delivered_at: Option<String>,
    read_at: Option<String>,
    edited_at: Option<String>,
    recalled_at: Option<String>,
    local_deleted_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMessageStatePatchInput {
    id: String,
    status: Option<String>,
    ciphertext: Option<String>,
    nonce: Option<String>,
    encryption_version: Option<String>,
    updated_at: String,
    delivered_at: Option<String>,
    read_at: Option<String>,
    edited_at: Option<String>,
    recalled_at: Option<String>,
    local_deleted_at: Option<String>,
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

#[tauri::command]
pub fn upsert_cached_conversations(
    app: AppHandle,
    conversations: Vec<CachedConversationInput>,
) -> Result<(), String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    upsert_cached_conversations_at_path(&db_path, &conversations).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_cached_conversations(app: AppHandle) -> Result<Vec<CachedConversationRecord>, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    list_cached_conversations_at_path(&db_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_cached_messages(
    app: AppHandle,
    messages: Vec<CachedMessageInput>,
) -> Result<(), String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    upsert_cached_messages_at_path(&db_path, &messages).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_cached_message_state(
    app: AppHandle,
    patches: Vec<CachedMessageStatePatchInput>,
) -> Result<(), String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    update_cached_message_state_at_path(&db_path, &patches).map_err(|error| error.to_string())
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

fn upsert_cached_conversations_at_path(
    db_path: &Path,
    conversations: &[CachedConversationInput],
) -> Result<(), LocalCacheError> {
    init_database_at_path(db_path)?;

    let mut connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let transaction = connection.transaction()?;
    {
        let mut statement = transaction.prepare(
            "
            INSERT INTO cached_conversations(
                id,
                conversation_type,
                peer_user_id,
                title,
                avatar_url,
                last_message_id,
                last_message_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                conversation_type = excluded.conversation_type,
                peer_user_id = excluded.peer_user_id,
                title = excluded.title,
                avatar_url = excluded.avatar_url,
                last_message_id = excluded.last_message_id,
                last_message_at = excluded.last_message_at,
                updated_at = excluded.updated_at
            ",
        )?;

        for conversation in conversations {
            statement.execute(params![
                &conversation.id,
                &conversation.conversation_type,
                &conversation.peer_user_id,
                &conversation.title,
                &conversation.avatar_url,
                &conversation.last_message_id,
                &conversation.last_message_at,
                &conversation.updated_at
            ])?;
        }
    }
    transaction.commit()?;

    Ok(())
}

fn list_cached_conversations_at_path(
    db_path: &Path,
) -> Result<Vec<CachedConversationRecord>, LocalCacheError> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    init_database_at_path(db_path)?;

    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let mut statement = connection.prepare(
        "
        SELECT
            id,
            conversation_type,
            peer_user_id,
            title,
            avatar_url,
            last_message_id,
            last_message_at,
            updated_at
        FROM cached_conversations
        ORDER BY updated_at DESC
        ",
    )?;

    let conversations = statement
        .query_map([], |row| {
            Ok(CachedConversationRecord {
                id: row.get(0)?,
                conversation_type: row.get(1)?,
                peer_user_id: row.get(2)?,
                title: row.get(3)?,
                avatar_url: row.get(4)?,
                last_message_id: row.get(5)?,
                last_message_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(conversations)
}

fn upsert_cached_messages_at_path(
    db_path: &Path,
    messages: &[CachedMessageInput],
) -> Result<(), LocalCacheError> {
    init_database_at_path(db_path)?;

    let mut connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let transaction = connection.transaction()?;
    {
        let mut statement = transaction.prepare(
            "
            INSERT INTO cached_messages(
                id,
                client_message_id,
                conversation_id,
                sender_id,
                message_type,
                status,
                ciphertext,
                nonce,
                encryption_version,
                metadata_json,
                created_at,
                updated_at,
                delivered_at,
                read_at,
                edited_at,
                recalled_at,
                local_deleted_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(id) DO UPDATE SET
                client_message_id = excluded.client_message_id,
                conversation_id = excluded.conversation_id,
                sender_id = excluded.sender_id,
                message_type = excluded.message_type,
                status = excluded.status,
                ciphertext = excluded.ciphertext,
                nonce = excluded.nonce,
                encryption_version = excluded.encryption_version,
                metadata_json = excluded.metadata_json,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                delivered_at = excluded.delivered_at,
                read_at = excluded.read_at,
                edited_at = excluded.edited_at,
                recalled_at = excluded.recalled_at,
                local_deleted_at = excluded.local_deleted_at
            ",
        )?;

        for message in messages {
            statement.execute(params![
                &message.id,
                &message.client_message_id,
                &message.conversation_id,
                &message.sender_id,
                &message.message_type,
                &message.status,
                &message.ciphertext,
                &message.nonce,
                &message.encryption_version,
                &message.metadata_json,
                &message.created_at,
                &message.updated_at,
                &message.delivered_at,
                &message.read_at,
                &message.edited_at,
                &message.recalled_at,
                &message.local_deleted_at
            ])?;
        }
    }
    transaction.commit()?;

    Ok(())
}

fn update_cached_message_state_at_path(
    db_path: &Path,
    patches: &[CachedMessageStatePatchInput],
) -> Result<(), LocalCacheError> {
    init_database_at_path(db_path)?;

    let mut connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let transaction = connection.transaction()?;
    {
        let mut statement = transaction.prepare(
            "
            UPDATE cached_messages
            SET
                status = COALESCE(?2, status),
                ciphertext = COALESCE(?3, ciphertext),
                nonce = COALESCE(?4, nonce),
                encryption_version = COALESCE(?5, encryption_version),
                updated_at = ?6,
                delivered_at = COALESCE(?7, delivered_at),
                read_at = COALESCE(?8, read_at),
                edited_at = COALESCE(?9, edited_at),
                recalled_at = COALESCE(?10, recalled_at),
                local_deleted_at = COALESCE(?11, local_deleted_at)
            WHERE id = ?1
            ",
        )?;

        for patch in patches {
            statement.execute(params![
                &patch.id,
                &patch.status,
                &patch.ciphertext,
                &patch.nonce,
                &patch.encryption_version,
                &patch.updated_at,
                &patch.delivered_at,
                &patch.read_at,
                &patch.edited_at,
                &patch.recalled_at,
                &patch.local_deleted_at
            ])?;
        }
    }
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
    fn cached_conversations_has_no_plaintext_columns() {
        let db_path = test_db_path("conversation-no-plaintext");
        init_database_at_path(&db_path).expect("database should initialize");

        let connection = Connection::open(&db_path).expect("database should open");
        let mut statement = connection
            .prepare("PRAGMA table_info(cached_conversations)")
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
    fn list_cached_conversations_returns_empty_when_database_is_missing() {
        let db_path = test_db_path("list-missing");

        let conversations =
            list_cached_conversations_at_path(&db_path).expect("missing database should list");

        assert!(conversations.is_empty());
        assert!(!db_path.exists());

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_conversations_returns_upserted_rows_ordered_by_updated_at_desc() {
        let db_path = test_db_path("list-upserted");
        let older =
            test_cached_conversation("conversation-older", "Alice", "2026-06-07T00:00:00.000Z");
        let newer =
            test_cached_conversation("conversation-newer", "Bob", "2026-06-07T00:01:00.000Z");

        upsert_cached_conversations_at_path(&db_path, &[older.clone(), newer.clone()])
            .expect("conversations should upsert");

        let conversations =
            list_cached_conversations_at_path(&db_path).expect("conversations should list");

        assert_eq!(conversations.len(), 2);
        assert_eq!(
            conversations[0],
            expected_cached_conversation_record(&newer)
        );
        assert_eq!(
            conversations[1],
            expected_cached_conversation_record(&older)
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserts_cached_conversations_in_batch() {
        let db_path = test_db_path("upsert-batch");
        let conversations = vec![
            test_cached_conversation("conversation-1", "Alice", "2026-06-07T00:00:00.000Z"),
            test_cached_conversation("conversation-2", "Bob", "2026-06-07T00:01:00.000Z"),
        ];

        upsert_cached_conversations_at_path(&db_path, &conversations)
            .expect("conversations should upsert");

        let connection = Connection::open(&db_path).expect("database should open");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cached_conversations", [], |row| {
                row.get(0)
            })
            .expect("conversation count should query");

        assert_eq!(count, 2);

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserting_cached_conversation_updates_existing_row() {
        let db_path = test_db_path("upsert-update");
        let first = vec![test_cached_conversation(
            "conversation-1",
            "Alice",
            "2026-06-07T00:00:00.000Z",
        )];
        let second = vec![test_cached_conversation(
            "conversation-1",
            "Alice Updated",
            "2026-06-07T00:05:00.000Z",
        )];

        upsert_cached_conversations_at_path(&db_path, &first).expect("first upsert should succeed");
        upsert_cached_conversations_at_path(&db_path, &second)
            .expect("second upsert should succeed");

        let connection = Connection::open(&db_path).expect("database should open");
        let row = connection
            .query_row(
                "SELECT title, updated_at FROM cached_conversations WHERE id = ?1",
                params!["conversation-1"],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("conversation should query");

        assert_eq!(row.0, "Alice Updated");
        assert_eq!(row.1, "2026-06-07T00:05:00.000Z");

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserts_one_cached_message() {
        let db_path = test_db_path("message-upsert-one");
        let message = test_cached_message("message-1", "SENT");

        upsert_cached_messages_at_path(&db_path, &[message.clone()])
            .expect("message should upsert");

        let connection = Connection::open(&db_path).expect("database should open");
        let row = connection
            .query_row(
                "
                SELECT
                    id,
                    client_message_id,
                    conversation_id,
                    sender_id,
                    message_type,
                    status,
                    ciphertext,
                    nonce,
                    encryption_version,
                    metadata_json,
                    created_at,
                    updated_at
                FROM cached_messages
                WHERE id = ?1
                ",
                params!["message-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                    ))
                },
            )
            .expect("message should query");

        assert_eq!(row.0, message.id);
        assert_eq!(row.1, message.client_message_id);
        assert_eq!(row.2, message.conversation_id);
        assert_eq!(row.3, message.sender_id);
        assert_eq!(row.4, message.message_type);
        assert_eq!(row.5, message.status);
        assert_eq!(row.6, message.ciphertext);
        assert_eq!(row.7, message.nonce);
        assert_eq!(row.8, message.encryption_version);
        assert_eq!(row.9, None);
        assert_eq!(row.10, message.created_at);
        assert_eq!(row.11, message.updated_at);

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserts_cached_messages_in_batch() {
        let db_path = test_db_path("message-upsert-batch");
        let messages = vec![
            test_cached_message("message-1", "SENT"),
            test_cached_message("message-2", "DELIVERED"),
        ];

        upsert_cached_messages_at_path(&db_path, &messages).expect("messages should upsert");

        let connection = Connection::open(&db_path).expect("database should open");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cached_messages", [], |row| row.get(0))
            .expect("message count should query");

        assert_eq!(count, 2);

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserting_cached_message_updates_status_delivery_and_read_fields() {
        let db_path = test_db_path("message-upsert-update");
        let first = test_cached_message("message-1", "SENT");
        let mut second = test_cached_message("message-1", "READ");
        second.delivered_at = Some("2026-06-07T00:01:00.000Z".to_string());
        second.read_at = Some("2026-06-07T00:02:00.000Z".to_string());
        second.updated_at = "2026-06-07T00:02:00.000Z".to_string();

        upsert_cached_messages_at_path(&db_path, &[first]).expect("first upsert should succeed");
        upsert_cached_messages_at_path(&db_path, &[second]).expect("second upsert should succeed");

        let connection = Connection::open(&db_path).expect("database should open");
        let row = connection
            .query_row(
                "SELECT status, delivered_at, read_at, updated_at FROM cached_messages WHERE id = ?1",
                params!["message-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .expect("message should query");

        assert_eq!(row.0, "READ");
        assert_eq!(row.1, Some("2026-06-07T00:01:00.000Z".to_string()));
        assert_eq!(row.2, Some("2026-06-07T00:02:00.000Z".to_string()));
        assert_eq!(row.3, "2026-06-07T00:02:00.000Z");

        cleanup_test_db(&db_path);
    }

    #[test]
    fn cached_message_state_patch_writes_recalled_and_local_deleted_fields() {
        let db_path = test_db_path("message-state-patch");
        let message = test_cached_message("message-1", "SENT");
        upsert_cached_messages_at_path(&db_path, &[message]).expect("message should upsert");

        update_cached_message_state_at_path(
            &db_path,
            &[
                test_cached_message_state_patch(
                    "message-1",
                    Some("RECALLED"),
                    "2026-06-07T00:03:00.000Z",
                )
                .with_recalled_at("2026-06-07T00:03:00.000Z"),
                test_cached_message_state_patch("message-1", None, "2026-06-07T00:04:00.000Z")
                    .with_local_deleted_at("2026-06-07T00:04:00.000Z"),
            ],
        )
        .expect("state patches should apply");

        let connection = Connection::open(&db_path).expect("database should open");
        let row = connection
            .query_row(
                "SELECT status, recalled_at, local_deleted_at, updated_at FROM cached_messages WHERE id = ?1",
                params!["message-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .expect("message should query");

        assert_eq!(row.0, "RECALLED");
        assert_eq!(row.1, Some("2026-06-07T00:03:00.000Z".to_string()));
        assert_eq!(row.2, Some("2026-06-07T00:04:00.000Z".to_string()));
        assert_eq!(row.3, "2026-06-07T00:04:00.000Z");

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserting_cached_messages_does_not_change_schema_version() {
        let db_path = test_db_path("message-schema-version");
        init_database_at_path(&db_path).expect("database should initialize");

        upsert_cached_messages_at_path(&db_path, &[test_cached_message("message-1", "SENT")])
            .expect("message should upsert");

        let status = get_status_at_path(&db_path).expect("status should be readable");
        assert_eq!(status.schema_version, Some(CURRENT_SCHEMA_VERSION));

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

    fn test_cached_conversation(
        id: &str,
        title: &str,
        updated_at: &str,
    ) -> CachedConversationInput {
        CachedConversationInput {
            id: id.to_string(),
            conversation_type: "DIRECT".to_string(),
            peer_user_id: Some("user-2".to_string()),
            title: Some(title.to_string()),
            avatar_url: Some("https://example.test/avatar.png".to_string()),
            last_message_id: Some("message-1".to_string()),
            last_message_at: Some("2026-06-07T00:00:00.000Z".to_string()),
            updated_at: updated_at.to_string(),
        }
    }

    fn expected_cached_conversation_record(
        input: &CachedConversationInput,
    ) -> CachedConversationRecord {
        CachedConversationRecord {
            id: input.id.clone(),
            conversation_type: input.conversation_type.clone(),
            peer_user_id: input.peer_user_id.clone(),
            title: input.title.clone(),
            avatar_url: input.avatar_url.clone(),
            last_message_id: input.last_message_id.clone(),
            last_message_at: input.last_message_at.clone(),
            updated_at: input.updated_at.clone(),
        }
    }

    fn test_cached_message(id: &str, status: &str) -> CachedMessageInput {
        CachedMessageInput {
            id: id.to_string(),
            client_message_id: Some(format!("client-{id}")),
            conversation_id: "conversation-1".to_string(),
            sender_id: "user-1".to_string(),
            message_type: "TEXT".to_string(),
            status: status.to_string(),
            ciphertext: Some(format!("ciphertext-{id}")),
            nonce: Some(format!("nonce-{id}")),
            encryption_version: Some("mvp-v1".to_string()),
            metadata_json: None,
            created_at: "2026-06-07T00:00:00.000Z".to_string(),
            updated_at: "2026-06-07T00:00:00.000Z".to_string(),
            delivered_at: None,
            read_at: None,
            edited_at: None,
            recalled_at: None,
            local_deleted_at: None,
        }
    }

    fn test_cached_message_state_patch(
        id: &str,
        status: Option<&str>,
        updated_at: &str,
    ) -> CachedMessageStatePatchInput {
        CachedMessageStatePatchInput {
            id: id.to_string(),
            status: status.map(str::to_string),
            ciphertext: None,
            nonce: None,
            encryption_version: None,
            updated_at: updated_at.to_string(),
            delivered_at: None,
            read_at: None,
            edited_at: None,
            recalled_at: None,
            local_deleted_at: None,
        }
    }

    trait CachedMessageStatePatchTestExt {
        fn with_recalled_at(self, recalled_at: &str) -> Self;
        fn with_local_deleted_at(self, local_deleted_at: &str) -> Self;
    }

    impl CachedMessageStatePatchTestExt for CachedMessageStatePatchInput {
        fn with_recalled_at(mut self, recalled_at: &str) -> Self {
            self.recalled_at = Some(recalled_at.to_string());
            self
        }

        fn with_local_deleted_at(mut self, local_deleted_at: &str) -> Self {
            self.local_deleted_at = Some(local_deleted_at.to_string());
            self
        }
    }
}
