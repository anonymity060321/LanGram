use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fmt, fs, io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const LOCAL_CACHE_DB_FILE: &str = "langram-local-cache.sqlite3";
const SCHEMA_VERSION_KEY: &str = "schema_version";
const CURRENT_SCHEMA_VERSION: i64 = 2;
const DEFAULT_CACHED_MESSAGES_LIMIT: i64 = 50;
const MAX_CACHED_MESSAGES_LIMIT: i64 = 100;
const DEFAULT_LOCAL_FILES_LIMIT: i64 = 50;
const MAX_LOCAL_FILES_LIMIT: i64 = 200;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMessageRecord {
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRecordInput {
    file_id: String,
    conversation_id: Option<String>,
    message_id: Option<String>,
    original_name: String,
    safe_name: String,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    sha256: Option<String>,
    local_path: String,
    status: String,
    error_message: Option<String>,
    downloaded_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRecord {
    id: String,
    file_id: String,
    conversation_id: Option<String>,
    message_id: Option<String>,
    original_name: String,
    safe_name: String,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    sha256: Option<String>,
    local_path: String,
    status: String,
    error_message: Option<String>,
    downloaded_at: Option<String>,
    created_at: String,
    updated_at: String,
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

#[tauri::command]
pub fn list_cached_messages(
    app: AppHandle,
    conversation_id: String,
    limit: Option<i64>,
    before_created_at: Option<String>,
) -> Result<Vec<CachedMessageRecord>, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    list_cached_messages_at_path(
        &db_path,
        &conversation_id,
        limit,
        before_created_at.as_deref(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_local_file_record(
    app: AppHandle,
    record: LocalFileRecordInput,
) -> Result<LocalFileRecord, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    upsert_local_file_record_at_path(&db_path, &record).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_local_file_records(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<LocalFileRecord>, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    list_local_file_records_at_path(&db_path, limit).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_local_file_record(
    app: AppHandle,
    id: String,
) -> Result<Option<LocalFileRecord>, String> {
    let db_path = local_cache_path(&app).map_err(|error| error.to_string())?;
    get_local_file_record_at_path(&db_path, &id).map_err(|error| error.to_string())
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
    // Clearing chat cache intentionally keeps local_files download records.
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

fn list_cached_messages_at_path(
    db_path: &Path,
    conversation_id: &str,
    limit: Option<i64>,
    before_created_at: Option<&str>,
) -> Result<Vec<CachedMessageRecord>, LocalCacheError> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    init_database_at_path(db_path)?;

    let normalized_limit = limit
        .unwrap_or(DEFAULT_CACHED_MESSAGES_LIMIT)
        .clamp(1, MAX_CACHED_MESSAGES_LIMIT);
    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let sql = if before_created_at.is_some() {
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
            updated_at,
            delivered_at,
            read_at,
            edited_at,
            recalled_at,
            local_deleted_at
        FROM cached_messages
        WHERE conversation_id = ?1 AND created_at < ?2
        ORDER BY created_at DESC
        LIMIT ?3
        "
    } else {
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
            updated_at,
            delivered_at,
            read_at,
            edited_at,
            recalled_at,
            local_deleted_at
        FROM cached_messages
        WHERE conversation_id = ?1
        ORDER BY created_at DESC
        LIMIT ?2
        "
    };
    let mut statement = connection.prepare(sql)?;
    let rows = if let Some(before_created_at) = before_created_at {
        statement.query_map(
            params![conversation_id, before_created_at, normalized_limit],
            cached_message_record_from_row,
        )?
    } else {
        statement.query_map(
            params![conversation_id, normalized_limit],
            cached_message_record_from_row,
        )?
    };
    let mut messages = rows.collect::<Result<Vec<_>, _>>()?;
    messages.reverse();

    Ok(messages)
}

fn upsert_local_file_record_at_path(
    db_path: &Path,
    record: &LocalFileRecordInput,
) -> Result<LocalFileRecord, LocalCacheError> {
    validate_local_file_record_input(record)?;
    init_database_at_path(db_path)?;

    let mut connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let transaction = connection.transaction()?;
    let now = current_timestamp_sql(&transaction)?;
    let existing_id = transaction
        .query_row(
            "SELECT id FROM local_files WHERE file_id = ?1",
            params![&record.file_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let id = existing_id.unwrap_or_else(create_local_file_record_id);

    transaction.execute(
        "
        INSERT INTO local_files(
            id,
            file_id,
            conversation_id,
            message_id,
            original_name,
            safe_name,
            mime_type,
            size_bytes,
            sha256,
            local_path,
            status,
            error_message,
            downloaded_at,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
        ON CONFLICT(id) DO UPDATE SET
            file_id = excluded.file_id,
            conversation_id = excluded.conversation_id,
            message_id = excluded.message_id,
            original_name = excluded.original_name,
            safe_name = excluded.safe_name,
            mime_type = excluded.mime_type,
            size_bytes = excluded.size_bytes,
            sha256 = excluded.sha256,
            local_path = excluded.local_path,
            status = excluded.status,
            error_message = excluded.error_message,
            downloaded_at = excluded.downloaded_at,
            updated_at = excluded.updated_at
        ",
        params![
            &id,
            &record.file_id,
            &record.conversation_id,
            &record.message_id,
            &record.original_name,
            &record.safe_name,
            &record.mime_type,
            &record.size_bytes,
            &record.sha256,
            &record.local_path,
            &record.status,
            &record.error_message,
            &record.downloaded_at,
            &now
        ],
    )?;
    transaction.commit()?;

    get_local_file_record_at_path(db_path, &id)?.ok_or(LocalCacheError::MissingLocalFileRecord)
}

fn list_local_file_records_at_path(
    db_path: &Path,
    limit: Option<i64>,
) -> Result<Vec<LocalFileRecord>, LocalCacheError> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    init_database_at_path(db_path)?;

    let normalized_limit = limit
        .unwrap_or(DEFAULT_LOCAL_FILES_LIMIT)
        .clamp(1, MAX_LOCAL_FILES_LIMIT);
    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    let mut statement = connection.prepare(
        "
        SELECT
            id,
            file_id,
            conversation_id,
            message_id,
            original_name,
            safe_name,
            mime_type,
            size_bytes,
            sha256,
            local_path,
            status,
            error_message,
            downloaded_at,
            created_at,
            updated_at
        FROM local_files
        ORDER BY COALESCE(downloaded_at, updated_at) DESC, updated_at DESC
        LIMIT ?1
        ",
    )?;
    let records = statement
        .query_map(params![normalized_limit], local_file_record_from_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(records)
}

fn get_local_file_record_at_path(
    db_path: &Path,
    id: &str,
) -> Result<Option<LocalFileRecord>, LocalCacheError> {
    if !db_path.exists() {
        return Ok(None);
    }

    init_database_at_path(db_path)?;

    let connection = Connection::open(db_path)?;
    enable_foreign_keys(&connection)?;
    connection
        .query_row(
            "
            SELECT
                id,
                file_id,
                conversation_id,
                message_id,
                original_name,
                safe_name,
                mime_type,
                size_bytes,
                sha256,
                local_path,
                status,
                error_message,
                downloaded_at,
                created_at,
                updated_at
            FROM local_files
            WHERE id = ?1
            ",
            params![id],
            local_file_record_from_row,
        )
        .optional()
        .map_err(LocalCacheError::from)
}

fn local_file_record_from_row(row: &rusqlite::Row<'_>) -> Result<LocalFileRecord, rusqlite::Error> {
    Ok(LocalFileRecord {
        id: row.get(0)?,
        file_id: row.get(1)?,
        conversation_id: row.get(2)?,
        message_id: row.get(3)?,
        original_name: row.get(4)?,
        safe_name: row.get(5)?,
        mime_type: row.get(6)?,
        size_bytes: row.get(7)?,
        sha256: row.get(8)?,
        local_path: row.get(9)?,
        status: row.get(10)?,
        error_message: row.get(11)?,
        downloaded_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn cached_message_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<CachedMessageRecord, rusqlite::Error> {
    Ok(CachedMessageRecord {
        id: row.get(0)?,
        client_message_id: row.get(1)?,
        conversation_id: row.get(2)?,
        sender_id: row.get(3)?,
        message_type: row.get(4)?,
        status: row.get(5)?,
        ciphertext: row.get(6)?,
        nonce: row.get(7)?,
        encryption_version: row.get(8)?,
        metadata_json: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        delivered_at: row.get(12)?,
        read_at: row.get(13)?,
        edited_at: row.get(14)?,
        recalled_at: row.get(15)?,
        local_deleted_at: row.get(16)?,
    })
}

fn validate_local_file_record_input(record: &LocalFileRecordInput) -> Result<(), LocalCacheError> {
    if record.file_id.trim().is_empty() {
        return Err(LocalCacheError::InvalidLocalFileRecord(
            "file_id is required".to_string(),
        ));
    }
    if record.original_name.trim().is_empty() {
        return Err(LocalCacheError::InvalidLocalFileRecord(
            "original_name is required".to_string(),
        ));
    }
    if record.safe_name.trim().is_empty() {
        return Err(LocalCacheError::InvalidLocalFileRecord(
            "safe_name is required".to_string(),
        ));
    }
    if record.local_path.trim().is_empty() {
        return Err(LocalCacheError::InvalidLocalFileRecord(
            "local_path is required".to_string(),
        ));
    }
    if record.status.trim().is_empty() {
        return Err(LocalCacheError::InvalidLocalFileRecord(
            "status is required".to_string(),
        ));
    }

    Ok(())
}

fn current_timestamp_sql(connection: &Connection) -> Result<String, LocalCacheError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(LocalCacheError::from)
}

fn create_local_file_record_id() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("local-file-{timestamp:x}-{:x}", std::process::id())
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

        CREATE TABLE IF NOT EXISTS local_files (
            id TEXT PRIMARY KEY,
            file_id TEXT NOT NULL,
            conversation_id TEXT,
            message_id TEXT,
            original_name TEXT NOT NULL,
            safe_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER,
            sha256 TEXT,
            local_path TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            downloaded_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cached_messages_conversation_created
            ON cached_messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_cached_messages_client_message_id
            ON cached_messages(client_message_id);
        CREATE INDEX IF NOT EXISTS idx_cached_conversations_updated
            ON cached_conversations(updated_at);
        CREATE INDEX IF NOT EXISTS idx_local_files_file_id
            ON local_files(file_id);
        CREATE INDEX IF NOT EXISTS idx_local_files_conversation_id
            ON local_files(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_local_files_message_id
            ON local_files(message_id);
        CREATE INDEX IF NOT EXISTS idx_local_files_downloaded_at
            ON local_files(downloaded_at);
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
    InvalidLocalFileRecord(String),
    MissingLocalFileRecord,
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
            Self::InvalidLocalFileRecord(error) => {
                write!(formatter, "local file record is invalid: {error}")
            }
            Self::MissingLocalFileRecord => {
                write!(formatter, "local file record was not found after write")
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
    fn list_cached_messages_returns_empty_when_database_is_missing() {
        let db_path = test_db_path("message-list-missing");

        let messages = list_cached_messages_at_path(&db_path, "conversation-1", None, None)
            .expect("missing database should list");

        assert!(messages.is_empty());
        assert!(!db_path.exists());

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_messages_only_returns_requested_conversation() {
        let db_path = test_db_path("message-list-conversation");
        let mut other_conversation_message = test_cached_message("message-other", "SENT");
        other_conversation_message.conversation_id = "conversation-2".to_string();
        let messages = vec![
            test_cached_message_with_created_at("message-1", "2026-06-07T00:00:00.000Z"),
            other_conversation_message,
        ];

        upsert_cached_messages_at_path(&db_path, &messages).expect("messages should upsert");

        let listed = list_cached_messages_at_path(&db_path, "conversation-1", None, None)
            .expect("messages should list");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "message-1");
        assert_eq!(listed[0].conversation_id, "conversation-1");

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_messages_returns_created_at_ascending_by_default() {
        let db_path = test_db_path("message-list-asc");
        let messages = vec![
            test_cached_message_with_created_at("message-older", "2026-06-07T00:00:00.000Z"),
            test_cached_message_with_created_at("message-newest", "2026-06-07T00:02:00.000Z"),
            test_cached_message_with_created_at("message-middle", "2026-06-07T00:01:00.000Z"),
        ];

        upsert_cached_messages_at_path(&db_path, &messages).expect("messages should upsert");

        let listed = list_cached_messages_at_path(&db_path, "conversation-1", None, None)
            .expect("messages should list");

        assert_eq!(
            listed
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["message-older", "message-middle", "message-newest"]
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_messages_applies_limit_to_recent_messages() {
        let db_path = test_db_path("message-list-limit");
        let messages = vec![
            test_cached_message_with_created_at("message-older", "2026-06-07T00:00:00.000Z"),
            test_cached_message_with_created_at("message-middle", "2026-06-07T00:01:00.000Z"),
            test_cached_message_with_created_at("message-newest", "2026-06-07T00:02:00.000Z"),
        ];

        upsert_cached_messages_at_path(&db_path, &messages).expect("messages should upsert");

        let listed = list_cached_messages_at_path(&db_path, "conversation-1", Some(2), None)
            .expect("messages should list");

        assert_eq!(
            listed
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["message-middle", "message-newest"]
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_messages_applies_before_created_at() {
        let db_path = test_db_path("message-list-before");
        let messages = vec![
            test_cached_message_with_created_at("message-older", "2026-06-07T00:00:00.000Z"),
            test_cached_message_with_created_at("message-middle", "2026-06-07T00:01:00.000Z"),
            test_cached_message_with_created_at("message-newest", "2026-06-07T00:02:00.000Z"),
        ];

        upsert_cached_messages_at_path(&db_path, &messages).expect("messages should upsert");

        let listed = list_cached_messages_at_path(
            &db_path,
            "conversation-1",
            None,
            Some("2026-06-07T00:02:00.000Z"),
        )
        .expect("messages should list");

        assert_eq!(
            listed
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["message-older", "message-middle"]
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_cached_messages_returns_fields_written_by_upsert() {
        let db_path = test_db_path("message-list-fields");
        let mut message =
            test_cached_message_with_created_at("message-1", "2026-06-07T00:00:00.000Z");
        message.metadata_json = Some(r#"{"fileId":"file-1","sizeBytes":1024}"#.to_string());
        message.delivered_at = Some("2026-06-07T00:01:00.000Z".to_string());
        message.read_at = Some("2026-06-07T00:02:00.000Z".to_string());
        message.edited_at = Some("2026-06-07T00:03:00.000Z".to_string());
        message.recalled_at = Some("2026-06-07T00:04:00.000Z".to_string());
        message.local_deleted_at = Some("2026-06-07T00:05:00.000Z".to_string());
        message.updated_at = "2026-06-07T00:05:00.000Z".to_string();

        upsert_cached_messages_at_path(&db_path, &[message.clone()])
            .expect("message should upsert");

        let listed = list_cached_messages_at_path(&db_path, "conversation-1", None, None)
            .expect("messages should list");

        assert_eq!(listed, vec![expected_cached_message_record(&message)]);

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

    #[test]
    fn migrates_v1_database_to_schema_v2() {
        let db_path = test_db_path("migrate-v1");
        create_v1_database_at_path(&db_path);

        let schema_version = init_database_at_path(&db_path).expect("database should migrate");
        let connection = Connection::open(&db_path).expect("database should open");

        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION);
        assert!(has_table(&connection, "cached_conversations").expect("table check should work"));
        assert!(has_table(&connection, "cached_messages").expect("table check should work"));
        assert!(has_table(&connection, "local_clear_watermarks").expect("table check should work"));
        assert!(has_table(&connection, "local_files").expect("table check should work"));

        cleanup_test_db(&db_path);
    }

    #[test]
    fn local_files_table_exists_after_initialization() {
        let db_path = test_db_path("local-files-table");
        init_database_at_path(&db_path).expect("database should initialize");

        let connection = Connection::open(&db_path).expect("database should open");
        let mut statement = connection
            .prepare("PRAGMA table_info(local_files)")
            .expect("table info should prepare");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("columns should collect");

        assert_eq!(
            columns,
            vec![
                "id",
                "file_id",
                "conversation_id",
                "message_id",
                "original_name",
                "safe_name",
                "mime_type",
                "size_bytes",
                "sha256",
                "local_path",
                "status",
                "error_message",
                "downloaded_at",
                "created_at",
                "updated_at"
            ]
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn local_files_indexes_exist_after_initialization() {
        let db_path = test_db_path("local-files-indexes");
        init_database_at_path(&db_path).expect("database should initialize");

        let connection = Connection::open(&db_path).expect("database should open");
        let mut statement = connection
            .prepare("PRAGMA index_list(local_files)")
            .expect("index list should prepare");
        let indexes = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("index list should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("indexes should collect");

        assert!(indexes
            .iter()
            .any(|index| index == "idx_local_files_file_id"));
        assert!(indexes
            .iter()
            .any(|index| index == "idx_local_files_conversation_id"));
        assert!(indexes
            .iter()
            .any(|index| index == "idx_local_files_message_id"));
        assert!(indexes
            .iter()
            .any(|index| index == "idx_local_files_downloaded_at"));

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserts_local_file_record_inserts_record() {
        let db_path = test_db_path("local-file-insert");
        let input = test_local_file_record("file-1", "report.pdf", "2026-06-08T00:00:00.000Z");

        let record =
            upsert_local_file_record_at_path(&db_path, &input).expect("record should upsert");

        assert!(!record.id.trim().is_empty());
        assert_eq!(record.file_id, input.file_id);
        assert_eq!(record.original_name, input.original_name);
        assert_eq!(record.safe_name, input.safe_name);
        assert_eq!(record.local_path, input.local_path);
        assert_eq!(record.status, "completed");
        assert_eq!(record.downloaded_at, input.downloaded_at);
        assert!(!record.created_at.trim().is_empty());
        assert!(!record.updated_at.trim().is_empty());

        cleanup_test_db(&db_path);
    }

    #[test]
    fn upserts_local_file_record_updates_existing_file_record() {
        let db_path = test_db_path("local-file-update");
        let first = test_local_file_record("file-1", "report.pdf", "2026-06-08T00:00:00.000Z");
        let mut second =
            test_local_file_record("file-1", "report-renamed.pdf", "2026-06-08T00:02:00.000Z");
        second.local_path = "D:\\Downloads\\report-renamed.pdf".to_string();

        let first_record =
            upsert_local_file_record_at_path(&db_path, &first).expect("first upsert should work");
        let second_record =
            upsert_local_file_record_at_path(&db_path, &second).expect("second upsert should work");
        let listed = list_local_file_records_at_path(&db_path, None).expect("records should list");

        assert_eq!(first_record.id, second_record.id);
        assert_eq!(second_record.original_name, "report-renamed.pdf");
        assert_eq!(
            second_record.local_path,
            "D:\\Downloads\\report-renamed.pdf"
        );
        assert_eq!(listed.len(), 1);

        cleanup_test_db(&db_path);
    }

    #[test]
    fn list_local_file_records_returns_recent_records_first() {
        let db_path = test_db_path("local-file-list-order");
        let older = test_local_file_record("file-older", "older.pdf", "2026-06-08T00:00:00.000Z");
        let newer = test_local_file_record("file-newer", "newer.pdf", "2026-06-08T00:01:00.000Z");

        upsert_local_file_record_at_path(&db_path, &older).expect("older should upsert");
        upsert_local_file_record_at_path(&db_path, &newer).expect("newer should upsert");

        let listed =
            list_local_file_records_at_path(&db_path, Some(50)).expect("records should list");

        assert_eq!(
            listed
                .iter()
                .map(|record| record.file_id.as_str())
                .collect::<Vec<_>>(),
            vec!["file-newer", "file-older"]
        );

        cleanup_test_db(&db_path);
    }

    #[test]
    fn local_file_record_rejects_empty_required_fields() {
        let db_path = test_db_path("local-file-required");
        let mut input = test_local_file_record("file-1", "report.pdf", "2026-06-08T00:00:00.000Z");
        input.file_id = "  ".to_string();

        let error = upsert_local_file_record_at_path(&db_path, &input)
            .expect_err("empty file_id should fail");

        assert!(error.to_string().contains("file_id is required"));
        assert!(!db_path.exists());

        cleanup_test_db(&db_path);
    }

    #[test]
    fn clear_local_cache_keeps_local_file_records() {
        let db_path = test_db_path("clear-keeps-local-files");
        let input = test_local_file_record("file-1", "report.pdf", "2026-06-08T00:00:00.000Z");
        let record =
            upsert_local_file_record_at_path(&db_path, &input).expect("record should upsert");

        clear_local_cache_at_path(&db_path).expect("cache should clear");

        let listed =
            list_local_file_records_at_path(&db_path, None).expect("records should still list");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, record.id);
        assert_eq!(listed[0].file_id, "file-1");

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

    fn create_v1_database_at_path(db_path: &Path) {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).expect("test database directory should be created");
        }

        let connection = Connection::open(db_path).expect("database should open");
        connection
            .execute_batch(
                "
                CREATE TABLE local_cache_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE cached_conversations (
                    id TEXT PRIMARY KEY,
                    conversation_type TEXT NOT NULL,
                    peer_user_id TEXT,
                    title TEXT,
                    avatar_url TEXT,
                    last_message_id TEXT,
                    last_message_at TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE cached_messages (
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

                CREATE TABLE local_clear_watermarks (
                    conversation_id TEXT PRIMARY KEY,
                    cleared_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                INSERT INTO local_cache_meta(key, value, updated_at)
                VALUES ('schema_version', '1', '2026-06-08T00:00:00.000Z');
                ",
            )
            .expect("v1 schema should be created");
    }

    fn test_local_file_record(
        file_id: &str,
        original_name: &str,
        downloaded_at: &str,
    ) -> LocalFileRecordInput {
        LocalFileRecordInput {
            file_id: file_id.to_string(),
            conversation_id: Some("conversation-1".to_string()),
            message_id: Some("message-1".to_string()),
            original_name: original_name.to_string(),
            safe_name: original_name.replace(' ', "_"),
            mime_type: Some("application/pdf".to_string()),
            size_bytes: Some(1024),
            sha256: Some("sha256-test-value".to_string()),
            local_path: format!("D:\\Downloads\\{original_name}"),
            status: "completed".to_string(),
            error_message: None,
            downloaded_at: Some(downloaded_at.to_string()),
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

    fn test_cached_message_with_created_at(id: &str, created_at: &str) -> CachedMessageInput {
        let mut message = test_cached_message(id, "SENT");
        message.created_at = created_at.to_string();
        message.updated_at = created_at.to_string();
        message
    }

    fn expected_cached_message_record(input: &CachedMessageInput) -> CachedMessageRecord {
        CachedMessageRecord {
            id: input.id.clone(),
            client_message_id: input.client_message_id.clone(),
            conversation_id: input.conversation_id.clone(),
            sender_id: input.sender_id.clone(),
            message_type: input.message_type.clone(),
            status: input.status.clone(),
            ciphertext: input.ciphertext.clone(),
            nonce: input.nonce.clone(),
            encryption_version: input.encryption_version.clone(),
            metadata_json: input.metadata_json.clone(),
            created_at: input.created_at.clone(),
            updated_at: input.updated_at.clone(),
            delivered_at: input.delivered_at.clone(),
            read_at: input.read_at.clone(),
            edited_at: input.edited_at.clone(),
            recalled_at: input.recalled_at.clone(),
            local_deleted_at: input.local_deleted_at.clone(),
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
