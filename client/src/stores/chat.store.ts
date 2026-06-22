import { create } from 'zustand';
import {
  createDirectConversation,
  listConversations,
  listMessages,
  type Conversation,
  type EncryptedMessage,
  type MessageType,
} from '../api/conversations.api';
import { forwardFile, type FileMetadataResponse } from '../api/files.api';
import { getApiBaseUrl } from '../api/http';
import {
  listCachedConversations,
  listCachedMessages,
  updateCachedMessageState,
  upsertCachedConversations,
  upsertCachedMessages,
  type CachedConversationInput,
  type CachedConversationRecord,
  type CachedMessageInput,
  type CachedMessageRecord,
  type CachedMessageStatePatchInput,
} from '../api/localCache.api';
import { decryptMessage, encryptMessage, MESSAGE_ENCRYPTION_VERSION } from '../crypto/messageCrypto';
import { isNetworkRequestError } from '../utils/serverHealth';
import { useNetworkStore } from './network.store';
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
  type PresenceUpdatePayload,
  type MessageReadPayload,
  type MessageRecalledPayload,
  type RealtimeErrorPayload,
  type SessionKickedPayload,
} from '../realtime/socket';

export type LocalMessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'recalled';
const UNABLE_TO_DECRYPT_MESSAGE = '[Unable to decrypt message]';
const MESSAGE_PAGE_SIZE = 50;
const LOCAL_CLEAR_WATERMARKS_KEY = 'langram.localClearWatermarks';

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

export interface MessagePaginationState {
  hasMore: boolean;
  nextCursor: string | null;
  isLoadingOlder: boolean;
}

interface ChatState {
  conversations: Conversation[];
  selectedConversationId: string | null;
  currentUserId: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  messagePaginationByConversation: Record<string, MessagePaginationState>;
  isUsingCachedMessagesByConversation: Record<string, boolean>;
  localClearWatermarks: Record<string, string>;
  latestIncomingMessage: ChatMessage | null;
  presenceByUserId: Record<string, PresenceUpdatePayload>;
  error: string | null;
  searchQuery: string;
  isLoadingConversations: boolean;
  isUsingCachedConversations: boolean;
  isLoadingMessages: boolean;
  loadConversations: (currentUserId?: string) => Promise<void>;
  selectConversation: (conversationId: string, currentUserId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string, currentUserId: string) => Promise<boolean>;
  closeConversation: () => void;
  openDirectConversation: (friendUserId: string, currentUserId: string) => Promise<string | null>;
  connect: (accessToken: string, onSessionKicked: (payload: SessionKickedPayload) => void) => void;
  disconnect: () => void;
  sendTextMessage: (conversationId: string, plaintext: string, senderId: string) => Promise<void>;
  createFailedTextMessage: (conversationId: string, plaintext: string, senderId: string) => void;
  retryTextMessage: (conversationId: string, messageId: string) => Promise<boolean>;
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
  updatePresence: (payload: PresenceUpdatePayload) => void;
}

type ChatSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  currentUserId: null,
  messagesByConversation: {},
  messagePaginationByConversation: {},
  isUsingCachedMessagesByConversation: {},
  localClearWatermarks: loadLocalClearWatermarks(),
  latestIncomingMessage: null,
  presenceByUserId: {},
  error: null,
  searchQuery: '',
  isLoadingConversations: false,
  isUsingCachedConversations: false,
  isLoadingMessages: false,
  loadConversations: async (currentUserId) => {
    set({ isLoadingConversations: true, error: null });
    try {
      const result = await listConversations();
      const userId = currentUserId ?? get().currentUserId;
      const conversations = userId ? await enrichConversations(result.conversations) : result.conversations;
      const selectedConversationId = get().selectedConversationId;
      const selectedConversation =
        selectedConversationId && !conversations.some((item) => item.id === selectedConversationId)
          ? get().conversations.find((item) => item.id === selectedConversationId) ?? null
          : null;
      const nextConversations = selectedConversation
        ? sortConversations([selectedConversation, ...conversations])
        : conversations;
      set({
        conversations: nextConversations,
        currentUserId: userId ?? null,
        isLoadingConversations: false,
        isUsingCachedConversations: false,
      });
      void cacheConversationSummaries(nextConversations);
    } catch (error) {
      if (isNetworkRequestError(error)) {
        useNetworkStore.getState().setStatus('reconnecting');
        const userId = currentUserId ?? get().currentUserId;
        const cachedConversations = userId ? await loadCachedConversationSnapshot(userId) : [];
        if (cachedConversations.length > 0) {
          set({
            conversations: cachedConversations,
            currentUserId: userId ?? null,
            isLoadingConversations: false,
            isUsingCachedConversations: true,
          });
          return;
        }

        set({ isLoadingConversations: false });
        return;
      }

      set({ error: 'Failed to load conversations', isLoadingConversations: false });
    }
  },
  selectConversation: async (conversationId, currentUserId) => {
    set((state) => ({
      selectedConversationId: conversationId,
      currentUserId,
      conversations: clearConversationUnread(state.conversations, conversationId),
      messagePaginationByConversation: {
        ...state.messagePaginationByConversation,
        [conversationId]: { hasMore: false, nextCursor: null, isLoadingOlder: false },
      },
      isLoadingMessages: true,
      error: null,
    }));
    try {
      const result = await listMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
      const conversation = get().conversations.find((item) => item.id === conversationId);
      if (!conversation || get().selectedConversationId !== conversationId) {
        set({ isLoadingMessages: false });
        return;
      }
      void cacheEncryptedMessages(result.messages);

      const loadedMessages = await Promise.all(
        result.messages.map((message) => toChatMessage(message, conversation, currentUserId)),
      );
      const messages = filterMessagesAfterLocalClear(conversationId, loadedMessages, get().localClearWatermarks);
      const reachedLocalClear = messages.length < loadedMessages.length;
      let mergedMessages = messages;

      set((state) => {
        mergedMessages = mergeLoadedMessagesWithPendingLocal(
          messages,
          state.messagesByConversation[conversationId] ?? [],
          conversationId,
          state.localClearWatermarks,
        );

        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: mergedMessages,
          },
          messagePaginationByConversation: {
            ...state.messagePaginationByConversation,
            [conversationId]: {
              hasMore: reachedLocalClear ? false : result.hasMore,
              nextCursor: reachedLocalClear ? null : result.nextCursor,
              isLoadingOlder: false,
            },
          },
          isUsingCachedMessagesByConversation: {
            ...state.isUsingCachedMessagesByConversation,
            [conversationId]: false,
          },
          conversations: updateConversationFromMessages(state.conversations, conversationId, mergedMessages),
          isLoadingMessages: false,
        };
      });

      const lastIncoming = [...mergedMessages].reverse().find((message) => !message.isOwn);
      if (lastIncoming) {
        get().markRead(conversationId, lastIncoming.id);
      }
    } catch (error) {
      if (isNetworkRequestError(error)) {
        useNetworkStore.getState().setStatus('reconnecting');
        const conversation = get().conversations.find((item) => item.id === conversationId);
        const cachedMessages = conversation
          ? await loadCachedMessageSnapshot(
              conversationId,
              conversation,
              currentUserId,
              get().localClearWatermarks,
            )
          : [];
        if (cachedMessages.length > 0 && get().selectedConversationId === conversationId) {
          set((state) => {
            const mergedMessages = mergeLoadedMessagesWithPendingLocal(
              cachedMessages,
              state.messagesByConversation[conversationId] ?? [],
              conversationId,
              state.localClearWatermarks,
            );

            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: mergedMessages,
              },
              messagePaginationByConversation: {
                ...state.messagePaginationByConversation,
                [conversationId]: {
                  hasMore: false,
                  nextCursor: null,
                  isLoadingOlder: false,
                },
              },
              isUsingCachedMessagesByConversation: {
                ...state.isUsingCachedMessagesByConversation,
                [conversationId]: true,
              },
              conversations: updateConversationFromMessages(state.conversations, conversationId, mergedMessages),
              isLoadingMessages: false,
            };
          });
          return;
        }

        set({ isLoadingMessages: false });
        return;
      }

      set({ error: 'Failed to load messages', isLoadingMessages: false });
    }
  },
  loadOlderMessages: async (conversationId, currentUserId) => {
    const state = get();
    const pagination = state.messagePaginationByConversation[conversationId];
    if (!pagination?.hasMore || pagination.isLoadingOlder || !pagination.nextCursor) {
      return false;
    }

    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return false;
    }

    set((currentState) => ({
      messagePaginationByConversation: {
        ...currentState.messagePaginationByConversation,
        [conversationId]: {
          ...pagination,
          isLoadingOlder: true,
        },
      },
      error: null,
    }));

    try {
      const result = await listMessages(conversationId, {
        beforeMessageId: pagination.nextCursor,
        limit: MESSAGE_PAGE_SIZE,
      });
      if (get().selectedConversationId !== conversationId) {
        return false;
      }
      void cacheEncryptedMessages(result.messages);

      const loadedOlderMessages = await Promise.all(
        result.messages.map((message) => toChatMessage(message, conversation, currentUserId)),
      );
      const olderMessages = filterMessagesAfterLocalClear(
        conversationId,
        loadedOlderMessages,
        get().localClearWatermarks,
      );
      const reachedLocalClear = olderMessages.length < loadedOlderMessages.length;

      let didAddMessages = false;
      set((currentState) => {
        const currentMessages = currentState.messagesByConversation[conversationId] ?? [];
        const mergedMessages = mergeOlderMessages(olderMessages, currentMessages);
        didAddMessages = mergedMessages.length > currentMessages.length;

        return {
          messagesByConversation: {
            ...currentState.messagesByConversation,
            [conversationId]: mergedMessages,
          },
          messagePaginationByConversation: {
            ...currentState.messagePaginationByConversation,
            [conversationId]: {
              hasMore: reachedLocalClear ? false : result.hasMore,
              nextCursor: reachedLocalClear ? null : result.nextCursor,
              isLoadingOlder: false,
            },
          },
        };
      });

      return didAddMessages;
    } catch (error) {
      if (isNetworkRequestError(error)) {
        useNetworkStore.getState().setStatus('reconnecting');
        set((currentState) => ({
          messagePaginationByConversation: {
            ...currentState.messagePaginationByConversation,
            [conversationId]: {
              hasMore: currentState.messagePaginationByConversation[conversationId]?.hasMore ?? false,
              nextCursor: currentState.messagePaginationByConversation[conversationId]?.nextCursor ?? null,
              isLoadingOlder: false,
            },
          },
        }));
        return false;
      }

      set((currentState) => ({
        error: 'Failed to load messages',
        messagePaginationByConversation: {
          ...currentState.messagePaginationByConversation,
          [conversationId]: {
            hasMore: currentState.messagePaginationByConversation[conversationId]?.hasMore ?? false,
            nextCursor: currentState.messagePaginationByConversation[conversationId]?.nextCursor ?? null,
            isLoadingOlder: false,
          },
        },
      }));
      return false;
    }
  },
  closeConversation: () => {
    set({ selectedConversationId: null, isLoadingMessages: false, searchQuery: '' });
  },
  openDirectConversation: async (friendUserId, currentUserId) => {
    set({ error: null });
    try {
      const conversation = await createDirectConversation(friendUserId);
      const conversationId = conversation.id;
      let openedConversations: Conversation[] = [];
      set((state) => ({
        conversations: (openedConversations = upsertOpenedConversation(
          state.conversations,
          conversation,
        )),
        selectedConversationId: conversationId,
        currentUserId,
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: state.messagesByConversation[conversationId] ?? [],
        },
        messagePaginationByConversation: {
          ...state.messagePaginationByConversation,
          [conversationId]: state.messagePaginationByConversation[conversationId] ?? {
            hasMore: false,
            nextCursor: null,
            isLoadingOlder: false,
          },
        },
      }));
      void cacheConversationSummaries(openedConversations);
      await get().selectConversation(conversationId, currentUserId);
      let selectedConversations: Conversation[] = [];
      set((state) => ({
        conversations: (selectedConversations = upsertOpenedConversation(
          state.conversations,
          conversation,
        )),
        selectedConversationId: conversationId,
        currentUserId,
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: state.messagesByConversation[conversationId] ?? [],
        },
        messagePaginationByConversation: {
          ...state.messagePaginationByConversation,
          [conversationId]: state.messagePaginationByConversation[conversationId] ?? {
            hasMore: false,
            nextCursor: null,
            isLoadingOlder: false,
          },
        },
      }));
      void cacheConversationSummaries(selectedConversations);
      return conversationId;
    } catch {
      set({ error: 'Failed to open conversation' });
      return null;
    }
  },
  connect: (accessToken, onSessionKicked) => {
    useNetworkStore.getState().setStatus('connecting');
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
      onPresenceUpdate: (payload) => {
        get().updatePresence(payload);
      },
      onFriendRequestChanged: () => {
        window.dispatchEvent(new Event('langram:friend-request-changed'));
      },
      onSessionKicked,
      onError: (payload) => {
        handleRealtimeError(payload, set);
      },
      onConnectionStatusChange: (status) => {
        useNetworkStore.getState().setStatus(status);
      },
    });
  },
  disconnect: () => {
    disconnectRealtime();
    useNetworkStore.getState().reset();
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
  createFailedTextMessage: (conversationId, plaintext, senderId) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      set({ error: 'Conversation not found' });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const failedMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId,
      messageType: 'TEXT',
      plaintext,
      file: null,
      status: 'failed',
      createdAt,
      editedAt: null,
      recalledAt: null,
      isOwn: true,
    };

    set((state) => ({
      messagesByConversation: appendMessage(
        state.messagesByConversation,
        conversationId,
        failedMessage,
      ),
    }));
  },
  retryTextMessage: async (conversationId, messageId) => {
    if (!useNetworkStore.getState().online) {
      return false;
    }

    const conversation = get().conversations.find((item) => item.id === conversationId);
    const existing = get().messagesByConversation[conversationId]?.find(
      (message) => message.id === messageId || message.clientMessageId === messageId,
    );
    if (
      !conversation ||
      !existing ||
      !existing.isOwn ||
      existing.status !== 'failed' ||
      existing.messageType !== 'TEXT'
    ) {
      return false;
    }

    const clientMessageId = existing.clientMessageId ?? existing.id;
    const createdAt = new Date().toISOString();
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((message) =>
          message.id === existing.id || message.clientMessageId === clientMessageId
            ? {
                ...message,
                id: clientMessageId,
                clientMessageId,
                status: 'sending',
                createdAt,
              }
            : message,
        ),
      },
    }));

    try {
      const encrypted = await encryptMessage(existing.plaintext, conversation);
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
      return true;
    } catch {
      updateMessageStatus(conversationId, clientMessageId, 'failed', set);
      return false;
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

    if (isLocalPendingTextMessage(existing)) {
      updateLocalPendingTextMessage(conversationId, existing.id, newPlaintext, set);
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

    try {
      if (sourceMessage.messageType === 'TEXT') {
        await forwardTextMessage(sourceMessage, targetConversation, targetConversationId, senderId, set);
        return;
      }

      if (!sourceMessage.file) {
        set({ error: 'Forward failed' });
        return;
      }

      const clonedFile = await forwardFile(sourceMessage.file.id, targetConversationId);
      await forwardFileMessage(clonedFile, targetConversation, targetConversationId, senderId, set);
    } catch {
      set({ error: 'Forward failed' });
    }
  },
  markRead: (conversationId, messageId) => {
    set((state) => ({
      conversations: clearConversationUnread(state.conversations, conversationId),
    }));
    sendRealtimeRead({ conversationId, messageId });
  },
  recallMessage: (conversationId, messageId) => {
    sendRealtimeRecall({ conversationId, messageId });
  },
  deleteLocalMessage: (conversationId, messageId) => {
    const deletedAt = new Date().toISOString();
    void cacheMessageStatePatches([
      buildCachedMessageStatePatch(messageId, {
        updatedAt: deletedAt,
        localDeletedAt: deletedAt,
      }),
    ]);
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
    const clearedAt = new Date().toISOString();
    const cachedMessagePatches = (get().messagesByConversation[conversationId] ?? []).map(
      (message) =>
        buildCachedMessageStatePatch(message.id, {
          updatedAt: clearedAt,
          localDeletedAt: clearedAt,
        }),
    );
    const localClearWatermarks = {
      ...get().localClearWatermarks,
      [conversationId]: clearedAt,
    };
    saveLocalClearWatermarks(localClearWatermarks);
    void cacheMessageStatePatches(cachedMessagePatches);
    set((state) => ({
      localClearWatermarks,
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [],
      },
      messagePaginationByConversation: {
        ...state.messagePaginationByConversation,
        [conversationId]: { hasMore: false, nextCursor: null, isLoadingOlder: false },
      },
      isUsingCachedMessagesByConversation: {
        ...state.isUsingCachedMessagesByConversation,
        [conversationId]: false,
      },
      conversations: clearConversationUnread(state.conversations, conversationId),
    }));
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },
  updatePresence: (payload) => {
    set((state) => ({
      presenceByUserId: {
        ...state.presenceByUserId,
        [payload.userId]: payload,
      },
      conversations: state.conversations.map((conversation) =>
        updateConversationPresence(conversation, payload),
      ),
    }));
  },
}));

