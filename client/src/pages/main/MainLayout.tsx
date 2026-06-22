import {
  ChangeEvent,
  Fragment,
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { Conversation } from '../../api/conversations.api';
import {
  downloadFile,
  uploadFile,
  type FileKind,
  type FileMetadataResponse,
} from '../../api/files.api';
import { saveDownloadedFile, upsertLocalFileRecord } from '../../api/localFiles.api';
import { logout as requestLogout } from '../../api/auth.api';
import { deleteFriend, listFriendRequests, listFriends, type FriendItem } from '../../api/friends.api';
import { AppLogo } from '../../components/AppLogo';
import { UserAvatar } from '../../components/UserAvatar';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore, type ChatMessage } from '../../stores/chat.store';
import { useNetworkStore, type NetworkStatus } from '../../stores/network.store';
import { useSettingsStore, type SendShortcutPreference } from '../../stores/settings.store';
import {
  CONVERSATION_SEARCH_OPEN_EVENT,
  CONVERSATION_SEARCH_READY_EVENT,
  type ConversationSearchMessage,
  type ConversationSearchPayload,
} from './ConversationSearchWindow';
import {
  loadConversationUiState,
  saveConversationUiState,
  unhideConversationInUiState,
  type ConversationUiState,
} from '../../utils/conversationUiState';
import {
  debugNotificationDiagnostic,
  focusMainWindow,
  showDesktopNotification,
} from '../../utils/desktopNotification';
import { isCompressibleImage, prepareImageUploadFile } from '../../utils/imageCompression';
import { FriendDeleteConfirmDialog, FriendsWorkspace } from './FriendsPage';

const EMPTY_SEARCH_MATCH_IDS = new Set<string>();
const EMPTY_CONVERSATION_IDS: string[] = [];

function useDismissOnOutsideOrEscape<T extends HTMLElement>(
  isOpen: boolean,
  layerRef: RefObject<T | null>,
  setIsOpen: (isOpen: boolean) => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (layerRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, layerRef, setIsOpen]);
}

