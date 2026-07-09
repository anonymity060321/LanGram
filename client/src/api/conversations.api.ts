import { apiRequest } from './http';
import type { FileMetadataResponse } from './files.api';
import type { UserProfile } from './users.api';

export type ConversationType = 'DIRECT' | 'GROUP';
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
> & {
  userId?: string;
  groupNickname?: string | null;
  groupRemark?: string | null;
  role?: 'OWNER' | 'MEMBER' | string;
  leftAt?: string | null;
};

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  intro?: string | null;
  avatarUrl?: string | null;
  peer: ConversationUser | null;
  members: ConversationUser[];
  memberCount: number;
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

export function createGroupConversation(
  title: string,
  memberUserIds: string[],
): Promise<Conversation> {
  return apiRequest('/conversations/groups', {
    method: 'POST',
    body: JSON.stringify({ title, memberUserIds }),
  });
}

export function addGroupMembers(
  conversationId: string,
  userIds: string[],
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversationId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  });
}
export function updateGroupConversation(
  conversationId: string,
  payload: { name?: string; intro?: string | null; avatarUrl?: string | null },
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversationId}/group`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
export function updateGroupNickname(
  conversationId: string,
  groupNickname: string | null,
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversationId}/group-nickname`, {
    method: 'PATCH',
    body: JSON.stringify({ groupNickname }),
  });
}

export function updateGroupRemark(
  conversationId: string,
  groupRemark: string | null,
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversationId}/group-remark`, {
    method: 'PATCH',
    body: JSON.stringify({ groupRemark }),
  });
}

export function removeGroupMember(
  conversationId: string,
  memberUserId: string,
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversationId}/members/${memberUserId}`, {
    method: 'DELETE',
  });
}

export function leaveGroupConversation(
  conversationId: string,
): Promise<{ conversationId: string; leftAt: string }> {
  return apiRequest(`/conversations/${conversationId}/leave`, {
    method: 'POST',
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