async function forwardTextMessage(
  sourceMessage: ChatMessage,
  targetConversation: Conversation,
  targetConversationId: string,
  senderId: string,
  set: ChatSet,
): Promise<void> {
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
  } catch (error) {
    updateMessageStatus(targetConversationId, clientMessageId, 'failed', set);
    throw error;
  }
}

async function forwardFileMessage(
  file: FileMetadataResponse,
  targetConversation: Conversation,
  targetConversationId: string,
  senderId: string,
  set: ChatSet,
): Promise<void> {
  const clientMessageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const plaintext = JSON.stringify({ caption: '', fileName: file.originalName });
  const optimisticMessage: ChatMessage = {
    id: clientMessageId,
    clientMessageId,
    conversationId: targetConversationId,
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
      targetConversationId,
      optimisticMessage,
    ),
  }));

  try {
    const encrypted = await encryptMessage(plaintext, targetConversation);
    sendRealtimeMessage({
      clientMessageId,
      conversationId: targetConversationId,
      messageType: file.kind,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      fileId: file.id,
      replyToMessageId: null,
      createdAt,
    });
  } catch (error) {
    updateMessageStatus(targetConversationId, clientMessageId, 'failed', set);
    throw error;
  }
}

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

async function loadCachedMessageSnapshot(
  conversationId: string,
  conversation: Conversation,
  currentUserId: string,
  localClearWatermarks: Record<string, string>,
): Promise<ChatMessage[]> {
  try {
    const records = await listCachedMessages({ conversationId, limit: MESSAGE_PAGE_SIZE });
    const messages = await Promise.all(
      records.map((record) => cachedMessageToChatMessage(record, conversation, currentUserId)),
    );

    return filterMessagesAfterLocalClear(
      conversationId,
      messages.filter((message): message is ChatMessage => Boolean(message)),
      localClearWatermarks,
    );
  } catch {
    return [];
  }
}

