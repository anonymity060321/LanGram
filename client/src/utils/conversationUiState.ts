export interface ConversationUiState {
  pinnedIds: string[];
  manualUnreadIds: string[];
  hiddenConversations: Record<string, string>;
}

const conversationUiStorageKey = 'langram.conversationUiState.v1';

const defaultConversationUiState: ConversationUiState = {
  pinnedIds: [],
  manualUnreadIds: [],
  hiddenConversations: {},
};

export function loadConversationUiState(): ConversationUiState {
  try {
    const raw = window.localStorage.getItem(conversationUiStorageKey);
    if (!raw) {
      return defaultConversationUiState;
    }

    return normalizeConversationUiState(JSON.parse(raw) as Partial<ConversationUiState>);
  } catch {
    return defaultConversationUiState;
  }
}

export function saveConversationUiState(state: ConversationUiState): ConversationUiState {
  const normalized = normalizeConversationUiState(state);
  try {
    window.localStorage.setItem(conversationUiStorageKey, JSON.stringify(normalized));
  } catch {
    // Local UI state is best-effort and must not block chat usage.
  }

  return normalized;
}

export function unhideConversationInUiState(conversationId: string): void {
  const current = loadConversationUiState();
  if (!current.hiddenConversations[conversationId]) {
    return;
  }

  const hiddenConversations = { ...current.hiddenConversations };
  delete hiddenConversations[conversationId];
  saveConversationUiState({ ...current, hiddenConversations });
}

function normalizeConversationUiState(state: Partial<ConversationUiState>): ConversationUiState {
  return {
    pinnedIds: Array.isArray(state.pinnedIds) ? Array.from(new Set(state.pinnedIds)) : [],
    manualUnreadIds: Array.isArray(state.manualUnreadIds)
      ? Array.from(new Set(state.manualUnreadIds))
      : [],
    hiddenConversations:
      state.hiddenConversations && typeof state.hiddenConversations === 'object'
        ? state.hiddenConversations
        : {},
  };
}
