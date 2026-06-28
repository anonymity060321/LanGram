export const REALTIME_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  MESSAGE_RECALL: 'message:recall',
  MESSAGE_RECALLED: 'message:recalled',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_EDITED: 'message:edited',
  PRESENCE_UPDATE: 'presence:update',
  CONVERSATION_MEMBER_UPDATED: 'conversation:member-updated',
  FRIEND_REQUEST_CHANGED: 'friend:request:changed',
  SESSION_KICKED: 'session:kicked',
  ERROR: 'error',
} as const;

export interface MessageSendPayload {
  clientMessageId: string;
  conversationId: string;
  messageType: 'TEXT' | 'IMAGE' | 'FILE';
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  fileId?: string | null;
  replyToMessageId?: string | null;
  createdAt?: string;
}

export interface MessageReadPayload {
  conversationId: string;
  messageId: string;
}

export interface MessageRecallPayload {
  conversationId: string;
  messageId: string;
}

export interface MessageRecalledPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  recalledByUserId: string;
  recalledAt: Date;
}

export interface MessageEditPayload {
  conversationId: string;
  messageId: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
}

export interface SessionKickedPayload {
  reason: 'new_device_login';
}

export interface FriendRequestChangedPayload {
  reason: 'friend_request_changed';
}

export type ConversationMemberUpdatedPayload =
  | {
      conversationId: string;
      reason: 'group_member_updated' | 'group_member_left';
      member: {
        id: string;
        userId?: string;
        email: string | null;
        displayName: string | null;
        statusMessage?: string | null;
        avatarUrl?: string | null;
        accountType?: string;
        isOnline?: boolean;
        lastSeenAt?: string | null;
        groupNickname?: string | null;
        leftAt?: string | Date | null;
      };
    }
  | {
      conversationId: string;
      reason: 'group_member_added';
      conversation: unknown;
    };

export interface PresenceUpdatePayload {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