async function cachedMessageToChatMessage(
  record: CachedMessageRecord,
  conversation: Conversation,
  currentUserId: string,
): Promise<ChatMessage | null> {
  if (record.localDeletedAt || record.messageType !== 'TEXT') {
    return null;
  }

  const isRecalled = Boolean(record.recalledAt) || record.status === 'RECALLED';
  if (
    !isRecalled &&
    (!record.ciphertext ||
      !record.nonce ||
      record.encryptionVersion !== MESSAGE_ENCRYPTION_VERSION)
  ) {
    return null;
  }
  const ciphertext = record.ciphertext ?? '';
  const nonce = record.nonce ?? '';
  const status = toCachedLocalStatus(record);
  if (!status) {
    return null;
  }

  return {
    id: record.id,
    clientMessageId: record.clientMessageId ?? undefined,
    conversationId: record.conversationId,
    senderId: record.senderId,
    messageType: 'TEXT',
    plaintext: isRecalled ? '' : await decryptSafely(ciphertext, nonce, conversation),
    file: null,
    status,
    createdAt: record.createdAt,
    editedAt: record.editedAt,
    recalledAt: record.recalledAt,
    isOwn: record.senderId === currentUserId,
  };
}

async function enrichConversations(conversations: Conversation[]): Promise<Conversation[]> {
  const enriched = await Promise.all(
    conversations.map(async (conversation) => {
      if (!conversation.lastMessage) {
        return conversation;
      }

      return {
        ...conversation,
        ...(await buildLastMessagePreview(conversation, conversation.lastMessage)),
      };
    }),
  );

  return sortConversations(enriched);
}

