import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';

type ConversationSearchTab = 'all' | 'media' | 'emoji' | 'files' | 'links';

export type ConversationSearchMessage = {
  id: string;
  senderName: string;
  avatarUrl: string | null;
  plaintext: string;
  messageType: string;
  fileName: string | null;
  createdAt: string;
};

export type ConversationSearchPayload = {
  conversationId: string;
  title: string;
  messages: ConversationSearchMessage[];
};

type ConversationSearchReadyPayload = {
  label: string;
};

const CONVERSATION_SEARCH_OPEN_EVENT = 'conversation-search:open';
const CONVERSATION_SEARCH_READY_EVENT = 'conversation-search:ready';

const searchTabs: Array<{
  id: ConversationSearchTab;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
}> = [
  { id: 'all', labelKey: 'chat.searchTabAll' },
  { id: 'media', labelKey: 'chat.searchTabMedia' },
  { id: 'emoji', labelKey: 'chat.searchTabEmoji' },
  { id: 'files', labelKey: 'chat.searchTabFiles' },
  { id: 'links', labelKey: 'chat.searchTabLinks' },
];

export function ConversationSearchWindow(): JSX.Element {
  const { t } = useI18n();
  const [payload, setPayload] = useState<ConversationSearchPayload | null>(null);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ConversationSearchTab>('all');

  useEffect(() => {
    document.title = t('chat.searchWindowTitle');
  }, [t]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isCancelled = false;

    async function listenForSearchPayload(): Promise<void> {
      if (!(await isTauriRuntime())) {
        return;
      }

      const [{ listen, emit }, { WebviewWindow }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/webviewWindow'),
      ]);
      const label = WebviewWindow.getCurrent().label;
      unlisten = await listen<ConversationSearchPayload>(CONVERSATION_SEARCH_OPEN_EVENT, (event) => {
        if (isCancelled) {
          return;
        }

        setPayload(event.payload);
      });
      await emit(CONVERSATION_SEARCH_READY_EVENT, { label } satisfies ConversationSearchReadyPayload);
    }

    void listenForSearchPayload();
    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, []);

  const results = useMemo(
    () => filterSearchMessages(payload?.messages ?? [], query, activeTab),
    [activeTab, payload?.messages, query],
  );

  return (
    <main className="conversation-search-window">
      <header className="conversation-search-header">
        <label className="conversation-search-input">
          <span>{t('chat.searchPlaceholder')}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('chat.searchPlaceholder')}
          />
        </label>
        <div className="conversation-search-controls">
          <nav className="conversation-search-tabs" aria-label={t('chat.searchWindowTitle')}>
            {searchTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`conversation-search-tab${activeTab === tab.id ? ' is-active' : ''}`}
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="conversation-search-filter"
            disabled
            title={t('chat.searchComingSoon')}
          >
            {t('chat.searchFilter')}
          </button>
        </div>
      </header>

      <section className="conversation-search-results" aria-label={payload?.title ?? t('chat.searchWindowTitle')}>
        {results.length > 0 ? (
          results.map((message) => (
            <article className="conversation-search-result" key={message.id}>
              <span className="conversation-search-avatar">
                {message.avatarUrl ? <img src={message.avatarUrl} alt="" aria-hidden="true" /> : getInitial(message.senderName)}
              </span>
              <span className="conversation-search-content">
                <strong>{message.senderName}</strong>
                <span>{getMessageSummary(message)}</span>
              </span>
              <time className="conversation-search-date" dateTime={message.createdAt}>
                {formatSearchDate(message.createdAt)}
              </time>
            </article>
          ))
        ) : (
          <p className="conversation-search-empty">{t('chat.searchNoResults')}</p>
        )}
      </section>
    </main>
  );
}

export {
  CONVERSATION_SEARCH_OPEN_EVENT,
  CONVERSATION_SEARCH_READY_EVENT,
};

function filterSearchMessages(
  messages: ConversationSearchMessage[],
  query: string,
  activeTab: ConversationSearchTab,
): ConversationSearchMessage[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return messages
    .filter((message) => matchesTab(message, activeTab))
    .filter((message) => {
      if (!normalizedQuery) {
        return true;
      }

      return getSearchableText(message).toLocaleLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function matchesTab(message: ConversationSearchMessage, activeTab: ConversationSearchTab): boolean {
  switch (activeTab) {
    case 'media':
      return message.messageType === 'IMAGE';
    case 'emoji':
      return containsEmoji(message.plaintext);
    case 'files':
      return message.messageType === 'FILE';
    case 'links':
      return /https?:\/\/\S+/i.test(message.plaintext);
    case 'all':
    default:
      return true;
  }
}

function getSearchableText(message: ConversationSearchMessage): string {
  return [message.plaintext, message.fileName, message.senderName].filter(Boolean).join(' ');
}

function getMessageSummary(message: ConversationSearchMessage): string {
  if (message.fileName) {
    return message.fileName;
  }

  return message.plaintext.trim() || message.messageType;
}

function containsEmoji(value: string): boolean {
  return /\p{Extended_Pictographic}/u.test(value);
}

function getInitial(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase() || 'L';
}

function formatSearchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return '__TAURI_INTERNALS__' in window;
  }
}
