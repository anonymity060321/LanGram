export const REALTIME_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  SESSION_KICKED: 'session:kicked',
  ERROR: 'error',
} as const;

export interface MessageSendPayload {
  clientMessageId: string;
  conversationId: string;
  messageType: 'TEXT';
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  replyToMessageId?: string | null;
  createdAt?: string;
}

export interface MessageReadPayload {
  conversationId: string;
  messageId: string;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
}