async function buildLastMessagePreview(
  conversation: Conversation,
  message: EncryptedMessage,
): Promise<Pick<Conversation, 'lastMessagePlaintext' | 'lastMessageDecryptionFailed'>> {
  if (message.status === 'RECALLED') {
    return { lastMessagePlaintext: null, lastMessageDecryptionFailed: false };
  }

  if (message.messageType !== 'TEXT') {
    return { lastMessagePlaintext: null, lastMessageDecryptionFailed: false };
  }

  const plaintext = await decryptSafely(message.ciphertext, message.nonce, conversation);
  return {
    lastMessagePlaintext: plaintext,
    lastMessageDecryptionFailed: plaintext === UNABLE_TO_DECRYPT_MESSAGE,
  };
}

function updateConversationForIncomingMessage(
  conversations: Conversation[],
  payload: MessageNewPayload,
  message: ChatMessage,
  selectedConversationId: string | null,
  currentUserId: string | null,
): Conversation[] {
  return sortConversations(
    conversations.map((conversation) => {
      if (conversation.id !== payload.conversationId) {
        return conversation;
      }

      const shouldCountUnread =
        payload.senderId !== currentUserId && selectedConversationId !== payload.conversationId;

      return {
        ...conversation,
        lastMessage: messagePayloadToEncryptedMessage(payload),
        lastMessageAt: payload.createdAt,
        lastMessagePlaintext:
          message.status === 'recalled' || message.messageType !== 'TEXT' ? null : message.plaintext,
        lastMessageDecryptionFailed: message.plaintext === UNABLE_TO_DECRYPT_MESSAGE,
        unreadCount: shouldCountUnread ? conversation.unreadCount + 1 : 0,
        updatedAt: payload.createdAt,
      };
    }),
  );
}

function updateConversationFromMessages(
  conversations: Conversation[],
  conversationId: string,
  messages: ChatMessage[],
): Conversation[] {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return conversations;
  }

  return sortConversations(
    conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            lastMessageAt: lastMessage.createdAt,
            lastMessagePlaintext:
              lastMessage.status === 'recalled' || lastMessage.messageType !== 'TEXT'
                ? null
                : lastMessage.plaintext,
            lastMessageDecryptionFailed: lastMessage.plaintext === UNABLE_TO_DECRYPT_MESSAGE,
          }
        : conversation,
    ),
  );
}

function messagePayloadToEncryptedMessage(payload: MessageNewPayload): EncryptedMessage {
  return {
    id: payload.messageId,
    conversationId: payload.conversationId,
    senderId: payload.senderId,
    messageType: payload.messageType,
    ciphertext: payload.ciphertext,
    encryptionVersion: payload.encryptionVersion,
    nonce: payload.nonce,
    replyToMessageId: payload.replyToMessageId,
    status: payload.status,
    file: payload.file,
    editedAt: null,
    recalledAt: null,
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
  };
}

function clearConversationUnread(
  conversations: Conversation[],
  conversationId: string,
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
  );
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.lastMessageAt ?? right.updatedAt).getTime() -
      new Date(left.lastMessageAt ?? left.updatedAt).getTime(),
  );
}

async function loadCachedConversationSnapshot(currentUserId: string): Promise<Conversation[]> {
  try {
    const records = await listCachedConversations();
    return sortConversations(
      records
        .map((record) => cachedConversationToConversation(record, currentUserId))
        .filter((conversation): conversation is Conversation => Boolean(conversation)),
    );
  } catch {
    return [];
  }
}

