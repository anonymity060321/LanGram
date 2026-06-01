import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

type ContactsPanel = 'empty' | 'friend' | 'add' | 'requests';

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
}: {
  className?: string;
  showBackLink?: boolean;
  onConversationOpened?: (conversationId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const openDirectConversation = useChatStore((state) => state.openDirectConversation);
  const presenceByUserId = useChatStore((state) => state.presenceByUserId);
  const isNetworkOnline = useNetworkStore((state) => state.online);
  const [activePanel, setActivePanel] = useState<ContactsPanel>('empty');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selectedFriendshipId, setSelectedFriendshipId] = useState<string | null>(null);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

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
    } catch {
      setError(isNetworkOnline ? t('friends.actionFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenChat(friendUserId: string): Promise<void> {
    if (!user) {
      return;
    }

    if (!isNetworkOnline) {
      setError(t('friends.networkUnavailable'));
      return;
    }

    const conversationId = await openDirectConversation(friendUserId, user.id);
    if (conversationId) {
      unhideConversationInUiState(conversationId);
      onConversationOpened?.(conversationId);
    }
  }

  async function handleDeleteFriend(item: FriendItem): Promise<void> {
    if (!window.confirm(t('friends.deleteConfirm'))) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteFriend(item.id);
      setNotice(t('friends.deleteSuccess'));
      if (selectedFriendshipId === item.id) {
        setSelectedFriendshipId(null);
        setActivePanel('empty');
      }
      await refreshFriendsData();
    } catch {
      setError(isNetworkOnline ? t('friends.deleteFailed') : t('friends.networkUnavailable'));
    } finally {
      setIsBusy(false);
    }
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
        <button
          type="button"
          className={`friends-nav-entry ${
            activePanel === 'empty' || activePanel === 'friend' ? 'is-active' : ''
          }`}
          onClick={() => {
            setSelectedFriendshipId(null);
            setActivePanel('empty');
          }}
        >
          <strong>{t('friends.listTitle')}</strong>
          <span className="friends-nav-badge">{filteredFriends.length}</span>
        </button>
        <FriendListSection
          friends={filteredFriends}
          selectedFriend={activePanel === 'friend' ? selectedFriend : null}
          t={t}
          onSelectFriend={handleSelectFriend}
        />
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

function ContactsEmptyState({ t }: { t: ReturnType<typeof useI18n>['t'] }): JSX.Element {
  return (
    <section className="friends-detail-empty">
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
  onOpenChat: (friendUserId: string) => Promise<void>;
  onDeleteFriend: (item: FriendItem) => Promise<void>;
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
          onClick={() => void onOpenChat(selectedFriend.friend.id)}
        >
          {t('friends.openChat')}
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
      <div className="friends-add-section">
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
            <span aria-hidden="true">!</span>
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
