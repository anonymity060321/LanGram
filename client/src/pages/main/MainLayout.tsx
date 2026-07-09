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
import { getFileIconByName } from '../../utils/fileIcons';
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
const GROUP_SETTINGS_AUTOSAVE_DELAY_MS = 800;
const GROUP_INTRO_MAX_LENGTH = 500;
const GROUP_AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const GROUP_AVATAR_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const GROUP_AVATAR_UPLOAD_ACCEPT = Array.from(GROUP_AVATAR_UPLOAD_MIME_TYPES).join(',');
type GroupManagementView = 'overview' | 'members' | 'admins';


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
  const updateGroupConversation = useChatStore((state) => state.updateGroupConversation);
  const updateGroupNickname = useChatStore((state) => state.updateGroupNickname);
  const updateGroupRemark = useChatStore((state) => state.updateGroupRemark);
  const leaveGroup = useChatStore((state) => state.leaveGroup);
  const addGroupMembers = useChatStore((state) => state.addGroupMembers);
  const removeGroupMember = useChatStore((state) => state.removeGroupMember);
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
  const [groupNicknameDraft, setGroupNicknameDraft] = useState('');
  const [groupRemarkDraft, setGroupRemarkDraft] = useState('');
  const [groupNicknameNotice, setGroupNicknameNotice] = useState<string | null>(null);
  const [groupNicknameError, setGroupNicknameError] = useState<string | null>(null);
  const [isSavingGroupNickname, setIsSavingGroupNickname] = useState(false);
  const [isSavingGroupRemark, setIsSavingGroupRemark] = useState(false);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [pendingLeaveGroupConversationId, setPendingLeaveGroupConversationId] = useState<string | null>(null);
  const [leaveGroupError, setLeaveGroupError] = useState<string | null>(null);
  const [isAddingGroupMembers, setIsAddingGroupMembers] = useState(false);
  const [isGroupInviteDialogOpen, setIsGroupInviteDialogOpen] = useState(false);
  const [selectedGroupMemberAddIds, setSelectedGroupMemberAddIds] = useState<string[]>([]);
  const [addGroupMembersError, setAddGroupMembersError] = useState<string | null>(null);
  const [addGroupMembersNotice, setAddGroupMembersNotice] = useState<string | null>(null);
  const [removeGroupMemberError, setRemoveGroupMemberError] = useState<string | null>(null);
  const [isRemovingGroupMember, setIsRemovingGroupMember] = useState(false);
  const [pendingRemoveGroupMemberId, setPendingRemoveGroupMemberId] = useState<string | null>(null);
  const [isGroupManagementOpen, setIsGroupManagementOpen] = useState(false);
  const [groupManagementView, setGroupManagementView] = useState<GroupManagementView>('overview');
  const [groupManagementName, setGroupManagementName] = useState('');
  const [groupManagementIntro, setGroupManagementIntro] = useState('');
  const [isDiscardGroupChangesConfirmOpen, setIsDiscardGroupChangesConfirmOpen] = useState(false);
  const [groupManagementError, setGroupManagementError] = useState<string | null>(null);
  const [groupManagementNotice, setGroupManagementNotice] = useState<string | null>(null);
  const [isSavingGroupManagement, setIsSavingGroupManagement] = useState(false);
  const [isUploadingGroupAvatar, setIsUploadingGroupAvatar] = useState(false);
  const [groupAvatarError, setGroupAvatarError] = useState<string | null>(null);
  const [groupManagementSearchQuery, setGroupManagementSearchQuery] = useState('');
  const [groupInviteSearchQuery, setGroupInviteSearchQuery] = useState('');
  const [selectedGroupMemberProfileUserId, setSelectedGroupMemberProfileUserId] = useState<string | null>(null);
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
  const [openAddFriendPanelKey, setOpenAddFriendPanelKey] = useState(0);
  const [nonFriendNoticePulseKey, setNonFriendNoticePulseKey] = useState(0);
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
  const groupNicknameSaveTimerRef = useRef<number | null>(null);
  const groupRemarkSaveTimerRef = useRef<number | null>(null);

  const lastSavedGroupNicknameRef = useRef('');
  const lastSavedGroupRemarkRef = useRef('');

  useDismissOnOutsideOrEscape(isAppMenuOpen, appMenuRef, setIsAppMenuOpen);
  useDismissOnOutsideOrEscape(isChatActionsOpen, chatActionsRef, setIsChatActionsOpen);
  useDismissOnOutsideOrEscape(isSendShortcutMenuOpen, sendShortcutRef, setIsSendShortcutMenuOpen);
  useDismissOnOutsideOrEscape(isEmojiPanelOpen, emojiPanelRef, setIsEmojiPanelOpen);

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null;
  const isUsingCachedMessages = selectedConversationId
    ? isUsingCachedMessagesByConversation[selectedConversationId] ?? false
    : false;
  const isSelectedConversationDirect = selectedConversation?.type === 'DIRECT';
  const isSelectedConversationGroup = selectedConversation?.type === 'GROUP';
  const selectedConversationTitle = selectedConversation
    ? getConversationDisplayName(selectedConversation, t('chat.unknownPeer'), user?.id ?? null)
    : null;
  const selectedConversationProfileTitle =
    selectedConversation?.type === 'GROUP'
      ? selectedConversation.title?.trim() || t('chat.groupConversation')
      : selectedConversationTitle;
  const profileUser = isSelectedConversationDirect ? selectedConversation?.peer ?? null : user ?? null;
  const currentGroupMember = isSelectedConversationGroup && user?.id
    ? selectedConversation?.members.find((member) => member.id === user.id && !member.leftAt) ?? null
    : null;
  const isCurrentUserGroupOwner = currentGroupMember?.role === 'OWNER';
  const profilePresence = !isNetworkOnline
    ? t('presence.offline')
    : isSelectedConversationGroup && selectedConversation
    ? formatGroupMembers(selectedConversation.memberCount, t)
    : selectedConversation?.peer
    ? formatPresence(selectedConversation.peer.isOnline, selectedConversation.peer.lastSeenAt, t)
    : t('presence.online');
  const isFriendshipRequiredError = chatError === 'FRIENDSHIP_REQUIRED' || chatError === 'NOT_FRIENDS';
  const isSelectedPeerKnownNonFriend =
    isSelectedConversationDirect && selectedConversation?.peer
      ? isPeerKnownNonFriend(selectedConversation.peer.id, friends, hasLoadedFriends, trustedFriendPeerId)
      : false;
  const selectedPeerFriendship = isSelectedConversationDirect && selectedConversation?.peer
    ? friends.find((item) => item.friend.id === selectedConversation.peer?.id) ?? null
    : null;
  const isSelectedPeerNonFriend =
    isSelectedConversationDirect && (isFriendshipRequiredError || isSelectedPeerKnownNonFriend);
  const isSelectedPeerFriend =
    !isSelectedPeerNonFriend &&
    (Boolean(selectedPeerFriendship) ||
      Boolean(
        selectedConversation?.peer &&
          trustedFriendPeerId === selectedConversation.peer.id,
      ));
  const chatTopNotice =
    selectedConversation && isSelectedConversationDirect && isSelectedPeerNonFriend
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


  const cancelGroupNicknameAutosaveTimer = useCallback((): void => {
    if (groupNicknameSaveTimerRef.current === null) {
      return;
    }

    window.clearTimeout(groupNicknameSaveTimerRef.current);
    groupNicknameSaveTimerRef.current = null;
  }, []);

  const cancelGroupRemarkAutosaveTimer = useCallback((): void => {
    if (groupRemarkSaveTimerRef.current === null) {
      return;
    }

    window.clearTimeout(groupRemarkSaveTimerRef.current);
    groupRemarkSaveTimerRef.current = null;
  }, []);

  const cancelGroupSettingsAutosaveTimers = useCallback((): void => {
    cancelGroupNicknameAutosaveTimer();
    cancelGroupRemarkAutosaveTimer();
  }, [cancelGroupNicknameAutosaveTimer, cancelGroupRemarkAutosaveTimer]);

  const flushGroupNicknameSave = useCallback(async (): Promise<void> => {
    cancelGroupNicknameAutosaveTimer();
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return;
    }

    const normalizedNickname = groupNicknameDraft.trim();
    if (normalizedNickname === lastSavedGroupNicknameRef.current) {
      return;
    }

    setGroupNicknameNotice(null);
    setGroupNicknameError(null);
    setIsSavingGroupNickname(true);
    const success = await updateGroupNickname(selectedConversation.id, normalizedNickname || null);
    setIsSavingGroupNickname(false);

    if (!success) {
      setGroupNicknameError(t('chat.groupSettingsAutosaveFailed'));
      return;
    }

    lastSavedGroupNicknameRef.current = normalizedNickname;
    setGroupNicknameDraft(normalizedNickname);
    setGroupNicknameNotice(t('chat.groupSettingsAutosaved'));
  }, [cancelGroupNicknameAutosaveTimer, groupNicknameDraft, selectedConversation, t, updateGroupNickname]);

  const flushGroupRemarkSave = useCallback(async (): Promise<void> => {
    cancelGroupRemarkAutosaveTimer();
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return;
    }

    const normalizedRemark = groupRemarkDraft.trim();
    if (normalizedRemark === lastSavedGroupRemarkRef.current) {
      return;
    }

    setGroupNicknameNotice(null);
    setGroupNicknameError(null);
    setIsSavingGroupRemark(true);
    const success = await updateGroupRemark(selectedConversation.id, normalizedRemark || null);
    setIsSavingGroupRemark(false);

    if (!success) {
      setGroupNicknameError(t('chat.groupSettingsAutosaveFailed'));
      return;
    }

    lastSavedGroupRemarkRef.current = normalizedRemark;
    setGroupRemarkDraft(normalizedRemark);
    setGroupNicknameNotice(t('chat.groupSettingsAutosaved'));
  }, [cancelGroupRemarkAutosaveTimer, groupRemarkDraft, selectedConversation, t, updateGroupRemark]);

  const flushGroupSettingsSave = useCallback(async (): Promise<void> => {
    await Promise.all([flushGroupNicknameSave(), flushGroupRemarkSave()]);
  }, [flushGroupNicknameSave, flushGroupRemarkSave]);

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
    const savedNickname = currentGroupMember?.groupNickname?.trim() ?? '';
    const savedRemark = currentGroupMember?.groupRemark?.trim() ?? '';
    lastSavedGroupNicknameRef.current = savedNickname;
    lastSavedGroupRemarkRef.current = savedRemark;
    setGroupNicknameDraft(savedNickname);
    setGroupRemarkDraft(savedRemark);
    setGroupNicknameNotice(null);
    setGroupNicknameError(null);
    cancelGroupSettingsAutosaveTimers();
  }, [
    cancelGroupSettingsAutosaveTimers,
    currentGroupMember?.groupNickname,
    currentGroupMember?.groupRemark,
    currentGroupMember?.id,
    selectedConversationId,
  ]);

  useEffect(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return undefined;
    }

    const normalizedNickname = groupNicknameDraft.trim();
    if (normalizedNickname === lastSavedGroupNicknameRef.current) {
      return undefined;
    }

    cancelGroupNicknameAutosaveTimer();
    groupNicknameSaveTimerRef.current = window.setTimeout(() => {
      void flushGroupNicknameSave();
    }, GROUP_SETTINGS_AUTOSAVE_DELAY_MS);

    return () => cancelGroupNicknameAutosaveTimer();
  }, [
    cancelGroupNicknameAutosaveTimer,
    flushGroupNicknameSave,
    groupNicknameDraft,
    selectedConversation,
  ]);

  useEffect(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return undefined;
    }

    const normalizedRemark = groupRemarkDraft.trim();
    if (normalizedRemark === lastSavedGroupRemarkRef.current) {
      return undefined;
    }

    cancelGroupRemarkAutosaveTimer();
    groupRemarkSaveTimerRef.current = window.setTimeout(() => {
      void flushGroupRemarkSave();
    }, GROUP_SETTINGS_AUTOSAVE_DELAY_MS);

    return () => cancelGroupRemarkAutosaveTimer();
  }, [
    cancelGroupRemarkAutosaveTimer,
    flushGroupRemarkSave,
    groupRemarkDraft,
    selectedConversation,
  ]);

  useEffect(() => () => cancelGroupSettingsAutosaveTimers(), [cancelGroupSettingsAutosaveTimers]);
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
    setIsGroupInviteDialogOpen(false);
    setSelectedGroupMemberAddIds([]);
    setGroupInviteSearchQuery('');
    setAddGroupMembersError(null);
    setAddGroupMembersNotice(null);
    setIsGroupManagementOpen(false);
    setGroupManagementView('overview');
    setGroupManagementIntro('');
    setIsDiscardGroupChangesConfirmOpen(false);
    setGroupManagementError(null);
    setGroupManagementSearchQuery('');
    setPendingRemoveGroupMemberId(null);
    setRemoveGroupMemberError(null);
    setGroupManagementNotice(null);
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
        (friend) =>
          !conversations.some(
            (conversation) =>
              conversation.type === 'DIRECT' && conversation.peer?.id === friend.friend.id,
          ),
      ),
    [conversations, friends],
  );
  const groupInviteActiveMemberIds = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return new Set<string>();
    }

    return new Set(
      selectedConversation.members
        .filter((member) => !member.leftAt)
        .map((member) => member.id),
    );
  }, [selectedConversation]);
  const groupInviteFriends = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !user?.id) {
      return [];
    }

    return friends.filter((friendship) => friendship.friend.id !== user.id);
  }, [friends, selectedConversation, user?.id]);
  const availableGroupMemberFriends = useMemo(
    () => groupInviteFriends.filter((friendship) => !groupInviteActiveMemberIds.has(friendship.friend.id)),
    [groupInviteActiveMemberIds, groupInviteFriends],
  );  const selectedGroupMemberProfile = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !selectedGroupMemberProfileUserId) {
      return null;
    }

    return selectedConversation.members.find(
      (member) => member.id === selectedGroupMemberProfileUserId && !member.leftAt,
    ) ?? null;
  }, [selectedConversation, selectedGroupMemberProfileUserId]);
  const selectedGroupMemberFriendship = selectedGroupMemberProfile
    ? friends.find((friendship) => friendship.friend.id === selectedGroupMemberProfile.id) ?? null
    : null;
  useEffect(() => {
    const availableIds = new Set(availableGroupMemberFriends.map((friendship) => friendship.friend.id));
    setSelectedGroupMemberAddIds((current) => current.filter((userId) => availableIds.has(userId)));
  }, [availableGroupMemberFriends]);
  const forwardTargets = useMemo(
    () => buildForwardTargets(
      conversations,
      visibleFriends,
      t('chat.unknownPeer'),
      selectedConversationId,
      user?.id ?? null,
    ),
    [conversations, selectedConversationId, t, user?.id, visibleFriends],
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
  async function handleMessageGroupMember(friendship: FriendItem): Promise<void> {
    const opened = await handleMessageFriend(friendship);
    if (opened) {
      setSelectedGroupMemberProfileUserId(null);
    }
  }

  function requestAddGroupMembers(): void {
    setIsGroupInviteDialogOpen(true);
    setAddGroupMembersError(null);
    setAddGroupMembersNotice(null);
    setGroupInviteSearchQuery('');
  }

  function requestRemoveGroupMemberConfirmation(memberUserId: string): void {
    setPendingRemoveGroupMemberId(memberUserId);
    setRemoveGroupMemberError(null);
  }

  function cancelRemoveGroupMemberConfirmation(): void {
    if (isRemovingGroupMember) {
      return;
    }

    setPendingRemoveGroupMemberId(null);
    setRemoveGroupMemberError(null);
  }

  async function confirmRemoveGroupMember(): Promise<void> {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !pendingRemoveGroupMemberId) {
      return;
    }

    const memberUserId = pendingRemoveGroupMemberId;
    setIsRemovingGroupMember(true);
    setRemoveGroupMemberError(null);
    const success = await removeGroupMember(selectedConversation.id, memberUserId);
    setIsRemovingGroupMember(false);

    if (!success) {
      setRemoveGroupMemberError(t('chat.removeGroupMemberFailed'));
      return;
    }

    setPendingRemoveGroupMemberId(null);
    if (selectedGroupMemberProfileUserId === memberUserId) {
      setSelectedGroupMemberProfileUserId(null);
    }
    setAddGroupMembersNotice(t('chat.groupMemberRemoved'));
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitMessageDraft();
  }

  async function submitMessageDraft(): Promise<void> {
    if (!user || !selectedConversationId || !messageDraft.trim()) {
      return;
    }

    const plaintext = messageDraft.trim();

    if (selectedConversation?.peer && isSelectedPeerNonFriend) {
      createFailedTextMessage(selectedConversationId, plaintext, user.id);
      setNonFriendNoticePulseKey((current) => current + 1);
      setMessageDraft('');
      return;
    }

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
    if (file.size <= 0) {
      setUploadState({ isUploading: false, notice: null, error: t('chat.emptyFileUpload') });
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

    const friendship = selectedPeerFriendship;
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

  function handleAddFriendFromMenu(): void {
    setIsChatActionsOpen(false);
    setActiveView('contacts');
    setOpenAddFriendPanelKey((current) => current + 1);
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

  function currentGroupManagementName(): string {
    return selectedConversation?.title?.trim() || t('chat.groupConversation');
  }

  function currentGroupManagementIntro(): string {
    return selectedConversation?.intro?.trim() ?? '';
  }

  function hasUnsavedGroupManagementChanges(): boolean {
    return groupManagementName.trim() !== currentGroupManagementName()
      || groupManagementIntro.trim() !== currentGroupManagementIntro();
  }

  function resetGroupManagementState(): void {
    setIsGroupManagementOpen(false);
    setGroupManagementView('overview');
    setGroupManagementError(null);
    setGroupManagementSearchQuery('');
    setPendingRemoveGroupMemberId(null);
    setRemoveGroupMemberError(null);
    setGroupManagementNotice(null);
    setGroupAvatarError(null);
    setGroupManagementIntro('');
    setIsDiscardGroupChangesConfirmOpen(false);
  }

  function openGroupManagement(): void {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !isCurrentUserGroupOwner) {
      return;
    }

    setRemoveGroupMemberError(null);
    setGroupManagementError(null);
    setGroupManagementSearchQuery('');
    setPendingRemoveGroupMemberId(null);
    setGroupManagementNotice(null);
    setGroupAvatarError(null);
    setGroupManagementName(selectedConversation.title?.trim() || t('chat.groupConversation'));
    setGroupManagementIntro(selectedConversation.intro ?? '');
    setGroupManagementView('overview');
    setIsDiscardGroupChangesConfirmOpen(false);
    setIsGroupManagementOpen(true);
  }

  function requestCloseGroupManagement(): void {
    if (isSavingGroupManagement || isUploadingGroupAvatar) {
      return;
    }

    if (hasUnsavedGroupManagementChanges()) {
      setIsDiscardGroupChangesConfirmOpen(true);
      return;
    }

    resetGroupManagementState();
  }

  function continueEditingGroupManagement(): void {
    setIsDiscardGroupChangesConfirmOpen(false);
  }

  function discardGroupManagementChanges(): void {
    resetGroupManagementState();
  }

  async function saveGroupManagement(): Promise<void> {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !isCurrentUserGroupOwner || isSavingGroupManagement) {
      return;
    }

    const normalizedName = groupManagementName.trim();
    const normalizedIntro = groupManagementIntro.trim();
    if (!normalizedName) {
      setGroupManagementNotice(null);
      setGroupManagementError(t('chat.groupNameRequired'));
      return;
    }

    if (normalizedIntro.length > GROUP_INTRO_MAX_LENGTH) {
      setGroupManagementNotice(null);
      setGroupManagementError(t('chat.groupIntroTooLong'));
      return;
    }

    if (!hasUnsavedGroupManagementChanges()) {
      return;
    }

    setIsSavingGroupManagement(true);
    setGroupManagementError(null);
    setGroupManagementNotice(null);
    const success = await updateGroupConversation(selectedConversation.id, {
      name: normalizedName,
      intro: normalizedIntro.length > 0 ? normalizedIntro : null,
    });
    setIsSavingGroupManagement(false);

    if (!success) {
      setGroupManagementError(t('chat.groupInfoSaveFailed'));
      return;
    }

    setGroupManagementName(normalizedName);
    setGroupManagementIntro(normalizedIntro);
    setGroupManagementNotice(t('chat.groupNameSaved'));
  }

  async function handleGroupAvatarInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file || !selectedConversation || selectedConversation.type !== 'GROUP' || !isCurrentUserGroupOwner) {
      return;
    }

    const mimeType = file.type.trim().toLowerCase();
    if (!GROUP_AVATAR_UPLOAD_MIME_TYPES.has(mimeType)) {
      setGroupAvatarError(t('chat.groupAvatarInvalidType'));
      setGroupManagementNotice(null);
      return;
    }

    if (file.size > GROUP_AVATAR_MAX_SIZE_BYTES) {
      setGroupAvatarError(t('chat.groupAvatarTooLarge'));
      setGroupManagementNotice(null);
      return;
    }

    setIsUploadingGroupAvatar(true);
    setGroupAvatarError(null);
    setGroupManagementNotice(null);

    try {
      const metadata = await uploadFile({
        file,
        conversationId: selectedConversation.id,
        kind: 'IMAGE',
      });
      const success = await updateGroupConversation(selectedConversation.id, {
        avatarUrl: buildGroupAvatarUrl(metadata.id),
      });

      if (!success) {
        setGroupAvatarError(t('chat.groupAvatarSaveFailed'));
      }
    } catch {
      setGroupAvatarError(t('chat.groupAvatarUploadFailed'));
    } finally {
      setIsUploadingGroupAvatar(false);
    }
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


  function requestLeaveGroupConfirmation(): void {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return;
    }

    setIsChatActionsOpen(false);
    setLeaveGroupError(null);
    setPendingLeaveGroupConversationId(selectedConversation.id);
  }

  function cancelLeaveGroupConfirmation(): void {
    if (isLeavingGroup) {
      return;
    }

    setPendingLeaveGroupConversationId(null);
    setLeaveGroupError(null);
  }

  async function confirmLeaveGroup(): Promise<void> {
    if (!pendingLeaveGroupConversationId) {
      return;
    }

    setIsLeavingGroup(true);
    setLeaveGroupError(null);
    setGroupNicknameError(null);
    const conversationId = pendingLeaveGroupConversationId;
    const success = await leaveGroup(conversationId);
    setIsLeavingGroup(false);

    if (!success) {
      setLeaveGroupError(t('chat.leaveGroupFailed'));
      return;
    }

    setPendingLeaveGroupConversationId(null);
    void updateConfig({
      pinnedConversationIds: pinnedConversationIds.filter((id) => id !== conversationId),
      mutedConversationIds: mutedConversationIds.filter((id) => id !== conversationId),
    });
    setReadConversationOverrides((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }
  function togglePendingGroupMember(friendUserId: string): void {
    if (groupInviteActiveMemberIds.has(friendUserId)) {
      return;
    }

    setSelectedGroupMemberAddIds((current) =>
      current.includes(friendUserId)
        ? current.filter((memberUserId) => memberUserId !== friendUserId)
        : [...current, friendUserId],
    );
    setAddGroupMembersError(null);
    setAddGroupMembersNotice(null);
  }

  function cancelAddGroupMembers(): void {
    if (isAddingGroupMembers) {
      return;
    }

    setIsGroupInviteDialogOpen(false);
    setSelectedGroupMemberAddIds([]);
    setGroupInviteSearchQuery('');
    setAddGroupMembersError(null);
  }

  async function submitAddGroupMembers(): Promise<void> {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') {
      return;
    }

    if (selectedGroupMemberAddIds.length === 0) {
      return;
    }

    setIsAddingGroupMembers(true);
    setAddGroupMembersError(null);
    setAddGroupMembersNotice(null);
    try {
      await addGroupMembers(selectedConversation.id, selectedGroupMemberAddIds);
      setIsGroupInviteDialogOpen(false);
      setSelectedGroupMemberAddIds([]);
      setGroupInviteSearchQuery('');
      setAddGroupMembersNotice(t('chat.groupMemberInvited'));
    } catch {
      setAddGroupMembersError(t('chat.inviteMembersFailed'));
    } finally {
      setIsAddingGroupMembers(false);
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
          onConversationOpened={(conversationId) => {
            setPendingConversationActivationId(conversationId);
            setActiveView('messages');
          }}
          onMessageFriend={handleMessageFriend}
          openAddPanelKey={openAddFriendPanelKey}
          addPanelNotice={t('chat.addFriendHint')}
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
                  {conversation.type === 'GROUP' ? (
                    <GroupConversationAvatar
                      conversationId={conversation.id}
                      displayName={getConversationDisplayName(conversation, t('chat.unknownPeer'), user?.id ?? null)}
                      avatarUrl={conversation.avatarUrl}
                    />
                  ) : (
                    <UserAvatar
                      userId={conversation.peer?.id}
                      displayName={getConversationDisplayName(conversation, t('chat.unknownPeer'), user?.id ?? null)}
                      avatarUrl={conversation.peer?.avatarUrl}
                    />
                  )}
                  <span className="conversation-item-body">
                    <span className="conversation-item-header">
                      <strong>{getConversationDisplayName(conversation, t('chat.unknownPeer'), user?.id ?? null)}</strong>
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
            <strong>{selectedConversationTitle ?? user?.displayName ?? t('app.name')}</strong>
            <span>
              {isSelectedConversationGroup && selectedConversation
                ? formatGroupMembers(selectedConversation.memberCount, t)
                : selectedConversation?.peer
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
                      <span className="chat-actions-panel-arrow" aria-hidden="true">&gt;</span>
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
                    {isSelectedConversationDirect ? (
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
                    ) : null}
                  </div>
                  {isSelectedConversationGroup ? (
                    <div className="chat-actions-panel-section">
                      <form
                        className="group-settings-form"
                        aria-busy={isSavingGroupNickname || isSavingGroupRemark}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void flushGroupSettingsSave();
                        }}
                      >
                        <label className="group-settings-field" htmlFor="chat-group-nickname-input">
                          <span className="group-settings-label">{t('chat.myGroupNickname')}</span>
                          <input
                            id="chat-group-nickname-input"
                            className="group-settings-input"
                            value={groupNicknameDraft}
                            maxLength={32}
                            placeholder={t('chat.groupNicknameInputPlaceholder')}
                            disabled={isLeavingGroup}
                            onBlur={() => void flushGroupNicknameSave()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void flushGroupNicknameSave();
                              }
                            }}
                            onChange={(event) => {
                              setGroupNicknameDraft(event.target.value);
                              setGroupNicknameNotice(null);
                              setGroupNicknameError(null);
                            }}
                          />
                        </label>
                        <label className="group-settings-field" htmlFor="chat-group-remark-input">
                          <span className="group-settings-label">{t('chat.groupRemark')}</span>
                          <input
                            id="chat-group-remark-input"
                            className="group-settings-input"
                            value={groupRemarkDraft}
                            maxLength={64}
                            placeholder={t('chat.groupRemarkPlaceholder')}
                            disabled={isLeavingGroup}
                            onBlur={() => void flushGroupRemarkSave()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void flushGroupRemarkSave();
                              }
                            }}
                            onChange={(event) => {
                              setGroupRemarkDraft(event.target.value);
                              setGroupNicknameNotice(null);
                              setGroupNicknameError(null);
                            }}
                          />
                        </label>
                        {groupNicknameNotice ? <small className="group-settings-notice">{groupNicknameNotice}</small> : null}
                        {groupNicknameError ? <small className="group-settings-error">{groupNicknameError}</small> : null}
                      </form>
                    </div>
                  ) : null}
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
                    {isSelectedConversationDirect && selectedConversation?.peer && isSelectedPeerFriend ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-actions-panel-item is-danger"
                        onClick={() => void handleDeleteFriendFromMenu()}
                      >
                        <span>{t('chat.deleteFriend')}</span>
                      </button>
                    ) : null}
                    {isSelectedConversationDirect && selectedConversation?.peer && isSelectedPeerNonFriend ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-actions-panel-item is-primary"
                        onClick={handleAddFriendFromMenu}
                      >
                        <span>{t('chat.addFriend')}</span>
                      </button>
                    ) : null}
                    {isSelectedConversationGroup ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-actions-panel-item is-danger"
                        disabled={isLeavingGroup}
                        onClick={requestLeaveGroupConfirmation}
                      >
                        <span>{t('chat.leaveGroup')}</span>
                      </button>
                    ) : null}
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
              <div
                key={nonFriendNoticePulseKey}
                className={`chat-top-notice${nonFriendNoticePulseKey > 0 ? ' is-attention' : ''}`}
                role="alert"
                aria-live="polite"
              >
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
                currentUserProfile={user}
                peerProfile={selectedConversation.peer}
                memberProfiles={selectedConversation.members}
                conversationType={selectedConversation.type}
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
                      <span aria-hidden="true">{isSendShortcutMenuOpen ? '^' : 'v'}</span>
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
                        <span aria-hidden="true">{sendShortcut === 'enter' ? '✔' : ''}</span>
                        <span>{t('chat.sendWithEnter')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={sendShortcut === 'ctrlEnter'}
                        className="send-shortcut-menu-item"
                        onClick={() => void handleSendShortcutChange('ctrlEnter')}
                      >
                        <span aria-hidden="true">{sendShortcut === 'ctrlEnter' ? '✔' : ''}</span>
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
        {isSelectedConversationGroup ? (
          <GroupConversationAvatar
            conversationId={selectedConversation?.id}
            displayName={selectedConversationProfileTitle ?? t('chat.groupConversation')}
            avatarUrl={selectedConversation?.avatarUrl}
            size="lg"
          />
        ) : (
          <UserAvatar
            userId={profileUser?.id}
            displayName={profileUser?.displayName}
            avatarUrl={profileUser?.avatarUrl}
            size="lg"
          />
        )}
        <strong>
          {isSelectedConversationGroup
            ? selectedConversationProfileTitle ?? t('chat.groupConversation')
            : profileUser?.displayName ?? t('app.name')}
        </strong>
        <span className="presence-text">{profilePresence}</span>
        <span>
          {isSelectedConversationGroup
            ? t('chat.groupChat')
            : profileUser?.statusMessage || profileUser?.email || profileUser?.accountType || 'MVP'}
        </span>
        {isSelectedConversationGroup && selectedConversation ? (
          <GroupProfileActions
            isOwner={isCurrentUserGroupOwner}
            isMuted={isSelectedConversationMuted}
            isLeaving={isLeavingGroup}
            t={t}
            onToggleMute={toggleMutedConversation}
            onManage={openGroupManagement}
            onLeave={requestLeaveGroupConfirmation}
          />
        ) : null}
        {isSelectedConversationGroup && selectedConversation ? (
          selectedGroupMemberProfile ? (
            <GroupMemberProfileCard
              member={selectedGroupMemberProfile}
              friendship={selectedGroupMemberFriendship}
              isSelf={selectedGroupMemberProfile.id === user?.id}
              t={t}
              onBack={() => {
                setSelectedGroupMemberProfileUserId(null);
                setRemoveGroupMemberError(null);
              }}
              onMessage={handleMessageGroupMember}
            />
          ) : (
            <GroupMemberPanel
              members={selectedConversation.members}
              notice={addGroupMembersNotice}
              selectedMemberId={selectedGroupMemberProfileUserId}
              t={t}
              onInvite={requestAddGroupMembers}
              onSelectMember={setSelectedGroupMemberProfileUserId}
            />
          )
        ) : null}
      </aside>
        </>
      )}
      {isSelectedConversationGroup && selectedConversation && isGroupInviteDialogOpen ? (
        <GroupInviteDialog
          friends={groupInviteFriends}
          activeMemberIds={groupInviteActiveMemberIds}
          selectedIds={selectedGroupMemberAddIds}
          searchQuery={groupInviteSearchQuery}
          isSubmitting={isAddingGroupMembers}
          error={addGroupMembersError}
          t={t}
          onToggleFriend={togglePendingGroupMember}
          onSearchQueryChange={setGroupInviteSearchQuery}
          onCancel={cancelAddGroupMembers}
          onSubmit={() => void submitAddGroupMembers()}
        />
      ) : null}
      {isSelectedConversationGroup && selectedConversation && isGroupManagementOpen
        ? createPortal(
            <GroupManagementDialog
              conversation={selectedConversation}
              currentUserId={user?.id ?? null}
              view={groupManagementView}
              isOwner={isCurrentUserGroupOwner}
              isRemoving={isRemovingGroupMember}
              memberError={removeGroupMemberError}
              memberSearchQuery={groupManagementSearchQuery}
              name={groupManagementName}
              intro={groupManagementIntro}
              hasUnsavedChanges={hasUnsavedGroupManagementChanges()}
              isIntroTooLong={groupManagementIntro.trim().length > GROUP_INTRO_MAX_LENGTH}
              nameError={groupManagementError}
              notice={groupManagementNotice}
              isSaving={isSavingGroupManagement}
              isAvatarUploading={isUploadingGroupAvatar}
              avatarError={groupAvatarError}
              t={t}
              onViewChange={setGroupManagementView}
              onNameChange={setGroupManagementName}
              onIntroChange={setGroupManagementIntro}
              onAvatarChange={(event) => void handleGroupAvatarInputChange(event)}
              onMemberSearchQueryChange={setGroupManagementSearchQuery}
              onInviteMembers={requestAddGroupMembers}
              onCancel={requestCloseGroupManagement}
              onSave={() => void saveGroupManagement()}
              onRemoveMember={requestRemoveGroupMemberConfirmation}
            />,
            document.body,
          )
        : null}
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
      {isDiscardGroupChangesConfirmOpen ? (
        <DiscardGroupChangesConfirmDialog
          title={t('chat.discardGroupChangesTitle')}
          message={t('chat.discardGroupChangesMessage')}
          cancelLabel={t('chat.continueEditing')}
          confirmLabel={t('chat.discardChanges')}
          onCancel={continueEditingGroupManagement}
          onConfirm={discardGroupManagementChanges}
        />
      ) : null}
      {pendingLeaveGroupConversationId ? (
        <LeaveGroupConfirmDialog
          title={t('chat.leaveGroupConfirmTitle')}
          message={t('chat.leaveGroupConfirmMessage')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('chat.leaveGroup')}
          error={leaveGroupError}
          isBusy={isLeavingGroup}
          onCancel={cancelLeaveGroupConfirmation}
          onConfirm={() => void confirmLeaveGroup()}
        />
      ) : null}
      {pendingRemoveGroupMemberId ? (
        <LeaveGroupConfirmDialog
          title={t('chat.removeGroupMemberConfirmTitle')}
          message={t('chat.removeGroupMemberConfirmMessage')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('chat.removeMember')}
          error={removeGroupMemberError}
          isBusy={isRemovingGroupMember}
          onCancel={cancelRemoveGroupMemberConfirmation}
          onConfirm={() => void confirmRemoveGroupMember()}
        />
      ) : null}
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

