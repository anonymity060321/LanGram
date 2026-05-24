import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import { unhideConversationInUiState } from '../../utils/conversationUiState';

type FriendsTab = 'list' | 'add' | 'requests';

export function FriendsPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const connect = useChatStore((state) => state.connect);
  const disconnect = useChatStore((state) => state.disconnect);
  const openDirectConversation = useChatStore((state) => state.openDirectConversation);
  const presenceByUserId = useChatStore((state) => state.presenceByUserId);
  const [activeTab, setActiveTab] = useState<FriendsTab>('list');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selectedFriendshipId, setSelectedFriendshipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void refreshFriendsData().catch(() => setError(t('friends.actionFailed')));
  }, [t]);

  useEffect(() => {
    if (!accessToken) {
      disconnect();
      return;
    }

    connect(accessToken);
    return () => disconnect();
  }, [accessToken, connect, disconnect]);

  useEffect(() => {
    setFriends((current) =>
      current.map((item) => ({
        ...item,
        friend: applyPresence(item.friend, presenceByUserId),
      })),
    );
  }, [presenceByUserId]);

  const selectedFriend = useMemo(
    () => friends.find((item) => item.id === selectedFriendshipId) ?? friends[0] ?? null,
    [friends, selectedFriendshipId],
  );

  async function refreshFriendsData(): Promise<void> {
    const [requestsResult, friendsResult] = await Promise.all([
      listFriendRequests(),
      listFriends(),
    ]);
    setIncoming(requestsResult.incoming);
    setOutgoing(requestsResult.outgoing);
    setFriends(friendsResult.friends);
  }

  async function handleGenerateCode(): Promise<void> {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createPairingCode();
      setPairingCode(result.pairingCode);
      setPairingCodeExpiresAt(result.expiresAt);
    } catch {
      setError(t('friends.actionFailed'));
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
      setActiveTab('requests');
    } catch {
      setError(t('friends.actionFailed'));
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
      setError(t('friends.actionFailed'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenChat(friendUserId: string): Promise<void> {
    if (!user) {
      return;
    }

    const conversationId = await openDirectConversation(friendUserId, user.id);
    if (conversationId) {
      unhideConversationInUiState(conversationId);
      navigate('/');
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
      }
      await refreshFriendsData();
    } catch {
      setError(t('friends.deleteFailed'));
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
      setError(t('friends.clearRequestsFailed'));
    } finally {
      setIsBusy(false);
    }
  }

  const canClearRequests = useMemo(
    () => [...incoming, ...outgoing].some((request) => request.status !== 'PENDING'),
    [incoming, outgoing],
  );

  return (
    <main className="friends-page">
      <section className="friends-shell">
        <header className="settings-header">
          <h1>{t('friends.title')}</h1>
          <Link to="/">{t('common.back')}</Link>
        </header>

        <div className="friends-tabs" role="tablist" aria-label={t('friends.title')}>
          {(['list', 'add', 'requests'] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={activeTab === tab ? 'is-active' : ''}
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {t(`friends.tab.${tab}`)}
            </button>
          ))}
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        {activeTab === 'list' ? (
          <FriendListSection
            friends={friends}
            selectedFriend={selectedFriend}
            isBusy={isBusy}
            t={t}
            onSelectFriend={setSelectedFriendshipId}
            onOpenChat={handleOpenChat}
            onDeleteFriend={handleDeleteFriend}
          />
        ) : null}

        {activeTab === 'add' ? (
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

        {activeTab === 'requests' ? (
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
    </main>
  );
}

function FriendListSection({
  friends,
  selectedFriend,
  isBusy,
  t,
  onSelectFriend,
  onOpenChat,
  onDeleteFriend,
}: {
  friends: FriendItem[];
  selectedFriend: FriendItem | null;
  isBusy: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onSelectFriend: (friendshipId: string) => void;
  onOpenChat: (friendUserId: string) => Promise<void>;
  onDeleteFriend: (item: FriendItem) => Promise<void>;
}): JSX.Element {
  return (
    <section className="friends-content-grid">
      <div className="friends-panel">
        <h2>{t('friends.listTitle')}</h2>
        {friends.length === 0 ? <p className="empty-list">{t('friends.noFriends')}</p> : null}
        <div className="request-list">
          {friends.map((item) => (
            <article
              className={`friend-row ${selectedFriend?.id === item.id ? 'is-selected' : ''}`}
              key={item.id}
            >
              <button
                type="button"
                className="friend-row-button"
                onClick={() => onSelectFriend(item.id)}
              >
                <FriendSummary
                  user={item.friend}
                  presenceLabel={formatPresence(item.friend.isOnline, item.friend.lastSeenAt, t)}
                />
              </button>
              <div className="row-actions">
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={isBusy}
                  onClick={() => void onOpenChat(item.friend.id)}
                >
                  {t('friends.openChat')}
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button danger-button"
                  disabled={isBusy}
                  onClick={() => void onDeleteFriend(item)}
                >
                  {t('friends.deleteFriend')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <FriendProfileCard selectedFriend={selectedFriend} t={t} />
    </section>
  );
}

function FriendProfileCard({
  selectedFriend,
  t,
}: {
  selectedFriend: FriendItem | null;
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element {
  if (!selectedFriend) {
    return (
      <aside className="friends-panel friend-profile-card">
        <h2>{t('friends.profileTitle')}</h2>
        <p className="empty-list">{t('friends.noProfileSelected')}</p>
      </aside>
    );
  }

  return (
    <aside className="friends-panel friend-profile-card">
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
    <section className="friends-grid">
      <div className="friends-panel">
        <h2>{t('friends.generateTitle')}</h2>
        <button
          type="button"
          className="primary-button"
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

      <div className="friends-panel">
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
    <section className="friends-panel">
      <div className="friends-panel-header">
        <h2>{t('friends.requestsTitle')}</h2>
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
      </div>
      {incoming.length === 0 && outgoing.length === 0 ? (
        <p className="empty-list">{t('friends.noRequests')}</p>
      ) : null}
      <div className="request-list">
        {incoming.map((request) => (
          <article className="friend-row" key={request.id}>
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
          <article className="friend-row" key={request.id}>
            <FriendSummary
              user={request.addressee}
              presenceLabel={`${t('friends.outgoing')}: ${request.status}`}
            />
          </article>
        ))}
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
        <span className="friend-summary-meta">{user.statusMessage || user.email || user.accountType}</span>
        <span className="friend-presence-line">{presenceLabel}</span>
      </span>
    </div>
  );
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
