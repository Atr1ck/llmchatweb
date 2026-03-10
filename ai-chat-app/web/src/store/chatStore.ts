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
  editMessage: (sessionId: string, messageId: string, content: string) => void;
};

function createId() {
  return Math.random().toString(36).slice(2);
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,

  createSession: () =>
    set((state) => {
      const id = createId();
      const newSession: Session = {
        id,
        title: "新会话",
        messages: [],
        createdAt: Date.now(),
      };
      return {
        sessions: [newSession, ...state.sessions],
        currentSessionId: id,
      };
    }),

  switchSession: (id: string) =>
    set(() => ({
      currentSessionId: id,
    })),

  deleteSession: (id: string) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const currentSessionId =
        state.currentSessionId === id
          ? sessions[0]?.id ?? null
          : state.currentSessionId;
      return { sessions, currentSessionId };
    }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
      ),
    })),

  updateLastAssistantMessage: (sessionId, content) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
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
      ),
    })),

  editMessage: (sessionId, messageId, content) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId ? { ...m, content } : m
              ),
            }
          : s
      ),
    })),
}));

