import { create } from "zustand";

/** Agent 循环阶段 */
export type AgentStage = "interpreting" | "retrieving" | "planning" | "thinking" | "tool_calling" | "observing" | "responding" | "saving";

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
  runId?: string;
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  message?: string;
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

export type SkillRef = {
  id: string;
  version: string;
  name: string;
  summary: string;
};

export type CreativeContextSnapshot = {
  selectedAssetIds: string[];
  skills: SkillRef[];
  memories: Array<{ id: string; kind: string; text: string; sourceAssetIds?: string[] }>;
  styleBibleSummary?: string;
};

export type CreativeBrief = {
  operation: "generate" | "variation" | "merge";
  sourceAssetIds: string[];
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resultCount: number;
  skillIds: string[];
  skills: SkillRef[];
  contextNotes: string[];
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  status?: "streaming" | "complete" | "cancelled" | "error";
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  tool_results?: ToolResult[];
  creativeContext?: CreativeContextSnapshot;
  creativeBrief?: CreativeBrief;
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
  getOrCreateProjectSession: (projectId: string) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  clearSession: (id: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateLastAssistantMessage: (sessionId: string, content: string) => void;
  updateMessageStatus: (sessionId: string, messageId: string, status: Message["status"]) => void;
  updateLastAssistantToolCalls: (sessionId: string, toolCalls: ToolCall[]) => void;
  updateLastAssistantToolResult: (sessionId: string, toolCallId: string, result: string, success: boolean, duration: number) => void;
  updateLastAssistantCreativeContext: (sessionId: string, context: CreativeContextSnapshot) => void;
  updateLastAssistantBrief: (sessionId: string, brief: CreativeBrief) => void;
  setAgentStatus: (sessionId: string, status: AgentStatus | undefined) => void;
  persist: () => void;
  editMessage: (sessionId: string, messageId: string, content: string) => void;
};

const STORAGE_KEY = "ai-chat-sessions-v1";
const PROJECT_SESSION_KEY = "ai-chat-project-sessions-v1";

function createId() {
  return Math.random().toString(36).slice(2);
}

function loadProjectSessionMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROJECT_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function persistProjectSessionMap(projectSessionMap: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECT_SESSION_KEY, JSON.stringify(projectSessionMap));
  } catch {
    // ignore
  }
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

  getOrCreateProjectSession: (projectId) => {
    const state = get();
    const projectSessionMap = loadProjectSessionMap();
    const mappedSessionId = projectSessionMap[projectId];
    const mappedSession = mappedSessionId ? state.sessions.find((session) => session.id === mappedSessionId) : undefined;
    if (mappedSession) {
      persistState(state.sessions, mappedSession.id);
      set({ currentSessionId: mappedSession.id });
      return mappedSession.id;
    }

    if (!mappedSessionId && Object.keys(projectSessionMap).length === 0 && state.currentSessionId && state.sessions.some((session) => session.id === state.currentSessionId)) {
      projectSessionMap[projectId] = state.currentSessionId;
      persistProjectSessionMap(projectSessionMap);
      return state.currentSessionId;
    }

    const id = createId();
    const newSession: Session = {
      id,
      title: "新会话",
      messages: [],
      createdAt: Date.now(),
    };
    const sessions = [newSession, ...state.sessions];
    projectSessionMap[projectId] = id;
    persistProjectSessionMap(projectSessionMap);
    persistState(sessions, id);
    set({ sessions, currentSessionId: id });
    return id;
  },

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

  clearSession: (id: string) =>
    set((state) => {
      const sessions = state.sessions.map((session) => session.id === id
        ? { ...session, title: "新会话", messages: [], agentStatus: undefined }
        : session
      );
      persistState(sessions, state.currentSessionId);
      return { sessions };
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

  updateMessageStatus: (sessionId, messageId, status) =>
    set((state) => {
      const sessions = state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map((message) =>
                message.id === messageId ? { ...message, status } : message
              ),
            }
          : session
      );
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

  updateLastAssistantCreativeContext: (sessionId, context) =>
    set((state) => {
      const sessions = state.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const lastIdx = session.messages.reduce((acc, message, index) => message.role === "assistant" ? index : acc, -1);
        if (lastIdx < 0) return session;
        return { ...session, messages: session.messages.map((message, index) => index === lastIdx ? { ...message, creativeContext: context } : message) };
      });
      return { sessions };
    }),

  updateLastAssistantBrief: (sessionId, brief) =>
    set((state) => {
      const sessions = state.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const lastIdx = session.messages.reduce((acc, message, index) => message.role === "assistant" ? index : acc, -1);
        if (lastIdx < 0) return session;
        return { ...session, messages: session.messages.map((message, index) => index === lastIdx ? { ...message, creativeBrief: brief } : message) };
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
