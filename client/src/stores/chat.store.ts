import { create } from 'zustand';
import {
  createDirectConversation,
  listConversations,
  listMessages,
  type Conversation,
  type EncryptedMessage,
  type MessageType,
} from '../api/conversations.api';
import type { FileMetadataResponse } from '../api/files.api';
import { getApiBaseUrl } from '../api/http';
import { decryptMessage, encryptMessage } from '../crypto/messageCrypto';
import {
  connectRealtime,
  disconnectRealtime,
  sendRealtimeEdit,
  sendRealtimeMessage,
  sendRealtimeRead,
  sendRealtimeRecall,
  type MessageDeliveredPayload,
  type MessageEditedPayload,
  type MessageNewPayload,
  type MessageReadPayload,
  type MessageRecalledPayload,
  type RealtimeErrorPayload,
} from '../realtime/socket';

export type LocalMessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'recalled';

export interface ChatMessage {
  id: string;
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  plaintext: string;
  file: FileMetadataResponse | null;
  status: LocalMessageStatus;
  createdAt: string;
  editedAt: string | null;
  recalledAt: string | null;
  isOwn: boolean;
}

interface ChatState {
  conversations: Conversation[];
  selectedConversationId: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  error: string | null;
  searchQuery: string;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  loadConversations: () => Promise<void>;
  selectConversation: (conversationId: string, currentUserId: string) => Promise<void>;
  openDirectConversation: (friendUserId: string, currentUserId: string) => Promise<string | null>;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  sendTextMessage: (conversationId: string, plaintext: string, senderId: string) => Promise<void>;
  sendFileMessage: (
    conversationId: string,
    file: FileMetadataResponse,
    senderId: string,
  ) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, newPlaintext: string) => Promise<void>;
  forwardMessage: (
    sourceConversationId: string,
    sourceMessageId: string,
    targetConversationId: string,
  ) => Promise<void>;
  recallMessage: (conversationId: string, messageId: string) => void;
  markRead: (conversationId: string, messageId: string) => void;
  deleteLocalMessage: (conversationId: string, messageId: string) => void;
  clearLocalConversation: (conversationId: string) => void;
  setSearchQuery: (query: string) => void;
}

type ChatSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messagesByConversation: {},
  error: null,
  searchQuery: '',
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
      return conversation.id;
    } catch {
      set({ error: 'Failed to open conversation' });
      return null;
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
      onMessageRecalled: (payload) => {
        handleRecalled(payload, set);
      },
      onMessageEdited: (payload) => {
        void handleEdited(payload, get, set);
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
      messageType: 'TEXT',
      plaintext,
      file: null,
      status: 'sending',
      createdAt,
      editedAt: null,
      recalledAt: null,
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
        fileId: null,
        replyToMessageId: null,
        createdAt,
      });
    } catch {
      updateMessageStatus(conversationId, clientMessageId, 'failed', set);
    }
  },
  sendFileMessage: async (conversationId, file, senderId) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      set({ error: 'Conversation not found' });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const plaintext = JSON.stringify({ caption: '', fileName: file.originalName });
    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId,
      messageType: file.kind,
      plaintext,
      file,
      status: 'sending',
      createdAt,
      editedAt: null,
      recalledAt: null,
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
        messageType: file.kind,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
        fileId: file.id,
        replyToMessageId: null,
        createdAt,
      });
    } catch {
      updateMessageStatus(conversationId, clientMessageId, 'failed', set);
      set({ error: 'File message failed' });
    }
  },
  editMessage: async (conversationId, messageId, newPlaintext) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      set({ error: 'Conversation not found' });
      return;
    }

    const existing = get().messagesByConversation[conversationId]?.find(
      (message) => message.id === messageId || message.clientMessageId === messageId,
    );
    if (!existing || existing.status === 'recalled') {
      set({ error: 'Edit failed' });
      return;
    }

    try {
      const encrypted = await encryptMessage(newPlaintext, conversation);
      sendRealtimeEdit({
        conversationId,
        messageId: existing.id,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
      });
    } catch {
      set({ error: 'Edit failed' });
    }
  },
  forwardMessage: async (sourceConversationId, sourceMessageId, targetConversationId) => {
    const sourceMessage = get().messagesByConversation[sourceConversationId]?.find(
      (message) => message.id === sourceMessageId || message.clientMessageId === sourceMessageId,
    );
    if (!sourceMessage) {
      set({ error: 'Forward failed' });
      return;
    }

    if (sourceMessage.status === 'recalled') {
      set({ error: 'Cannot forward recalled messages' });
      return;
    }

    const targetConversation = get().conversations.find((item) => item.id === targetConversationId);
    if (!targetConversation) {
      set({ error: 'Forward failed' });
      return;
    }

    const senderId = getCurrentUserId(targetConversation);
    if (!senderId) {
      set({ error: 'Forward failed' });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId: targetConversationId,
      senderId,
      messageType: 'TEXT',
      plaintext: sourceMessage.plaintext,
      file: null,
      status: 'sending',
      createdAt,
      editedAt: null,
      recalledAt: null,
      isOwn: true,
    };

    set((state) => ({
      messagesByConversation: appendMessage(
        state.messagesByConversation,
        targetConversationId,
        optimisticMessage,
      ),
    }));

    try {
      const encrypted = await encryptMessage(sourceMessage.plaintext, targetConversation);
      sendRealtimeMessage({
        clientMessageId,
        conversationId: targetConversationId,
        messageType: 'TEXT',
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
        fileId: null,
        replyToMessageId: null,
        createdAt,
      });
    } catch {
      updateMessageStatus(targetConversationId, clientMessageId, 'failed', set);
      set({ error: 'Forward failed' });
    }
  },
  markRead: (conversationId, messageId) => {
    sendRealtimeRead({ conversationId, messageId });
  },
  recallMessage: (conversationId, messageId) => {
    sendRealtimeRecall({ conversationId, messageId });
  },
  deleteLocalMessage: (conversationId, messageId) => {
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).filter(
          (message) => message.id !== messageId && message.clientMessageId !== messageId,
        ),
      },
    }));
  },
  clearLocalConversation: (conversationId) => {
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [],
      },
    }));
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },
}));

async function toChatMessage(
  message: EncryptedMessage,
  conversation: Conversation,
  currentUserId: string,
): Promise<ChatMessage> {
  const isRecalled = message.status === 'RECALLED';
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    plaintext: isRecalled ? '' : await decryptSafely(message.ciphertext, message.nonce, conversation),
    file: message.file,
    status: toLocalStatus(message.status),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    recalledAt: message.recalledAt,
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
    messageType: payload.messageType,
    plaintext,
    file: payload.file,
    status: matched?.isOwn ? 'sent' : toLocalStatus(payload.status),
    createdAt: payload.createdAt,
    editedAt: null,
    recalledAt: null,
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

function handleRecalled(
  payload: MessageRecalledPayload,
  set: ChatSet,
): void {
  set((state: ChatState) => ({
    messagesByConversation: {
      ...state.messagesByConversation,
      [payload.conversationId]: (state.messagesByConversation[payload.conversationId] ?? []).map(
        (message) =>
          message.id === payload.messageId || message.clientMessageId === payload.messageId
            ? {
                ...message,
                plaintext: '',
                status: 'recalled',
                recalledAt: payload.recalledAt,
              }
            : message,
      ),
    },
  }));
}

async function handleEdited(
  payload: MessageEditedPayload,
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
  set((currentState: ChatState) => ({
    messagesByConversation: {
      ...currentState.messagesByConversation,
      [payload.conversationId]: (currentState.messagesByConversation[payload.conversationId] ?? []).map(
        (message) =>
          message.id === payload.messageId || message.clientMessageId === payload.messageId
            ? {
                ...message,
                id: payload.messageId,
                senderId: payload.senderId,
                plaintext,
                editedAt: payload.editedAt,
              }
            : message,
      ),
    },
  }));
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
  if (status === 'RECALLED') {
    return 'recalled';
  }
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

function getCurrentUserId(conversation: Conversation): string | null {
  const peerId = conversation.peer?.id;
  return conversation.members.find((member) => member.id !== peerId)?.id ?? null;
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
