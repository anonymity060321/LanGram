import { io, Socket } from 'socket.io-client';
import type { MessageType, ServerMessageStatus } from '../api/conversations.api';

export const REALTIME_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  MESSAGE_RECALL: 'message:recall',
  MESSAGE_RECALLED: 'message:recalled',
  ERROR: 'error',
} as const;

export interface MessageSendPayload {
  clientMessageId: string;
  conversationId: string;
  messageType: MessageType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
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
  recalledAt: string;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
}

interface RealtimeHandlers {
  onMessageNew: (payload: MessageNewPayload) => void;
  onMessageDelivered: (payload: MessageDeliveredPayload) => void;
  onMessageRead: (payload: MessageReadPayload) => void;
  onMessageRecalled: (payload: MessageRecalledPayload) => void;
  onError: (payload: RealtimeErrorPayload) => void;
}

let socket: Socket | null = null;

export function connectRealtime(
  apiBaseUrl: string,
  accessToken: string,
  handlers: RealtimeHandlers,
): void {
  disconnectRealtime();

  socket = io(resolveSocketUrl(apiBaseUrl), {
    path: '/ws',
    transports: ['websocket'],
    auth: { token: accessToken },
  });

  socket.on(REALTIME_EVENTS.MESSAGE_NEW, handlers.onMessageNew);
  socket.on(REALTIME_EVENTS.MESSAGE_DELIVERED, handlers.onMessageDelivered);
  socket.on(REALTIME_EVENTS.MESSAGE_READ, handlers.onMessageRead);
  socket.on(REALTIME_EVENTS.MESSAGE_RECALLED, handlers.onMessageRecalled);
  socket.on(REALTIME_EVENTS.ERROR, handlers.onError);
  socket.on('connect_error', (error) => {
    handlers.onError({ code: 'WS_CONNECT_ERROR', message: error.message });
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

function resolveSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '');
}
