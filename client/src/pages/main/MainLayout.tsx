import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listFriends, type FriendItem } from '../../api/friends.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore, type ChatMessage } from '../../stores/chat.store';

export function MainLayout(): JSX.Element {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const conversations = useChatStore((state) => state.conversations);
  const selectedConversationId = useChatStore((state) => state.selectedConversationId);
  const messagesByConversation = useChatStore((state) => state.messagesByConversation);
  const chatError = useChatStore((state) => state.error);
  const searchQuery = useChatStore((state) => state.searchQuery);
  const isLoadingConversations = useChatStore((state) => state.isLoadingConversations);
  const isLoadingMessages = useChatStore((state) => state.isLoadingMessages);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const openDirectConversation = useChatStore((state) => state.openDirectConversation);
  const connect = useChatStore((state) => state.connect);
  const disconnect = useChatStore((state) => state.disconnect);
  const sendTextMessage = useChatStore((state) => state.sendTextMessage);
  const recallMessage = useChatStore((state) => state.recallMessage);
  const deleteLocalMessage = useChatStore((state) => state.deleteLocalMessage);
  const clearLocalConversation = useChatStore((state) => state.clearLocalConversation);
  const setSearchQuery = useChatStore((state) => state.setSearchQuery);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [messageDraft, setMessageDraft] = useState('');

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null;
  const messages = useMemo(
    () => (selectedConversationId ? messagesByConversation[selectedConversationId] ?? [] : []),
    [messagesByConversation, selectedConversationId],
  );
  const visibleMessages = useMemo(
    () => filterMessages(messages, searchQuery),
    [messages, searchQuery],
  );

  useEffect(() => {
    void loadConversations();
    void listFriends()
      .then((result) => setFriends(result.friends))
      .catch(() => setFriends([]));
  }, [loadConversations]);

  useEffect(() => {
    if (!accessToken) {
      disconnect();
      return;
    }

    connect(accessToken);
    return () => disconnect();
  }, [accessToken, connect, disconnect]);

  const visibleFriends = useMemo(
    () =>
      friends.filter(
        (friend) => !conversations.some((conversation) => conversation.peer?.id === friend.friend.id),
      ),
    [conversations, friends],
  );

  async function handleSelectConversation(conversationId: string): Promise<void> {
    if (!user) {
      return;
    }

    setSearchQuery('');
    await selectConversation(conversationId, user.id);
  }

  async function handleOpenFriend(friendUserId: string): Promise<void> {
    if (!user) {
      return;
    }

    await openDirectConversation(friendUserId, user.id);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !selectedConversationId || !messageDraft.trim()) {
      return;
    }

    const plaintext = messageDraft.trim();
    setMessageDraft('');
    await sendTextMessage(selectedConversationId, plaintext, user.id);
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

  function handleClearLocalConversation(): void {
    if (!selectedConversationId) {
      return;
    }

    clearLocalConversation(selectedConversationId);
  }

  return (
    <main className="main-layout">
      <aside className="conversation-panel">
        <div className="sidebar-header">
          <strong>{t('app.name')}</strong>
          <div className="sidebar-actions">
            <Link to="/friends">{t('main.friends')}</Link>
            <Link to="/settings">{t('main.settings')}</Link>
          </div>
        </div>
        <section className="sidebar-section">
          <h2>{t('main.sidebarChats')}</h2>
          {isLoadingConversations ? <p>{t('chat.loading')}</p> : null}
          {!isLoadingConversations && conversations.length === 0 ? (
            <p>{t('chat.noConversations')}</p>
          ) : null}
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                type="button"
                className={`conversation-item ${
                  selectedConversationId === conversation.id ? 'is-active' : ''
                }`}
                key={conversation.id}
                onClick={() => void handleSelectConversation(conversation.id)}
              >
                <span className="conversation-avatar">
                  {conversation.peer?.displayName.slice(0, 1).toUpperCase() ?? 'L'}
                </span>
                <span>
                  <strong>{conversation.peer?.displayName ?? t('chat.unknownPeer')}</strong>
                  <small>{t('chat.direct')}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="sidebar-section">
          <h2>{t('main.sidebarFriends')}</h2>
          <Link to="/friends">{t('friends.openFriends')}</Link>
        </section>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <strong>
              {selectedConversation?.peer?.displayName ?? user?.displayName ?? t('app.name')}
            </strong>
            <span>{selectedConversation ? t('chat.direct') : (user?.accountType ?? 'MVP')}</span>
          </div>
          {selectedConversation ? (
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={handleClearLocalConversation}
              disabled={messages.length === 0}
            >
              {t('chat.clearLocal')}
            </button>
          ) : null}
        </header>
        {selectedConversation ? (
          <>
            <div className="chat-search-bar">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('chat.searchPlaceholder')}
              />
              {searchQuery.trim() ? (
                <span>
                  {visibleMessages.length} / {messages.length}
                </span>
              ) : null}
            </div>
            <MessageList
              messages={visibleMessages}
              isLoading={isLoadingMessages}
              searchQuery={searchQuery}
              hasSearchQuery={searchQuery.trim().length > 0}
              onDeleteLocalMessage={handleDeleteLocalMessage}
              onRecallMessage={handleRecallMessage}
            />
            <form className="message-input" onSubmit={(event) => void handleSend(event)}>
              <input
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder={t('chat.messagePlaceholder')}
              />
              <button type="submit" className="primary-button" disabled={!messageDraft.trim()}>
                {t('chat.send')}
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat-state">
            <h1>{t('main.emptyTitle')}</h1>
            <p>{t('chat.selectConversation')}</p>
          </div>
        )}
        {chatError ? <p className="chat-error">{chatError}</p> : null}
      </section>

      <aside className="profile-panel">
        <div className="profile-avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? 'L'}</div>
        <strong>{user?.displayName ?? t('app.name')}</strong>
        <span>{user?.email ?? user?.accountType ?? 'MVP'}</span>
        <section className="profile-section">
          <h2>{t('chat.startChat')}</h2>
          {visibleFriends.length === 0 ? <p>{t('chat.noFriendsToStart')}</p> : null}
          <div className="friend-start-list">
            {visibleFriends.map((friend) => (
              <button
                type="button"
                className="friend-start-button"
                key={friend.id}
                onClick={() => void handleOpenFriend(friend.friend.id)}
              >
                {friend.friend.displayName}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function MessageList({
  messages,
  isLoading,
  searchQuery,
  hasSearchQuery,
  onDeleteLocalMessage,
  onRecallMessage,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  searchQuery: string;
  hasSearchQuery: boolean;
  onDeleteLocalMessage: (messageId: string) => void;
  onRecallMessage: (messageId: string) => void;
}): JSX.Element {
  const { t } = useI18n();

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
        <p>{hasSearchQuery ? t('chat.searchNoResults') : t('chat.noMessages')}</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <article className={`message-row ${message.isOwn ? 'is-own' : ''}`} key={message.id}>
          <div className={`message-bubble ${message.status === 'recalled' ? 'is-recalled' : ''}`}>
            <p>
              {message.status === 'recalled'
                ? t('chat.messageRecalled')
                : renderHighlightedText(message.plaintext, searchQuery)}
            </p>
            <div className="message-meta">
              <span>
                {message.isOwn && message.status !== 'recalled'
                  ? t(`chat.status.${message.status}`)
                  : formatTime(message.recalledAt ?? message.createdAt)}
              </span>
              {message.isOwn && message.status !== 'recalled' && canRecallMessage(message) ? (
                <button
                  type="button"
                  className="message-action"
                  onClick={() => onRecallMessage(message.id)}
                >
                  {t('chat.recall')}
                </button>
              ) : null}
              <button
                type="button"
                className="message-action"
                onClick={() => onDeleteLocalMessage(message.id)}
              >
                {t('chat.deleteLocal')}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function canRecallMessage(message: ChatMessage): boolean {
  return Date.now() - new Date(message.createdAt).getTime() <= 2 * 60 * 1000;
}

function filterMessages(messages: ChatMessage[], query: string): ChatMessage[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return messages;
  }

  return messages.filter((message) =>
    message.plaintext.toLocaleLowerCase().includes(normalizedQuery),
  );
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
