import { create } from "zustand";

/** Agent 循环阶段 */
export type AgentStage = "thinking" | "tool_calling" | "observing" | "responding";

/** 工具调用结果 */
export type ToolResult = {
  id: string;
  name: string;
  result: string;
  success: boolean;
  duration: number;
};

/** Agent 状态 */
export type AgentStatus = {
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  toolName?: string;
  toolSuccess?: boolean;
  toolDuration?: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
  status?: "pending" | "success" | "error";
  result?: string;
  duration?: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  tool_results?: ToolResult[];
};

export type Session = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  agentStatus?: AgentStatus;
};

type ChatState = {
  sessions: Session[];
  currentSessionId: string | null;
  createSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateLastAssistantMessage: (sessionId: string, content: string) => void;
  updateLastAssistantToolCalls: (sessionId: string, toolCalls: ToolCall[]) => void;
  updateLastAssistantToolResult: (sessionId: string, toolCallId: string, result: string, success: boolean, duration: number) => void;
  setAgentStatus: (sessionId: string, status: AgentStatus | undefined) => void;
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
      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        // 从末尾找最后一条 assistant 消息（tool 消息可能在其之后）
        const lastIdx = s.messages.reduce(
          (acc, m, i) => (m.role === "assistant" ? i : acc),
          -1
        );
        if (lastIdx === -1) return s;
        return {
          ...s,
          messages: s.messages.map((m, i) =>
            i === lastIdx ? { ...m, content } : m
          ),
        };
      });
      return { sessions };
    }),

  updateLastAssistantToolCalls: (sessionId, toolCalls) =>
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const lastIdx = s.messages.reduce(
          (acc, m, i) => (m.role === "assistant" ? i : acc),
          -1
        );
        if (lastIdx === -1) return s;
        return {
          ...s,
          messages: s.messages.map((m, i) =>
            i === lastIdx ? { ...m, tool_calls: toolCalls } : m
          ),
        };
      });
      return { sessions };
    }),

  updateLastAssistantToolResult: (sessionId, toolCallId, result, success, duration) =>
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const lastIdx = s.messages.reduce(
          (acc, m, i) => (m.role === "assistant" ? i : acc),
          -1
        );
        if (lastIdx === -1) return s;
        const assistantMsg = s.messages[lastIdx];
        if (!assistantMsg.tool_calls) return s;

        const updatedToolCalls = assistantMsg.tool_calls.map((tc) =>
          tc.id === toolCallId
            ? { ...tc, status: success ? ("success" as const) : ("error" as const), result, duration }
            : tc
        );

        return {
          ...s,
          messages: s.messages.map((m, i) =>
            i === lastIdx
              ? {
                  ...m,
                  tool_calls: updatedToolCalls,
                  tool_results: [
                    ...(m.tool_results || []),
                    { id: toolCallId, name: assistantMsg.tool_calls?.find(tc => tc.id === toolCallId)?.name || "", result, success, duration },
                  ],
                }
              : m
          ),
        };
      });
      return { sessions };
    }),

  setAgentStatus: (sessionId, status) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, agentStatus: status } : s
      );
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

