import { useState, useEffect, useCallback } from "react";
import { streamChat } from "../services/api";
import { useChatStore, type Message, type ToolCall, type AgentStatus } from "../store/chatStore";

export function useChat() {
  const {
    sessions,
    currentSessionId,
    createSession,
    switchSession,
    deleteSession,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantToolCalls,
    updateLastAssistantToolResult,
    setAgentStatus,
    persist,
    editMessage,
  } = useChatStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(
    null
  );
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [agentStatus, setAgentStatusLocal] = useState<AgentStatus | null>(null);

  useEffect(() => {
    if (!currentSessionId && sessions.length === 0) {
      createSession();
    }
  }, [currentSessionId, sessions.length, createSession]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentSession) return;
      const sessionId = currentSession.id;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
      };

      addMessage(sessionId, userMessage);
      addMessage(sessionId, assistantMessage);

      setError(null);
      setLoading(true);
      setAgentStatusLocal(null);
      setAgentStatus(sessionId, undefined);

      const controller = new AbortController();
      setAbortController(controller);

      try {
        let buffer = "";
        let toolCalls: ToolCall[] = [];

        await streamChat(
          [...currentSession.messages, userMessage],
          {
            onText: (text) => {
              buffer += text;
              updateLastAssistantMessage(sessionId, buffer);
            },
            onToolCallStart: (call) => {
              toolCalls = [...toolCalls, { id: call.id, name: call.name, arguments: "", status: "pending" }];
              updateLastAssistantToolCalls(sessionId, toolCalls);
            },
            onToolCallDelta: (call) => {
              toolCalls = toolCalls.map((tc) =>
                tc.id === call.id
                  ? { ...tc, arguments: tc.arguments + call.arguments }
                  : tc
              );
              updateLastAssistantToolCalls(sessionId, toolCalls);
            },
            onToolCallEnd: (call) => {
              toolCalls = toolCalls.map((tc) =>
                tc.id === call.id
                  ? { id: call.id, name: call.name, arguments: call.arguments, status: "pending" as const }
                  : tc
              );
              updateLastAssistantToolCalls(sessionId, toolCalls);
            },
            onToolResult: (result) => {
              toolCalls = toolCalls.map((tc) =>
                tc.id === result.id
                  ? { ...tc, status: result.success ? "success" as const : "error" as const, result: result.result, duration: result.duration }
                  : tc
              );
              updateLastAssistantToolCalls(sessionId, toolCalls);
              updateLastAssistantToolResult(sessionId, result.id, result.result, result.success, result.duration);
              // 将 tool message 加入上下文，确保后续 LLM 调用能获取工具结果
              addMessage(sessionId, {
                id: crypto.randomUUID(),
                role: "tool",
                content: result.result,
                tool_call_id: result.id,
                name: toolCalls.find(tc => tc.id === result.id)?.name,
              });
            },
            onAgentStatus: (status) => {
              setAgentStatusLocal(status);
              setAgentStatus(sessionId, status);
            },
            onDone: () => {},
          },
          { signal: controller.signal }
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError("对话生成失败，请稍后重试。");
        }
      } finally {
        setLoading(false);
        setAbortController(null);
        setAgentStatusLocal(null);
        setAgentStatus(sessionId, undefined);
        persist();
      }
    },
    [currentSession, addMessage, updateLastAssistantMessage, updateLastAssistantToolCalls, updateLastAssistantToolResult, setAgentStatus, persist]
  );

  const regenerate = useCallback(async () => {
    if (!currentSession) return;
    const sessionId = currentSession.id;
    const lastUser = [...currentSession.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    addMessage(sessionId, assistantMessage);

    setError(null);
    setLoading(true);
    setAgentStatusLocal(null);
    setAgentStatus(sessionId, undefined);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      let buffer = "";
      let toolCalls: ToolCall[] = [];

      await streamChat(
        currentSession.messages,
        {
          onText: (text) => {
            buffer += text;
            updateLastAssistantMessage(sessionId, buffer);
          },
          onToolCallStart: (call) => {
            toolCalls = [...toolCalls, { id: call.id, name: call.name, arguments: "", status: "pending" }];
            updateLastAssistantToolCalls(sessionId, toolCalls);
          },
          onToolCallDelta: (call) => {
            toolCalls = toolCalls.map((tc) =>
              tc.id === call.id
                ? { ...tc, arguments: tc.arguments + call.arguments }
                : tc
            );
            updateLastAssistantToolCalls(sessionId, toolCalls);
          },
          onToolCallEnd: (call) => {
            toolCalls = toolCalls.map((tc) =>
              tc.id === call.id
                ? { id: call.id, name: call.name, arguments: call.arguments, status: "pending" as const }
                : tc
            );
            updateLastAssistantToolCalls(sessionId, toolCalls);
          },
          onToolResult: (result) => {
              toolCalls = toolCalls.map((tc) =>
                tc.id === result.id
                  ? { ...tc, status: result.success ? "success" as const : "error" as const, result: result.result, duration: result.duration }
                  : tc
              );
              updateLastAssistantToolCalls(sessionId, toolCalls);
              updateLastAssistantToolResult(sessionId, result.id, result.result, result.success, result.duration);
              // 将 tool message 加入上下文，确保后续 LLM 调用能获取工具结果
              addMessage(sessionId, {
                id: crypto.randomUUID(),
                role: "tool",
                content: result.result,
                tool_call_id: result.id,
                name: toolCalls.find(tc => tc.id === result.id)?.name,
              });
          },
          onAgentStatus: (status) => {
            setAgentStatusLocal(status);
            setAgentStatus(sessionId, status);
          },
          onDone: () => {},
        },
        { signal: controller.signal }
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("重新生成失败，请稍后重试。");
      }
    } finally {
      setLoading(false);
      setAbortController(null);
      setAgentStatusLocal(null);
      setAgentStatus(sessionId, undefined);
      persist();
    }
  }, [currentSession, addMessage, updateLastAssistantMessage, updateLastAssistantToolCalls, updateLastAssistantToolResult, setAgentStatus, persist]);

  const startEditMessage = (message: Message) => {
    setEditingMessage(message);
  };

  const applyEditMessage = (content: string) => {
    if (!currentSession || !editingMessage) return;
    editMessage(currentSession.id, editingMessage.id, content);
    setEditingMessage(null);
  };

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  return {
    sessions,
    currentSession,
    currentSessionId,
    loading,
    error,
    editingMessage,
    agentStatus,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    regenerate,
    stopGeneration,
    startEditMessage,
    applyEditMessage,
  };
}
