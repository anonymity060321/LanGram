import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  acceptFriendRequest,
  createFriendRequest,
  createPairingCode,
  listFriendRequests,
  listFriends,
  rejectFriendRequest,
  type FriendItem,
  type FriendRequest,
} from '../../api/friends.api';
import { UserAvatar } from '../../components/UserAvatar';
import { useI18n } from '../../i18n';

export function FriendsPage(): JSX.Element {
  const { t } = useI18n();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void refreshFriendsData().catch(() => setError(t('friends.actionFailed')));
  }, [t]);

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

  return (
    <main className="friends-page">
      <section className="friends-shell">
        <header className="settings-header">
          <h1>{t('friends.title')}</h1>
          <Link to="/">{t('common.back')}</Link>
        </header>

        <div className="friends-grid">
          <section className="friends-panel">
            <h2>{t('friends.generateTitle')}</h2>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleGenerateCode()}
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
          </section>

          <section className="friends-panel">
            <h2>{t('friends.addTitle')}</h2>
            <form className="form-stack" onSubmit={(event) => void handleSubmitRequest(event)}>
              <label>
                <span>{t('friends.pairingCode')}</span>
                <input
                  value={inputCode}
                  inputMode="numeric"
                  onChange={(event) => setInputCode(event.target.value)}
                />
              </label>
              <button type="submit" className="primary-button" disabled={isBusy || !inputCode}>
                {t('friends.sendRequest')}
              </button>
            </form>
          </section>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        <section className="friends-panel">
          <h2>{t('friends.requestsTitle')}</h2>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className="empty-list">{t('friends.noRequests')}</p>
          ) : null}
          <div className="request-list">
            {incoming.map((request) => (
              <article className="friend-row" key={request.id}>
                <div className="friend-user-summary">
                  <UserAvatar
                    userId={request.requester.id}
                    displayName={request.requester.displayName}
                    avatarUrl={request.requester.avatarUrl}
                    size="sm"
                  />
                  <span>
                    <strong>{request.requester.displayName}</strong>
                    <span>{request.status}</span>
                  </span>
                </div>
                {request.status === 'PENDING' ? (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isBusy}
                      onClick={() => void handleRespond(request.id, 'reject')}
                    >
                      {t('friends.reject')}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={isBusy}
                      onClick={() => void handleRespond(request.id, 'accept')}
                    >
                      {t('friends.accept')}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {outgoing.map((request) => (
              <article className="friend-row" key={request.id}>
                <div className="friend-user-summary">
                  <UserAvatar
                    userId={request.addressee.id}
                    displayName={request.addressee.displayName}
                    avatarUrl={request.addressee.avatarUrl}
                    size="sm"
                  />
                  <span>
                    <strong>{request.addressee.displayName}</strong>
                    <span>
                    {t('friends.outgoing')}: {request.status}
                    </span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="friends-panel">
          <h2>{t('friends.listTitle')}</h2>
          {friends.length === 0 ? <p className="empty-list">{t('friends.noFriends')}</p> : null}
          <div className="request-list">
            {friends.map((item) => (
              <article className="friend-row" key={item.id}>
                <div className="friend-user-summary">
                  <UserAvatar
                    userId={item.friend.id}
                    displayName={item.friend.displayName}
                    avatarUrl={item.friend.avatarUrl}
                    size="sm"
                  />
                  <span>
                    <strong>{item.friend.displayName}</strong>
                    <span>{item.friend.statusMessage || item.friend.email || item.friend.accountType}</span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString();
}
