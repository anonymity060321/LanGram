import { io, Socket } from 'socket.io-client';
import type { Conversation, ConversationUser, MessageType, ServerMessageStatus } from '../api/conversations.api';
import type { FileMetadataResponse } from '../api/files.api';

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
  CONVERSATION_UPDATED: 'conversation:updated',
  FRIEND_REQUEST_CHANGED: 'friend:request:changed',
  SESSION_KICKED: 'session:kicked',
  ERROR: 'error',
} as const;

export interface MessageSendPayload {
  clientMessageId: string;
  conversationId: string;
  messageType: MessageType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  fileId?: string | null;
  replyToMessageId: string | null;
  createdAt: string;
}

export interface MessageNewPayload {
  messageId: string;
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  replyToMessageId: string | null;
  status: ServerMessageStatus;
  file: FileMetadataResponse | null;
  createdAt: string;
}

export interface MessageDeliveredPayload {
  conversationId: string;
  messageId: string;
  receiverId: string;
  deliveredAt: string;
}

export interface MessageReadPayload {
  conversationId: string;
  messageId: string;
  readerId: string;
  readAt: string;
}

export interface MessageRecalledPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  recalledByUserId?: string;
  recalledAt: string;
}

export interface MessageEditPayload {
  conversationId: string;
  messageId: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
}

export interface MessageEditedPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  editedAt: string;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
}

export interface PresenceUpdatePayload {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface SessionKickedPayload {
  reason: 'new_device_login';
}

export interface FriendRequestChangedPayload {
  reason: 'friend_request_changed';
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  reason: 'group_updated';
  conversation: Conversation;
}

export type ConversationMemberUpdatedPayload =
  | {
      conversationId: string;
      reason: 'group_member_updated' | 'group_member_left' | 'group_member_removed';
      member: ConversationUser;
      removedUserId?: string;
    }
  | {
      conversationId: string;
      reason: 'group_member_added';
      conversation: Conversation;
    };

export type RealtimeConnectionStatus =
  | 'online'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting'
  | 'failed';

interface RealtimeHandlers {
  onMessageNew: (payload: MessageNewPayload) => void;
  onMessageDelivered: (payload: MessageDeliveredPayload) => void;
  onMessageRead: (payload: MessageReadPayload) => void;
  onMessageRecalled: (payload: MessageRecalledPayload) => void;
  onMessageEdited: (payload: MessageEditedPayload) => void;
  onPresenceUpdate: (payload: PresenceUpdatePayload) => void;
  onFriendRequestChanged?: (payload: FriendRequestChangedPayload) => void;
  onConversationMemberUpdated?: (payload: ConversationMemberUpdatedPayload) => void;
  onConversationUpdated?: (payload: ConversationUpdatedPayload) => void;
  onSessionKicked: (payload: SessionKickedPayload) => void;
  onError: (payload: RealtimeErrorPayload) => void;
  onConnectionStatusChange?: (status: RealtimeConnectionStatus) => void;
}

let socket: Socket | null = null;

export function connectRealtime(
  apiBaseUrl: string,
  accessToken: string,
  handlers: RealtimeHandlers,
): void {
  disconnectRealtime();
  handlers.onConnectionStatusChange?.('connecting');

  socket = io(resolveSocketUrl(apiBaseUrl), {
    path: '/ws',
    transports: ['websocket'],
    auth: { token: accessToken },
  });

  socket.on('connect', () => {
    handlers.onConnectionStatusChange?.('online');
  });
  socket.on('disconnect', (reason) => {
    handlers.onConnectionStatusChange?.(
      reason === 'io client disconnect' ? 'disconnected' : 'reconnecting',
    );
  });
  socket.on(REALTIME_EVENTS.MESSAGE_NEW, handlers.onMessageNew);
  socket.on(REALTIME_EVENTS.MESSAGE_DELIVERED, handlers.onMessageDelivered);
  socket.on(REALTIME_EVENTS.MESSAGE_READ, handlers.onMessageRead);
  socket.on(REALTIME_EVENTS.MESSAGE_RECALLED, handlers.onMessageRecalled);
  socket.on(REALTIME_EVENTS.MESSAGE_EDITED, handlers.onMessageEdited);
  socket.on(REALTIME_EVENTS.PRESENCE_UPDATE, handlers.onPresenceUpdate);
  if (handlers.onFriendRequestChanged) {
    socket.on(REALTIME_EVENTS.FRIEND_REQUEST_CHANGED, handlers.onFriendRequestChanged);
  }
  if (handlers.onConversationMemberUpdated) {
    socket.on(REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED, handlers.onConversationMemberUpdated);
  }
  if (handlers.onConversationUpdated) {
    socket.on(REALTIME_EVENTS.CONVERSATION_UPDATED, handlers.onConversationUpdated);
  }
  socket.on(REALTIME_EVENTS.SESSION_KICKED, handlers.onSessionKicked);
  socket.on(REALTIME_EVENTS.ERROR, handlers.onError);
  socket.on('connect_error', (error) => {
    handlers.onConnectionStatusChange?.('failed');
    handlers.onError({ code: 'WS_CONNECT_ERROR', message: error.message });
  });
  socket.io.on('reconnect_attempt', () => {
    handlers.onConnectionStatusChange?.('reconnecting');
  });
  socket.io.on('reconnect', () => {
    handlers.onConnectionStatusChange?.('online');
  });
  socket.io.on('reconnect_failed', () => {
    handlers.onConnectionStatusChange?.('failed');
  });
}

export function disconnectRealtime(): void {
  if (!socket) {
    return;
  }

  socket.disconnect();
  socket = null;
}

export function sendRealtimeMessage(payload: MessageSendPayload): void {
  socket?.emit(REALTIME_EVENTS.MESSAGE_SEND, payload);
}

export function sendRealtimeRead(payload: { conversationId: string; messageId: string }): void {
  socket?.emit(REALTIME_EVENTS.MESSAGE_READ, payload);
}

export function sendRealtimeRecall(payload: { conversationId: string; messageId: string }): void {
  socket?.emit(REALTIME_EVENTS.MESSAGE_RECALL, payload);
}

export function sendRealtimeEdit(payload: MessageEditPayload): void {
  socket?.emit(REALTIME_EVENTS.MESSAGE_EDIT, payload);
}

function resolveSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '');
}