function cachedConversationToConversation(
  record: CachedConversationRecord,
  currentUserId: string,
): Conversation | null {
  if (record.conversationType !== 'DIRECT' || !record.peerUserId || !currentUserId) {
    return null;
  }

  const peer = buildCachedConversationUser({
    id: record.peerUserId,
    displayName: record.title?.trim() || record.peerUserId,
    avatarUrl: record.avatarUrl,
  });
  const currentUser = buildCachedConversationUser({
    id: currentUserId,
    displayName: currentUserId,
    avatarUrl: null,
  });
  const createdAt = record.lastMessageAt ?? record.updatedAt;

  return {
    id: record.id,
    type: 'DIRECT',
    peer,
    members: [currentUser, peer],
    lastMessage: null,
    lastMessageAt: record.lastMessageAt,
    unreadCount: 0,
    lastMessagePlaintext: null,
    lastMessageDecryptionFailed: false,
    createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildCachedConversationUser({
  id,
  displayName,
  avatarUrl,
}: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}): NonNullable<Conversation['peer']> {
  return {
    id,
    email: null,
    displayName,
    statusMessage: null,
    avatarUrl,
    accountType: 'cached',
    isOnline: false,
    lastSeenAt: null,
  };
}

async function cacheConversationSummaries(conversations: Conversation[]): Promise<void> {
  try {
    await upsertCachedConversations(conversations.map(toCachedConversationInput));
  } catch {
    // Local cache writes are best-effort and must not affect REST-backed chat state.
  }
}

function toCachedConversationInput(conversation: Conversation): CachedConversationInput {
  return {
    id: conversation.id,
    conversationType: conversation.type,
    peerUserId: conversation.peer?.id ?? null,
    title: conversation.peer?.displayName ?? null,
    avatarUrl: conversation.peer?.avatarUrl ?? null,
    lastMessageId: conversation.lastMessage?.id ?? null,
    lastMessageAt: conversation.lastMessageAt ?? conversation.lastMessage?.createdAt ?? null,
    updatedAt: conversation.updatedAt,
  };
}

async function cacheEncryptedMessages(messages: EncryptedMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  try {
    await upsertCachedMessages(messages.map(toCachedMessageInput));
  } catch {
    // Local cache writes are best-effort and must not affect REST-backed chat state.
  }
}

async function cacheRealtimeMessage(payload: MessageNewPayload): Promise<void> {
  try {
    await upsertCachedMessages([realtimePayloadToCachedMessageInput(payload)]);
  } catch {
    // Local cache writes are best-effort and must not affect realtime chat state.
  }
}

async function cacheMessageStatePatches(
  patches: CachedMessageStatePatchInput[],
): Promise<void> {
  if (patches.length === 0) {
    return;
  }

  try {
    await updateCachedMessageState(patches);
  } catch {
    // Local cache writes are best-effort and must not affect chat state.
  }
}

function toCachedMessageInput(message: EncryptedMessage): CachedMessageInput {
  return {
    id: message.id,
    clientMessageId: null,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    status: message.status,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    encryptionVersion: message.encryptionVersion,
    metadataJson: null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    deliveredAt: null,
    readAt: null,
    editedAt: message.editedAt,
    recalledAt: message.recalledAt,
    localDeletedAt: null,
  };
}

function realtimePayloadToCachedMessageInput(payload: MessageNewPayload): CachedMessageInput {
  return {
    id: payload.messageId,
    clientMessageId: payload.clientMessageId ?? null,
    conversationId: payload.conversationId,
    senderId: payload.senderId,
    messageType: payload.messageType,
    status: payload.status,
    ciphertext: payload.ciphertext,
    nonce: payload.nonce,
    encryptionVersion: payload.encryptionVersion,
    metadataJson: null,
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
    deliveredAt: null,
    readAt: null,
    editedAt: null,
    recalledAt: null,
    localDeletedAt: null,
  };
}

function buildCachedMessageStatePatch(
  id: string,
  patch: {
    status?: string;
    ciphertext?: string;
    nonce?: string;
    encryptionVersion?: string;
    updatedAt: string;
    deliveredAt?: string;
    readAt?: string;
    editedAt?: string;
    recalledAt?: string;
    localDeletedAt?: string;
  },
): CachedMessageStatePatchInput {
  return {
    id,
    status: patch.status ?? null,
    ciphertext: patch.ciphertext ?? null,
    nonce: patch.nonce ?? null,
    encryptionVersion: patch.encryptionVersion ?? null,
    updatedAt: patch.updatedAt,
    deliveredAt: patch.deliveredAt ?? null,
    readAt: patch.readAt ?? null,
    editedAt: patch.editedAt ?? null,
    recalledAt: patch.recalledAt ?? null,
    localDeletedAt: patch.localDeletedAt ?? null,
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
    void cacheRealtimeMessage(payload);
    await state.loadConversations(state.currentUserId ?? undefined);
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
    isOwn: matched?.isOwn ?? payload.senderId === state.currentUserId,
  };
  if (isMessageClearedLocally(payload.conversationId, message.createdAt, state.localClearWatermarks)) {
    return;
  }
  void cacheRealtimeMessage(payload);

  set((currentState: ChatState) => ({
    messagesByConversation: upsertMessage(
      currentState.messagesByConversation,
      payload.conversationId,
      message,
    ),
    conversations: updateConversationForIncomingMessage(
      currentState.conversations,
      payload,
      message,
      currentState.selectedConversationId,
      currentState.currentUserId,
    ),
    latestIncomingMessage: !message.isOwn ? message : currentState.latestIncomingMessage,
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
  void cacheMessageStatePatches([
    buildCachedMessageStatePatch(payload.messageId, {
      status: 'DELIVERED',
      updatedAt: payload.deliveredAt,
      deliveredAt: payload.deliveredAt,
    }),
  ]);
}

function handleRead(
  payload: MessageReadPayload,
  set: ChatSet,
): void {
  set((state: ChatState) => {
    if (payload.readerId === state.currentUserId) {
      return { conversations: clearConversationUnread(state.conversations, payload.conversationId) };
    }

    return {
      messagesByConversation: markOwnMessagesReadThrough(
        state.messagesByConversation,
        payload.conversationId,
        payload.messageId,
      ),
    };
  });
  void cacheMessageStatePatches([
    buildCachedMessageStatePatch(payload.messageId, {
      status: 'READ',
      updatedAt: payload.readAt,
      readAt: payload.readAt,
    }),
  ]);
}

function handleRecalled(
  payload: MessageRecalledPayload,
  set: ChatSet,
): void {
  void cacheMessageStatePatches([
    buildCachedMessageStatePatch(payload.messageId, {
      status: 'RECALLED',
      updatedAt: payload.recalledAt,
      recalledAt: payload.recalledAt,
    }),
  ]);
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
    conversations: state.conversations.map((conversation) =>
      conversation.id === payload.conversationId &&
      conversation.lastMessage?.id === payload.messageId
        ? {
            ...conversation,
            lastMessage: {
              ...conversation.lastMessage,
              status: 'RECALLED',
              recalledAt: payload.recalledAt,
            },
            lastMessagePlaintext: null,
            lastMessageDecryptionFailed: false,
          }
        : conversation,
    ),
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
    await state.loadConversations(state.currentUserId ?? undefined);
    return;
  }

  const plaintext = await decryptSafely(payload.ciphertext, payload.nonce, conversation);
  void cacheMessageStatePatches([
    buildCachedMessageStatePatch(payload.messageId, {
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      encryptionVersion: payload.encryptionVersion,
      updatedAt: payload.editedAt,
      editedAt: payload.editedAt,
    }),
  ]);
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
    conversations: currentState.conversations.map((item) =>
      item.id === payload.conversationId && item.lastMessage?.id === payload.messageId
        ? {
            ...item,
            lastMessage: {
              ...item.lastMessage,
              ciphertext: payload.ciphertext,
              nonce: payload.nonce,
              encryptionVersion: payload.encryptionVersion,
              editedAt: payload.editedAt,
            },
            lastMessagePlaintext: plaintext,
            lastMessageDecryptionFailed: plaintext === '[Unable to decrypt message]',
          }
        : item,
    ),
  }));
}

