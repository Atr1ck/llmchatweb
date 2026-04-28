import { create } from "zustand";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type Session = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
};

type ChatState = {
  sessions: Session[];
  currentSessionId: string | null;
  createSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateLastAssistantMessage: (sessionId: string, content: string) => void;
  persist: () => void;
  editMessage: (sessionId: string, messageId: string, content: string) => void;
};

const STORAGE_KEY = "ai-chat-sessions-v1";

function createId() {
  return Math.random().toString(36).slice(2);
}

function loadInitialState(): Pick<ChatState, "sessions" | "currentSessionId"> {
  if (typeof window === "undefined") {
    return { sessions: [], currentSessionId: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], currentSessionId: null };
    const parsed = JSON.parse(raw) as {
      sessions?: Session[];
      currentSessionId?: string | null;
    };
    return {
      sessions: parsed.sessions ?? [],
      currentSessionId: parsed.currentSessionId ?? null,
    };
  } catch {
    return { sessions: [], currentSessionId: null };
  }
}

function persistState(sessions: Session[], currentSessionId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({ sessions, currentSessionId });
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // ignore
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...loadInitialState(),

  createSession: () =>
    set((state) => {
      const id = createId();
      const newSession: Session = {
        id,
        title: "新会话",
        messages: [],
        createdAt: Date.now(),
      };
      const sessions = [newSession, ...state.sessions];
      const currentSessionId = id;
      persistState(sessions, currentSessionId);
      return {
        sessions,
        currentSessionId,
      };
    }),

  switchSession: (id: string) =>
    set((state) => {
      const currentSessionId = id;
      persistState(state.sessions, currentSessionId);
      return { currentSessionId };
    }),

  deleteSession: (id: string) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const currentSessionId =
        state.currentSessionId === id
          ? sessions[0]?.id ?? null
          : state.currentSessionId;
      persistState(sessions, currentSessionId);
      return { sessions, currentSessionId };
    }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
      );
      persistState(sessions, state.currentSessionId);
      return { sessions };
    }),

  updateLastAssistantMessage: (sessionId, content) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m, index) =>
                index === s.messages.length - 1 && m.role === "assistant"
                  ? { ...m, content }
                  : m
              ),
            }
          : s
      );
      // 流式过程中不持久化，避免每个 chunk 都写 localStorage
      return { sessions };
    }),

  persist: () => {
    const { sessions, currentSessionId } = get();
    persistState(sessions, currentSessionId);
  },

  editMessage: (sessionId, messageId, content) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId ? { ...m, content } : m
              ),
            }
          : s
      );
      persistState(sessions, state.currentSessionId);
      return { sessions };
    }),
}));