export function MainLayout(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const notifySessionReplaced = useAuthStore((state) => state.notifySessionReplaced);
  const clearSession = useAuthStore((state) => state.clearSession);
  const conversations = useChatStore((state) => state.conversations);
  const selectedConversationId = useChatStore((state) => state.selectedConversationId);
  const messagesByConversation = useChatStore((state) => state.messagesByConversation);
  const latestIncomingMessage = useChatStore((state) => state.latestIncomingMessage);
  const messagePaginationByConversation = useChatStore(
    (state) => state.messagePaginationByConversation,
  );
  const presenceByUserId = useChatStore((state) => state.presenceByUserId);
  const chatError = useChatStore((state) => state.error);
  const networkStatus = useNetworkStore((state) => state.status);
  const networkLastChangedAt = useNetworkStore((state) => state.lastChangedAt);
  const isNetworkOnline = useNetworkStore((state) => state.online);
  const isLoadingConversations = useChatStore((state) => state.isLoadingConversations);
  const isUsingCachedConversations = useChatStore((state) => state.isUsingCachedConversations);
  const isUsingCachedMessagesByConversation = useChatStore(
    (state) => state.isUsingCachedMessagesByConversation,
  );
  const isLoadingMessages = useChatStore((state) => state.isLoadingMessages);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const loadOlderMessages = useChatStore((state) => state.loadOlderMessages);
  const closeConversation = useChatStore((state) => state.closeConversation);
  const openDirectConversation = useChatStore((state) => state.openDirectConversation);
  const connect = useChatStore((state) => state.connect);
  const disconnect = useChatStore((state) => state.disconnect);
  const markRead = useChatStore((state) => state.markRead);
  const sendTextMessage = useChatStore((state) => state.sendTextMessage);
  const createFailedTextMessage = useChatStore((state) => state.createFailedTextMessage);
  const retryTextMessage = useChatStore((state) => state.retryTextMessage);
  const sendFileMessage = useChatStore((state) => state.sendFileMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const forwardMessage = useChatStore((state) => state.forwardMessage);
  const recallMessage = useChatStore((state) => state.recallMessage);
  const deleteLocalMessage = useChatStore((state) => state.deleteLocalMessage);
  const clearLocalConversation = useChatStore((state) => state.clearLocalConversation);
  const localClearWatermarks = useChatStore((state) => state.localClearWatermarks);
  const settingsConfig = useSettingsStore((state) => state.config);
  const enableNotifications = settingsConfig?.enableNotifications ?? true;
  const sendShortcut = useSettingsStore((state) => state.config?.sendShortcut ?? 'enter');
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [hasLoadedFriends, setHasLoadedFriends] = useState(false);
  const [trustedFriendPeerId, setTrustedFriendPeerId] = useState<string | null>(null);
  const [pendingFriendRequestCount, setPendingFriendRequestCount] = useState(0);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageLimitNotice, setMessageLimitNotice] = useState<string | null>(null);
  const [reconnectedNoticeVisible, setReconnectedNoticeVisible] = useState(false);
  const [uploadState, setUploadState] = useState<FileUploadState>({
    isUploading: false,
    notice: null,
    error: null,
  });
  const [activeView, setActiveView] = useState<MainView>('messages');
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [isChatActionsOpen, setIsChatActionsOpen] = useState(false);
  const [isSendShortcutMenuOpen, setIsSendShortcutMenuOpen] = useState(false);
  const [isEmojiPanelOpen, setIsEmojiPanelOpen] = useState(false);
  const [downloadStates, setDownloadStates] = useState<Record<string, FileDownloadStatus>>({});
  const [downloadSuccessNotice, setDownloadSuccessNotice] =
    useState<DownloadSuccessNotice | null>(null);
  const [conversationUiState, setConversationUiState] = useState<ConversationUiState>(() =>
    loadConversationUiState(),
  );
  const [readConversationOverrides, setReadConversationOverrides] = useState<Record<string, string>>({});
  const [conversationContextMenu, setConversationContextMenu] =
    useState<ConversationContextMenuState | null>(null);
  const [pendingConversationActivationId, setPendingConversationActivationId] = useState<string | null>(null);
  const [pendingDeleteFriend, setPendingDeleteFriend] = useState<PendingFriendDelete | null>(null);
  const [isDeletingFriend, setIsDeletingFriend] = useState(false);
  const [pageAttentionKey, setPageAttentionKey] = useState(0);
  const appMenuRef = useRef<HTMLDivElement>(null);
  const chatActionsRef = useRef<HTMLDivElement>(null);
  const sendShortcutRef = useRef<HTMLDivElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isMessageComposingRef = useRef(false);
  const lastNotificationMessageRef = useRef<string | null>(null);
  const hasRequestedNotificationPermissionRef = useRef(false);
  const hasSeenOnlineRef = useRef(false);
  const previousNetworkStatusRef = useRef<NetworkStatus>(networkStatus);
  const hasObservedOnlineForSyncRef = useRef(networkStatus === 'online');
  const previousNetworkStatusForSyncRef = useRef<NetworkStatus>(networkStatus);
  const lastSyncedNetworkChangedAtRef = useRef<string | null>(null);
  const pendingActivationInFlightRef = useRef<string | null>(null);

  useDismissOnOutsideOrEscape(isAppMenuOpen, appMenuRef, setIsAppMenuOpen);
  useDismissOnOutsideOrEscape(isChatActionsOpen, chatActionsRef, setIsChatActionsOpen);
  useDismissOnOutsideOrEscape(isSendShortcutMenuOpen, sendShortcutRef, setIsSendShortcutMenuOpen);
  useDismissOnOutsideOrEscape(isEmojiPanelOpen, emojiPanelRef, setIsEmojiPanelOpen);

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null;
  const isUsingCachedMessages = selectedConversationId
    ? isUsingCachedMessagesByConversation[selectedConversationId] ?? false
    : false;
  const profileUser = selectedConversation?.peer ?? user ?? null;
  const profilePresence = !isNetworkOnline
    ? t('presence.offline')
    : selectedConversation?.peer
    ? formatPresence(selectedConversation.peer.isOnline, selectedConversation.peer.lastSeenAt, t)
    : t('presence.online');
  const isFriendshipRequiredError = chatError === 'FRIENDSHIP_REQUIRED' || chatError === 'NOT_FRIENDS';
  const isSelectedPeerKnownNonFriend =
    selectedConversation?.peer
      ? isPeerKnownNonFriend(selectedConversation.peer.id, friends, hasLoadedFriends, trustedFriendPeerId)
      : false;
  const chatTopNotice =
    selectedConversation && (isFriendshipRequiredError || isSelectedPeerKnownNonFriend)
      ? t('chat.notFriendsCannotSend')
      : null;
  const visibleChatError = isFriendshipRequiredError ? null : chatError;
  const messages = useMemo(
    () => (selectedConversationId ? messagesByConversation[selectedConversationId] ?? [] : []),
    [messagesByConversation, selectedConversationId],
  );
  const selectedMessagePagination = selectedConversationId
    ? messagePaginationByConversation[selectedConversationId] ?? null
    : null;
  const pinnedConversationIds = settingsConfig?.pinnedConversationIds ?? EMPTY_CONVERSATION_IDS;
  const mutedConversationIds = settingsConfig?.mutedConversationIds ?? EMPTY_CONVERSATION_IDS;
  const isSelectedConversationPinned = selectedConversationId
    ? pinnedConversationIds.includes(selectedConversationId)
    : false;
  const isSelectedConversationMuted = selectedConversationId
    ? mutedConversationIds.includes(selectedConversationId)
    : false;
  const effectiveConversationUiState = useMemo(
    () => ({
      ...conversationUiState,
      pinnedIds: pinnedConversationIds,
    }),
    [conversationUiState, pinnedConversationIds],
  );
  const displayedConversations = useMemo(
    () => buildDisplayedConversations(conversations, effectiveConversationUiState, messagesByConversation, localClearWatermarks),
    [conversations, effectiveConversationUiState, localClearWatermarks, messagesByConversation],
  );
  const totalUnreadCount = useMemo(
    () =>
      displayedConversations.reduce((total, conversation) => {
        const preview = getVisibleConversationPreview(
          conversation,
          messagesByConversation[conversation.id] ?? [],
          localClearWatermarks,
          effectiveConversationUiState.manualUnreadIds,
          readConversationOverrides,
          t,
        );

        return total + preview.unreadCount;
      }, 0),
    [
      displayedConversations,
      effectiveConversationUiState.manualUnreadIds,
      localClearWatermarks,
      messagesByConversation,
      readConversationOverrides,
      t,
    ],
  );
  const refreshFriendRequestCount = useCallback(async (): Promise<void> => {
    const result = await listFriendRequests();
    setPendingFriendRequestCount(
      result.incoming.filter((request) => request.status === 'PENDING').length,
    );
  }, []);

  useEffect(() => {
    if (user) {
      void loadConversations(user.id);
      void refreshFriendRequestCount();
    }
    setHasLoadedFriends(false);
    void listFriends()
      .then((result) => {
        setFriends(result.friends);
        setHasLoadedFriends(true);
      })
      .catch(() => {
        setFriends([]);
        setHasLoadedFriends(false);
      });
  }, [loadConversations, refreshFriendRequestCount, user]);

  useEffect(() => {
    function handleFriendRequestChanged(): void {
      void refreshFriendRequestCount();
      void listFriends()
        .then((result) => {
          setFriends(result.friends);
          setHasLoadedFriends(true);
        })
        .catch(() => {
          setHasLoadedFriends(false);
        });
    }

    window.addEventListener('langram:friend-request-changed', handleFriendRequestChanged);
    return () => window.removeEventListener('langram:friend-request-changed', handleFriendRequestChanged);
  }, [refreshFriendRequestCount]);

  useEffect(() => {
    if (!accessToken) {
      disconnect();
      return;
    }

    connect(accessToken, () => notifySessionReplaced());
    return () => disconnect();
  }, [accessToken, connect, disconnect, notifySessionReplaced]);

  useEffect(() => {
    if (!messageLimitNotice) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setMessageLimitNotice(null), 1800);
    return () => window.clearTimeout(timerId);
  }, [messageLimitNotice]);

  useEffect(() => {
    const unreadPrefix = totalUnreadCount > 0 ? `(${formatUnreadCount(totalUnreadCount)}) ` : '';
    const statusSuffix = networkStatus === 'reconnecting' ? ` - ${t('network.reconnectingTitle')}` : '';
    document.title = `${unreadPrefix}LanGram${statusSuffix}`;
  }, [networkStatus, t, totalUnreadCount]);

  useEffect(() => {
    const previousStatus = previousNetworkStatusRef.current;
    previousNetworkStatusRef.current = networkStatus;

    if (networkStatus === 'online') {
      if (hasSeenOnlineRef.current && previousStatus !== 'online') {
        setReconnectedNoticeVisible(true);
      }
      hasSeenOnlineRef.current = true;
    }
  }, [networkStatus]);

  useEffect(() => {
    if (!reconnectedNoticeVisible) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setReconnectedNoticeVisible(false), 2000);
    return () => window.clearTimeout(timerId);
  }, [reconnectedNoticeVisible]);

  useEffect(() => {
    const previousStatus = previousNetworkStatusForSyncRef.current;
    previousNetworkStatusForSyncRef.current = networkStatus;

    if (networkStatus !== 'online') {
      return;
    }

    if (!hasObservedOnlineForSyncRef.current) {
      hasObservedOnlineForSyncRef.current = true;
      return;
    }

    if (
      previousStatus === 'online' ||
      !user?.id ||
      lastSyncedNetworkChangedAtRef.current === networkLastChangedAt
    ) {
      return;
    }

    lastSyncedNetworkChangedAtRef.current = networkLastChangedAt;
    void loadConversations(user.id);
    if (selectedConversationId) {
      void selectConversation(selectedConversationId, user.id);
    }
  }, [
    loadConversations,
    networkLastChangedAt,
    networkStatus,
    selectConversation,
    selectedConversationId,
    user?.id,
  ]);

  useEffect(() => {
    void updateTrayUnreadCount(totalUnreadCount);
  }, [totalUnreadCount]);

  useEffect(() => {
    if (!uploadState.notice || uploadState.error) {
      return undefined;
    }

    const currentNotice = uploadState.notice;
    const timerId = window.setTimeout(() => {
      setUploadState((current) =>
        current.notice === currentNotice ? { ...current, notice: null } : current,
      );
    }, 3000);

    return () => window.clearTimeout(timerId);
  }, [uploadState.error, uploadState.notice]);

  useEffect(() => {
    if (!downloadSuccessNotice) {
      return undefined;
    }

    const currentNotice = downloadSuccessNotice;
    const timerId = window.setTimeout(() => {
      setDownloadSuccessNotice((current) => (current === currentNotice ? null : current));
    }, 3000);

    return () => window.clearTimeout(timerId);
  }, [downloadSuccessNotice]);

  useEffect(() => {
    if (!conversationContextMenu) {
      return undefined;
    }

    function handlePointerDown(): void {
      setConversationContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setConversationContextMenu(null);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [conversationContextMenu]);

  useEffect(() => {
    setConversationUiState((current) => {
      const nextHiddenConversations = { ...current.hiddenConversations };
      let didChange = false;
      for (const conversation of conversations) {
        const hiddenAt = nextHiddenConversations[conversation.id];
        if (hiddenAt && isConversationNewerThanHidden(conversation, hiddenAt)) {
          delete nextHiddenConversations[conversation.id];
          didChange = true;
        }
      }

      if (!didChange) {
        return current;
      }

      return saveConversationUiState({
        ...current,
        hiddenConversations: nextHiddenConversations,
      });
    });
  }, [conversations]);

  useEffect(() => {
    if (selectedConversationId && conversationUiState.hiddenConversations[selectedConversationId]) {
      closeConversation();
    }
  }, [closeConversation, conversationUiState.hiddenConversations, selectedConversationId]);

  useEffect(() => {
    setIsChatActionsOpen(false);
  }, [selectedConversationId]);

  useEffect(() => {
    function notifyVisibilityChange(): void {
      setPageAttentionKey((current) => current + 1);
    }

    window.addEventListener('focus', notifyVisibilityChange);
    window.addEventListener('blur', notifyVisibilityChange);
    document.addEventListener('visibilitychange', notifyVisibilityChange);
    return () => {
      window.removeEventListener('focus', notifyVisibilityChange);
      window.removeEventListener('blur', notifyVisibilityChange);
      document.removeEventListener('visibilitychange', notifyVisibilityChange);
    };
  }, []);

  useEffect(() => {
    setFriends((current) =>
      current.map((item) => ({
        ...item,
        friend: applyKnownPresence(item.friend, conversations, presenceByUserId),
      })),
    );
  }, [conversations, presenceByUserId]);

  const visibleFriends = useMemo(
    () =>
      friends.filter(
        (friend) => !conversations.some((conversation) => conversation.peer?.id === friend.friend.id),
      ),
    [conversations, friends],
  );
  const forwardTargets = useMemo(
    () => buildForwardTargets(conversations, visibleFriends, t('chat.unknownPeer'), selectedConversationId),
    [conversations, selectedConversationId, t, visibleFriends],
  );

  const unhideConversation = useCallback((conversationId: string): void => {
    unhideConversationInUiState(conversationId);
    setConversationUiState((current) => {
      if (!current.hiddenConversations[conversationId]) {
        return current;
      }

      const hiddenConversations = { ...current.hiddenConversations };
      delete hiddenConversations[conversationId];
      return saveConversationUiState({ ...current, hiddenConversations });
    });
  }, []);

  const activateConversation = useCallback(async (
    conversationId: string,
    options: { forceOpen?: boolean } = {},
  ): Promise<boolean> => {
    if (!user) {
      return false;
    }

    setActiveView('messages');
    setConversationContextMenu(null);
    setIsChatActionsOpen(false);
    unhideConversation(conversationId);
    setConversationUiState((current) => {
      if (!current.manualUnreadIds.includes(conversationId)) {
        return current;
      }

      return saveConversationUiState({
        ...current,
        manualUnreadIds: current.manualUnreadIds.filter((id) => id !== conversationId),
      });
    });
    setReadConversationOverrides((current) => ({ ...current, [conversationId]: new Date().toISOString() }));
    if (!options.forceOpen && selectedConversationId === conversationId) {
      closeConversation();
      return true;
    }

    await selectConversation(conversationId, user.id);
    setActiveView('messages');
    return true;
  }, [closeConversation, selectConversation, selectedConversationId, unhideConversation, user]);

  const handleSelectConversation = useCallback(async (conversationId: string): Promise<void> => {
    await activateConversation(conversationId);
  }, [activateConversation]);

  useEffect(() => {
    if (!pendingConversationActivationId || !user || activeView !== 'messages') {
      return undefined;
    }

    if (!conversations.some((conversation) => conversation.id === pendingConversationActivationId)) {
      return undefined;
    }

    if (pendingActivationInFlightRef.current === pendingConversationActivationId) {
      return undefined;
    }

    pendingActivationInFlightRef.current = pendingConversationActivationId;
    void activateConversation(pendingConversationActivationId, { forceOpen: true })
      .then((didActivate) => {
        if (didActivate) {
          setPendingConversationActivationId(null);
        }
      })
      .finally(() => {
        if (pendingActivationInFlightRef.current === pendingConversationActivationId) {
          pendingActivationInFlightRef.current = null;
        }
      });

    return undefined;
  }, [activateConversation, activeView, conversations, pendingConversationActivationId, user]);

  useEffect(() => {
    if (!latestIncomingMessage) {
      return;
    }

    if (!enableNotifications) {
      debugNotificationDiagnostic('message-notification-skipped', {
        reason: 'disabled',
        conversationId: latestIncomingMessage.conversationId,
      });
      return;
    }

    if (mutedConversationIds.includes(latestIncomingMessage.conversationId)) {
      debugNotificationDiagnostic('message-notification-skipped', {
        reason: 'muted',
        conversationId: latestIncomingMessage.conversationId,
      });
      return;
    }

    const notificationKey = latestIncomingMessage.clientMessageId ?? latestIncomingMessage.id;
    if (lastNotificationMessageRef.current === notificationKey) {
      return;
    }
    lastNotificationMessageRef.current = notificationKey;

    const isViewingConversation =
      selectedConversationId === latestIncomingMessage.conversationId &&
      document.visibilityState === 'visible' &&
      document.hasFocus();
    if (isViewingConversation) {
      debugNotificationDiagnostic('message-notification-skipped', {
        reason: 'viewing',
        conversationId: latestIncomingMessage.conversationId,
      });
      return;
    }

    const conversation = conversations.find((item) => item.id === latestIncomingMessage.conversationId);
    const title = conversation?.peer?.displayName ?? t('chat.unknownPeer');
    const body = formatNotificationMessage(latestIncomingMessage, t);
    void showDesktopNotification({
      title,
      body,
      conversationId: latestIncomingMessage.conversationId,
      hasRequestedPermissionRef: hasRequestedNotificationPermissionRef,
      onClick: (conversationId) => {
        void focusMainWindow();
        void handleSelectConversation(conversationId);
      },
    }).then((result) => {
      debugNotificationDiagnostic('message-notification-result', {
        runtime: result.runtime,
        permission: result.permission,
        reason: result.reason,
        conversationId: latestIncomingMessage.conversationId,
      });
    });
  }, [
    conversations,
    enableNotifications,
    handleSelectConversation,
    latestIncomingMessage,
    mutedConversationIds,
    pageAttentionKey,
    selectedConversationId,
    t,
  ]);

  async function handleLogout(): Promise<void> {
    if (!window.confirm(t('auth.logoutConfirm'))) {
      return;
    }

    try {
      await requestLogout();
    } catch {
      // Local session cleanup still needs to happen if the server is unreachable.
    } finally {
      disconnect();
      clearSession();
      navigate('/auth/login', { replace: true });
    }
  }

  async function handleMessageFriend(friendship: FriendItem): Promise<boolean> {
    if (!user) {
      return false;
    }

    if (!isNetworkOnline) {
      return false;
    }

    setTrustedFriendPeerId(friendship.friend.id);
    setFriends((current) => upsertFriendship(current, friendship));
    setConversationContextMenu(null);
    setActiveView('messages');

    const conversationId = await openDirectConversation(friendship.friend.id, user.id);
    if (!conversationId) {
      return false;
    }

    unhideConversation(conversationId);
    setPendingConversationActivationId(conversationId);
    setActiveView('messages');
    return true;
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitMessageDraft();
  }

  async function submitMessageDraft(): Promise<void> {
    if (!user || !selectedConversationId || !messageDraft.trim()) {
      return;
    }

    if (
      selectedConversation?.peer &&
      isPeerKnownNonFriend(selectedConversation.peer.id, friends, hasLoadedFriends, trustedFriendPeerId)
    ) {
      return;
    }

    const plaintext = messageDraft.trim();
    setMessageDraft('');
    setMessageLimitNotice(isNetworkOnline ? null : t('network.unavailableSend'));
    if (!isNetworkOnline) {
      createFailedTextMessage(selectedConversationId, plaintext, user.id);
      return;
    }

    await sendTextMessage(selectedConversationId, plaintext, user.id);
  }

  function handleMessageDraftChange(value: string): void {
    const wasBelowLimit = messageDraft.length < MESSAGE_DRAFT_MAX_LENGTH;
    setMessageDraft(value);
    if (wasBelowLimit && value.length >= MESSAGE_DRAFT_MAX_LENGTH) {
      setMessageLimitNotice(t('chat.messageLengthLimitReached'));
    }
  }

  function handleMessageDraftKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || isMessageComposingRef.current) {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    if (sendShortcut === 'enter') {
      event.preventDefault();
      void submitMessageDraft();
      return;
    }

    if (sendShortcut === 'ctrlEnter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submitMessageDraft();
    }
  }

  async function handleSendShortcutChange(nextShortcut: SendShortcutPreference): Promise<void> {
    setIsSendShortcutMenuOpen(false);
    if (nextShortcut === sendShortcut) {
      return;
    }

    await updateConfig({ sendShortcut: nextShortcut });
  }

  function insertEmoji(emoji: string): void {
    const textarea = messageTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? messageDraft.length;
    const selectionEnd = textarea?.selectionEnd ?? messageDraft.length;
    const nextDraft = `${messageDraft.slice(0, selectionStart)}${emoji}${messageDraft.slice(selectionEnd)}`;

    if (nextDraft.length > MESSAGE_DRAFT_MAX_LENGTH) {
      setMessageLimitNotice(t('chat.messageLengthLimitReached'));
      return;
    }

    setMessageDraft(nextDraft);
    requestAnimationFrame(() => {
      const currentTextarea = messageTextareaRef.current;
      if (!currentTextarea) {
        return;
      }

      const nextCursorPosition = selectionStart + emoji.length;
      currentTextarea.focus();
      currentTextarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function handleFileSelected(
    event: ChangeEvent<HTMLInputElement>,
    requestedKind: FileKind,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!user || !selectedConversationId || !file) {
      return;
    }

    if (!isNetworkOnline) {
      setUploadState({ isUploading: false, notice: null, error: t('network.unavailableSend') });
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadState({ isUploading: false, notice: null, error: t('chat.fileTooLarge') });
      return;
    }

    if (!isSupportedUpload(file, requestedKind)) {
      setUploadState({ isUploading: false, notice: null, error: t('chat.unsupportedFileType') });
      return;
    }

    setUploadState({ isUploading: true, notice: null, error: null });
    let uploadImage: Awaited<ReturnType<typeof prepareImageUploadFile>> | null = null;
    if (requestedKind === 'IMAGE') {
      try {
        uploadImage = await prepareImageUploadFile(file, true);
      } catch {
        setUploadState({
          isUploading: false,
          notice: null,
          error: isCompressibleImage(file) ? t('chat.imageCompressionFailed') : t('chat.uploadFailed'),
        });
        return;
      }
    }

    try {
      const uploadSource = uploadImage?.file ?? file;
      if (uploadSource.size > MAX_UPLOAD_SIZE_BYTES) {
        setUploadState({ isUploading: false, notice: null, error: t('chat.fileTooLarge') });
        return;
      }

      const metadata = await uploadFile({
        file: uploadSource,
        conversationId: selectedConversationId,
        kind: requestedKind,
        width: uploadImage?.width,
        height: uploadImage?.height,
      });
      await sendFileMessage(selectedConversationId, metadata, user.id);
      setUploadState({
        isUploading: false,
        notice: formatUploadNotice(metadata),
        error: null,
      });
    } catch {
      setUploadState({ isUploading: false, notice: null, error: t('chat.uploadFailed') });
    }
  }

  function handleDeleteLocalMessage(messageId: string): void {
    if (!selectedConversationId) {
      return;
    }

    deleteLocalMessage(selectedConversationId, messageId);
  }

  function handleRecallMessage(messageId: string): void {
    if (!selectedConversationId) {
      return;
    }

    recallMessage(selectedConversationId, messageId);
  }

  async function handleEditMessage(messageId: string, plaintext: string): Promise<void> {
    if (!selectedConversationId) {
      return;
    }

    await editMessage(selectedConversationId, messageId, plaintext);
  }

  async function handleForwardMessage(messageId: string, target: ForwardTarget): Promise<void> {
    if (!user || !selectedConversationId) {
      return;
    }

    const targetConversationId =
      target.type === 'conversation'
        ? target.conversationId
        : await openDirectConversation(target.friendUserId, user.id);
    if (!targetConversationId) {
      return;
    }

    await forwardMessage(selectedConversationId, messageId, targetConversationId);
  }

  async function handleRetryMessage(messageId: string): Promise<void> {
    if (!selectedConversationId) {
      return;
    }

    if (!isNetworkOnline) {
      setMessageLimitNotice(t('network.unavailableSend'));
      return;
    }

    setMessageLimitNotice(null);
    await retryTextMessage(selectedConversationId, messageId);
  }

  async function handleDownloadFile(file: FileMetadataResponse): Promise<void> {
    setDownloadStates((current) => ({ ...current, [file.id]: 'downloading' }));

    try {
      const blob = await downloadFile(file.id);
      const savedFile = await saveDownloadedFile(file.originalName, await blobToByteArray(blob));
      await upsertLocalFileRecord({
        fileId: file.id,
        conversationId: file.conversationId,
        messageId: file.messageId,
        originalName: file.originalName,
        safeName: savedFile.safeName,
        mimeType: file.mimeType,
        sizeBytes: savedFile.sizeBytes,
        sha256: file.sha256,
        localPath: savedFile.localPath,
        status: 'completed',
        errorMessage: null,
        downloadedAt: new Date().toISOString(),
      });
      setDownloadSuccessNotice({
        fileId: file.id,
        message: formatDownloadSavedNotice(t, savedFile.localPath),
        path: savedFile.localPath,
      });
      setDownloadStates((current) => {
        const next = { ...current };
        delete next[file.id];
        return next;
      });
    } catch {
      setDownloadStates((current) => ({ ...current, [file.id]: 'failed' }));
    }
  }

  function handleClearLocalConversation(): void {
    if (!selectedConversationId) {
      return;
    }

    clearLocalConversation(selectedConversationId);
    setConversationUiState((current) =>
      saveConversationUiState({
        ...current,
        manualUnreadIds: current.manualUnreadIds.filter((id) => id !== selectedConversationId),
      }),
    );
    setReadConversationOverrides((current) => ({
      ...current,
      [selectedConversationId]: new Date().toISOString(),
    }));
  }

  function openConversationSearch(): void {
    setIsChatActionsOpen(false);
    if (!selectedConversation) {
      return;
    }

    void openConversationSearchWindow(
      buildConversationSearchPayload(
        selectedConversation,
        messages,
        user?.id ?? null,
        user?.displayName ?? t('app.name'),
      ),
      t('chat.searchWindowTitle'),
    );
  }

  function handleClearLocalConversationFromMenu(): void {
    setIsChatActionsOpen(false);
    handleClearLocalConversation();
  }

  async function handleDeleteFriendFromMenu(): Promise<void> {
    if (!selectedConversationId || !selectedConversation?.peer || !user) {
      return;
    }

    const friendship = friends.find((item) => item.friend.id === selectedConversation.peer?.id);
    if (!friendship) {
      window.alert(t('chat.deleteFriendFailed'));
      return;
    }

    setPendingDeleteFriend({ friendship, conversationId: selectedConversationId });
  }

  async function confirmDeleteFriendFromMenu(): Promise<void> {
    if (!pendingDeleteFriend || !user) {
      return;
    }

    setIsChatActionsOpen(false);
    setIsDeletingFriend(true);
    try {
      await deleteFriend(pendingDeleteFriend.friendship.id);
      setTrustedFriendPeerId((current) =>
        current === pendingDeleteFriend.friendship.friend.id ? null : current,
      );
      setFriends((current) => current.filter((item) => item.id !== pendingDeleteFriend.friendship.id));
      setHasLoadedFriends(true);
      if (pendingDeleteFriend.conversationId) {
        const deletedConversationId = pendingDeleteFriend.conversationId;
        setConversationUiState((current) =>
          saveConversationUiState({
            ...current,
            manualUnreadIds: current.manualUnreadIds.filter((id) => id !== deletedConversationId),
            hiddenConversations: {
              ...current.hiddenConversations,
              [deletedConversationId]: new Date().toISOString(),
            },
          }),
        );
        void updateConfig({
          pinnedConversationIds: pinnedConversationIds.filter((id) => id !== deletedConversationId),
          mutedConversationIds: mutedConversationIds.filter((id) => id !== deletedConversationId),
        });
      }
      setPendingDeleteFriend(null);
      closeConversation();
      await loadConversations(user.id);
    } catch {
      window.alert(isNetworkOnline ? t('chat.deleteFriendFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsDeletingFriend(false);
    }
  }

  function cancelDeleteFriendFromMenu(): void {
    if (isDeletingFriend) {
      return;
    }

    setPendingDeleteFriend(null);
  }

  function togglePinnedConversation(): void {
    if (!selectedConversationId) {
      return;
    }

    const nextPinnedIds = pinnedConversationIds.includes(selectedConversationId)
      ? pinnedConversationIds.filter((id) => id !== selectedConversationId)
      : [...pinnedConversationIds, selectedConversationId];
    void updateConfig({ pinnedConversationIds: nextPinnedIds });
  }

  function toggleMutedConversation(): void {
    if (!selectedConversationId) {
      return;
    }

    const nextMutedIds = mutedConversationIds.includes(selectedConversationId)
      ? mutedConversationIds.filter((id) => id !== selectedConversationId)
      : [...mutedConversationIds, selectedConversationId];
    void updateConfig({ mutedConversationIds: nextMutedIds });
  }

  function handleConversationContextMenu(event: MouseEvent, conversation: Conversation): void {
    event.preventDefault();
    setConversationContextMenu({
      conversation,
      ...getContextMenuPosition(event.clientX, event.clientY, 190, 150),
    });
  }

  function pinConversation(conversationId: string): void {
    if (pinnedConversationIds.includes(conversationId)) {
      return;
    }

    void updateConfig({ pinnedConversationIds: [...pinnedConversationIds, conversationId] });
  }

  function unpinConversation(conversationId: string): void {
    if (!pinnedConversationIds.includes(conversationId)) {
      return;
    }

    void updateConfig({
      pinnedConversationIds: pinnedConversationIds.filter((id) => id !== conversationId),
    });
  }

  function markConversationUnread(conversationId: string): void {
    setReadConversationOverrides((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setConversationUiState((current) => {
      if (current.manualUnreadIds.includes(conversationId)) {
        return current;
      }

      return saveConversationUiState({
        ...current,
        manualUnreadIds: [...current.manualUnreadIds, conversationId],
      });
    });
  }

  function markConversationRead(conversation: Conversation): void {
    setConversationUiState((current) =>
      saveConversationUiState({
        ...current,
        manualUnreadIds: current.manualUnreadIds.filter((id) => id !== conversation.id),
      }),
    );
    setReadConversationOverrides((current) => ({
      ...current,
      [conversation.id]: new Date().toISOString(),
    }));
    if (conversation.lastMessage) {
      markRead(conversation.id, conversation.lastMessage.id);
    }
  }

  function hideConversation(conversationId: string): void {
    if (!window.confirm(t('conversation.removeFromListConfirm'))) {
      return;
    }

    setConversationUiState((current) =>
      saveConversationUiState({
        ...current,
        manualUnreadIds: current.manualUnreadIds.filter((id) => id !== conversationId),
        hiddenConversations: {
          ...current.hiddenConversations,
          [conversationId]: new Date().toISOString(),
        },
      }),
    );
    void updateConfig({
      pinnedConversationIds: pinnedConversationIds.filter((id) => id !== conversationId),
      mutedConversationIds: mutedConversationIds.filter((id) => id !== conversationId),
    });
    setReadConversationOverrides((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    if (selectedConversationId === conversationId) {
      closeConversation();
    }
  }

  function handleConversationMenuAction(action: ConversationMenuAction, conversation: Conversation): void {
    setConversationContextMenu(null);
    switch (action) {
      case 'pin':
        pinConversation(conversation.id);
        break;
      case 'unpin':
        unpinConversation(conversation.id);
        break;
      case 'markUnread':
        markConversationUnread(conversation.id);
        break;
      case 'markRead':
        markConversationRead(conversation);
        break;
      case 'hide':
        hideConversation(conversation.id);
        break;
      default:
        break;
    }
  }

  async function handleLoadOlderMessages(): Promise<boolean> {
    if (!user || !selectedConversationId) {
      return false;
    }

    return loadOlderMessages(selectedConversationId, user.id);
  }

  return (
    <main className={`main-layout ${activeView === 'contacts' ? 'main-layout--contacts' : ''}`}>
      <aside className="app-nav">
        <AppLogo label={t('app.name')} size="sm" />
        <nav className="app-nav-links" aria-label={t('main.navigation')}>
          <button
            type="button"
            className={`app-nav-link ${activeView === 'messages' ? 'is-active' : ''}`}
            aria-label={t('main.navMessages')}
            title={t('main.navMessages')}
            onClick={() => setActiveView('messages')}
          >
            <NavIcon src={NAV_ICON_SOURCES.messages} fallback="M" label={t('main.navMessages')} />
            <strong>{t('main.navMessages')}</strong>
            {totalUnreadCount > 0 ? (
              <span className="app-nav-unread" aria-label={`${t('main.navMessages')} ${formatUnreadCount(totalUnreadCount)}`}>
                {formatUnreadCount(totalUnreadCount)}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={`app-nav-link ${activeView === 'contacts' ? 'is-active' : ''}`}
            aria-label={t('main.navContacts')}
            title={t('main.navContacts')}
            onClick={() => {
              setConversationContextMenu(null);
              setActiveView('contacts');
            }}
          >
            <NavIcon src={NAV_ICON_SOURCES.contacts} fallback="C" label={t('main.navContacts')} />
            <strong>{t('main.navContacts')}</strong>
            {pendingFriendRequestCount > 0 ? (
              <span className="app-nav-unread" aria-label={`${t('main.navContacts')} ${formatUnreadCount(pendingFriendRequestCount)}`}>
                {formatUnreadCount(pendingFriendRequestCount)}
              </span>
            ) : null}
          </button>
        </nav>
        <div className="app-nav-menu" ref={appMenuRef}>
          {isAppMenuOpen ? (
            <div className="app-nav-popover" role="menu">
              <Link
                role="menuitem"
                to="/settings"
                className="app-nav-menu-item"
                onClick={() => setIsAppMenuOpen(false)}
              >
                <MenuItemIcon src={NAV_ICON_SOURCES.settings} fallback="S" label={t('main.navSettings')} />
                {t('main.navSettings')}
              </Link>
              <button
                type="button"
                role="menuitem"
                className="app-nav-menu-item is-danger"
                onClick={() => {
                  setIsAppMenuOpen(false);
                  void handleLogout();
                }}
              >
                <MenuItemIcon src={NAV_ICON_SOURCES.logout} fallback="L" label={t('auth.logout')} />
                {t('auth.logout')}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="app-nav-link app-nav-menu-toggle"
            aria-label={t('main.moreMenu')}
            aria-expanded={isAppMenuOpen}
            title={t('main.moreMenu')}
            onClick={() => setIsAppMenuOpen((isOpen) => !isOpen)}
          >
            <NavIcon src={NAV_ICON_SOURCES.more} fallback="..." label={t('main.moreMenu')} />
            <strong>{t('main.moreMenu')}</strong>
          </button>
        </div>
      </aside>
      {activeView === 'contacts' ? (
        <FriendsWorkspace
          className="main-friends-shell"
          onConversationOpened={() => setActiveView('messages')}
          onMessageFriend={handleMessageFriend}
        />
      ) : (
        <>
      <aside className="conversation-panel">
        <div className="sidebar-header">
          <strong>{t('main.sidebarChats')}</strong>
        </div>
        <section className="sidebar-section">
          {isLoadingConversations ? <p>{t('chat.loading')}</p> : null}
          {isUsingCachedConversations ? (
            <p className="conversation-cache-notice">{t('chat.showingLocalCache')}</p>
          ) : null}
          {!isLoadingConversations && displayedConversations.length === 0 ? (
            <p>{t('chat.noConversations')}</p>
          ) : null}
          <div className="conversation-list">
            {displayedConversations.map((conversation) => {
              const preview = getVisibleConversationPreview(
                conversation,
                messagesByConversation[conversation.id] ?? [],
                localClearWatermarks,
                effectiveConversationUiState.manualUnreadIds,
                readConversationOverrides,
                t,
              );
              const isPinned = effectiveConversationUiState.pinnedIds.includes(conversation.id);
              return (
                <button
                  type="button"
                  className={`conversation-item ${isPinned ? 'is-pinned' : ''} ${
                    selectedConversationId === conversation.id ? 'is-active' : ''
                  }`}
                  key={conversation.id}
                  onClick={() => void handleSelectConversation(conversation.id)}
                  onContextMenu={(event) => handleConversationContextMenu(event, conversation)}
                >
                  <UserAvatar
                    userId={conversation.peer?.id}
                    displayName={conversation.peer?.displayName}
                    avatarUrl={conversation.peer?.avatarUrl}
                  />
                  <span className="conversation-item-body">
                    <span className="conversation-item-header">
                      <strong>{conversation.peer?.displayName ?? t('chat.unknownPeer')}</strong>
                      {preview.time ? (
                        <time dateTime={preview.time}>{formatConversationTime(preview.time, t)}</time>
                      ) : null}
                    </span>
                    <span className="conversation-item-meta">
                      <small>{preview.summary}</small>
                      {preview.unreadCount > 0 ? (
                        <span className="conversation-unread">
                          {preview.unreadCount > 99 ? '99+' : preview.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <strong>
              {selectedConversation?.peer?.displayName ?? user?.displayName ?? t('app.name')}
            </strong>
            <span>
              {selectedConversation?.peer
                ? formatPresence(selectedConversation.peer.isOnline, selectedConversation.peer.lastSeenAt, t)
                : t('presence.online')}
            </span>
          </div>
          {selectedConversation ? (
            <div className="chat-header-actions" ref={chatActionsRef}>
              {isChatActionsOpen ? (
                <div className="chat-actions-panel" role="menu" aria-label={t('chat.moreActions')}>
                  <div className="chat-actions-panel-section">
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-actions-panel-item"
                      onClick={openConversationSearch}
                    >
                      <span>{t('chat.searchCurrentConversation')}</span>
                      <span className="chat-actions-panel-arrow" aria-hidden="true">›</span>
                    </button>
                  </div>
                  <div className="chat-actions-panel-section">
                    <button
                      type="button"
                      role="menuitem"
                      className={`chat-actions-panel-item${isSelectedConversationPinned ? ' is-enabled' : ''}`}
                      aria-pressed={isSelectedConversationPinned}
                      title={isSelectedConversationPinned ? t('chat.pinned') : undefined}
                      onClick={togglePinnedConversation}
                    >
                      <span>{t('chat.pinConversation')}</span>
                      <span className="chat-actions-panel-toggle" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`chat-actions-panel-item${isSelectedConversationMuted ? ' is-enabled' : ''}`}
                      aria-pressed={isSelectedConversationMuted}
                      title={isSelectedConversationMuted ? t('chat.muted') : undefined}
                      onClick={toggleMutedConversation}
                    >
                      <span>{t('chat.muteConversation')}</span>
                      <span className="chat-actions-panel-toggle" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-actions-panel-item"
                      disabled
                      title={t('chat.comingSoon')}
                    >
                      <span>{t('chat.blockUser')}</span>
                      <span className="chat-actions-panel-toggle" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="chat-actions-panel-section">
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-actions-panel-item"
                      onClick={handleClearLocalConversationFromMenu}
                      disabled={messages.length === 0}
                    >
                      <span>{t('chat.clearLocalRecords')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-actions-panel-item is-danger"
                      onClick={() => void handleDeleteFriendFromMenu()}
                      disabled={!selectedConversation?.peer || !friends.some((item) => item.friend.id === selectedConversation.peer?.id)}
                      title={
                        selectedConversation?.peer && friends.some((item) => item.friend.id === selectedConversation.peer?.id)
                          ? undefined
                          : t('chat.comingSoon')
                      }
                    >
                      <span>{t('chat.deleteFriend')}</span>
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="chat-more-button"
                aria-label={t('chat.moreActions')}
                aria-expanded={isChatActionsOpen}
                title={t('chat.moreActions')}
                onClick={() => setIsChatActionsOpen((isOpen) => !isOpen)}
              >
                <span className="chat-more-button-icon" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </header>
        {selectedConversation ? (
          <div className="chat-conversation-body">
            <div className="chat-network-slot">
              <NetworkStatusBanner
                status={networkStatus}
                showReconnected={reconnectedNoticeVisible}
                t={t}
              />
            </div>
            {chatTopNotice ? (
              <div className="chat-top-notice" role="status">
                {chatTopNotice}
              </div>
            ) : null}
            <div className="chat-message-area">
              {isUsingCachedMessages ? (
                <p className="chat-cache-notice">{t('chat.showingCachedMessages')}</p>
              ) : null}
              <MessageList
                conversationId={selectedConversation.id}
                messages={messages}
                isLoading={isLoadingMessages}
                hasMoreMessages={selectedMessagePagination?.hasMore ?? false}
                isLoadingOlderMessages={selectedMessagePagination?.isLoadingOlder ?? false}
                searchQuery=""
                activeSearchMessageId={null}
                searchMatchIds={EMPTY_SEARCH_MATCH_IDS}
                onLoadOlderMessages={handleLoadOlderMessages}
                onDeleteLocalMessage={handleDeleteLocalMessage}
                onRecallMessage={handleRecallMessage}
                onEditMessage={handleEditMessage}
                onForwardMessage={handleForwardMessage}
                onRetryMessage={handleRetryMessage}
                onDownloadFile={handleDownloadFile}
                forwardTargets={forwardTargets}
                downloadStates={downloadStates}
              />
            </div>
            {uploadState.notice || uploadState.error ? (
              <div className={`file-upload-status ${uploadState.error ? 'is-error' : ''}`}>
                <span>{uploadState.error ?? t('chat.uploadSuccess')}</span>
                {uploadState.notice ? <small>{uploadState.notice}</small> : null}
              </div>
            ) : null}
            {downloadSuccessNotice ? (
              <div className="file-download-success" role="status" aria-live="polite">
                <span title={downloadSuccessNotice.path || downloadSuccessNotice.message}>
                  {downloadSuccessNotice.message}
                </span>
              </div>
            ) : null}
            {messageLimitNotice ? (
              <div className="message-limit-notice" role="status">
                {messageLimitNotice}
              </div>
            ) : null}
            <form className="message-input" onSubmit={(event) => void handleSend(event)}>
              <div className="message-input-toolbar" aria-label={t('chat.attachments')}>
                <div className="emoji-picker-wrapper" ref={emojiPanelRef}>
                  <button
                    type="button"
                    className="composer-tool-button"
                    aria-label={t('chat.emoji')}
                    title={t('chat.emoji')}
                    aria-expanded={isEmojiPanelOpen}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsEmojiPanelOpen((isOpen) => !isOpen);
                    }}
                  >
                    <img src="/vector_icon/smile.svg" alt="" aria-hidden="true" />
                    <span>{t('chat.emoji')}</span>
                  </button>
                  {isEmojiPanelOpen ? (
                    <div className="emoji-panel" role="menu" aria-label={t('chat.insertEmoji')}>
                      {EMOJI_GROUPS.map((group) => (
                        <section className="emoji-panel-section" key={group.id}>
                          <h3 className="emoji-panel-title">{t(group.labelKey)}</h3>
                          <div className="emoji-grid">
                            {group.items.map((emoji) => (
                              <button
                                type="button"
                                role="menuitem"
                                className="emoji-option"
                                key={`${group.id}-${emoji}`}
                                aria-label={emoji}
                                onClick={() => insertEmoji(emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="composer-tool-button"
                  aria-label={t('chat.sendFile')}
                  title={t('chat.sendFile')}
                  disabled={uploadState.isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <img src="/vector_icon/file.svg" alt="" aria-hidden="true" />
                  <span>{t('chat.sendFile')}</span>
                </button>
                <button
                  type="button"
                  className="composer-tool-button"
                  aria-label={t('chat.sendImage')}
                  title={t('chat.sendImage')}
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploadState.isUploading}
                >
                  <img src="/vector_icon/image.svg" alt="" aria-hidden="true" />
                  <span>{t('chat.sendImage')}</span>
                </button>
                <input
                  ref={fileInputRef}
                  className="hidden-file-input"
                  type="file"
                  onChange={(event) => void handleFileSelected(event, 'FILE')}
                  disabled={uploadState.isUploading}
                  accept={FILE_UPLOAD_ACCEPT}
                />
                <input
                  ref={imageInputRef}
                  className="hidden-file-input"
                  type="file"
                  onChange={(event) => void handleFileSelected(event, 'IMAGE')}
                  disabled={uploadState.isUploading}
                  accept={IMAGE_UPLOAD_ACCEPT}
                />
              </div>
              <div className="message-editor">
                <textarea
                  ref={messageTextareaRef}
                  value={messageDraft}
                  onChange={(event) => handleMessageDraftChange(event.target.value)}
                  onCompositionStart={() => {
                    isMessageComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isMessageComposingRef.current = false;
                  }}
                  onKeyDown={handleMessageDraftKeyDown}
                  placeholder={t('chat.messagePlaceholder')}
                  rows={3}
                  maxLength={MESSAGE_DRAFT_MAX_LENGTH}
                />
                <div className="message-send-wrapper" ref={sendShortcutRef}>
                  <div className={`message-send-control${messageDraft.trim() ? '' : ' is-empty'}`}>
                    <button
                      type="submit"
                      className="primary-button message-send-button"
                      disabled={!messageDraft.trim()}
                    >
                      {t('chat.send')}
                    </button>
                    <button
                      type="button"
                      className="primary-button message-send-shortcut-button"
                      aria-label={t('chat.sendShortcut')}
                      aria-expanded={isSendShortcutMenuOpen}
                      title={t('chat.sendShortcut')}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setIsSendShortcutMenuOpen((isOpen) => !isOpen);
                      }}
                    >
                      <span aria-hidden="true">{isSendShortcutMenuOpen ? '∨' : '∧'}</span>
                    </button>
                  </div>
                  {isSendShortcutMenuOpen ? (
                    <div className="send-shortcut-menu" role="menu" aria-label={t('chat.sendShortcut')}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={sendShortcut === 'enter'}
                        className="send-shortcut-menu-item"
                        onClick={() => void handleSendShortcutChange('enter')}
                      >
                        <span aria-hidden="true">{sendShortcut === 'enter' ? '✓' : ''}</span>
                        <span>{t('chat.sendWithEnter')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={sendShortcut === 'ctrlEnter'}
                        className="send-shortcut-menu-item"
                        onClick={() => void handleSendShortcutChange('ctrlEnter')}
                      >
                        <span aria-hidden="true">{sendShortcut === 'ctrlEnter' ? '✓' : ''}</span>
                        <span>{t('chat.sendWithCtrlEnter')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </form>
          </div>
        ) : (
          <div className="empty-chat-state">
            <h1>{t('main.emptyTitle')}</h1>
            <p>{t('chat.selectConversation')}</p>
          </div>
        )}
        {visibleChatError ? <p className="chat-error">{visibleChatError}</p> : null}
      </section>

      <aside className="profile-panel">
        <UserAvatar
          userId={profileUser?.id}
          displayName={profileUser?.displayName}
          avatarUrl={profileUser?.avatarUrl}
          size="lg"
        />
        <strong>{profileUser?.displayName ?? t('app.name')}</strong>
        <span className="presence-text">{profilePresence}</span>
        <span>{profileUser?.statusMessage || profileUser?.email || profileUser?.accountType || 'MVP'}</span>
      </aside>
        </>
      )}
      {activeView === 'messages' && conversationContextMenu
        ? createPortal(
            <ConversationContextMenu
              conversation={conversationContextMenu.conversation}
              isPinned={effectiveConversationUiState.pinnedIds.includes(
                conversationContextMenu.conversation.id,
              )}
              isUnread={
                getVisibleConversationPreview(
                  conversationContextMenu.conversation,
                  messagesByConversation[conversationContextMenu.conversation.id] ?? [],
                  localClearWatermarks,
                  conversationUiState.manualUnreadIds,
                  readConversationOverrides,
                  t,
                ).unreadCount > 0
              }
              x={conversationContextMenu.x}
              y={conversationContextMenu.y}
              t={t}
              onAction={handleConversationMenuAction}
              onClose={() => setConversationContextMenu(null)}
            />,
            document.body,
          )
        : null}
      {pendingDeleteFriend ? (
        <FriendDeleteConfirmDialog
          title={t('friends.deleteFriendConfirmTitle')}
          message={t('friends.deleteFriendConfirm')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('friends.deleteFriendConfirmAction')}
          isBusy={isDeletingFriend}
          onCancel={cancelDeleteFriendFromMenu}
          onConfirm={() => void confirmDeleteFriendFromMenu()}
        />
      ) : null}
    </main>
  );
}

function NetworkStatusBanner({
  status,
  showReconnected,
  t,
}: {
  status: NetworkStatus;
  showReconnected: boolean;
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element | null {
  if (showReconnected) {
    return (
      <div className="network-status-banner is-online" role="status">
        {t('network.reconnected')}
      </div>
    );
  }

  if (status === 'online') {
    return null;
  }

  const labelByStatus: Record<Exclude<NetworkStatus, 'online'>, string> = {
    connecting: t('network.connecting'),
    disconnected: t('network.disconnected'),
    reconnecting: t('network.reconnecting'),
    failed: t('network.reconnectFailed'),
  };

  return (
    <div className={`network-status-banner is-${status}`} role="status">
      {labelByStatus[status]}
    </div>
  );
}

function applyKnownPresence(
  friend: FriendItem['friend'],
  conversations: Conversation[],
  presenceByUserId: ReturnType<typeof useChatStore.getState>['presenceByUserId'],
): FriendItem['friend'] {
  const eventPresence = presenceByUserId[friend.id];
  if (eventPresence) {
    return {
      ...friend,
      isOnline: eventPresence.isOnline,
      lastSeenAt: eventPresence.lastSeenAt,
    };
  }

  const conversationPeer = conversations
    .map((conversation) => conversation.peer)
    .find((peer) => peer?.id === friend.id);

  if (!conversationPeer) {
    return friend;
  }

  return {
    ...friend,
    isOnline: conversationPeer.isOnline,
    lastSeenAt: conversationPeer.lastSeenAt,
  };
}

function formatPresence(
  isOnline: boolean | undefined,
  lastSeenAt: string | null | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (isOnline) {
    return t('presence.online');
  }

  if (!lastSeenAt) {
    return t('presence.offline');
  }

  const diffMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000),
  );
  if (diffMinutes < 1) {
    return t('presence.justNow');
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} ${t('presence.minutesAgo')}`;
  }

  return `${Math.floor(diffMinutes / 60)} ${t('presence.hoursAgo')}`;
}

function formatConversationSummary(
  conversation: Conversation,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return formatConversationMessageSummary(
    conversation.lastMessage,
    conversation.lastMessagePlaintext ?? null,
    conversation.lastMessageDecryptionFailed ?? false,
    t,
  );
}

function formatConversationMessageSummary(
  message: Conversation['lastMessage'] | ChatMessage | null,
  plaintext: string | null,
  decryptionFailed: boolean,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!message) {
    return t('chat.noMessages');
  }

  if (message.status === 'RECALLED' || message.status === 'recalled') {
    return t('chat.messageRecalled');
  }

  if (decryptionFailed) {
    return t('chat.decryptFailed');
  }

  if (message.messageType === 'IMAGE') {
    return `[${t('chat.image')}] ${message.file?.originalName ?? t('chat.image')}`;
  }

  if (message.messageType === 'FILE') {
    return `[${t('chat.file')}] ${message.file?.originalName ?? t('chat.file')}`;
  }

  return plaintext?.trim() || t('chat.noMessages');
}

function formatNotificationMessage(
  message: ChatMessage,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return formatConversationMessageSummary(
    message,
    message.messageType === 'TEXT' ? message.plaintext : null,
    message.plaintext === '[Unable to decrypt message]',
    t,
  );
}

function formatUnreadCount(unreadCount: number): string {
  return unreadCount > 99 ? '99+' : String(unreadCount);
}

function buildDisplayedConversations(
  conversations: Conversation[],
  uiState: ConversationUiState,
  messagesByConversation: Record<string, ChatMessage[]>,
  localClearWatermarks: Record<string, string>,
): Conversation[] {
  return [...conversations]
    .filter((conversation) => !uiState.hiddenConversations[conversation.id])
    .sort((left, right) => {
      const leftPinned = uiState.pinnedIds.includes(left.id);
      const rightPinned = uiState.pinnedIds.includes(right.id);
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      return (
        getVisibleConversationSortTime(right, messagesByConversation, localClearWatermarks) -
        getVisibleConversationSortTime(left, messagesByConversation, localClearWatermarks)
      );
    });
}

function getConversationSortTime(conversation: Conversation): number {
  return new Date(conversation.lastMessageAt ?? conversation.updatedAt).getTime();
}

function getVisibleConversationSortTime(
  conversation: Conversation,
  messagesByConversation: Record<string, ChatMessage[]>,
  localClearWatermarks: Record<string, string>,
): number {
  const preview = getVisibleConversationLastMessage(
    conversation,
    messagesByConversation[conversation.id] ?? [],
    localClearWatermarks,
  );

  return preview?.createdAt ? new Date(preview.createdAt).getTime() : new Date(conversation.updatedAt).getTime();
}

function isConversationNewerThanHidden(conversation: Conversation, hiddenAt: string): boolean {
  return getConversationSortTime(conversation) > new Date(hiddenAt).getTime();
}

function getDisplayedUnreadCount(
  conversation: Conversation,
  manualUnreadIds: string[],
  readConversationOverrides: Record<string, string>,
): number {
  if (manualUnreadIds.includes(conversation.id)) {
    return Math.max(1, conversation.unreadCount);
  }

  const readAt = readConversationOverrides[conversation.id];
  if (readAt && getConversationSortTime(conversation) <= new Date(readAt).getTime()) {
    return 0;
  }

  return conversation.unreadCount;
}

function getVisibleConversationPreview(
  conversation: Conversation,
  localMessages: ChatMessage[],
  localClearWatermarks: Record<string, string>,
  manualUnreadIds: string[],
  readConversationOverrides: Record<string, string>,
  t: ReturnType<typeof useI18n>['t'],
): ConversationPreview {
  const visibleLastMessage = getVisibleConversationLastMessage(
    conversation,
    localMessages,
    localClearWatermarks,
  );
  if (!visibleLastMessage) {
    return {
      summary: t('chat.noMessages'),
      time: null,
      unreadCount: 0,
    };
  }

  const lastMessage = visibleLastMessage;
  const summary =
    'plaintext' in lastMessage
      ? formatConversationMessageSummary(
          lastMessage,
          lastMessage.messageType === 'TEXT' ? lastMessage.plaintext : null,
          lastMessage.plaintext === '[Unable to decrypt message]',
          t,
        )
      : formatConversationSummary(conversation, t);

  return {
    summary,
    time: lastMessage.createdAt,
    unreadCount: getVisibleConversationUnreadCount(
      conversation,
      lastMessage,
      manualUnreadIds,
      readConversationOverrides,
    ),
  };
}

function getVisibleConversationUnreadCount(
  conversation: Conversation,
  visibleLastMessage: NonNullable<Conversation['lastMessage']> | ChatMessage,
  manualUnreadIds: string[],
  readConversationOverrides: Record<string, string>,
): number {
  if (manualUnreadIds.includes(conversation.id)) {
    return Math.max(1, conversation.unreadCount);
  }

  if ('isOwn' in visibleLastMessage && visibleLastMessage.isOwn) {
    return 0;
  }

  return getDisplayedUnreadCount(conversation, manualUnreadIds, readConversationOverrides);
}

function getVisibleConversationLastMessage(
  conversation: Conversation,
  localMessages: ChatMessage[],
  localClearWatermarks: Record<string, string>,
): Conversation['lastMessage'] | ChatMessage | null {
  const latestLocalMessage = localMessages.at(-1);
  if (latestLocalMessage) {
    return latestLocalMessage;
  }

  if (
    conversation.lastMessage &&
    !isConversationLastMessageCleared(conversation, localClearWatermarks)
  ) {
    return conversation.lastMessage;
  }

  return null;
}

function isConversationLastMessageCleared(
  conversation: Conversation,
  localClearWatermarks: Record<string, string>,
): boolean {
  const clearedAt = localClearWatermarks[conversation.id];
  if (!clearedAt || !conversation.lastMessage) {
    return false;
  }

  return new Date(conversation.lastMessage.createdAt).getTime() <= new Date(clearedAt).getTime();
}

function formatConversationTime(
  value: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return t('chat.yesterday');
  }

  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

function MessageList({
  conversationId,
  messages,
  isLoading,
  hasMoreMessages,
  isLoadingOlderMessages,
  searchQuery,
  activeSearchMessageId,
  searchMatchIds,
  onLoadOlderMessages,
  onDeleteLocalMessage,
  onRecallMessage,
  onEditMessage,
  onForwardMessage,
  onRetryMessage,
  onDownloadFile,
  forwardTargets,
  downloadStates,
}: {
  conversationId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  hasMoreMessages: boolean;
  isLoadingOlderMessages: boolean;
  searchQuery: string;
  activeSearchMessageId: string | null;
  searchMatchIds: Set<string>;
  onLoadOlderMessages: () => Promise<boolean>;
  onDeleteLocalMessage: (messageId: string) => void;
  onRecallMessage: (messageId: string) => void;
  onEditMessage: (messageId: string, plaintext: string) => Promise<void>;
  onForwardMessage: (messageId: string, target: ForwardTarget) => Promise<void>;
  onRetryMessage: (messageId: string) => Promise<void>;
  onDownloadFile: (file: FileMetadataResponse) => Promise<void>;
  forwardTargets: ForwardTarget[];
  downloadStates: Record<string, FileDownloadStatus>;
}): JSX.Element {
  const { t } = useI18n();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [selectedForwardTargetIds, setSelectedForwardTargetIds] = useState<string[]>([]);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<MessageContextMenuState | null>(null);
  const [previewFile, setPreviewFile] = useState<FileMetadataResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isJumpToBottomVisible, setIsJumpToBottomVisible] = useState(false);
  const [hasNewMessagesPrompt, setHasNewMessagesPrompt] = useState(false);
  const [messageNotice, setMessageNotice] = useState<MessageNoticeState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const isAtBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousIsLoadingRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const lastMessage = messages[messages.length - 1] ?? null;
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageIsOwn = lastMessage?.isOwn ?? false;

  useEffect(() => {
    setContextMenu(null);
    setPreviewFile(null);
  }, [messages]);

  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlderMessages;
  }, [isLoadingOlderMessages]);

  useEffect(() => {
    if (!activeSearchMessageId) {
      return;
    }

    const messageElement = messageRefs.current[activeSearchMessageId];
    messageElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSearchMessageId]);

  useEffect(() => {
    if (!forwardingMessage) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        closeForwardDialog();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [forwardingMessage]);

  useEffect(() => {
    if (!messageNotice) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setMessageNotice(null), 3000);
    return () => window.clearTimeout(timerId);
  }, [messageNotice]);

  useLayoutEffect(() => {
    const conversationChanged = previousConversationIdRef.current !== conversationId;
    const lastMessageChanged = previousLastMessageIdRef.current !== lastMessageId;
    const messageAdded = messages.length > previousMessageCountRef.current && lastMessageChanged;
    const loadingFinished = previousIsLoadingRef.current && !isLoading;
    const shouldStickToBottom =
      conversationChanged || loadingFinished || isAtBottomRef.current || lastMessageIsOwn;
    previousConversationIdRef.current = conversationId;
    previousMessageCountRef.current = messages.length;
    previousLastMessageIdRef.current = lastMessageId;
    previousIsLoadingRef.current = isLoading;

    if (conversationChanged || messages.length === 0) {
      setHasNewMessagesPrompt(false);
    }

    if (isLoading || (!conversationChanged && !messageAdded && !loadingFinished)) {
      return;
    }

    if (!shouldStickToBottom) {
      setHasNewMessagesPrompt(messageAdded);
      setIsJumpToBottomVisible(true);
      return;
    }

    if (conversationChanged || loadingFinished) {
      scrollToMessageBottom('auto');
      return;
    }

    requestAnimationFrame(() => scrollToMessageBottom(getBottomScrollBehavior('smooth')));
  }, [conversationId, isLoading, lastMessageId, lastMessageIsOwn, messages.length]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    function handlePointerDown(): void {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>, message: ChatMessage): Promise<void> {
    event.preventDefault();
    if (!editDraft.trim()) {
      return;
    }

    await onEditMessage(message.id, editDraft.trim());
    setEditingMessageId(null);
    setEditDraft('');
  }

  function openForwardDialog(message: ChatMessage): void {
    setForwardingMessage(message);
    setSelectedForwardTargetIds([]);
    setForwardError(null);
  }

  function closeForwardDialog(): void {
    setForwardingMessage(null);
    setSelectedForwardTargetIds([]);
    setForwardError(null);
  }

  function toggleForwardTarget(targetId: string): void {
    setForwardError(null);
    setSelectedForwardTargetIds((current) =>
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId],
    );
  }

  async function handleForwardSelectedTargets(): Promise<void> {
    if (!forwardingMessage || selectedForwardTargetIds.length === 0) {
      return;
    }

    const selectedTargets = forwardTargets.filter((target) =>
      selectedForwardTargetIds.includes(target.id),
    );
    if (selectedTargets.length === 0) {
      return;
    }

    try {
      for (const target of selectedTargets) {
        await onForwardMessage(forwardingMessage.id, target);
      }
      closeForwardDialog();
    } catch {
      setForwardError(t('chat.forwardFailed'));
    }
  }

  function handleContextMenu(event: MouseEvent, message: ChatMessage): void {
    event.preventDefault();
    setContextMenu({
      message,
      ...getContextMenuPosition(event.clientX, event.clientY),
    });
  }

  function handleListScroll(): void {
    setContextMenu(null);
    const list = listRef.current;
    if (!list) {
      return;
    }

    const isAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    isAtBottomRef.current = isAtBottom;
    setIsJumpToBottomVisible(!isAtBottom);
    if (isAtBottom) {
      setHasNewMessagesPrompt(false);
    }

    if (list.scrollTop < 96) {
      void loadOlderMessagesFromTop();
    }
  }

  async function loadOlderMessagesFromTop(): Promise<void> {
    const list = listRef.current;
    if (!list || !hasMoreMessages || isLoadingOlderRef.current) {
      return;
    }

    isLoadingOlderRef.current = true;
    const previousScrollHeight = list.scrollHeight;
    const previousScrollTop = list.scrollTop;
    const didAddMessages = await onLoadOlderMessages();
    requestAnimationFrame(() => {
      const currentList = listRef.current;
      if (!currentList) {
        return;
      }

      if (didAddMessages) {
        currentList.scrollTop = currentList.scrollHeight - previousScrollHeight + previousScrollTop;
      }
      isLoadingOlderRef.current = false;
    });
  }

  async function openImagePreview(file: FileMetadataResponse): Promise<void> {
    setContextMenu(null);
    setPreviewError(null);
    if (!(await isTauriRuntime())) {
      setPreviewFile(file);
      return;
    }

    try {
      const blob = await downloadFile(file.id);
      if (!blob.type.toLowerCase().startsWith('image/')) {
        throw new Error('Downloaded file is not an image');
      }

      const payload: ImagePreviewWindowPayload = {
        id: file.id,
        originalName: file.originalName,
        dataUrl: await blobToDataUrl(blob),
      };
      await openImagePreviewWindow(payload);
    } catch (error) {
      console.error('Failed to open image preview window', error);
      setPreviewError(t('chat.imagePreviewFailed'));
    }
  }

  function scrollToMessageBottom(behavior: ScrollBehavior): void {
    const list = listRef.current;
    if (!list) {
      return;
    }

    if (behavior === 'auto') {
      list.scrollTop = list.scrollHeight;
    } else {
      list.scrollTo({
        top: list.scrollHeight,
        behavior,
      });
    }
    isAtBottomRef.current = true;
    setIsJumpToBottomVisible(false);
    setHasNewMessagesPrompt(false);
  }

  function getBottomScrollBehavior(preferredBehavior: ScrollBehavior): ScrollBehavior {
    const list = listRef.current;
    if (!list || preferredBehavior !== 'smooth') {
      return preferredBehavior;
    }

    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    return distanceToBottom > 640 ? 'auto' : 'smooth';
  }

  async function copyMessageText(message: ChatMessage): Promise<void> {
    if (!canCopyMessage(message)) {
      return;
    }

    try {
      await copyTextToClipboard(message.plaintext);
      setMessageNotice({ message: t('chat.copied'), isError: false });
    } catch {
      setMessageNotice({ message: t('chat.copyFailed'), isError: true });
    }
  }

  function handleMenuAction(action: MessageMenuAction, message: ChatMessage): void {
    setContextMenu(null);
    switch (action) {
      case 'copy':
        void copyMessageText(message);
        break;
      case 'download':
        if (message.file) {
          void onDownloadFile(message.file);
        }
        break;
      case 'forward':
        openForwardDialog(message);
        break;
      case 'retry':
        void onRetryMessage(message.id);
        break;
      case 'edit':
        setEditingMessageId(message.id);
        setEditDraft(message.plaintext);
        break;
      case 'recall':
        if (!canRecallMessage(message)) {
          setMessageNotice({ message: t('chat.recallFailed'), isError: true });
          return;
        }
        onRecallMessage(message.id);
        break;
      case 'deleteLocal':
        setHasNewMessagesPrompt(false);
        onDeleteLocalMessage(message.id);
        break;
      default:
        break;
    }
  }

  if (isLoading) {
    return (
      <div className="message-list empty-chat-state">
        <p>{t('chat.loading')}</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="message-list empty-chat-state">
        <div className="message-empty-card">
          <strong>{t('chat.noMessages')}</strong>
          <p>{t('chat.noMessagesHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list-shell">
      <div ref={listRef} className="message-list" onScroll={handleListScroll}>
        {isLoadingOlderMessages || !hasMoreMessages ? (
          <div className="message-history-status" aria-live="polite">
            {isLoadingOlderMessages ? t('chat.loadingOlderMessages') : t('chat.allMessagesLoaded')}
          </div>
        ) : null}
        {messages.map((message, index) => {
          const previousMessage = messages[index - 1] ?? null;
          const showTimeDivider = shouldShowMessageTimeDivider(previousMessage, message);
          const isSameDirectionGroup = Boolean(
            previousMessage && !showTimeDivider && previousMessage.isOwn === message.isOwn,
          );
          const canRetryMessage = message.isOwn && message.status === 'failed' && message.messageType === 'TEXT';
          const visibleOwnStatus = getVisibleOwnMessageStatus(message);

          return (
            <Fragment key={message.id}>
              {showTimeDivider ? (
                <div className="message-time-divider" role="separator">
                  <time dateTime={message.createdAt}>{formatMessageTimeDivider(message.createdAt, t)}</time>
                </div>
              ) : null}
              <article
                className={`message-row ${message.isOwn ? 'is-own' : ''} ${
                  isSameDirectionGroup ? 'is-compact' : ''
                } ${showTimeDivider ? 'is-after-divider' : ''} ${
                  searchMatchIds.has(message.id) ? 'is-search-match' : ''
                } ${activeSearchMessageId === message.id ? 'is-current-search-match' : ''}`}
                ref={(element) => {
                  messageRefs.current[message.id] = element;
                }}
              >
                <div
                  className={`message-bubble ${message.status === 'recalled' ? 'is-recalled' : ''} ${
                    message.status === 'failed' ? 'is-failed' : ''
                  }`}
                  onContextMenu={(event) => handleContextMenu(event, message)}
                >
                  {editingMessageId === message.id ? (
                    <form className="message-edit-form" onSubmit={(event) => void handleSaveEdit(event, message)}>
                      <input
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        autoFocus
                      />
                      <div className="message-edit-actions">
                        <button type="submit" className="message-action" disabled={!editDraft.trim()}>
                          {t('chat.saveEdit')}
                        </button>
                        <button
                          type="button"
                          className="message-action"
                          onClick={() => {
                            setEditingMessageId(null);
                            setEditDraft('');
                          }}
                        >
                          {t('chat.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p>
                      {message.status === 'recalled'
                        ? t('chat.messageRecalled')
                        : renderMessageBody(
                            message,
                            searchQuery,
                            t,
                            downloadStates,
                            openImagePreview,
                            searchMatchIds.has(message.id),
                            activeSearchMessageId === message.id,
                          )}
                    </p>
                  )}
                  <div className="message-meta">
                    {message.isOwn && visibleOwnStatus ? (
                      <span className={message.status === 'failed' ? 'message-status-failed' : ''}>
                        {t(`chat.status.${visibleOwnStatus}`)}
                      </span>
                    ) : null}
                    {!message.isOwn ? <span>{formatTime(message.recalledAt ?? message.createdAt)}</span> : null}
                    {canRetryMessage ? (
                      <button
                        type="button"
                        className="message-retry-button"
                        onClick={() => void onRetryMessage(message.id)}
                      >
                        {t('chat.retrySending')}
                      </button>
                    ) : null}
                    {message.editedAt && message.status !== 'recalled' ? (
                      <span>{t('chat.edited')}</span>
                    ) : null}
                  </div>
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
      {contextMenu
        ? createPortal(
            <MessageContextMenu
              message={contextMenu.message}
              x={contextMenu.x}
              y={contextMenu.y}
              t={t}
              downloadStatus={contextMenu.message.file ? downloadStates[contextMenu.message.file.id] : undefined}
              onAction={handleMenuAction}
              onClose={() => setContextMenu(null)}
            />,
            document.body,
          )
        : null}
      {isJumpToBottomVisible ? (
        <button
          type="button"
          className={`jump-to-bottom-button ${hasNewMessagesPrompt ? 'has-new-messages' : ''}`}
          aria-label={hasNewMessagesPrompt ? t('chat.newMessages') : t('chat.scrollToBottom')}
          title={hasNewMessagesPrompt ? t('chat.newMessages') : t('chat.scrollToBottom')}
          onClick={() => scrollToMessageBottom('smooth')}
        >
          {hasNewMessagesPrompt ? t('chat.newMessages') : <span aria-hidden="true">&darr;</span>}
        </button>
      ) : null}
      {previewFile ? (
        <ImagePreviewDialog
          file={previewFile}
          t={t}
          onClose={() => setPreviewFile(null)}
          onDownload={() => void onDownloadFile(previewFile)}
        />
      ) : null}
      {previewError ? <p className="chat-error">{previewError}</p> : null}
      {messageNotice ? (
        <div className={`message-action-toast ${messageNotice.isError ? 'is-error' : ''}`} role="status" aria-live="polite">
          {messageNotice.message}
        </div>
      ) : null}
      {forwardingMessage ? (
        <div
          className="forward-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeForwardDialog();
            }
          }}
        >
          <section className="forward-dialog" role="dialog" aria-modal="true" aria-labelledby="forward-dialog-title">
            <header className="forward-dialog-header">
              <strong id="forward-dialog-title">{t('chat.forwardTo')}</strong>
            </header>
            {forwardTargets.length === 0 ? (
              <p className="forward-dialog-empty">{t('chat.selectForwardTarget')}</p>
            ) : (
              <div className="forward-target-list">
                {forwardTargets.map((target) => {
                  const isSelected = selectedForwardTargetIds.includes(target.id);
                  return (
                    <button
                      type="button"
                      className={`forward-target ${isSelected ? 'is-selected' : ''}`}
                      aria-pressed={isSelected}
                      key={target.id}
                      onClick={() => toggleForwardTarget(target.id)}
                    >
                      <span className="forward-target-label">
                        <span>{target.label}</span>
                        {target.isCurrentChat ? (
                          <em className="forward-current-badge">{t('chat.currentChat')}</em>
                        ) : null}
                      </span>
                      <small>{t('chat.direct')}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {forwardError ? <p className="forward-dialog-error">{forwardError}</p> : null}
            <footer className="forward-dialog-actions">
              <button type="button" className="secondary-button compact-button" onClick={closeForwardDialog}>
                {t('chat.cancel')}
              </button>
              <button
                type="button"
                className="primary-button compact-button"
                disabled={selectedForwardTargetIds.length === 0}
                onClick={() => void handleForwardSelectedTargets()}
              >
                {t('chat.forward')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shouldShowMessageTimeDivider(previousMessage: ChatMessage | null, message: ChatMessage): boolean {
  if (!previousMessage) {
    return true;
  }

  const previousTime = new Date(previousMessage.createdAt).getTime();
  const currentTime = new Date(message.createdAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }

  return currentTime - previousTime > MESSAGE_TIME_DIVIDER_INTERVAL_MS;
}

function formatMessageTimeDivider(
  value: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const time = formatTime(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameCalendarDate(date, today)) {
    return `${t('chat.today')} ${time}`;
  }

  if (isSameCalendarDate(date, yesterday)) {
    return `${t('chat.yesterday')} ${time}`;
  }

  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  if (date.getFullYear() === today.getFullYear()) {
    return `${month}/${day} ${time}`;
  }

  return `${date.getFullYear()}/${month}/${day} ${time}`;
}

function isSameCalendarDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function MessageContextMenu({
  message,
  x,
  y,
  t,
  downloadStatus,
  onAction,
  onClose,
}: {
  message: ChatMessage;
  x: number;
  y: number;
  t: ReturnType<typeof useI18n>['t'];
  downloadStatus?: FileDownloadStatus;
  onAction: (action: MessageMenuAction, message: ChatMessage) => void;
  onClose: () => void;
}): JSX.Element {
  const actions = buildMessageMenuActions(message, downloadStatus);

  return (
    <div
      className="message-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((item) => (
        <button
          type="button"
          role="menuitem"
          className={item.isDanger ? 'is-danger' : ''}
          disabled={item.disabled}
          key={item.action}
          onClick={() => {
            onAction(item.action, message);
            onClose();
          }}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}

function ConversationContextMenu({
  conversation,
  isPinned,
  isUnread,
  x,
  y,
  t,
  onAction,
  onClose,
}: {
  conversation: Conversation;
  isPinned: boolean;
  isUnread: boolean;
  x: number;
  y: number;
  t: ReturnType<typeof useI18n>['t'];
  onAction: (action: ConversationMenuAction, conversation: Conversation) => void;
  onClose: () => void;
}): JSX.Element {
  const actions: ConversationMenuItem[] = [
    {
      action: isPinned ? 'unpin' : 'pin',
      labelKey: isPinned ? 'conversation.unpin' : 'conversation.pin',
    },
    isUnread
      ? { action: 'markRead', labelKey: 'conversation.markRead' }
      : { action: 'markUnread', labelKey: 'conversation.markUnread' },
    { action: 'hide', labelKey: 'conversation.removeFromList', isDanger: true },
  ];

  return (
    <div
      className="conversation-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((item) => (
        <button
          type="button"
          role="menuitem"
          className={item.isDanger ? 'is-danger' : ''}
          key={item.action}
          onClick={() => {
            onAction(item.action, conversation);
            onClose();
          }}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}

function buildMessageMenuActions(
  message: ChatMessage,
  downloadStatus?: FileDownloadStatus,
): MessageMenuItem[] {
  if (message.status === 'recalled') {
    return [{ action: 'deleteLocal', labelKey: 'chat.deleteLocal', isDanger: true }];
  }

  const actions: MessageMenuItem[] = [];
  if (canCopyMessage(message)) {
    actions.push({ action: 'copy', labelKey: 'chat.copy' });
  }

  if (message.file) {
    actions.push({
      action: 'download',
      labelKey: downloadStatus === 'downloading' ? 'chat.downloading' : 'chat.download',
      disabled: downloadStatus === 'downloading',
    });
  }

  if (message.isOwn && message.status === 'failed' && message.messageType === 'TEXT') {
    actions.push({ action: 'retry', labelKey: 'chat.retrySending' });
  }

  actions.push({ action: 'forward', labelKey: 'chat.forward' });

  if (message.isOwn && message.messageType === 'TEXT' && canEditMessage(message)) {
    actions.push({ action: 'edit', labelKey: 'chat.edit' });
  }

  if (message.isOwn && canShowRecallMenuItem(message)) {
    actions.push({ action: 'recall', labelKey: 'chat.recall', isDanger: true });
  }

  actions.push({ action: 'deleteLocal', labelKey: 'chat.deleteLocal', isDanger: true });
  return actions;
}

function canCopyMessage(message: ChatMessage): boolean {
  return (
    message.messageType === 'TEXT' &&
    message.status !== 'recalled' &&
    message.plaintext.trim().length > 0
  );
}

function isLocalPendingMessage(message: ChatMessage): boolean {
  return (
    Boolean(message.clientMessageId) &&
    (message.status === 'failed' || message.status === 'sending')
  );
}

function isCurrentPeerFriend(peerId: string, friends: FriendItem[]): boolean {
  return friends.some((item) => item.friend.id === peerId);
}

function isPeerKnownNonFriend(
  peerId: string,
  friends: FriendItem[],
  hasLoadedFriends: boolean,
  trustedFriendPeerId: string | null,
): boolean {
  if (!hasLoadedFriends) {
    return false;
  }

  if (trustedFriendPeerId === peerId) {
    return false;
  }

  return !isCurrentPeerFriend(peerId, friends);
}

function upsertFriendship(friends: FriendItem[], friendship: FriendItem): FriendItem[] {
  const index = friends.findIndex((item) => item.id === friendship.id || item.friend.id === friendship.friend.id);
  if (index === -1) {
    return [friendship, ...friends];
  }

  const next = [...friends];
  next[index] = friendship;
  return next;
}

function canShowRecallMenuItem(message: ChatMessage): boolean {
  return (
    message.isOwn &&
    message.status !== 'recalled' &&
    (isWithinRecallWindow(message) || isLocalPendingMessage(message))
  );
}

function getContextMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth = 168,
  menuHeight = 226,
): { x: number; y: number } {
  const padding = 8;

  return {
    x: Math.max(padding, Math.min(clientX, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(clientY, window.innerHeight - menuHeight - padding)),
  };
}

function canRecallMessage(message: ChatMessage): boolean {
  return (
    message.isOwn &&
    !isLocalPendingMessage(message) &&
    (message.status === 'sent' || message.status === 'delivered' || message.status === 'read') &&
    isWithinRecallWindow(message)
  );
}

function isWithinRecallWindow(message: ChatMessage): boolean {
  return Date.now() - new Date(message.createdAt).getTime() <= 2 * 60 * 1000;
}

function canEditMessage(message: ChatMessage): boolean {
  return Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
}

function getVisibleOwnMessageStatus(message: ChatMessage): 'sending' | 'failed' | null {
  if (message.status === 'sending' || message.status === 'failed') {
    return message.status;
  }

  return null;
}

function renderMessageBody(
  message: ChatMessage,
  searchQuery: string,
  t: ReturnType<typeof useI18n>['t'],
  downloadStates: Record<string, FileDownloadStatus>,
  onOpenImagePreview: (file: FileMetadataResponse) => void,
  isSearchMatch: boolean,
  isCurrentSearchMatch: boolean,
): Array<string | JSX.Element> | JSX.Element | string {
  if (message.messageType === 'IMAGE' && message.file) {
    const downloadStatus = downloadStates[message.file.id];

    return (
      <span
        className={`image-message-card ${isSearchMatch ? 'is-search-match' : ''} ${
          isCurrentSearchMatch ? 'is-current-search-match' : ''
        }`}
      >
        <ImageMessagePreview file={message.file} t={t} onOpenPreview={onOpenImagePreview} />
        <span className="image-message-details">
          <strong>{renderHighlightedText(message.file.originalName, searchQuery)}</strong>
          <small>{formatFileSize(Number(message.file.sizeBytes))}</small>
          {downloadStatus ? (
            <small className={downloadStatus === 'failed' ? 'file-download-error' : ''}>
              {downloadStatus === 'downloading' ? t('chat.downloading') : t('chat.downloadFailed')}
            </small>
          ) : null}
        </span>
      </span>
    );
  }

  if (message.messageType === 'FILE' && message.file) {
    const downloadStatus = downloadStates[message.file.id];
    const fileBadge = formatFileBadge(message.file.originalName);

    return (
      <span
        className={`file-message-card ${isSearchMatch ? 'is-search-match' : ''} ${
          isCurrentSearchMatch ? 'is-current-search-match' : ''
        }`}
      >
        <span className="file-message-details">
          <strong>{renderHighlightedText(message.file.originalName, searchQuery)}</strong>
          <small>{formatFileSize(Number(message.file.sizeBytes))}</small>
          {downloadStatus ? (
            <small className={downloadStatus === 'failed' ? 'file-download-error' : ''}>
              {downloadStatus === 'downloading' ? t('chat.downloading') : t('chat.downloadFailed')}
            </small>
          ) : null}
        </span>
        {fileBadge.iconSrc ? (
          <span className={`file-message-icon has-image file-kind-${fileBadge.kind}`}>
            <img className="file-message-real-icon" src={fileBadge.iconSrc} alt={fileBadge.label} />
          </span>
        ) : (
          <span className={`file-message-icon file-kind-${fileBadge.kind}`}>
            <span className="file-message-icon-label">{fileBadge.label}</span>
          </span>
        )}
      </span>
    );
  }

  return renderHighlightedText(message.plaintext, searchQuery);
}

function ImageMessagePreview({
  file,
  t,
  onOpenPreview,
}: {
  file: FileMetadataResponse;
  t: ReturnType<typeof useI18n>['t'];
  onOpenPreview: (file: FileMetadataResponse) => void;
}): JSX.Element {
  const [previewState, setPreviewState] = useState<ImagePreviewState>({
    status: 'loading',
    objectUrl: null,
  });

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    setPreviewState({ status: 'loading', objectUrl: null });
    void downloadFile(file.id)
      .then((blob) => {
        if (!blob.type.toLowerCase().startsWith('image/')) {
          throw new Error('Downloaded file is not an image');
        }

        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setPreviewState({ status: 'loaded', objectUrl });
      })
      .catch(() => {
        if (!isCancelled) {
          setPreviewState({ status: 'failed', objectUrl: null });
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.id]);

  if (previewState.status === 'loaded' && previewState.objectUrl) {
    return (
      <button
        type="button"
        className="image-preview-frame image-preview-trigger"
        aria-label={t('chat.openImagePreview')}
        title={t('chat.openImagePreview')}
        onClick={() => onOpenPreview(file)}
      >
        <img src={previewState.objectUrl} alt={file.originalName} />
      </button>
    );
  }

  return (
    <span className={`image-preview-placeholder ${previewState.status === 'failed' ? 'is-error' : ''}`}>
      {previewState.status === 'failed' ? t('chat.imagePreviewFailed') : t('chat.imagePreviewLoading')}
    </span>
  );
}

function ImagePreviewDialog({
  file,
  t,
  onClose,
  onDownload,
}: {
  file: FileMetadataResponse;
  t: ReturnType<typeof useI18n>['t'];
  onClose: () => void;
  onDownload: () => void;
}): JSX.Element {
  const [previewState, setPreviewState] = useState<ImagePreviewState>({
    status: 'loading',
    objectUrl: null,
  });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    setPreviewState({ status: 'loading', objectUrl: null });
    setScale(1);
    void downloadFile(file.id)
      .then((blob) => {
        if (!blob.type.toLowerCase().startsWith('image/')) {
          throw new Error('Downloaded file is not an image');
        }

        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setPreviewState({ status: 'loaded', objectUrl });
      })
      .catch(() => {
        if (!isCancelled) {
          setPreviewState({ status: 'failed', objectUrl: null });
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function updateScale(nextScale: number): void {
    setScale(Math.min(3, Math.max(0.5, nextScale)));
  }

  return (
    <div
      className="image-lightbox-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="image-lightbox" role="dialog" aria-modal="true" aria-labelledby="image-preview-title">
        <header className="image-lightbox-header">
          <strong id="image-preview-title">{file.originalName}</strong>
          <button type="button" className="image-lightbox-icon-button" aria-label={t('chat.closePreview')} onClick={onClose}>
            &times;
          </button>
        </header>
        <div className="image-lightbox-stage">
          {previewState.status === 'loaded' && previewState.objectUrl ? (
            <img
              src={previewState.objectUrl}
              alt={file.originalName}
              style={{ transform: `scale(${scale})` }}
            />
          ) : (
            <p className={`image-lightbox-state ${previewState.status === 'failed' ? 'is-error' : ''}`}>
              {previewState.status === 'failed' ? t('chat.imagePreviewFailed') : t('chat.imagePreviewLoading')}
            </p>
          )}
        </div>
        <footer className="image-lightbox-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={scale <= 0.5}
            onClick={() => updateScale(scale - 0.25)}
          >
            {t('chat.zoomOut')}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={scale === 1}
            onClick={() => updateScale(1)}
          >
            {t('chat.zoomReset')}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={scale >= 3}
            onClick={() => updateScale(scale + 0.25)}
          >
            {t('chat.zoomIn')}
          </button>
          <button type="button" className="primary-button compact-button" onClick={onDownload}>
            {t('chat.download')}
          </button>
          <button type="button" className="secondary-button compact-button" onClick={onClose}>
            {t('chat.closePreview')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function NavIcon({
  src,
  fallback,
  label,
}: {
  src: string | null;
  fallback: string;
  label: string;
}): JSX.Element {
  if (!src) {
    return <span className="nav-icon-fallback">{fallback}</span>;
  }

  return (
    <span className="nav-icon-shell">
      <img
        className="nav-icon-img"
        src={src}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
          event.currentTarget.parentElement?.setAttribute('data-icon-missing', 'true');
        }}
      />
      <span className="nav-icon-fallback" aria-label={label}>
        {fallback}
      </span>
    </span>
  );
}

function MenuItemIcon({
  src,
  fallback,
  label,
}: {
  src: string | null;
  fallback: string;
  label: string;
}): JSX.Element {
  if (!src) {
    return <span className="menu-item-icon-fallback">{fallback}</span>;
  }

  return (
    <span className="menu-item-icon">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
          event.currentTarget.parentElement?.setAttribute('data-icon-missing', 'true');
        }}
      />
      <span className="menu-item-icon-fallback" aria-label={label}>
        {fallback}
      </span>
    </span>
  );
}

interface FileUploadState {
  isUploading: boolean;
  notice: string | null;
  error: string | null;
}

interface DownloadSuccessNotice {
  fileId: string;
  message: string;
  path: string;
}

type FileDownloadStatus = 'downloading' | 'failed';
type MainView = 'messages' | 'contacts';
type MessageMenuAction = 'copy' | 'download' | 'forward' | 'retry' | 'edit' | 'recall' | 'deleteLocal';
type MessageContextMenuState = {
  message: ChatMessage;
  x: number;
  y: number;
};
type MessageNoticeState = {
  message: string;
  isError: boolean;
};
type ConversationContextMenuState = {
  conversation: Conversation;
  x: number;
  y: number;
};
type MessageMenuItem = {
  action: MessageMenuAction;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
  isDanger?: boolean;
  disabled?: boolean;
};
type ConversationMenuAction = 'pin' | 'unpin' | 'markUnread' | 'markRead' | 'hide';
type ConversationMenuItem = {
  action: ConversationMenuAction;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
  isDanger?: boolean;
};
type ConversationPreview = {
  summary: string;
  time: string | null;
  unreadCount: number;
};
type EmojiGroup = {
  id: string;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
  items: string[];
};
type ImagePreviewState =
  | { status: 'loading'; objectUrl: null }
  | { status: 'failed'; objectUrl: null }
  | { status: 'loaded'; objectUrl: string };
type ImagePreviewWindowPayload = {
  id: string;
  originalName: string;
  dataUrl: string;
};
type ImagePreviewReadyPayload = {
  label: string;
};
type FileBadgeKind = 'word' | 'sheet' | 'slide' | 'pdf' | 'text' | 'archive' | 'image' | 'generic';
type FileBadge = {
  label: string;
  kind: FileBadgeKind;
  iconSrc: string | null;
};

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;
const MESSAGE_DRAFT_MAX_LENGTH = 5000;
const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'common',
    labelKey: 'chat.emojiGroupCommon',
    items: ['😀', '😂', '😊', '😍', '🥰', '😎', '😭', '😅', '👍', '👏', '🙏', '❤️', '🔥', '🎉', '✨'],
  },
  {
    id: 'faces',
    labelKey: 'chat.emojiGroupFaces',
    items: ['🙂', '😄', '😁', '😆', '😉', '😋', '😘', '🤔', '😐', '😴', '😢', '😡', '😱', '🤯', '🥳'],
  },
  {
    id: 'gestures',
    labelKey: 'chat.emojiGroupGestures',
    items: ['👋', '👌', '✌️', '🤝', '🙌', '💪', '🤟', '👀', '💯', '✅', '❌', '⭐', '💡', '📌', '🚀'],
  },
];
const MESSAGE_TIME_DIVIDER_INTERVAL_MS = 5 * 60 * 1000;
const IMAGE_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FILE_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);
const IMAGE_UPLOAD_ACCEPT = Array.from(IMAGE_UPLOAD_MIME_TYPES).join(',');
const FILE_UPLOAD_ACCEPT = Array.from(FILE_UPLOAD_MIME_TYPES).join(',');
const NAV_ICON_SOURCES = {
  messages: '/vector_icon/messages-square.svg',
  contacts: '/vector_icon/users-round.svg',
  more: '/vector_icon/menu.svg',
  settings: '/vector_icon/settings.svg',
  logout: '/vector_icon/log-out.svg',
} as const;
const FILE_ICON_SOURCES: Record<FileBadgeKind, string | null> = {
  word: '/file_icon/microsoft_word_macos_bigsur_icon_189948.png',
  sheet: '/file_icon/microsoft_excel_macos_bigsur_icon_189980.png',
  slide: '/file_icon/microsoft_powerpoint_macos_bigsur_icon_189966.png',
  pdf: null,
  text: '/file_icon/txt_filetype_icon_177515.png',
  archive: null,
  image: null,
  generic: null,
};
const IMAGE_PREVIEW_OPEN_EVENT = 'image-preview:open';
const IMAGE_PREVIEW_READY_EVENT = 'image-preview:ready';

function isSupportedUpload(file: File, requestedKind: FileKind): boolean {
  const mimeType = file.type.toLowerCase();
  return requestedKind === 'IMAGE'
    ? IMAGE_UPLOAD_MIME_TYPES.has(mimeType)
    : FILE_UPLOAD_MIME_TYPES.has(mimeType);
}

function formatUploadNotice(metadata: FileMetadataResponse): string {
  return `${metadata.originalName} (${formatFileSize(Number(metadata.sizeBytes))})`;
}

function formatDownloadSavedNotice(
  t: ReturnType<typeof useI18n>['t'],
  localPath: string,
): string {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) {
    return t('chat.downloadSaved');
  }

  return t('chat.downloadSavedTo').replace('{{path}}', normalizedPath);
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${sizeBytes} B`;
}

function formatFileBadge(originalName: string): FileBadge {
  const extension = originalName.split('.').pop()?.trim().toLocaleLowerCase();
  if (!extension || extension === originalName) {
    return { label: 'FILE', kind: 'generic', iconSrc: FILE_ICON_SOURCES.generic };
  }

  const fileBadgeByExtension: Record<string, FileBadge> = {
    doc: { label: 'DOC', kind: 'word', iconSrc: FILE_ICON_SOURCES.word },
    docx: { label: 'DOCX', kind: 'word', iconSrc: FILE_ICON_SOURCES.word },
    xls: { label: 'XLS', kind: 'sheet', iconSrc: FILE_ICON_SOURCES.sheet },
    xlsx: { label: 'XLSX', kind: 'sheet', iconSrc: FILE_ICON_SOURCES.sheet },
    ppt: { label: 'PPT', kind: 'slide', iconSrc: FILE_ICON_SOURCES.slide },
    pptx: { label: 'PPTX', kind: 'slide', iconSrc: FILE_ICON_SOURCES.slide },
    pdf: { label: 'PDF', kind: 'pdf', iconSrc: null },
    txt: { label: 'TXT', kind: 'text', iconSrc: FILE_ICON_SOURCES.text },
    zip: { label: 'ZIP', kind: 'archive', iconSrc: null },
    png: { label: 'PNG', kind: 'image', iconSrc: null },
    jpg: { label: 'JPG', kind: 'image', iconSrc: null },
    jpeg: { label: 'JPG', kind: 'image', iconSrc: null },
    webp: { label: 'WEBP', kind: 'image', iconSrc: null },
  };

  return fileBadgeByExtension[extension] ?? { label: 'FILE', kind: 'generic', iconSrc: FILE_ICON_SOURCES.generic };
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const didCopy = document.execCommand('copy');
    if (!didCopy) {
      throw new Error('Copy command failed');
    }
  } finally {
    textarea.remove();
  }
}

async function isTauriRuntime(): Promise<boolean> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return true;
  }

  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return false;
  }
}

async function updateTrayUnreadCount(unreadCount: number): Promise<void> {
  if (!(await isTauriRuntime())) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_tray_unread_count', {
      unreadCount: Math.max(0, Math.min(unreadCount, 9999)),
    });
  } catch {
    // Tray updates are best-effort and should never affect chat rendering.
  }
}

async function blobToByteArray(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Image preview data is unavailable'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Image preview data failed'));
    reader.readAsDataURL(blob);
  });
}

async function openImagePreviewWindow(payload: ImagePreviewWindowPayload): Promise<void> {
  const label = `image-preview-${payload.id.replace(/[^a-zA-Z0-9-/:_]/g, '_')}-${Date.now()}`;
  const [{ WebviewWindow }, { emitTo, listen }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/event'),
  ]);
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeoutId = window.setTimeout(() => {
    unlistenReady();
    rejectReady?.(new Error('Image preview window did not report ready'));
  }, 5000);
  const unlistenReady = await listen<ImagePreviewReadyPayload>(IMAGE_PREVIEW_READY_EVENT, (event) => {
    if (event.payload.label !== label) {
      return;
    }

    window.clearTimeout(timeoutId);
    unlistenReady();
    resolveReady?.();
  });

  const webview = new WebviewWindow(label, {
    url: '/#/preview/image',
    title: payload.originalName,
    width: 900,
    height: 720,
    minWidth: 520,
    minHeight: 420,
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once('tauri://created', () => resolve());
    void webview.once<string>('tauri://error', (event) => reject(new Error(event.payload)));
  });

  await readyPromise;
  await emitTo(label, IMAGE_PREVIEW_OPEN_EVENT, payload);
}

async function openConversationSearchWindow(
  payload: ConversationSearchPayload,
  title: string,
): Promise<void> {
  if (!(await isTauriRuntime())) {
    return;
  }

  const label = `conversation-search-${payload.conversationId.replace(/[^a-zA-Z0-9-/:_]/g, '_')}-${Date.now()}`;
  const [{ WebviewWindow }, { emitTo, listen }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/event'),
  ]);
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeoutId = window.setTimeout(() => {
    unlistenReady();
    rejectReady?.(new Error('Conversation search window did not report ready'));
  }, 5000);
  const unlistenReady = await listen<{ label: string }>(CONVERSATION_SEARCH_READY_EVENT, (event) => {
    if (event.payload.label !== label) {
      return;
    }

    window.clearTimeout(timeoutId);
    unlistenReady();
    resolveReady?.();
  });

  const webview = new WebviewWindow(label, {
    url: '/#/conversation-search',
    title,
    width: 760,
    height: 640,
    minWidth: 520,
    minHeight: 520,
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once('tauri://created', () => resolve());
    void webview.once<string>('tauri://error', (event) => reject(new Error(event.payload)));
  });

  await readyPromise;
  await emitTo(label, CONVERSATION_SEARCH_OPEN_EVENT, payload);
  window.setTimeout(() => {
    void emitTo(label, CONVERSATION_SEARCH_OPEN_EVENT, payload);
  }, 150);
}

function buildConversationSearchPayload(
  conversation: Conversation,
  messages: ChatMessage[],
  currentUserId: string | null,
  currentUserName: string,
): ConversationSearchPayload {
  const peerName = conversation.peer?.displayName ?? 'LanGram';
  const peerAvatarUrl = conversation.peer?.avatarUrl ?? null;

  return {
    conversationId: conversation.id,
    title: peerName,
    messages: (messages.length > 0 ? messages : buildConversationSearchFallbackMessages(conversation))
      .filter((message) => message.status !== 'recalled')
      .map((message) => {
        const isCurrentUser = Boolean(currentUserId && message.senderId === currentUserId);
        return {
          id: message.id,
          senderName: isCurrentUser ? currentUserName : peerName,
          avatarUrl: isCurrentUser ? null : peerAvatarUrl,
          plaintext: message.plaintext,
          messageType: message.messageType,
          fileName: message.file?.originalName ?? null,
          createdAt: message.createdAt,
        } satisfies ConversationSearchMessage;
      }),
  };
}

function buildConversationSearchFallbackMessages(conversation: Conversation): ChatMessage[] {
  if (!conversation.lastMessage || conversation.lastMessage.status === 'RECALLED') {
    return [];
  }

  return [
    {
      id: conversation.lastMessage.id,
      conversationId: conversation.id,
      senderId: conversation.lastMessage.senderId,
      messageType: conversation.lastMessage.messageType,
      plaintext: conversation.lastMessagePlaintext ?? '',
      file: conversation.lastMessage.file,
      status: conversation.lastMessage.status.toLowerCase() as ChatMessage['status'],
      createdAt: conversation.lastMessage.createdAt,
      editedAt: conversation.lastMessage.editedAt,
      recalledAt: conversation.lastMessage.recalledAt,
      isOwn: false,
    },
  ];
}

interface ForwardTarget {
  id: string;
  type: 'conversation' | 'friend';
  label: string;
  conversationId: string;
  friendUserId: string;
  isCurrentChat: boolean;
}

interface PendingFriendDelete {
  friendship: FriendItem;
  conversationId: string | null;
}

function buildForwardTargets(
  conversations: Conversation[],
  friendsWithoutConversation: FriendItem[],
  unknownPeerLabel: string,
  selectedConversationId: string | null,
): ForwardTarget[] {
  return [
    ...conversations.map((conversation) => ({
      id: `conversation:${conversation.id}`,
      type: 'conversation' as const,
      label: conversation.peer?.displayName ?? unknownPeerLabel,
      conversationId: conversation.id,
      friendUserId: '',
      isCurrentChat: conversation.id === selectedConversationId,
    })),
    ...friendsWithoutConversation.map((friend) => ({
      id: `friend:${friend.friend.id}`,
      type: 'friend' as const,
      label: friend.friend.displayName,
      conversationId: '',
      friendUserId: friend.friend.id,
      isCurrentChat: false,
    })),
  ];
}

function renderHighlightedText(text: string, query: string): Array<string | JSX.Element> | string {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return text;
  }

  const lowerText = text.toLocaleLowerCase();
  const fragments: Array<string | JSX.Element> = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      fragments.push(text.slice(cursor, matchIndex));
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    fragments.push(
      <mark className="message-highlight" key={`${matchIndex}-${matchEnd}`}>
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }

  return fragments;
}