function handleRealtimeError(
  payload: RealtimeErrorPayload,
  set: ChatSet,
): void {
  if (payload.code === 'WS_CONNECT_ERROR') {
    return;
  }

  if (payload.code === 'FRIENDSHIP_REQUIRED' || payload.message === 'FRIENDSHIP_REQUIRED') {
    set((state: ChatState) => ({
      error: 'FRIENDSHIP_REQUIRED',
      messagesByConversation: markOwnSendingMessagesFailed(state.messagesByConversation),
    }));
    return;
  }

  set({ error: payload.message });
}

function markOwnSendingMessagesFailed(
  messagesByConversation: Record<string, ChatMessage[]>,
): Record<string, ChatMessage[]> {
  let didChange = false;
  const nextMessagesByConversation: Record<string, ChatMessage[]> = {};

  for (const [conversationId, messages] of Object.entries(messagesByConversation)) {
    nextMessagesByConversation[conversationId] = messages.map((message) => {
      if (!message.isOwn || message.status !== 'sending') {
        return message;
      }

      didChange = true;
      return { ...message, status: 'failed' };
    });
  }

  return didChange ? nextMessagesByConversation : messagesByConversation;
}

async function decryptSafely(
  ciphertext: string,
  nonce: string,
  conversation: Conversation,
): Promise<string> {
  try {
    return await decryptMessage(ciphertext, nonce, conversation);
  } catch {
    return UNABLE_TO_DECRYPT_MESSAGE;
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

function toCachedLocalStatus(record: CachedMessageRecord): LocalMessageStatus | null {
  if (record.recalledAt || record.status === 'RECALLED') {
    return 'recalled';
  }
  if (record.readAt || record.status === 'READ') {
    return 'read';
  }
  if (record.deliveredAt || record.status === 'DELIVERED') {
    return 'delivered';
  }
  if (record.status !== 'SENT') {
    return null;
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

function isLocalPendingTextMessage(message: ChatMessage): boolean {
  return (
    message.isOwn &&
    message.messageType === 'TEXT' &&
    Boolean(message.clientMessageId) &&
    (message.status === 'failed' || message.status === 'sending')
  );
}

function updateLocalPendingTextMessage(
  conversationId: string,
  messageId: string,
  plaintext: string,
  set: ChatSet,
): void {
  set((state: ChatState) => {
    const messages = (state.messagesByConversation[conversationId] ?? []).map((message) =>
      message.id === messageId || message.clientMessageId === messageId
        ? {
            ...message,
            plaintext,
            editedAt: new Date().toISOString(),
          }
        : message,
    );

    return {
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: messages,
      },
      conversations: updateConversationFromMessages(state.conversations, conversationId, messages),
    };
  });
}

function filterMessagesAfterLocalClear(
  conversationId: string,
  messages: ChatMessage[],
  localClearWatermarks: Record<string, string>,
): ChatMessage[] {
  return messages.filter((message) =>
    !isMessageClearedLocally(conversationId, message.createdAt, localClearWatermarks),
  );
}

function isMessageClearedLocally(
  conversationId: string,
  createdAt: string,
  localClearWatermarks: Record<string, string>,
): boolean {
  const clearedAt = localClearWatermarks[conversationId];
  if (!clearedAt) {
    return false;
  }

  return new Date(createdAt).getTime() <= new Date(clearedAt).getTime();
}

function loadLocalClearWatermarks(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_CLEAR_WATERMARKS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string' &&
          !Number.isNaN(new Date(entry[1]).getTime()),
      ),
    );
  } catch {
    return {};
  }
}

