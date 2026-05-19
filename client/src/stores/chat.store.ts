import { create } from 'zustand';
import {
  createDirectConversation,
  listConversations,
  listMessages,
  type Conversation,
  type EncryptedMessage,
} from '../api/conversations.api';
import { getApiBaseUrl } from '../api/http';
import { decryptMessage, encryptMessage } from '../crypto/messageCrypto';
import {
  connectRealtime,
  disconnectRealtime,
  sendRealtimeMessage,
  sendRealtimeRead,
  type MessageDeliveredPayload,
  type MessageNewPayload,
  type MessageReadPayload,
  type RealtimeErrorPayload,
} from '../realtime/socket';

export type LocalMessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage {
  id: string;
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  plaintext: string;
  status: LocalMessageStatus;
  createdAt: string;
  isOwn: boolean;
}

interface ChatState {
  conversations: Conversation[];
  selectedConversationId: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  error: string | null;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  loadConversations: () => Promise<void>;
  selectConversation: (conversationId: string, currentUserId: string) => Promise<void>;
  openDirectConversation: (friendUserId: string, currentUserId: string) => Promise<void>;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  sendTextMessage: (conversationId: string, plaintext: string, senderId: string) => Promise<void>;
  markRead: (conversationId: string, messageId: string) => void;
}

type ChatSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messagesByConversation: {},
  error: null,
  isLoadingConversations: false,
  isLoadingMessages: false,
  loadConversations: async () => {
    set({ isLoadingConversations: true, error: null });
    try {
      const result = await listConversations();
      set({ conversations: result.conversations, isLoadingConversations: false });
    } catch {
      set({ error: 'Failed to load conversations', isLoadingConversations: false });
    }
  },
  selectConversation: async (conversationId, currentUserId) => {
    set({ selectedConversationId: conversationId, isLoadingMessages: true, error: null });
    try {
      const result = await listMessages(conversationId, { limit: 50 });
      const conversation = get().conversations.find((item) => item.id === conversationId);
      if (!conversation) {
        set({ isLoadingMessages: false });
        return;
      }

      const messages = await Promise.all(
        result.messages.map((message) => toChatMessage(message, conversation, currentUserId)),
      );

      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: messages,
        },
        isLoadingMessages: false,
      }));

      const lastIncoming = [...messages].reverse().find((message) => !message.isOwn);
      if (lastIncoming) {
        get().markRead(conversationId, lastIncoming.id);
      }
    } catch {
      set({ error: 'Failed to load messages', isLoadingMessages: false });
    }
  },
  openDirectConversation: async (friendUserId, currentUserId) => {
    set({ error: null });
    try {
      const conversation = await createDirectConversation(friendUserId);
      set((state) => ({
        conversations: upsertConversation(state.conversations, conversation),
      }));
      await get().selectConversation(conversation.id, currentUserId);
    } catch {
      set({ error: 'Failed to open conversation' });
    }
  },
  connect: (accessToken) => {
    connectRealtime(getApiBaseUrl(), accessToken, {
      onMessageNew: (payload) => {
        void handleIncomingMessage(payload, get, set);
      },
      onMessageDelivered: (payload) => {
        handleDelivered(payload, set);
      },
      onMessageRead: (payload) => {
        handleRead(payload, set);
      },
      onError: (payload) => {
        handleRealtimeError(payload, set);
      },
    });
  },
  disconnect: () => {
    disconnectRealtime();
  },
  sendTextMessage: async (conversationId, plaintext, senderId) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      set({ error: 'Conversation not found' });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId,
      plaintext,
      status: 'sending',
      createdAt,
      isOwn: true,
    };

    set((state) => ({
      messagesByConversation: appendMessage(
        state.messagesByConversation,
        conversationId,
        optimisticMessage,
      ),
    }));

    try {
      const encrypted = await encryptMessage(plaintext, conversation);
      sendRealtimeMessage({
        clientMessageId,
        conversationId,
        messageType: 'TEXT',
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
        replyToMessageId: null,
        createdAt,
      });
    } catch {
      updateMessageStatus(conversationId, clientMessageId, 'failed', set);
    }
  },
  markRead: (conversationId, messageId) => {
    sendRealtimeRead({ conversationId, messageId });
  },
}));