function DiscardGroupChangesConfirmDialog({
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="group-management-unsaved-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className="group-management-unsaved-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-group-changes-title">
        <strong id="discard-group-changes-title" className="group-management-unsaved-confirm-title">{title}</strong>
        <p className="group-management-unsaved-confirm-message">{message}</p>
        <footer className="group-management-unsaved-confirm-actions">
          <button type="button" className="group-management-unsaved-confirm-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="group-management-unsaved-confirm-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
function LeaveGroupConfirmDialog({
  title,
  message,
  cancelLabel,
  confirmLabel,
  error,
  isBusy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  error: string | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-group-confirm-title">
        <header>
          <strong id="leave-group-confirm-title">{title}</strong>
        </header>
        <p>{message}</p>
        {error ? <p className="confirm-dialog-error">{error}</p> : null}
        <footer className="confirm-dialog-actions">
          <button type="button" className="secondary-button compact-button" disabled={isBusy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="danger-button compact-button" disabled={isBusy} onClick={onConfirm}>
            {isBusy ? `${confirmLabel}...` : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
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
    .filter((conversation) => conversation.type === 'DIRECT')
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

function formatGroupMembers(count: number, t: ReturnType<typeof useI18n>['t']): string {
  return t('chat.groupMembers').replace('{{count}}', String(count));
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

type MessageAvatarProfile = {
  id?: string | null;
  displayName?: string | null;
  groupNickname?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  accountType?: string | null;
  statusMessage?: string | null;
  isOnline?: boolean;
  lastSeenAt?: string | null;
};

function getConversationDisplayName(
  conversation: Conversation,
  fallback: string,
  currentUserId: string | null = null,
): string {
  if (conversation.type === 'GROUP') {
    const currentMemberRemark = currentUserId
      ? conversation.members.find((member) => member.id === currentUserId)?.groupRemark?.trim()
      : '';
    return currentMemberRemark || conversation.title?.trim() || fallback;
  }

  return conversation.peer?.displayName ?? fallback;
}

function findMessageAvatarProfile(
  senderId: string,
  peerProfile: MessageAvatarProfile | null,
  memberProfiles: MessageAvatarProfile[],
): MessageAvatarProfile | null {
  return memberProfiles.find((member) => member.id === senderId) ?? peerProfile;
}

function GroupMemberPanel({
  members,
  notice,
  selectedMemberId,
  t,
  onInvite,
  onSelectMember,
}: {
  members: Conversation['members'];
  notice: string | null;
  selectedMemberId: string | null;
  t: ReturnType<typeof useI18n>['t'];
  onInvite: () => void;
  onSelectMember: (memberId: string) => void;
}): JSX.Element {
  const activeMembers = members.filter((member) => !member.leftAt);

  return (
    <section className="profile-group-section" aria-label={t('chat.groupMemberList')}>
      <header className="profile-group-section-header">
        <h2>{t('chat.groupMemberList')}</h2>
        <button
          type="button"
          className="profile-group-add-button"
          onClick={onInvite}
        >
          {t('chat.inviteGroupMembers')}
        </button>
      </header>
      {notice ? <p className="profile-group-add-notice">{notice}</p> : null}
      {activeMembers.length === 0 ? <p>{t('chat.noGroupMembers')}</p> : null}
      {activeMembers.length > 0 ? (
        <div className="profile-group-member-list">
          {activeMembers.map((member) => (
            <button
              type="button"
              className={`profile-group-member-row${selectedMemberId === member.id ? ' is-selected' : ''}`}
              key={member.id}
              onClick={() => onSelectMember(member.id)}
            >
              <UserAvatar
                userId={member.id}
                displayName={getMemberDisplayName(member)}
                avatarUrl={member.avatarUrl}
              />
              <span className="profile-group-member-text">
                <strong>{getMemberDisplayName(member)}</strong>
                <small>{formatMemberSubtitle(member, t)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}


function GroupProfileActions({
  isOwner,
  isMuted,
  isLeaving,
  t,
  onToggleMute,
  onManage,
  onLeave,
}: {
  isOwner: boolean;
  isMuted: boolean;
  isLeaving: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onToggleMute: () => void;
  onManage: () => void;
  onLeave: () => void;
}): JSX.Element {
  return (
    <div className={'group-profile-actions ' + (isOwner ? 'is-three-actions' : 'is-two-actions')} aria-label={t('chat.groupActions')}>
      <button
        type="button"
        className={'group-profile-action-button' + (isMuted ? ' is-active' : '')}
        aria-pressed={isMuted}
        onClick={onToggleMute}
      >
        <img
          className="group-profile-action-icon"
          src={isMuted ? '/vector_icon/bell-off.svg' : '/vector_icon/bell.svg'}
          alt=""
          aria-hidden="true"
        />
        <span className="group-profile-action-label">
          {isMuted ? t('chat.groupActionUnmute') : t('chat.groupActionMute')}
        </span>
      </button>
      {isOwner ? (
        <button type="button" className="group-profile-action-button" onClick={onManage}>
          <img className="group-profile-action-icon" src="/vector_icon/settings.svg" alt="" aria-hidden="true" />
          <span className="group-profile-action-label">{t('chat.groupActionManage')}</span>
        </button>
      ) : null}
      <button
        type="button"
        className="group-profile-action-button is-danger"
        disabled={isLeaving}
        onClick={onLeave}
      >
        <img className="group-profile-action-icon" src="/vector_icon/log-out.svg" alt="" aria-hidden="true" />
        <span className="group-profile-action-label">{t('chat.groupActionLeave')}</span>
      </button>
    </div>
  );
}

function GroupConversationAvatar({
  conversationId,
  displayName,
  avatarUrl,
  size = 'md',
  className,
}: {
  conversationId?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): JSX.Element {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const fileId = extractGroupAvatarFileId(avatarUrl);
    if (!conversationId || !fileId || avatarUrl === failedAvatarUrl) {
      setObjectUrl(null);
      return undefined;
    }

    let isCancelled = false;
    let nextObjectUrl: string | null = null;

    void downloadFile(fileId)
      .then((blob) => {
        if (!blob.type.toLowerCase().startsWith('image/')) {
          throw new Error('Group avatar is not an image');
        }

        nextObjectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }

        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (!isCancelled) {
          setObjectUrl(null);
          setFailedAvatarUrl(avatarUrl ?? null);
        }
      });

    return () => {
      isCancelled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [avatarUrl, conversationId, failedAvatarUrl]);

  const classes = ['user-avatar', `user-avatar-${size}`, className].filter(Boolean).join(' ');
  if (objectUrl) {
    return (
      <span className={classes}>
        <img src={objectUrl} alt="" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={classes}>
      <span className="user-avatar-initial">{getGroupAvatarInitial(displayName)}</span>
    </span>
  );
}

function GroupManagementDialog({
  conversation,
  currentUserId,
  view,
  isOwner,
  isRemoving,
  memberError,
  memberSearchQuery,
  name,
  intro,
  hasUnsavedChanges,
  isIntroTooLong,
  nameError,
  notice,
  isSaving,
  isAvatarUploading,
  avatarError,
  t,
  onViewChange,
  onNameChange,
  onIntroChange,
  onAvatarChange,
  onMemberSearchQueryChange,
  onInviteMembers,
  onCancel,
  onSave,
  onRemoveMember,
}: {
  conversation: Conversation;
  currentUserId: string | null;
  view: GroupManagementView;
  isOwner: boolean;
  isRemoving: boolean;
  memberError: string | null;
  memberSearchQuery: string;
  name: string;
  intro: string;
  hasUnsavedChanges: boolean;
  isIntroTooLong: boolean;
  nameError: string | null;
  notice: string | null;
  isSaving: boolean;
  isAvatarUploading: boolean;
  avatarError: string | null;
  t: ReturnType<typeof useI18n>['t'];
  onViewChange: (view: GroupManagementView) => void;
  onNameChange: (name: string) => void;
  onIntroChange: (intro: string) => void;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onMemberSearchQueryChange: (query: string) => void;
  onInviteMembers: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRemoveMember: (memberUserId: string) => void;
}): JSX.Element {
  const activeMembers = conversation.members.filter((member) => !member.leftAt);
  const ownerCount = activeMembers.filter((member) => member.role === 'OWNER').length || 1;

  return (
    <div className="group-management-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="group-management-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-management-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="group-management-header">
          <div>
            {view !== 'overview' ? (
              <button
                type="button"
                className="group-management-back-button"
                onClick={() => onViewChange('overview')}
              >
                {t('chat.backToGroupMembers')}
              </button>
            ) : null}
            <h2 id="group-management-title" className="group-management-title">
              {view === 'members'
                ? t('chat.groupMemberManagement')
                : view === 'admins'
                ? t('chat.groupAdminManagement')
                : t('chat.groupManageTitle')}
            </h2>
          </div>
          <button type="button" className="group-management-close" aria-label={t('common.cancel')} onClick={onCancel}>
            <img src="/vector_icon/x.svg" alt="" aria-hidden="true" />
          </button>
        </header>

        <div className="group-management-body">
          {view === 'members' ? (
            <GroupManagementMembers
              members={activeMembers}
              currentUserId={currentUserId}
              isOwner={isOwner}
              isRemoving={isRemoving}
              searchQuery={memberSearchQuery}
              error={memberError}
              t={t}
              onSearchQueryChange={onMemberSearchQueryChange}
              onInviteMembers={onInviteMembers}
              onRemoveMember={onRemoveMember}
            />
          ) : view === 'admins' ? (
            <GroupManagementAdmins members={activeMembers} t={t} />
          ) : (
            <GroupManagementOverview
              conversationId={conversation.id}
              title={name}
              intro={intro}
              avatarUrl={conversation.avatarUrl}
              isAvatarUploading={isAvatarUploading}
              avatarError={avatarError}
              isIntroTooLong={isIntroTooLong}
              error={nameError}
              notice={notice}
              onTitleChange={onNameChange}
              onIntroChange={onIntroChange}
              onAvatarChange={onAvatarChange}
              memberCount={activeMembers.length}
              adminCount={ownerCount}
              t={t}
              onViewChange={onViewChange}
            />
          )}
        </div>

        <footer className="group-management-footer">
          <button type="button" className="secondary-button group-management-cancel" disabled={isSaving || isAvatarUploading} onClick={onCancel}>
            {t('chat.groupManageCancel')}
          </button>
          <button
            type="button"
            className="primary-button group-management-save"
            disabled={isSaving || isAvatarUploading || !name.trim() || !hasUnsavedChanges || isIntroTooLong}
            onClick={onSave}
          >
            {isSaving ? t('chat.saving') : t('chat.groupManageSave')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function GroupManagementOverview({
  conversationId,
  title,
  intro,
  avatarUrl,
  isAvatarUploading,
  avatarError,
  isIntroTooLong,
  error,
  notice,
  memberCount,
  adminCount,
  t,
  onTitleChange,
  onIntroChange,
  onAvatarChange,
  onViewChange,
}: {
  conversationId: string;
  title: string;
  intro: string;
  avatarUrl?: string | null;
  isAvatarUploading: boolean;
  avatarError: string | null;
  isIntroTooLong: boolean;
  error: string | null;
  notice: string | null;
  memberCount: number;
  adminCount: number;
  t: ReturnType<typeof useI18n>['t'];
  onTitleChange: (title: string) => void;
  onIntroChange: (intro: string) => void;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onViewChange: (view: GroupManagementView) => void;
}): JSX.Element {
  const avatarInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <section className="group-management-profile" aria-label={t('chat.groupManageTitle')}>
        <button
          type="button"
          className={`group-management-avatar-button ${isAvatarUploading ? 'is-uploading' : ''}`}
          disabled={isAvatarUploading}
          aria-label={t('chat.changeGroupAvatar')}
          title={t('chat.changeGroupAvatar')}
          onClick={() => avatarInputRef.current?.click()}
        >
          <GroupConversationAvatar
            conversationId={conversationId}
            displayName={title}
            avatarUrl={avatarUrl}
            className="group-management-avatar"
          />
          <span className="group-management-avatar-overlay">
            <img
              className="group-management-avatar-overlay-icon"
              src={isAvatarUploading ? '/vector_icon/loader-circle.svg' : '/vector_icon/camera.svg'}
              alt=""
              aria-hidden="true"
            />
          </span>
          <input
            type="file"
            ref={avatarInputRef}
            accept={GROUP_AVATAR_UPLOAD_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onChange={onAvatarChange}
          />
        </button>
        {avatarError ? <p className="group-management-avatar-error">{avatarError}</p> : null}
        {isAvatarUploading ? <p className="group-management-avatar-status">{t('chat.groupAvatarUploading')}</p> : null}
        <label className="group-management-field">
          <span className="group-management-label">{t('chat.groupName')}</span>
          <input className="group-management-input" value={title} onChange={(event) => onTitleChange(event.target.value)} />
        </label>
        {error ? <p className="group-management-error">{error}</p> : null}
        {notice ? <p className="group-management-notice">{notice}</p> : null}
        <label className="group-management-field">
          <span className="group-management-label">{t('chat.groupIntroOptional')}</span>
          <textarea
            className="group-management-input group-management-textarea"
            value={intro}
            maxLength={GROUP_INTRO_MAX_LENGTH + 1}
            rows={3}
            onChange={(event) => onIntroChange(event.target.value)}
          />
        </label>
        {isIntroTooLong ? <p className="group-management-error">{t('chat.groupIntroTooLong')}</p> : null}
      </section>

      <section className="group-management-section" aria-label={t('chat.groupType')}>
        <GroupManagementRow label={t('chat.groupType')} value={t('chat.groupTypePrivate')} />
        <GroupManagementRow label={t('chat.newMembersHistoryVisibility')} value={t('chat.hidden')} />
        <GroupManagementRow label={t('chat.topic')} value={t('chat.closed')} />
      </section>

      <section className="group-management-section" aria-label={t('chat.permissionManagement')}>
        <GroupManagementRow label={t('chat.permissionManagement')} value={t('chat.notAvailableYet')} />
        <GroupManagementRow label={t('chat.inviteLink')} value={t('chat.notAvailableYet')} />
        <GroupManagementRow
          label={t('chat.admins')}
          value={String(adminCount)}
          isButton
          onClick={() => onViewChange('admins')}
        />
        <GroupManagementRow
          label={t('chat.members')}
          value={String(memberCount)}
          isButton
          onClick={() => onViewChange('members')}
        />
      </section>
    </>
  );
}

function GroupManagementRow({
  label,
  value,
  isButton = false,
  onClick,
}: {
  label: string;
  value: string;
  isButton?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <span className="group-management-row-label">{label}</span>
      <span className="group-management-row-value">{value}</span>
    </>
  );

  if (isButton) {
    return (
      <button type="button" className="group-management-row is-clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="group-management-row">{content}</div>;
}

function GroupManagementMembers({
  members,
  currentUserId,
  isOwner,
  isRemoving,
  searchQuery,
  error,
  t,
  onSearchQueryChange,
  onInviteMembers,
  onRemoveMember,
}: {
  members: Conversation['members'];
  currentUserId: string | null;
  isOwner: boolean;
  isRemoving: boolean;
  searchQuery: string;
  error: string | null;
  t: ReturnType<typeof useI18n>['t'];
  onSearchQueryChange: (query: string) => void;
  onInviteMembers: () => void;
  onRemoveMember: (memberUserId: string) => void;
}): JSX.Element {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleMembers = sortGroupManagementMembers(members, currentUserId)
    .filter((member) => {
      if (!normalizedSearchQuery) {
        return true;
      }

      const label = [
        member.displayName,
        member.groupNickname,
        member.email,
        member.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return label.includes(normalizedSearchQuery);
    });

  return (
    <section className="group-management-subview" aria-label={t('chat.groupMemberManagement')}>
      <header className="group-management-subview-header">
        <span className="group-management-member-count">{members.length} {t('chat.members')}</span>
        <button type="button" className="secondary-button compact-button" onClick={onInviteMembers}>
          {t('chat.inviteMembers')}
        </button>
      </header>
      <label className="group-management-search" htmlFor="group-management-member-search">
        <input
          id="group-management-member-search"
          className="group-management-search-input"
          type="search"
          value={searchQuery}
          placeholder={t('chat.searchGroupMembers')}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>
      {error ? <p className="group-management-error">{error}</p> : null}
      {visibleMembers.length === 0 ? (
        <p className="group-management-empty">{t('chat.noGroupMembersFound')}</p>
      ) : (
        <div className="group-management-member-list">
          {visibleMembers.map((member) => {
            const isGroupOwner = member.role === 'OWNER';
            const isSelf = currentUserId === member.id;
            const canRemove = isOwner && !isGroupOwner && !isSelf;
            return (
              <div className="group-management-member-row" key={member.id}>
                <UserAvatar userId={member.id} displayName={getMemberDisplayName(member)} avatarUrl={member.avatarUrl} />
                <span className="group-management-member-main">
                  <strong className="group-management-member-name">{getMemberDisplayName(member)}</strong>
                  <small className="group-management-member-meta">{member.email || formatPresence(member.isOnline, member.lastSeenAt, t)}</small>
                </span>
                <span className="group-management-member-role">
                  {isGroupOwner ? t('chat.groupOwnerRole') : t('chat.groupMemberRole')}
                </span>
                {canRemove ? (
                  <span className="group-management-member-actions">
                    <button
                      type="button"
                      className="group-management-danger-button"
                      disabled={isRemoving}
                      onClick={() => onRemoveMember(member.id)}
                    >
                      {t('chat.removeMember')}
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
function GroupManagementAdmins({
  members,
  t,
}: {
  members: Conversation['members'];
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element {
  const admins = members.filter((member) => member.role === 'OWNER' || member.role === 'ADMIN');
  return (
    <section className="group-management-subview" aria-label={t('chat.groupAdminManagement')}>
      <div className="group-management-member-list">
        {admins.map((member) => {
          const isGroupOwner = member.role === 'OWNER';
          return (
            <div className="group-management-member-row" key={member.id}>
              <UserAvatar userId={member.id} displayName={getMemberDisplayName(member)} avatarUrl={member.avatarUrl} />
              <span className="group-management-member-main">
                <strong className="group-management-member-name">{getMemberDisplayName(member)}</strong>
                <small className="group-management-member-meta">{member.email || formatPresence(member.isOnline, member.lastSeenAt, t)}</small>
              </span>
              <span className="group-management-member-role">
                {isGroupOwner ? t('chat.groupOwnerRole') : t('chat.groupAdminManagement')}
              </span>
            </div>
          );
        })}
      </div>
      <p className="group-management-admin-note">{t('chat.adminFeatureUnavailable')}</p>
    </section>
  );
}
function GroupMemberProfileCard({
  member,
  friendship,
  isSelf,
  t,
  onBack,
  onMessage,
}: {
  member: Conversation['members'][number];
  friendship: FriendItem | null;
  isSelf: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onBack: () => void;
  onMessage: (friendship: FriendItem) => void;
}): JSX.Element {
  const displayName = getMemberDisplayName(member);
  const canMessage = Boolean(friendship && !isSelf);
  const isOwner = member.role === 'OWNER';
  const roleLabel = isOwner ? t('chat.groupOwnerRole') : t('chat.groupMemberRole');

  return (
    <section className="group-member-profile" aria-label={t('chat.groupMemberProfile')}>
      <header className="group-member-profile-header">
        <button type="button" className="group-member-profile-back" onClick={onBack}>
          {t('chat.backToGroupMembers')}
        </button>
        <h2>{t('chat.groupMemberProfile')}</h2>
      </header>

      <div className="group-member-profile-identity">
        <UserAvatar
          userId={member.id}
          displayName={displayName}
          avatarUrl={member.avatarUrl}
          size="lg"
        />
        <strong className="group-member-profile-name">{displayName}</strong>
        <span className="group-member-profile-meta">
          {formatPresence(member.isOnline, member.lastSeenAt, t)}
        </span>
      </div>

      <dl className="group-member-profile-section">
        <div className="group-member-profile-row">
          <dt>{t('friends.profileEmail')}</dt>
          <dd>{member.email ?? t('friends.profileEmpty')}</dd>
        </div>
        <div className="group-member-profile-row">
          <dt>{t('friends.profileStatus')}</dt>
          <dd>{member.statusMessage || member.accountType || t('friends.profileEmpty')}</dd>
        </div>
        <div className="group-member-profile-row">
          <dt>{t('chat.groupMemberRole')}</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>

      <div className="group-member-profile-actions">
        {isSelf ? <p>{t('chat.thisIsYou')}</p> : null}
        {canMessage && friendship ? (
          <button
            type="button"
            className="primary-button group-member-profile-primary"
            onClick={() => onMessage(friendship)}
          >
            {t('chat.messageMember')}
          </button>
        ) : null}
        {!isSelf && !friendship ? (
          <button
            type="button"
            className="secondary-button group-member-profile-secondary"
            disabled
          >
            {t('chat.memberActionUnavailable')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
function GroupInviteDialog({
  friends,
  activeMemberIds,
  selectedIds,
  searchQuery,
  isSubmitting,
  error,
  t,
  onToggleFriend,
  onSearchQueryChange,
  onCancel,
  onSubmit,
}: {
  friends: FriendItem[];
  activeMemberIds: Set<string>;
  selectedIds: string[];
  searchQuery: string;
  isSubmitting: boolean;
  error: string | null;
  t: ReturnType<typeof useI18n>['t'];
  onToggleFriend: (friendUserId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleFriends = normalizedSearchQuery
    ? friends.filter((friendship) => {
      const friend = friendship.friend;
      const label = `${friend.displayName ?? ''} ${friend.email ?? ''} ${friend.id}`.toLowerCase();
      return label.includes(normalizedSearchQuery);
    })
    : friends;
  const selectedFriends = selectedIds
    .map((friendUserId) => friends.find((friendship) => friendship.friend.id === friendUserId))
    .filter((friendship): friendship is FriendItem => Boolean(friendship));

  return (
    <div
      className="group-invite-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="group-invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-invite-dialog-title"
      >

        <div className="group-invite-dialog-body">
          <aside className="group-invite-dialog-left">
            <label className="group-invite-search" htmlFor="group-invite-search-input">
              <input
                id="group-invite-search-input"
                className="group-invite-search-input"
                type="search"
                value={searchQuery}
                placeholder={t('chat.groupInviteSearchPlaceholder')}
                disabled={isSubmitting}
                onChange={(event) => onSearchQueryChange(event.target.value)}
              />
            </label>

            <div className="group-invite-friend-section">
              <div className="group-invite-section-header">
                <span>{t('chat.myFriends')}</span>
              </div>
              <div className="group-invite-friend-list">
                {visibleFriends.length === 0 ? (
                  <p className="group-invite-empty">{t('chat.noAvailableFriendsToInvite')}</p>
                ) : null}
                {visibleFriends.map((friendship) => {
                  const friend = friendship.friend;
                  const label = friend.displayName || friend.email || friend.id;
                  const isActiveMember = activeMemberIds.has(friend.id);
                  const isSelected = selectedIds.includes(friend.id);
                  const isChecked = isActiveMember || isSelected;
                  return (
                    <label
                      className={`group-invite-friend-row${isActiveMember ? ' is-disabled' : ''}`}
                      key={friendship.id}
                      title={isActiveMember ? t('chat.alreadyInGroup') : label}
                    >
                      <span
                        className={`group-invite-check${isChecked ? ' is-checked' : ''}${isActiveMember ? ' is-disabled' : ''}`}
                        aria-hidden="true"
                      />
                      <input
                        className="group-invite-checkbox"
                        type="checkbox"
                        checked={isChecked}
                        disabled={isSubmitting || isActiveMember}
                        onChange={() => onToggleFriend(friend.id)}
                        aria-label={label}
                      />
                      <UserAvatar
                        userId={friend.id}
                        displayName={label}
                        avatarUrl={friend.avatarUrl}
                        size="sm"
                      />
                      <span className="group-invite-friend-text">
                        <strong>{label}</strong>
                        <small>{isActiveMember ? t('chat.alreadyInGroup') : formatPresence(friend.isOnline, friend.lastSeenAt, t)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </aside>

          <section className="group-invite-dialog-right" aria-labelledby="group-invite-dialog-title">
            <header className="group-invite-selected-header">
              <h2 id="group-invite-dialog-title" className="group-invite-dialog-title">
                {t('chat.inviteGroupMembersTitle')}
              </h2>
              <span>{t('chat.selectedInviteFriends')}</span>
            </header>
            <div className="group-invite-selected-list">
              {selectedFriends.length === 0 ? (
                <p className="group-invite-selected-empty">{t('chat.noSelectedInviteFriends')}</p>
              ) : null}
              {selectedFriends.map((friendship) => {
                const friend = friendship.friend;
                const label = friend.displayName || friend.email || friend.id;
                return (
                  <div className="group-invite-selected-row" key={friendship.id}>
                    <UserAvatar
                      userId={friend.id}
                      displayName={label}
                      avatarUrl={friend.avatarUrl}
                      size="sm"
                    />
                    <span>{label}</span>
                    <button
                      type="button"
                      className="group-invite-remove-button"
                      aria-label={`${t('chat.removeInviteFriend')} ${label}`}
                      disabled={isSubmitting}
                      onClick={() => onToggleFriend(friend.id)}
                    >
                      {t('chat.removeInviteFriend')}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {error ? <p className="group-invite-dialog-error">{error}</p> : null}

        <footer className="group-invite-dialog-footer">
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {t('chat.cancelInviteMembers')}
          </button>
          <button
            type="button"
            className="primary-button compact-button"
            disabled={isSubmitting || selectedIds.length === 0}
            onClick={onSubmit}
          >
            {t('chat.inviteMembers')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function sortGroupManagementMembers(
  members: Conversation['members'],
  currentUserId: string | null,
): Conversation['members'] {
  return [...members].sort((first, second) => {
    const firstOwnerRank = first.role === 'OWNER' ? 0 : 1;
    const secondOwnerRank = second.role === 'OWNER' ? 0 : 1;
    if (firstOwnerRank !== secondOwnerRank) {
      return firstOwnerRank - secondOwnerRank;
    }

    const firstSelfRank = currentUserId && first.id === currentUserId ? 0 : 1;
    const secondSelfRank = currentUserId && second.id === currentUserId ? 0 : 1;
    if (firstOwnerRank !== 0 && firstSelfRank !== secondSelfRank) {
      return firstSelfRank - secondSelfRank;
    }

    const firstOnlineRank = first.isOnline ? 0 : 1;
    const secondOnlineRank = second.isOnline ? 0 : 1;
    if (firstOnlineRank !== secondOnlineRank) {
      return firstOnlineRank - secondOnlineRank;
    }

    const firstName = getMemberDisplayName(first).toLowerCase();
    const secondName = getMemberDisplayName(second).toLowerCase();
    const nameOrder = firstName.localeCompare(secondName);
    if (nameOrder !== 0) {
      return nameOrder;
    }

    return first.id.localeCompare(second.id);
  });
}
function getMemberDisplayName(member: Conversation['members'][number]): string {
  return getMessageSenderDisplayName(member);
}

function getMessageSenderDisplayName(profile: MessageAvatarProfile | null): string {
  return profile?.groupNickname?.trim() || profile?.displayName || profile?.email || profile?.id || '';
}

function formatMemberSubtitle(
  member: Conversation['members'][number],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (member.isOnline || member.lastSeenAt) {
    return formatPresence(member.isOnline, member.lastSeenAt, t);
  }

  return member.email || member.accountType || member.id;
}

function MessageList({
  conversationId,
  messages,
  currentUserProfile,
  peerProfile,
  memberProfiles,
  conversationType,
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
  currentUserProfile: MessageAvatarProfile | null;
  peerProfile: MessageAvatarProfile | null;
  memberProfiles: MessageAvatarProfile[];
  conversationType: Conversation['type'];
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
    if (message.status === 'recalled') {
      setContextMenu(null);
      return;
    }

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
      case 'preview':
        if (message.messageType === 'IMAGE' && message.file) {
          void openImagePreview(message.file);
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
          setMessageNotice({
            message:
              message.isOwn && !isLocalPendingMessage(message) && !isWithinRecallWindow(message)
                ? t('chat.recallExpired')
                : t('chat.recallFailed'),
            isError: true,
          });
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
          const nextMessage = messages[index + 1] ?? null;
          const showTimeDivider = shouldShowMessageTimeDivider(previousMessage, message);
          const showMessageAvatar = shouldShowMessageAvatar(message, nextMessage);
          const isGroupConversation = conversationType === 'GROUP';
          const isSenderGroupStart =
            !previousMessage || showTimeDivider || previousMessage.senderId !== message.senderId;
          const isSameDirectionGroup = Boolean(
            previousMessage && !showTimeDivider && isMessageInSameAvatarGroup(previousMessage, message),
          );
          const canRetryMessage = message.isOwn && message.status === 'failed' && message.messageType === 'TEXT';
          const visibleOwnStatus = getVisibleOwnMessageStatus(message);
          const showEditedMarker = Boolean(message.editedAt && message.status !== 'recalled');
          const showMessageMeta = Boolean(visibleOwnStatus || canRetryMessage || showEditedMarker);
          const messageAvatarProfile = message.isOwn
            ? currentUserProfile
            : findMessageAvatarProfile(message.senderId, peerProfile, memberProfiles);
          const senderDisplayName = getMessageSenderDisplayName(messageAvatarProfile);
          const showSenderName =
            isGroupConversation && !message.isOwn && isSenderGroupStart && Boolean(senderDisplayName);

          return (
            <Fragment key={message.id}>
              {showTimeDivider ? (
                <div className="message-time-divider" role="separator">
                  <time dateTime={message.createdAt}>{formatMessageTimeDivider(message.createdAt, t)}</time>
                </div>
              ) : null}
              <article
                className={`message-row ${message.isOwn ? 'is-own' : ''} ${
                  isGroupConversation ? 'is-group-conversation' : ''
                } ${isSameDirectionGroup ? 'is-compact' : ''} ${
                  showTimeDivider ? 'is-after-divider' : ''
                } ${
                  isGroupConversation && isSenderGroupStart && !showTimeDivider && index > 0
                    ? 'is-sender-group-start'
                    : ''
                } ${searchMatchIds.has(message.id) ? 'is-search-match' : ''} ${
                  activeSearchMessageId === message.id ? 'is-current-search-match' : ''
                }`}
                ref={(element) => {
                  messageRefs.current[message.id] = element;
                }}
              >
                {!message.isOwn ? (
                  <MessageAvatarSlot
                    message={message}
                    profile={messageAvatarProfile}
                    showAvatar={showMessageAvatar}
                  />
                ) : null}
                <div
                  className={`message-bubble ${
                    message.messageType === 'FILE' && message.status !== 'recalled' ? 'is-file-message' : ''
                  } ${message.status === 'recalled' ? 'is-recalled' : ''} ${
                    message.status === 'failed' ? 'is-failed' : ''
                  }`}
                  onContextMenu={(event) => handleContextMenu(event, message)}
                >
                  {showSenderName ? <span className="message-sender-name">{senderDisplayName}</span> : null}
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
                  ) : message.status === 'recalled' ? (
                    <p>{getRecalledMessageLabel(message, t)}</p>
                  ) : message.messageType === 'FILE' ? (
                    <FileMessageCard
                      message={message}
                      searchQuery={searchQuery}
                      isSearchMatch={searchMatchIds.has(message.id)}
                      isCurrentSearchMatch={activeSearchMessageId === message.id}
                    />
                  ) : (
                    <p>
                      {renderMessageBody(
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
                  {showMessageMeta ? (
                    <div className="message-meta">
                      {message.isOwn && visibleOwnStatus ? (
                        <span className={message.status === 'failed' ? 'message-status-failed' : ''}>
                          {t(`chat.status.${visibleOwnStatus}`)}
                        </span>
                      ) : null}
                      {canRetryMessage ? (
                        <button
                          type="button"
                          className="message-retry-button"
                          onClick={() => void onRetryMessage(message.id)}
                        >
                          {t('chat.retrySending')}
                        </button>
                      ) : null}
                      {showEditedMarker ? <span>{t('chat.edited')}</span> : null}
                    </div>
                  ) : null}
                </div>
                {message.isOwn ? (
                  <MessageAvatarSlot
                    message={message}
                    profile={messageAvatarProfile}
                    showAvatar={showMessageAvatar}
                  />
                ) : null}
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

function shouldShowMessageAvatar(message: ChatMessage, nextMessage: ChatMessage | null): boolean {
  if (!nextMessage) {
    return true;
  }

  return !isMessageInSameAvatarGroup(message, nextMessage);
}

function isMessageInSameAvatarGroup(message: ChatMessage, nextMessage: ChatMessage): boolean {
  if (message.senderId !== nextMessage.senderId) {
    return false;
  }

  const messageTime = new Date(message.createdAt).getTime();
  const nextMessageTime = new Date(nextMessage.createdAt).getTime();
  if (!Number.isFinite(messageTime) || !Number.isFinite(nextMessageTime)) {
    return false;
  }

  const diff = nextMessageTime - messageTime;
  return diff >= 0 && diff <= MESSAGE_AVATAR_GROUP_WINDOW_MS;
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
}): JSX.Element | null {
  const actions = buildMessageMenuActions(message, downloadStatus);
  if (actions.length === 0) {
    return null;
  }

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

function MessageAvatarSlot({
  message,
  profile,
  showAvatar,
}: {
  message: ChatMessage;
  profile: MessageAvatarProfile | null;
  showAvatar: boolean;
}): JSX.Element {
  if (!showAvatar) {
    return <span className="message-avatar-slot is-placeholder" aria-hidden="true" />;
  }

  return (
    <span className="message-avatar-slot" onContextMenu={(event) => event.preventDefault()}>
      <UserAvatar
        userId={profile?.id ?? message.senderId}
        displayName={getMessageSenderDisplayName(profile)}
        avatarUrl={profile?.avatarUrl}
        size="sm"
      />
    </span>
  );
}

function buildMessageMenuActions(
  message: ChatMessage,
  downloadStatus?: FileDownloadStatus,
): MessageMenuItem[] {
  if (message.status === 'recalled') {
    return [];
  }

  const actions: MessageMenuItem[] = [];
  if (canCopyMessage(message)) {
    actions.push({ action: 'copy', labelKey: 'chat.copy' });
  }

  if (message.messageType === 'IMAGE' && message.file) {
    actions.push({ action: 'preview', labelKey: 'chat.openImagePreview' });
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
    actions.push({ action: 'recall', labelKey: 'chat.recallMessage', isDanger: true });
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

function getRecalledMessageLabel(
  message: ChatMessage,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return message.isOwn ? t('chat.youRecalledMessage') : t('chat.peerRecalledMessage');
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



  return renderHighlightedText(message.plaintext, searchQuery);
}

function FileMessageCard({
  message,
  searchQuery,
  isSearchMatch,
  isCurrentSearchMatch,
}: {
  message: ChatMessage;
  searchQuery: string;
  isSearchMatch: boolean;
  isCurrentSearchMatch: boolean;
}): JSX.Element | null {
  if (!message.file) {
    return null;
  }

  const fileIcon = getFileIconByName(message.file.originalName, message.file.mimeType);

  return (
    <div
      className={`file-message-card ${isSearchMatch ? 'is-search-match' : ''} ${
        isCurrentSearchMatch ? 'is-current-search-match' : ''
      }`}
    >
      <span className="file-message-content">
        <span className="file-message-name">
          {renderHighlightedText(message.file.originalName, searchQuery)}
        </span>
        <span className="file-message-size">{formatFileSize(Number(message.file.sizeBytes))}</span>
      </span>
      <span className="file-message-icon-slot" aria-hidden="true">
        <img className="file-message-icon" src={fileIcon.src} alt="" />
      </span>
    </div>
  );
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
type MessageMenuAction =
  | 'copy'
  | 'preview'
  | 'download'
  | 'forward'
  | 'retry'
  | 'edit'
  | 'recall'
  | 'deleteLocal';
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

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;
const MESSAGE_DRAFT_MAX_LENGTH = 5000;
const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'common',
    labelKey: 'chat.emojiGroupCommon',
    items: [
      '\uD83D\uDE0E',
      '\uD83D\uDE02',
      '\uD83D\uDE0A',
      '\uD83D\uDE0D',
      '\uD83E\uDD17',
      '\uD83D\uDE2D',
      '\uD83D\uDE05',
      '\uD83D\uDC4D',
      '\uD83D\uDC4F',
      '\uD83D\uDE4F',
      '\u2764\uFE0F',
      '\uD83D\uDD25',
      '\uD83C\uDF89',
      '\u2728',
    ],
  },
  {
    id: 'faces',
    labelKey: 'chat.emojiGroupFaces',
    items: [
      '\uD83D\uDE43',
      '\uD83D\uDE03',
      '\uD83D\uDE07',
      '\uD83D\uDE09',
      '\uD83D\uDE1C',
      '\uD83D\uDE1D',
      '\uD83E\uDD28',
      '\uD83D\uDE13',
      '\uD83D\uDE29',
      '\uD83D\uDE28',
      '\uD83D\uDE3A',
      '\uD83D\uDE33',
      '\uD83D\uDE0C',
    ],
  },
  {
    id: 'gestures',
    labelKey: 'chat.emojiGroupGestures',
    items: [
      '\uD83D\uDC4B',
      '\uD83D\uDC4C',
      '\u270C\uFE0F',
      '\uD83E\uDD1D',
      '\uD83D\uDE4C',
      '\uD83D\uDCAA',
      '\uD83E\uDD1F',
      '\uD83D\uDC40',
      '\uD83D\uDCAF',
      '\uD83D\uDCCC',
      '\u2705',
      '\u2B50',
      '\uD83D\uDC95',
      '\uD83D\uDE80',
    ],
  },
];
const MESSAGE_AVATAR_GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_TIME_DIVIDER_INTERVAL_MS = 5 * 60 * 1000;
const IMAGE_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FILE_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);
const FILE_UPLOAD_EXTENSIONS = new Set([
  '.txt',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.zip',
]);
const DANGEROUS_FILE_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.msi',
  '.ps1',
  '.sh',
  '.dll',
  '.scr',
  '.js',
  '.vbs',
]);
const IMAGE_UPLOAD_ACCEPT = Array.from(IMAGE_UPLOAD_MIME_TYPES).join(',');
const NAV_ICON_SOURCES = {
  messages: '/vector_icon/messages-square.svg',
  contacts: '/vector_icon/users-round.svg',
  more: '/vector_icon/menu.svg',
  settings: '/vector_icon/settings.svg',
  logout: '/vector_icon/log-out.svg',
} as const;
const IMAGE_PREVIEW_OPEN_EVENT = 'image-preview:open';
const IMAGE_PREVIEW_READY_EVENT = 'image-preview:ready';

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return '';
  }

  return fileName.slice(lastDotIndex).toLowerCase();
}

function isSupportedUpload(file: File, requestedKind: FileKind): boolean {
  const mimeType = file.type.trim().toLowerCase();
  if (requestedKind === 'IMAGE') {
    return IMAGE_UPLOAD_MIME_TYPES.has(mimeType);
  }

  const extension = getFileExtension(file.name);
  if (DANGEROUS_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  return FILE_UPLOAD_MIME_TYPES.has(mimeType) || FILE_UPLOAD_EXTENSIONS.has(extension);
}

function buildGroupAvatarUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/download`;
}

function extractGroupAvatarFileId(avatarUrl?: string | null): string | null {
  const value = avatarUrl?.trim() ?? '';
  const match = value.match(/^\/api\/files\/([^/]+)\/download$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getGroupAvatarInitial(displayName?: string | null): string {
  const value = displayName?.trim();
  return value ? value.slice(0, 1).toUpperCase() : 'G';
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
  const conversationTitle = getConversationDisplayName(conversation, 'LanGram', currentUserId);
  const peerName = conversation.peer?.displayName ?? conversationTitle;
  const peerAvatarUrl = conversation.type === 'DIRECT' ? conversation.peer?.avatarUrl ?? null : null;
  const membersById = new Map(conversation.members.map((member) => [member.id, member]));

  return {
    conversationId: conversation.id,
    title: conversationTitle,
    messages: (messages.length > 0 ? messages : buildConversationSearchFallbackMessages(conversation))
      .filter((message) => message.status !== 'recalled')
      .map((message) => {
        const isCurrentUser = Boolean(currentUserId && message.senderId === currentUserId);
        const senderProfile = membersById.get(message.senderId);
        return {
          id: message.id,
          senderName: isCurrentUser
            ? currentUserName
            : senderProfile?.displayName ?? peerName,
          avatarUrl: isCurrentUser
            ? null
            : senderProfile?.avatarUrl ?? peerAvatarUrl,
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
  currentUserId: string | null,
): ForwardTarget[] {
  return [
    ...conversations.map((conversation) => ({
      id: `conversation:${conversation.id}`,
      type: 'conversation' as const,
      label: getConversationDisplayName(conversation, unknownPeerLabel, currentUserId),
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