function saveLocalClearWatermarks(localClearWatermarks: Record<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_CLEAR_WATERMARKS_KEY, JSON.stringify(localClearWatermarks));
  } catch {
    // Local clear remains effective for the current runtime state if persistence is unavailable.
  }
}

function mergeOlderMessages(
  olderMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  const currentIds = new Set(
    currentMessages.flatMap((message) =>
      message.clientMessageId ? [message.id, message.clientMessageId] : [message.id],
    ),
  );
  const uniqueOlderMessages = olderMessages.filter(
    (message) => !currentIds.has(message.id) && !currentIds.has(message.clientMessageId ?? ''),
  );

  return [...uniqueOlderMessages, ...currentMessages];
}

function mergeLoadedMessagesWithPendingLocal(
  loadedMessages: ChatMessage[],
  currentMessages: ChatMessage[],
  conversationId: string,
  localClearWatermarks: Record<string, string>,
): ChatMessage[] {
  const loadedIds = new Set(
    loadedMessages.flatMap((message) =>
      message.clientMessageId ? [message.id, message.clientMessageId] : [message.id],
    ),
  );
  const pendingLocalMessages = currentMessages.filter((message) => {
    if (
      !message.isOwn ||
      message.conversationId !== conversationId ||
      message.messageType !== 'TEXT' ||
      (message.status !== 'failed' && message.status !== 'sending') ||
      !message.clientMessageId ||
      !message.plaintext
    ) {
      return false;
    }

    if (isMessageClearedLocally(conversationId, message.createdAt, localClearWatermarks)) {
      return false;
    }

    return !loadedIds.has(message.id) && !loadedIds.has(message.clientMessageId);
  });

  if (pendingLocalMessages.length === 0) {
    return loadedMessages;
  }

  return [...loadedMessages, ...pendingLocalMessages].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
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

function upsertOpenedConversation(
  conversations: Conversation[],
  conversation: Conversation,
): Conversation[] {
  const existing = conversations.find((item) => item.id === conversation.id);
  if (!existing) {
    return upsertConversation(conversations, conversation);
  }

  return upsertConversation(conversations, {
    ...existing,
    ...conversation,
    lastMessage: conversation.lastMessage ?? existing.lastMessage,
    lastMessageAt: conversation.lastMessageAt ?? existing.lastMessageAt,
    lastMessagePlaintext: conversation.lastMessagePlaintext ?? existing.lastMessagePlaintext,
    lastMessageDecryptionFailed:
      conversation.lastMessageDecryptionFailed ?? existing.lastMessageDecryptionFailed,
  });
}

function updateConversationPresence(
  conversation: Conversation,
  payload: PresenceUpdatePayload,
): Conversation {
  return {
    ...conversation,
    peer:
      conversation.peer?.id === payload.userId
        ? {
            ...conversation.peer,
            isOnline: payload.isOnline,
            lastSeenAt: payload.lastSeenAt,
          }
        : conversation.peer,
    members: conversation.members.map((member) =>
      member.id === payload.userId
        ? {
            ...member,
            isOnline: payload.isOnline,
            lastSeenAt: payload.lastSeenAt,
          }
        : member,
    ),
  };
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

function markOwnMessagesReadThrough(
  messagesByConversation: Record<string, ChatMessage[]>,
  conversationId: string,
  messageId: string,
): Record<string, ChatMessage[]> {
  const messages = messagesByConversation[conversationId] ?? [];
  const readMessage = messages.find(
    (message) => message.id === messageId || message.clientMessageId === messageId,
  );
  if (!readMessage) {
    return {
      ...messagesByConversation,
      [conversationId]: messages.map((message) =>
        message.id === messageId || message.clientMessageId === messageId
          ? { ...message, status: message.status === 'recalled' ? 'recalled' : 'read' }
          : message,
      ),
    };
  }

  const readThroughTime = new Date(readMessage.createdAt).getTime();
  return {
    ...messagesByConversation,
    [conversationId]: messages.map((message) => {
      if (!message.isOwn || message.status === 'recalled') {
        return message;
      }

      return new Date(message.createdAt).getTime() <= readThroughTime
        ? { ...message, status: 'read' }
        : message;
    }),
  };
}
