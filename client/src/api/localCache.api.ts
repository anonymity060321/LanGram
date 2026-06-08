import { invoke } from '@tauri-apps/api/core';

export interface LocalCacheStatus {
  dbPath: string;
  exists: boolean;
  schemaVersion: number | null;
}

export interface InitLocalCacheResult {
  dbPath: string;
  schemaVersion: number;
  initialized: true;
}

export interface CachedConversationInput {
  id: string;
  conversationType: string;
  peerUserId: string | null;
  title: string | null;
  avatarUrl: string | null;
  lastMessageId: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
}

export interface CachedConversationRecord {
  id: string;
  conversationType: string;
  peerUserId: string | null;
  title: string | null;
  avatarUrl: string | null;
  lastMessageId: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
}

export interface CachedMessageInput {
  id: string;
  clientMessageId: string | null;
  conversationId: string;
  senderId: string;
  messageType: string;
  status: string;
  ciphertext: string | null;
  nonce: string | null;
  encryptionVersion: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  recalledAt: string | null;
  localDeletedAt: string | null;
}

export interface CachedMessageRecord {
  id: string;
  clientMessageId: string | null;
  conversationId: string;
  senderId: string;
  messageType: string;
  status: string;
  ciphertext: string | null;
  nonce: string | null;
  encryptionVersion: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  recalledAt: string | null;
  localDeletedAt: string | null;
}

export interface ListCachedMessagesParams {
  conversationId: string;
  limit?: number;
  beforeCreatedAt?: string;
}

export interface CachedMessageStatePatchInput {
  id: string;
  status: string | null;
  ciphertext: string | null;
  nonce: string | null;
  encryptionVersion: string | null;
  updatedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  recalledAt: string | null;
  localDeletedAt: string | null;
}

export function initLocalCache(): Promise<InitLocalCacheResult> {
  return invoke<InitLocalCacheResult>('init_local_cache');
}

export function getLocalCacheStatus(): Promise<LocalCacheStatus> {
  return invoke<LocalCacheStatus>('get_local_cache_status');
}

export function clearLocalCache(): Promise<LocalCacheStatus> {
  return invoke<LocalCacheStatus>('clear_local_cache');
}

export function upsertCachedConversations(conversations: CachedConversationInput[]): Promise<void> {
  return invoke<void>('upsert_cached_conversations', { conversations });
}

export function listCachedConversations(): Promise<CachedConversationRecord[]> {
  return invoke<CachedConversationRecord[]>('list_cached_conversations');
}

export function upsertCachedMessages(messages: CachedMessageInput[]): Promise<void> {
  return invoke<void>('upsert_cached_messages', { messages });
}

export function updateCachedMessageState(
  patches: CachedMessageStatePatchInput[],
): Promise<void> {
  return invoke<void>('update_cached_message_state', { patches });
}

export function listCachedMessages({
  conversationId,
  limit,
  beforeCreatedAt,
}: ListCachedMessagesParams): Promise<CachedMessageRecord[]> {
  return invoke<CachedMessageRecord[]>('list_cached_messages', {
    conversationId,
    limit,
    beforeCreatedAt,
  });
}
