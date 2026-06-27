import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Conversation } from '../../api/conversations.api';
import {
  acceptFriendRequest,
  clearFriendRequests,
  createFriendRequest,
  createPairingCode,
  deleteFriend,
  listFriendRequests,
  listFriends,
  rejectFriendRequest,
  type FriendItem,
  type FriendRequest,
  type FriendUser,
} from '../../api/friends.api';
import { UserAvatar } from '../../components/UserAvatar';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore } from '../../stores/chat.store';
import { useNetworkStore } from '../../stores/network.store';
import { unhideConversationInUiState } from '../../utils/conversationUiState';

type ContactsPanel = 'empty' | 'friend' | 'add' | 'requests' | 'group';
type ContactsListTab = 'friends' | 'groups';

export function FriendsPage(): JSX.Element {
  const navigate = useNavigate();
  const accessToken = useAuthStore((state) => state.accessToken);
  const notifySessionReplaced = useAuthStore((state) => state.notifySessionReplaced);
  const connect = useChatStore((state) => state.connect);
  const disconnect = useChatStore((state) => state.disconnect);

  useEffect(() => {
    if (!accessToken) {
      disconnect();
      return;
    }

    connect(accessToken, () => notifySessionReplaced());
    return () => disconnect();
  }, [accessToken, connect, disconnect, notifySessionReplaced]);

  return (
    <main className="friends-page">
      <FriendsWorkspace
        showBackLink
        onConversationOpened={() => navigate('/')}
      />
    </main>
  );
}

