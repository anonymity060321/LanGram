import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation } from '../../api/conversations.api';
import {
  downloadFile,
  uploadFile,
  type FileKind,
  type FileMetadataResponse,
} from '../../api/files.api';
import { listFriends, type FriendItem } from '../../api/friends.api';
import { AppLogo } from '../../components/AppLogo';
import { UserAvatar } from '../../components/UserAvatar';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore, type ChatMessage } from '../../stores/chat.store';
import { isCompressibleImage, prepareImageUploadFile } from '../../utils/imageCompression';

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
  const sendFileMessage = useChatStore((state) => state.sendFileMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const forwardMessage = useChatStore((state) => state.forwardMessage);
  const recallMessage = useChatStore((state) => state.recallMessage);
  const deleteLocalMessage = useChatStore((state) => state.deleteLocalMessage);
  const clearLocalConversation = useChatStore((state) => state.clearLocalConversation);
  const setSearchQuery = useChatStore((state) => state.setSearchQuery);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [uploadState, setUploadState] = useState<FileUploadState>({
    isUploading: false,
    notice: null,
    error: null,
  });
  const [sendOriginalImage, setSendOriginalImage] = useState(false);
  const [downloadStates, setDownloadStates] = useState<Record<string, FileDownloadStatus>>({});

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
  const forwardTargets = useMemo(
    () => buildForwardTargets(conversations, visibleFriends, t('chat.unknownPeer')),
    [conversations, t, visibleFriends],
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

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!user || !selectedConversationId || !file) {
      return;
    }

    const kind = detectFileKind(file);
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadState({ isUploading: false, notice: null, error: t('chat.fileTooLarge') });
      return;
    }

    if (!kind) {
      setUploadState({ isUploading: false, notice: null, error: t('chat.unsupportedFileType') });
      return;
    }

    setUploadState({ isUploading: true, notice: null, error: null });
    let uploadImage: Awaited<ReturnType<typeof prepareImageUploadFile>> | null = null;
    if (kind === 'IMAGE') {
      try {
        uploadImage = await prepareImageUploadFile(file, sendOriginalImage);
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
        kind,
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

  async function handleDownloadFile(file: FileMetadataResponse): Promise<void> {
    setDownloadStates((current) => ({ ...current, [file.id]: 'downloading' }));

    try {
      const blob = await downloadFile(file.id);
      triggerBrowserDownload(blob, file.originalName);
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
  }

  return (
    <main className="main-layout">
      <aside className="conversation-panel">
        <div className="sidebar-header">
          <AppLogo label={t('app.name')} size="sm" />
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
                <UserAvatar
                  userId={conversation.peer?.id}
                  displayName={conversation.peer?.displayName}
                  avatarUrl={conversation.peer?.avatarUrl}
                />
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
              onEditMessage={handleEditMessage}
              onForwardMessage={handleForwardMessage}
              onDownloadFile={handleDownloadFile}
              forwardTargets={forwardTargets}
              downloadStates={downloadStates}
            />
            <form className="message-input" onSubmit={(event) => void handleSend(event)}>
              <div className="file-input-tools">
                <label className={`file-upload-button ${uploadState.isUploading ? 'is-disabled' : ''}`}>
                  <input
                    type="file"
                    onChange={(event) => void handleFileSelected(event)}
                    disabled={uploadState.isUploading}
                    accept={SUPPORTED_UPLOAD_MIME_TYPES.join(',')}
                  />
                  <span>{uploadState.isUploading ? t('chat.uploading') : t('chat.chooseFile')}</span>
                </label>
                <label className="original-image-toggle">
                  <input
                    type="checkbox"
                    checked={sendOriginalImage}
                    onChange={(event) => setSendOriginalImage(event.target.checked)}
                  />
                  <span>{t('chat.sendOriginalImage')}</span>
                </label>
              </div>
              <input
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder={t('chat.messagePlaceholder')}
              />
              <button type="submit" className="primary-button" disabled={!messageDraft.trim()}>
                {t('chat.send')}
              </button>
            </form>
            {uploadState.notice || uploadState.error ? (
              <div className={`file-upload-status ${uploadState.error ? 'is-error' : ''}`}>
                <span>{uploadState.error ?? t('chat.uploadSuccess')}</span>
                {uploadState.notice ? <small>{uploadState.notice}</small> : null}
              </div>
            ) : null}
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
        <UserAvatar
          userId={user?.id}
          displayName={user?.displayName}
          avatarUrl={user?.avatarUrl}
          size="lg"
        />
        <strong>{user?.displayName ?? t('app.name')}</strong>
        <span>{user?.statusMessage || user?.email || user?.accountType || 'MVP'}</span>
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
                <UserAvatar
                  userId={friend.friend.id}
                  displayName={friend.friend.displayName}
                  avatarUrl={friend.friend.avatarUrl}
                  size="sm"
                />
                <span>{friend.friend.displayName}</span>
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
  onEditMessage,
  onForwardMessage,
  onDownloadFile,
  forwardTargets,
  downloadStates,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  searchQuery: string;
  hasSearchQuery: boolean;
  onDeleteLocalMessage: (messageId: string) => void;
  onRecallMessage: (messageId: string) => void;
  onEditMessage: (messageId: string, plaintext: string) => Promise<void>;
  onForwardMessage: (messageId: string, target: ForwardTarget) => Promise<void>;
  onDownloadFile: (file: FileMetadataResponse) => Promise<void>;
  forwardTargets: ForwardTarget[];
  downloadStates: Record<string, FileDownloadStatus>;
}): JSX.Element {
  const { t } = useI18n();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>, message: ChatMessage): Promise<void> {
    event.preventDefault();
    if (!editDraft.trim()) {
      return;
    }

    await onEditMessage(message.id, editDraft.trim());
    setEditingMessageId(null);
    setEditDraft('');
  }

  async function handleForward(message: ChatMessage, target: ForwardTarget): Promise<void> {
    await onForwardMessage(message.id, target);
    setForwardingMessageId(null);
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
        <p>{hasSearchQuery ? t('chat.searchNoResults') : t('chat.noMessages')}</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <article className={`message-row ${message.isOwn ? 'is-own' : ''}`} key={message.id}>
          <div className={`message-bubble ${message.status === 'recalled' ? 'is-recalled' : ''}`}>
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
                  : renderMessageBody(message, searchQuery, t, onDownloadFile, downloadStates)}
              </p>
            )}
            <div className="message-meta">
              <span>
                {message.isOwn && message.status !== 'recalled'
                  ? t(`chat.status.${message.status}`)
                  : formatTime(message.recalledAt ?? message.createdAt)}
              </span>
              {message.editedAt && message.status !== 'recalled' ? (
                <span>{t('chat.edited')}</span>
              ) : null}
              {message.isOwn && message.status !== 'recalled' && canEditMessage(message) ? (
                <button
                  type="button"
                  className="message-action"
                  onClick={() => {
                    setEditingMessageId(message.id);
                    setEditDraft(message.plaintext);
                  }}
                >
                  {t('chat.edit')}
                </button>
              ) : null}
              {message.isOwn && message.status !== 'recalled' && canRecallMessage(message) ? (
                <button
                  type="button"
                  className="message-action"
                  onClick={() => onRecallMessage(message.id)}
                >
                  {t('chat.recall')}
                </button>
              ) : null}
              {message.status !== 'recalled' ? (
                <button
                  type="button"
                  className="message-action"
                  onClick={() => setForwardingMessageId(message.id)}
                >
                  {t('chat.forward')}
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
            {forwardingMessageId === message.id ? (
              <div className="forward-picker">
                <div className="forward-picker-header">
                  <strong>{t('chat.forwardTo')}</strong>
                  <button
                    type="button"
                    className="message-action"
                    onClick={() => setForwardingMessageId(null)}
                  >
                    {t('chat.cancel')}
                  </button>
                </div>
                {forwardTargets.length === 0 ? (
                  <p>{t('chat.selectForwardTarget')}</p>
                ) : (
                  <div className="forward-target-list">
                    {forwardTargets.map((target) => (
                      <button
                        type="button"
                        className="forward-target"
                        key={target.id}
                        onClick={() => void handleForward(message, target)}
                      >
                        <span>{target.label}</span>
                        <small>{t('chat.direct')}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
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

function canEditMessage(message: ChatMessage): boolean {
  return Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
}

function renderMessageBody(
  message: ChatMessage,
  searchQuery: string,
  t: ReturnType<typeof useI18n>['t'],
  onDownloadFile: (file: FileMetadataResponse) => Promise<void>,
  downloadStates: Record<string, FileDownloadStatus>,
): Array<string | JSX.Element> | JSX.Element | string {
  if (message.messageType === 'IMAGE' && message.file) {
    const downloadStatus = downloadStates[message.file.id];

    return (
      <span className="image-message-card">
        <ImageMessagePreview file={message.file} t={t} />
        <span className="image-message-details">
          <strong>{message.file.originalName}</strong>
          <FileDownloadButton
            file={message.file}
            status={downloadStatus}
            onDownloadFile={onDownloadFile}
            t={t}
          />
          <small>
            {message.file.mimeType} · {formatFileSize(Number(message.file.sizeBytes))}
          </small>
        </span>
      </span>
    );
  }

  if (message.messageType === 'FILE' && message.file) {
    const downloadStatus = downloadStates[message.file.id];

    return (
      <span className="file-message-card">
        <span className="file-message-icon">{t('chat.file')}</span>
        <span>
          <strong>{message.file.originalName}</strong>
          <FileDownloadButton
            file={message.file}
            status={downloadStatus}
            onDownloadFile={onDownloadFile}
            t={t}
          />
          <small>
            {message.file.mimeType} · {formatFileSize(Number(message.file.sizeBytes))}
          </small>
        </span>
      </span>
    );
  }

  return renderHighlightedText(message.plaintext, searchQuery);
}

function ImageMessagePreview({
  file,
  t,
}: {
  file: FileMetadataResponse;
  t: ReturnType<typeof useI18n>['t'];
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
      <span className="image-preview-frame">
        <img src={previewState.objectUrl} alt={file.originalName} />
      </span>
    );
  }

  return (
    <span className={`image-preview-placeholder ${previewState.status === 'failed' ? 'is-error' : ''}`}>
      {previewState.status === 'failed' ? t('chat.imagePreviewFailed') : t('chat.imagePreviewLoading')}
    </span>
  );
}

function FileDownloadButton({
  file,
  status,
  onDownloadFile,
  t,
}: {
  file: FileMetadataResponse;
  status?: FileDownloadStatus;
  onDownloadFile: (file: FileMetadataResponse) => Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element {
  const isDownloading = status === 'downloading';

  return (
    <span className="file-message-actions">
      <button
        type="button"
        className="message-action file-download-button"
        onClick={() => void onDownloadFile(file)}
        disabled={isDownloading}
      >
        {isDownloading ? t('chat.downloading') : t('chat.download')}
      </button>
      {status === 'failed' ? (
        <small className="file-download-error">{t('chat.downloadFailed')}</small>
      ) : null}
    </span>
  );
}

interface FileUploadState {
  isUploading: boolean;
  notice: string | null;
  error: string | null;
}

type FileDownloadStatus = 'downloading' | 'failed';
type ImagePreviewState =
  | { status: 'loading'; objectUrl: null }
  | { status: 'failed'; objectUrl: null }
  | { status: 'loaded'; objectUrl: string };

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;
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
const SUPPORTED_UPLOAD_MIME_TYPES = [
  ...Array.from(IMAGE_UPLOAD_MIME_TYPES),
  ...Array.from(FILE_UPLOAD_MIME_TYPES),
];

function detectFileKind(file: File): FileKind | null {
  const mimeType = file.type.toLowerCase();
  if (IMAGE_UPLOAD_MIME_TYPES.has(mimeType)) {
    return 'IMAGE';
  }
  if (FILE_UPLOAD_MIME_TYPES.has(mimeType)) {
    return 'FILE';
  }

  return null;
}

function formatUploadNotice(metadata: FileMetadataResponse): string {
  return `${metadata.originalName} (${formatFileSize(Number(metadata.sizeBytes))})`;
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

function triggerBrowserDownload(blob: Blob, originalName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = sanitizeDownloadName(originalName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function sanitizeDownloadName(originalName: string): string {
  const name = originalName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\r\n]/g, '')
    .trim();

  return name || 'file';
}

interface ForwardTarget {
  id: string;
  type: 'conversation' | 'friend';
  label: string;
  conversationId: string;
  friendUserId: string;
}

function buildForwardTargets(
  conversations: Conversation[],
  friendsWithoutConversation: FriendItem[],
  unknownPeerLabel: string,
): ForwardTarget[] {
  return [
    ...conversations.map((conversation) => ({
      id: `conversation:${conversation.id}`,
      type: 'conversation' as const,
      label: conversation.peer?.displayName ?? unknownPeerLabel,
      conversationId: conversation.id,
      friendUserId: '',
    })),
    ...friendsWithoutConversation.map((friend) => ({
      id: `friend:${friend.friend.id}`,
      type: 'friend' as const,
      label: friend.friend.displayName,
      conversationId: '',
      friendUserId: friend.friend.id,
    })),
  ];
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
