import { apiRequest } from './http';
import type { FileMetadataResponse } from './files.api';
import type { UserProfile } from './users.api';

export type ConversationType = 'DIRECT';
export type MessageType = 'TEXT' | 'IMAGE' | 'FILE';
export type ServerMessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'RECALLED';

export type ConversationUser = Pick<
  UserProfile,
  | 'id'
  | 'email'
  | 'displayName'
  | 'statusMessage'
  | 'avatarUrl'
  | 'accountType'
  | 'isOnline'
  | 'lastSeenAt'
>;

export interface Conversation {
  id: string;
  type: ConversationType;
  peer: ConversationUser | null;
  members: ConversationUser[];
  lastMessage: EncryptedMessage | null;
  lastMessageAt: string | null;
  unreadCount: number;
  lastMessagePlaintext?: string | null;
  lastMessageDecryptionFailed?: boolean;
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

export interface ListMessagesResponse {
  messages: EncryptedMessage[];
  hasMore: boolean;
  nextCursor: string | null;
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
  options: { before?: string; beforeMessageId?: string; limit?: number } = {},
): Promise<ListMessagesResponse> {
  const params = new URLSearchParams();
  const beforeMessageId = options.beforeMessageId ?? options.before;
  if (beforeMessageId) {
    params.set('beforeMessageId', beforeMessageId);
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