export function FriendsWorkspace({
  className = '',
  showBackLink = false,
  onConversationOpened,
  onMessageFriend,
  openAddPanelKey = 0,
  addPanelNotice = null,
}: {
  className?: string;
  showBackLink?: boolean;
  onConversationOpened?: (conversationId: string) => void;
  onMessageFriend?: (friendship: FriendItem) => Promise<boolean>;
  openAddPanelKey?: number;
  addPanelNotice?: string | null;
}): JSX.Element {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const conversations = useChatStore((state) => state.conversations);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const openDirectConversation = useChatStore((state) => state.openDirectConversation);
  const openGroupConversation = useChatStore((state) => state.openGroupConversation);
  const presenceByUserId = useChatStore((state) => state.presenceByUserId);
  const isNetworkOnline = useNetworkStore((state) => state.online);
  const [activePanel, setActivePanel] = useState<ContactsPanel>('empty');
  const [activeListTab, setActiveListTab] = useState<ContactsListTab>('friends');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selectedFriendshipId, setSelectedFriendshipId] = useState<string | null>(null);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingDeleteFriend, setPendingDeleteFriend] = useState<FriendItem | null>(null);
  const [isDeletingFriend, setIsDeletingFriend] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadConversations(user.id);
  }, [loadConversations, user]);

  const refreshFriendsData = useCallback(async (): Promise<void> => {
    const [requestsResult, friendsResult] = await Promise.all([
      listFriendRequests(),
      listFriends(),
    ]);
    setIncoming(requestsResult.incoming);
    setOutgoing(requestsResult.outgoing);
    setFriends(friendsResult.friends);
    setError((current) => (current === t('friends.networkUnavailable') ? null : current));
  }, [t]);

  useEffect(() => {
    void refreshFriendsData().catch(() =>
      setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable')),
    );
  }, [isNetworkOnline, refreshFriendsData, t]);

  useEffect(() => {
    if (openAddPanelKey <= 0) {
      return;
    }

    setSelectedFriendshipId(null);
    setActivePanel('add');
    setNotice(addPanelNotice);
    setError(null);
  }, [addPanelNotice, openAddPanelKey]);

  useEffect(() => {
    function handleFriendRequestChanged(): void {
      void refreshFriendsData().catch(() =>
        setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable')),
      );
    }

    window.addEventListener('langram:friend-request-changed', handleFriendRequestChanged);
    return () => window.removeEventListener('langram:friend-request-changed', handleFriendRequestChanged);
  }, [isNetworkOnline, refreshFriendsData, t]);

  useEffect(() => {
    if (isNetworkOnline && error === t('friends.networkUnavailable')) {
      setError(null);
    }
  }, [error, isNetworkOnline, t]);

  useEffect(() => {
    setFriends((current) =>
      current.map((item) => ({
        ...item,
        friend: applyPresence(item.friend, presenceByUserId),
      })),
    );
  }, [presenceByUserId]);

  useEffect(() => {
    if (!isAddMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (addMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsAddMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsAddMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAddMenuOpen]);

  const filteredFriends = useMemo(
    () => filterFriends(friends, friendSearchQuery),
    [friendSearchQuery, friends],
  );
  const filteredGroupConversations = useMemo(
    () => filterGroupConversations(conversations, friendSearchQuery),
    [conversations, friendSearchQuery],
  );
  const selectedFriend = useMemo(
    () => friends.find((item) => item.id === selectedFriendshipId) ?? null,
    [friends, selectedFriendshipId],
  );
  const pendingRequestCount = useMemo(
    () => incoming.filter((request) => request.status === 'PENDING').length,
    [incoming],
  );

  async function handleGenerateCode(): Promise<void> {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createPairingCode();
      setPairingCode(result.pairingCode);
      setPairingCodeExpiresAt(result.expiresAt);
    } catch {
      setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createFriendRequest(inputCode.trim());
      setInputCode('');
      setNotice(t('friends.requestSent'));
      await refreshFriendsData();
      window.dispatchEvent(new Event('langram:friend-request-changed'));
      setSelectedFriendshipId(null);
      setActivePanel('requests');
    } catch {
      setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRespond(requestId: string, action: 'accept' | 'reject'): Promise<void> {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'accept') {
        await acceptFriendRequest(requestId);
        setNotice(t('friends.requestAccepted'));
      } else {
        await rejectFriendRequest(requestId);
        setNotice(t('friends.requestRejected'));
      }
      await refreshFriendsData();
      window.dispatchEvent(new Event('langram:friend-request-changed'));
    } catch {
      setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenChat(item: FriendItem): Promise<void> {
    if (!user) {
      return;
    }

    if (!isNetworkOnline) {
      setError(t('friends.networkUnavailable'));
      return;
    }

    if (onMessageFriend) {
      const opened = await onMessageFriend(item);
      if (!opened) {
        setError(t('friends.actionFailed'));
      }
      return;
    }

    const conversationId = await openDirectConversation(item.friend.id, user.id);
    if (conversationId) {
      unhideConversationInUiState(conversationId);
      onConversationOpened?.(conversationId);
    }
  }

  async function handleOpenGroupChat(conversation: Conversation): Promise<void> {
    if (!user) {
      return;
    }

    unhideConversationInUiState(conversation.id);
    await selectConversation(conversation.id, user.id);
    onConversationOpened?.(conversation.id);
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (!isNetworkOnline) {
      setError(t('friends.networkUnavailable'));
      return;
    }

    if (selectedGroupMemberIds.length === 0) {
      setError(t('chat.noGroupMembersSelected'));
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const conversationId = await openGroupConversation(groupName, selectedGroupMemberIds, user.id);
      if (!conversationId) {
        setError(t('chat.createGroupFailed'));
        return;
      }

      unhideConversationInUiState(conversationId);
      setGroupName('');
      setSelectedGroupMemberIds([]);
      setSelectedFriendshipId(null);
      setActivePanel('empty');
      onConversationOpened?.(conversationId);
    } catch {
      setError(isNetworkOnline ? t('chat.createGroupFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  function toggleGroupMember(friendUserId: string): void {
    setSelectedGroupMemberIds((current) =>
      current.includes(friendUserId)
        ? current.filter((memberUserId) => memberUserId !== friendUserId)
        : [...current, friendUserId],
    );
  }

  function handleDeleteFriend(item: FriendItem): void {
    setPendingDeleteFriend(item);
  }

  async function confirmDeleteFriend(): Promise<void> {
    if (!pendingDeleteFriend) {
      return;
    }

    setIsBusy(true);
    setIsDeletingFriend(true);
    setError(null);
    setNotice(null);
    try {
      await deleteFriend(pendingDeleteFriend.id);
      setNotice(t('friends.deleteSuccess'));
      if (selectedFriendshipId === pendingDeleteFriend.id) {
        setSelectedFriendshipId(null);
        setActivePanel('empty');
      }
      setPendingDeleteFriend(null);
      await refreshFriendsData();
      window.dispatchEvent(new Event('langram:friend-request-changed'));
    } catch {
      setError(isNetworkOnline ? t('friends.deleteFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
      setIsDeletingFriend(false);
    }
  }

  function cancelDeleteFriend(): void {
    if (isDeletingFriend) {
      return;
    }

    setPendingDeleteFriend(null);
  }

  async function handleClearRequests(): Promise<void> {
    if (!window.confirm(t('friends.clearRequestsConfirm'))) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await clearFriendRequests();
      setNotice(`${t('friends.clearRequestsSuccess')} ${result.deletedCount}`);
      await refreshFriendsData();
    } catch {
      setError(isNetworkOnline ? t('friends.clearRequestsFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  function handleSelectFriend(friendshipId: string): void {
    if (activePanel === 'friend' && selectedFriendshipId === friendshipId) {
      setSelectedFriendshipId(null);
      setActivePanel('empty');
      return;
    }

    setSelectedFriendshipId(friendshipId);
    setActiveListTab('friends');
    setActivePanel('friend');
  }

  const canClearRequests = useMemo(
    () => [...incoming, ...outgoing].some((request) => request.status !== 'PENDING'),
    [incoming, outgoing],
  );

  return (
    <section className={`friends-main-layout ${className}`.trim()}>
      <aside className="conversation-panel friends-conversation-panel">
        <header className="sidebar-header friends-list-header">
          <h1>{t('friends.title')}</h1>
          {showBackLink ? <Link to="/">{t('common.back')}</Link> : null}
        </header>

        <div className="friends-search-row">
          <label className="friends-search-field">
            <span>{t('friends.searchPlaceholder')}</span>
            <input
              value={friendSearchQuery}
              onChange={(event) => setFriendSearchQuery(event.target.value)}
              placeholder={t('friends.searchPlaceholder')}
            />
          </label>
          <div className="friends-add-menu" ref={addMenuRef}>
            <button
              type="button"
              className="friends-add-button"
              aria-label={t('friends.addMenu')}
              title={t('friends.addMenu')}
              aria-expanded={isAddMenuOpen}
              onClick={() => setIsAddMenuOpen((isOpen) => !isOpen)}
            >
              <img src="/vector_icon/plus.svg" alt="" aria-hidden="true" />
            </button>
            {isAddMenuOpen ? (
              <div className="friends-add-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    setSelectedFriendshipId(null);
                    setActivePanel('add');
                  }}
                >
                  {t('friends.addTitle')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    setSelectedFriendshipId(null);
                    setActivePanel('group');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {t('chat.createGroup')}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className={`friends-nav-entry ${activePanel === 'requests' ? 'is-active' : ''}`}
          onClick={() => {
            setSelectedFriendshipId(null);
            setActivePanel('requests');
          }}
        >
          <span>{t('friends.notifications')}</span>
          {pendingRequestCount > 0 ? (
            <strong className="friends-nav-badge friends-nav-badge--alert">
              {pendingRequestCount}
            </strong>
          ) : null}
        </button>
        <div className="friends-list-tabs" role="tablist" aria-label={t('friends.listTitle')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeListTab === 'friends'}
            className={activeListTab === 'friends' ? 'is-active' : ''}
            onClick={() => {
              setActiveListTab('friends');
              setSelectedFriendshipId(null);
              setActivePanel('empty');
            }}
          >
            <span>{t('friends.friendsTab')}</span>
            <strong>{filteredFriends.length}</strong>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeListTab === 'groups'}
            className={activeListTab === 'groups' ? 'is-active' : ''}
            onClick={() => {
              setActiveListTab('groups');
              setSelectedFriendshipId(null);
              setActivePanel('empty');
            }}
          >
            <span>{t('friends.groupsTab')}</span>
            <strong>{filteredGroupConversations.length}</strong>
          </button>
        </div>
        {activeListTab === 'friends' ? (
          <FriendListSection
            friends={filteredFriends}
            selectedFriend={activePanel === 'friend' ? selectedFriend : null}
            t={t}
            onSelectFriend={handleSelectFriend}
          />
        ) : (
          <GroupConversationListSection
            conversations={filteredGroupConversations}
            t={t}
            onOpenGroup={handleOpenGroupChat}
          />
        )}
      </aside>

      <section className="chat-panel friends-detail-panel">
        {!isNetworkOnline ? (
          <div className="friends-network-notice" role="status">
            {t('friends.networkUnavailable')}
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        {activePanel === 'empty' ? <ContactsEmptyState t={t} /> : null}

        {activePanel === 'friend' ? (
          <FriendProfileCard
            selectedFriend={selectedFriend}
            isBusy={isBusy}
            t={t}
            onOpenChat={handleOpenChat}
            onDeleteFriend={handleDeleteFriend}
          />
        ) : null}

        {activePanel === 'add' ? (
          <AddFriendSection
            pairingCode={pairingCode}
            pairingCodeExpiresAt={pairingCodeExpiresAt}
            inputCode={inputCode}
            isBusy={isBusy}
            t={t}
            onInputCodeChange={setInputCode}
            onGenerateCode={handleGenerateCode}
            onSubmitRequest={handleSubmitRequest}
          />
        ) : null}

        {activePanel === 'group' ? (
          <CreateGroupSection
            friends={friends}
            groupName={groupName}
            selectedMemberIds={selectedGroupMemberIds}
            isBusy={isBusy}
            t={t}
            onGroupNameChange={setGroupName}
            onToggleMember={toggleGroupMember}
            onSubmit={handleCreateGroup}
          />
        ) : null}

        {activePanel === 'requests' ? (
          <FriendRequestsSection
            incoming={incoming}
            outgoing={outgoing}
            isBusy={isBusy}
            canClearRequests={canClearRequests}
            t={t}
            onRespond={handleRespond}
            onClearRequests={handleClearRequests}
          />
        ) : null}
        {pendingDeleteFriend ? (
          <FriendDeleteConfirmDialog
            title={t('friends.deleteFriendConfirmTitle')}
            message={t('friends.deleteFriendConfirm')}
            cancelLabel={t('common.cancel')}
            confirmLabel={t('friends.deleteFriendConfirmAction')}
            isBusy={isDeletingFriend}
            onCancel={cancelDeleteFriend}
            onConfirm={() => void confirmDeleteFriend()}
          />
        ) : null}
      </section>
    </section>
  );
}

function FriendListSection({
  friends,
  selectedFriend,
  t,
  onSelectFriend,
}: {
  friends: FriendItem[];
  selectedFriend: FriendItem | null;
  t: ReturnType<typeof useI18n>['t'];
  onSelectFriend: (friendshipId: string) => void;
}): JSX.Element {
  return (
    <section className="friends-list-scroll">
        {friends.length === 0 ? <p className="empty-list">{t('friends.noFriends')}</p> : null}
        <div className="request-list">
          {friends.map((item) => (
            <button
              type="button"
              className={`friend-row ${selectedFriend?.id === item.id ? 'is-selected' : ''}`}
              key={item.id}
              onClick={() => onSelectFriend(item.id)}
            >
              <FriendSummary
                user={item.friend}
                presenceLabel={formatPresence(item.friend.isOnline, item.friend.lastSeenAt, t)}
              />
            </button>
          ))}
        </div>
    </section>
  );
}

function GroupConversationListSection({
  conversations,
  t,
  onOpenGroup,
}: {
  conversations: Conversation[];
  t: ReturnType<typeof useI18n>['t'];
  onOpenGroup: (conversation: Conversation) => Promise<void>;
}): JSX.Element {
  return (
    <section className="friends-list-scroll" aria-label={t('friends.groupList')}>
      {conversations.length === 0 ? <p className="empty-list">{t('friends.noGroups')}</p> : null}
      <div className="request-list group-conversation-list">
        {conversations.map((conversation) => (
          <button
            type="button"
            className="friend-row group-conversation-row"
            key={conversation.id}
            onClick={() => void onOpenGroup(conversation)}
          >
            <GroupConversationSummary conversation={conversation} t={t} />
          </button>
        ))}
      </div>
    </section>
  );
}

function GroupConversationSummary({
  conversation,
  t,
}: {
  conversation: Conversation;
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element {
  return (
    <div className="friend-user-summary group-conversation-summary">
      <UserAvatar
        userId={conversation.id}
        displayName={getGroupConversationTitle(conversation, t)}
        avatarUrl={null}
        size="sm"
      />
      <span className="friend-summary-text">
        <strong className="friend-summary-name">{getGroupConversationTitle(conversation, t)}</strong>
        <span className="friend-presence-line">{formatGroupConversationSubtitle(conversation, t)}</span>
      </span>
    </div>
  );
}
function ContactsEmptyState({ t }: { t: ReturnType<typeof useI18n>['t'] }): JSX.Element {
  return (
    <section className="friends-detail-empty">
      <span className="friends-empty-icon" aria-hidden="true">
        <img src="/vector_icon/contact-round.svg" alt="" />
      </span>
      <h2>{t('friends.profileTitle')}</h2>
      <p>{t('friends.noProfileSelected')}</p>
    </section>
  );
}

function FriendProfileCard({
  selectedFriend,
  isBusy,
  t,
  onOpenChat,
  onDeleteFriend,
}: {
  selectedFriend: FriendItem | null;
  isBusy: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onOpenChat: (item: FriendItem) => Promise<void>;
  onDeleteFriend: (item: FriendItem) => void;
}): JSX.Element {
  if (!selectedFriend) {
    return <ContactsEmptyState t={t} />;
  }

  return (
    <aside className="friend-profile-card">
      <UserAvatar
        userId={selectedFriend.friend.id}
        displayName={selectedFriend.friend.displayName}
        avatarUrl={selectedFriend.friend.avatarUrl}
        size="lg"
      />
      <h2>{selectedFriend.friend.displayName}</h2>
      <span className="friend-profile-presence">
        {formatPresence(selectedFriend.friend.isOnline, selectedFriend.friend.lastSeenAt, t)}
      </span>
      <dl>
        <div>
          <dt>{t('friends.profileEmail')}</dt>
          <dd>{selectedFriend.friend.email ?? t('friends.profileEmpty')}</dd>
        </div>
        <div>
          <dt>{t('friends.profileStatus')}</dt>
          <dd>{selectedFriend.friend.statusMessage || selectedFriend.friend.accountType}</dd>
        </div>
      </dl>
      <div className="friend-profile-actions">
        <button
          type="button"
          className="primary-button"
          disabled={isBusy}
          onClick={() => void onOpenChat(selectedFriend)}
        >
          {t('friends.sendMessage')}
        </button>
        <button
          type="button"
          className="secondary-button danger-button"
          disabled={isBusy}
          onClick={() => void onDeleteFriend(selectedFriend)}
        >
          {t('friends.deleteFriend')}
        </button>
      </div>
    </aside>
  );
}

export function FriendDeleteConfirmDialog({
  title,
  message,
  cancelLabel,
  confirmLabel,
  isBusy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
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
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-friend-confirm-title">
        <header>
          <strong id="delete-friend-confirm-title">{title}</strong>
        </header>
        <p>{message}</p>
        <footer className="confirm-dialog-actions">
          <button type="button" className="secondary-button compact-button" disabled={isBusy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="danger-button compact-button" disabled={isBusy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AddFriendSection({
  pairingCode,
  pairingCodeExpiresAt,
  inputCode,
  isBusy,
  t,
  onInputCodeChange,
  onGenerateCode,
  onSubmitRequest,
}: {
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  inputCode: string;
  isBusy: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onInputCodeChange: (value: string) => void;
  onGenerateCode: () => Promise<void>;
  onSubmitRequest: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): JSX.Element {
  return (
    <section className="friends-add-page">
      <div
        className={`friends-add-section ${
          pairingCode ? 'friends-add-section--has-code' : ''
        }`.trim()}
      >
        <div className="friends-panel friends-add-card">
          <h2>{t('friends.generateTitle')}</h2>
          <button
            type="button"
            className="primary-button friends-generate-code-button"
            onClick={() => void onGenerateCode()}
            disabled={isBusy}
          >
            {t('friends.generateCode')}
          </button>
          {pairingCode ? (
            <div className="pairing-code-box">
              <strong>{pairingCode}</strong>
              <span>
                {t('friends.expiresAt')}: {formatDateTime(pairingCodeExpiresAt)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="friends-panel friends-add-card">
          <h2>{t('friends.addTitle')}</h2>
          <form className="form-stack" onSubmit={(event) => void onSubmitRequest(event)}>
            <label>
              <span>{t('friends.pairingCode')}</span>
              <input
                value={inputCode}
                inputMode="numeric"
                onChange={(event) => onInputCodeChange(event.target.value)}
              />
            </label>
            <button type="submit" className="primary-button" disabled={isBusy || !inputCode.trim()}>
              {t('friends.sendRequest')}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function CreateGroupSection({
  friends,
  groupName,
  selectedMemberIds,
  isBusy,
  t,
  onGroupNameChange,
  onToggleMember,
  onSubmit,
}: {
  friends: FriendItem[];
  groupName: string;
  selectedMemberIds: string[];
  isBusy: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onGroupNameChange: (value: string) => void;
  onToggleMember: (friendUserId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): JSX.Element {
  return (
    <section className="friends-add-page">
      <div className="friends-panel friends-add-card friends-group-card">
        <h2>{t('chat.createGroup')}</h2>
        <form className="form-stack" onSubmit={(event) => void onSubmit(event)}>
          <label>
            <span>{t('chat.groupName')}</span>
            <input
              value={groupName}
              maxLength={80}
              onChange={(event) => onGroupNameChange(event.target.value)}
              placeholder={t('chat.groupNamePlaceholder')}
            />
          </label>
          <fieldset className="group-member-fieldset">
            <legend>{t('chat.selectGroupMembers')}</legend>
            <div className="group-member-list">
              {friends.length === 0 ? <p className="empty-list">{t('friends.noFriends')}</p> : null}
              {friends.map((friend) => {
                const isSelected = selectedMemberIds.includes(friend.friend.id);
                return (
                  <label className="group-member-option" key={friend.id}>
                    <span className="group-member-checkbox-wrap">
                      <input
                        className="group-member-checkbox"
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleMember(friend.friend.id)}
                        aria-label={friend.friend.displayName || friend.friend.email || friend.friend.id}
                      />
                      <span className="group-member-checkmark" aria-hidden="true" />
                    </span>
                    <FriendSummary
                      user={friend.friend}
                      presenceLabel={formatPresence(friend.friend.isOnline, friend.friend.lastSeenAt, t)}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="submit"
            className="primary-button"
            disabled={isBusy || !groupName.trim() || selectedMemberIds.length === 0}
          >
            {t('chat.createGroup')}
          </button>
        </form>
      </div>
    </section>
  );
}

function FriendRequestsSection({
  incoming,
  outgoing,
  isBusy,
  canClearRequests,
  t,
  onRespond,
  onClearRequests,
}: {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  isBusy: boolean;
  canClearRequests: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onRespond: (requestId: string, action: 'accept' | 'reject') => Promise<void>;
  onClearRequests: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="friends-notification-page">
      <header className="friends-page-header">
        <div>
          <h2>{t('friends.notifications')}</h2>
          <span>{t('friends.requestsTitle')}</span>
        </div>
        {incoming.length > 0 || outgoing.length > 0 ? (
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={isBusy || !canClearRequests}
            onClick={() => void onClearRequests()}
          >
            {t('friends.clearRequests')}
          </button>
        ) : null}
      </header>
      <div
        className={`friends-notification-body ${
          incoming.length === 0 && outgoing.length === 0 ? 'is-empty' : ''
        }`}
      >
        {incoming.length === 0 && outgoing.length === 0 ? (
          <div className="friends-notification-empty">
            <span className="friends-empty-icon" aria-hidden="true">
              <img src="/vector_icon/bell.svg" alt="" />
            </span>
            <p>{t('friends.noRequests')}</p>
          </div>
        ) : (
          <div className="friends-notification-list">
            {incoming.map((request) => (
              <article className="friends-notification-row" key={request.id}>
                <FriendSummary user={request.requester} presenceLabel={request.status} />
                {request.status === 'PENDING' ? (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={isBusy}
                      onClick={() => void onRespond(request.id, 'reject')}
                    >
                      {t('friends.reject')}
                    </button>
                    <button
                      type="button"
                      className="primary-button compact-button"
                      disabled={isBusy}
                      onClick={() => void onRespond(request.id, 'accept')}
                    >
                      {t('friends.accept')}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {outgoing.map((request) => (
              <article className="friends-notification-row" key={request.id}>
                <FriendSummary
                  user={request.addressee}
                  presenceLabel={`${t('friends.outgoing')}: ${request.status}`}
                />
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FriendSummary({
  user,
  presenceLabel,
}: {
  user: FriendUser;
  presenceLabel: string;
}): JSX.Element {
  return (
    <div className="friend-user-summary">
      <UserAvatar
        userId={user.id}
        displayName={user.displayName}
        avatarUrl={user.avatarUrl}
        size="sm"
      />
      <span className="friend-summary-text">
        <strong className="friend-summary-name">{user.displayName}</strong>
        <span className="friend-presence-line">{presenceLabel}</span>
      </span>
    </div>
  );
}

function filterGroupConversations(conversations: Conversation[], query: string): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = conversations.filter((conversation) => conversation.type === 'GROUP');
  if (!normalizedQuery) {
    return groups;
  }

  return groups.filter((conversation) =>
    getGroupConversationTitle(conversation, null).toLocaleLowerCase().includes(normalizedQuery),
  );
}

function getGroupConversationTitle(
  conversation: Conversation,
  t: ReturnType<typeof useI18n>['t'] | null,
): string {
  return conversation.title?.trim() || t?.('chat.groupConversation') || conversation.id;
}

function formatGroupConversationSubtitle(
  conversation: Conversation,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return t('chat.groupMembers').replace('{{count}}', String(conversation.memberCount));
}

function filterFriends(friends: FriendItem[], query: string): FriendItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return friends;
  }

  return friends.filter((item) => {
    const searchableText = [
      item.friend.displayName,
      item.friend.email ?? '',
      item.friend.statusMessage ?? '',
      item.friend.accountType,
    ]
      .join(' ')
      .toLocaleLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString();
}

function applyPresence(
  friend: FriendItem['friend'],
  presenceByUserId: ReturnType<typeof useChatStore.getState>['presenceByUserId'],
): FriendItem['friend'] {
  const presence = presenceByUserId[friend.id];
  if (!presence) {
    return friend;
  }

  return {
    ...friend,
    isOnline: presence.isOnline,
    lastSeenAt: presence.lastSeenAt,
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