async function toChatMessage(
  message: EncryptedMessage,
  conversation: Conversation,
  currentUserId: string,
): Promise<ChatMessage> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    plaintext: await decryptSafely(message.ciphertext, message.nonce, conversation),
    status: toLocalStatus(message.status),
    createdAt: message.createdAt,
    isOwn: message.senderId === currentUserId,
  };
}

async function handleIncomingMessage(
  payload: MessageNewPayload,
  get: () => ChatState,
  set: ChatSet,
): Promise<void> {
  const state = get();
  const conversation = state.conversations.find((item) => item.id === payload.conversationId);
  if (!conversation) {
    await state.loadConversations();
    return;
  }

  const plaintext = await decryptSafely(payload.ciphertext, payload.nonce, conversation);
  const existing = state.messagesByConversation[payload.conversationId] ?? [];
  const matched = payload.clientMessageId
    ? existing.find((message) => message.clientMessageId === payload.clientMessageId)
    : null;
  const message: ChatMessage = {
    id: payload.messageId,
    clientMessageId: payload.clientMessageId,
    conversationId: payload.conversationId,
    senderId: payload.senderId,
    plaintext,
    status: matched?.isOwn ? 'sent' : toLocalStatus(payload.status),
    createdAt: payload.createdAt,
    isOwn: matched?.isOwn ?? false,
  };

  set((currentState: ChatState) => ({
    messagesByConversation: upsertMessage(
      currentState.messagesByConversation,
      payload.conversationId,
      message,
    ),
  }));

  if (!message.isOwn && state.selectedConversationId === payload.conversationId) {
    sendRealtimeRead({ conversationId: payload.conversationId, messageId: payload.messageId });
  }
}

function handleDelivered(
  payload: MessageDeliveredPayload,
  set: ChatSet,
): void {
  updateMessageStatus(payload.conversationId, payload.messageId, 'delivered', set);
}

function handleRead(
  payload: MessageReadPayload,
  set: ChatSet,
): void {
  updateMessageStatus(payload.conversationId, payload.messageId, 'read', set);
}

function handleRealtimeError(
  payload: RealtimeErrorPayload,
  set: ChatSet,
): void {
  set({ error: payload.message });
}

async function decryptSafely(
  ciphertext: string,
  nonce: string,
  conversation: Conversation,
): Promise<string> {
  try {
    return await decryptMessage(ciphertext, nonce, conversation);
  } catch {
    return '[Unable to decrypt message]';
  }
}

function toLocalStatus(status: EncryptedMessage['status']): LocalMessageStatus {
  if (status === 'READ') {
    return 'read';
  }
  if (status === 'DELIVERED') {
    return 'delivered';
  }

  return 'sent';
}

function appendMessage(
  messagesByConversation: Record<string, ChatMessage[]>,
  conversationId: string,
  message: ChatMessage,
): Record<string, ChatMessage[]> {
  return {
    ...messagesByConversation,
    [conversationId]: [...(messagesByConversation[conversationId] ?? []), message],
  };
}

function upsertConversation(
  conversations: Conversation[],
  conversation: Conversation,
): Conversation[] {
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index === -1) {
    return [conversation, ...conversations];
  }

  const next = [...conversations];
  next[index] = conversation;
  return next;
}

function upsertMessage(
  messagesByConversation: Record<string, ChatMessage[]>,
  conversationId: string,
  message: ChatMessage,
): Record<string, ChatMessage[]> {
  const current = messagesByConversation[conversationId] ?? [];
  const index = current.findIndex(
    (item) =>
      item.id === message.id ||
      (message.clientMessageId && item.clientMessageId === message.clientMessageId),
  );

  if (index === -1) {
    return appendMessage(messagesByConversation, conversationId, message);
  }

  const next = [...current];
  next[index] = { ...next[index], ...message };

  return {
    ...messagesByConversation,
    [conversationId]: next,
  };
}

function updateMessageStatus(
  conversationId: string,
  messageId: string,
  status: LocalMessageStatus,
  set: ChatSet,
): void {
  set((state: ChatState) => ({
    messagesByConversation: {
      ...state.messagesByConversation,
      [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((message) =>
        message.id === messageId || message.clientMessageId === messageId
          ? { ...message, status }
          : message,
      ),
    },
  }));
}
