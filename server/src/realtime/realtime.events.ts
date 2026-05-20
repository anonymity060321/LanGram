export const REALTIME_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  MESSAGE_RECALL: 'message:recall',
  MESSAGE_RECALLED: 'message:recalled',
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

export interface MessageRecallPayload {
  conversationId: string;
  messageId: string;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
}
