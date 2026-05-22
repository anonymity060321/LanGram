import { apiRequest } from './http';
import type { FileMetadataResponse } from './files.api';

export type ConversationType = 'DIRECT';
export type MessageType = 'TEXT' | 'IMAGE' | 'FILE';
export type ServerMessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'RECALLED';

export interface ConversationUser {
  id: string;
  email: string | null;
  displayName: string;
  accountType: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  peer: ConversationUser | null;
  members: ConversationUser[];
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  ciphertext: string;
  encryptionVersion: string;
  nonce: string;
  replyToMessageId: string | null;
  status: ServerMessageStatus;
  file: FileMetadataResponse | null;
  editedAt: string | null;
  recalledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listConversations(): Promise<{ conversations: Conversation[] }> {
  return apiRequest('/conversations');
}

export function createDirectConversation(friendUserId: string): Promise<Conversation> {
  return apiRequest('/conversations/direct', {
    method: 'POST',
    body: JSON.stringify({ friendUserId }),
  });
}

export function listMessages(
  conversationId: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ messages: EncryptedMessage[] }> {
  const params = new URLSearchParams();
  if (options.before) {
    params.set('before', options.before);
  }
  if (options.limit) {
    params.set('limit', String(options.limit));
  }

  const query = params.toString();
  return apiRequest(`/conversations/${conversationId}/messages${query ? `?${query}` : ''}`);
}

export function markConversationRead(
  conversationId: string,
  messageId: string,
): Promise<{ read: true; messageId: string }> {
  return apiRequest(`/conversations/${conversationId}/read`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}
