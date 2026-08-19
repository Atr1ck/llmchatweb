import { useState, useEffect, useCallback, useRef } from "react";
import { streamChat, type ChatProviderId } from "../services/api";
import {
  useChatStore,
  type CreativeBrief,
  type CreativeContextSnapshot,
  type Message,
  type ToolCall,
  type AgentStatus,
} from "../store/chatStore";
import type { CreativeAgentContext } from "../workflow/types";

export type ImageOperationAction = {
  accepted: true;
  operation: "generate" | "variation" | "merge";
  prompt: string;
  sourceAssetIds: string[];
  resultCount?: number;
  operationId?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  skillIds?: string[];
  brief?: CreativeBrief;
};

type ActiveRun = {
  controller: AbortController;
  sessionId: string;
  assistantMessageId: string;
  buffer: string;
  cancelled: boolean;
  failed: boolean;
};

export function useChat(options?: { onImageOperation?: (action: ImageOperationAction) => void }) {
  const {
    sessions,
    currentSessionId,
    createSession,
    getOrCreateProjectSession,
    switchSession,
    deleteSession,
    clearSession,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantToolCalls,
    updateLastAssistantToolResult,
    updateLastAssistantCreativeContext,
    updateLastAssistantBrief,
    updateMessageStatus,
    setAgentStatus,
    persist,
    editMessage,
  } = useChatStore();

  const [loading, setLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [agentStatus, setAgentStatusLocal] = useState<AgentStatus | null>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const imageOperationRef = useRef(options?.onImageOperation);

  useEffect(() => {
    imageOperationRef.current = options?.onImageOperation;
  }, [options?.onImageOperation]);

  useEffect(() => {
    if (!currentSessionId && sessions.length === 0) {
      createSession();
    }
  }, [currentSessionId, sessions.length, createSession]);

  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null;

  const beginRun = useCallback((sessionId: string, assistantMessageId: string) => {
    if (activeRunRef.current) return null;

    const run: ActiveRun = {
      controller: new AbortController(),
      sessionId,
      assistantMessageId,
      buffer: "",
      cancelled: false,
      failed: false,
    };
    activeRunRef.current = run;
    setError(null);
    setIsStopping(false);
    setLoading(true);
    setAgentStatusLocal(null);
    setAgentStatus(sessionId, undefined);
    return run;
  }, [setAgentStatus]);

  const runStream = useCallback(async (
    run: ActiveRun,
    messages: Message[],
    failureMessage: string,
    context?: CreativeAgentContext,
    providerId?: ChatProviderId,
  ) => {
    let toolCalls: ToolCall[] = [];
    let currentBrief: CreativeBrief | undefined;
    const isActive = () => activeRunRef.current === run && !run.cancelled && !run.controller.signal.aborted;

    try {
      await streamChat(
        messages,
        {
          onText: (text) => {
            if (!isActive()) return;
            run.buffer += text;
            updateLastAssistantMessage(run.sessionId, run.buffer);
          },
          onToolCallStart: (call) => {
            if (!isActive()) return;
            toolCalls = [...toolCalls, { id: call.id, name: call.name, arguments: "", status: "pending" }];
            updateLastAssistantToolCalls(run.sessionId, toolCalls);
          },
          onToolCallDelta: (call) => {
            if (!isActive()) return;
            toolCalls = toolCalls.map((toolCall) =>
              toolCall.id === call.id
                ? { ...toolCall, arguments: toolCall.arguments + call.arguments }
                : toolCall
            );
            updateLastAssistantToolCalls(run.sessionId, toolCalls);
          },
          onToolCallEnd: (call) => {
            if (!isActive()) return;
            toolCalls = toolCalls.map((toolCall) =>
              toolCall.id === call.id
                ? { id: call.id, name: call.name, arguments: call.arguments, status: "pending" as const }
                : toolCall
            );
            updateLastAssistantToolCalls(run.sessionId, toolCalls);
          },
          onToolResult: (result) => {
            if (!isActive()) return;
            toolCalls = toolCalls.map((toolCall) =>
              toolCall.id === result.id
                ? {
                    ...toolCall,
                    status: result.success ? "success" as const : "error" as const,
                    result: result.result,
                    duration: result.duration,
                  }
                : toolCall
            );
            updateLastAssistantToolCalls(run.sessionId, toolCalls);
            updateLastAssistantToolResult(run.sessionId, result.id, result.result, result.success, result.duration);

            if (result.success && result.name === "image_operation") {
              try {
                const action = JSON.parse(result.result) as ImageOperationAction;
                if (action.accepted) imageOperationRef.current?.({ ...action, brief: currentBrief });
              } catch {
                // 工具结果仍会显示在对话中，即使它无法在本地应用。
              }
            }

            addMessage(run.sessionId, {
              id: crypto.randomUUID(),
              role: "tool",
              content: result.result,
              tool_call_id: result.id,
              name: toolCalls.find((toolCall) => toolCall.id === result.id)?.name,
            });
          },
          onAgentStatus: (status) => {
            if (!isActive()) return;
            setAgentStatusLocal(status);
            setAgentStatus(run.sessionId, status);
          },
          onCreativeContext: (contextSnapshot: CreativeContextSnapshot) => {
            if (!isActive()) return;
            updateLastAssistantCreativeContext(run.sessionId, contextSnapshot);
          },
          onCreativeBrief: (brief: CreativeBrief) => {
            if (!isActive()) return;
            currentBrief = brief;
            updateLastAssistantBrief(run.sessionId, brief);
          },
          onError: (message) => {
            if (!isActive()) return;
            run.failed = true;
            setError(message);
          },
          onDone: () => {},
        },
        { signal: run.controller.signal, sessionId: run.sessionId, context, providerId },
      );
    } catch (caughtError) {
      if ((caughtError as Error).name !== "AbortError" && activeRunRef.current === run) {
        run.failed = true;
        setError(failureMessage);
      }
    } finally {
      if (activeRunRef.current !== run) return;

      const finalStatus = run.cancelled || run.controller.signal.aborted
        ? "cancelled"
        : run.failed
          ? "error"
          : "complete";
      updateMessageStatus(run.sessionId, run.assistantMessageId, finalStatus);
      activeRunRef.current = null;
      setLoading(false);
      setIsStopping(false);
      setAgentStatusLocal(null);
      setAgentStatus(run.sessionId, undefined);
      persist();
    }
  }, [
    addMessage,
    persist,
    setAgentStatus,
    updateLastAssistantBrief,
    updateLastAssistantCreativeContext,
    updateLastAssistantMessage,
    updateLastAssistantToolCalls,
    updateLastAssistantToolResult,
    updateMessageStatus,
  ]);

  const sendMessage = useCallback(async (
    content: string,
    agentContext?: CreativeAgentContext,
    providerId?: ChatProviderId,
  ) => {
    if (!currentSession || activeRunRef.current) return;
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
      status: "streaming",
    };

    addMessage(sessionId, userMessage);
    addMessage(sessionId, assistantMessage);
    const run = beginRun(sessionId, assistantMessage.id);
    if (!run) return;

    await runStream(
      run,
      [...currentSession.messages, userMessage],
      "对话生成失败，请稍后重试。",
      agentContext,
      providerId,
    );
  }, [addMessage, beginRun, currentSession, runStream]);

  const regenerate = useCallback(async (providerId?: ChatProviderId) => {
    if (!currentSession || activeRunRef.current) return;
    const sessionId = currentSession.id;
    const lastUser = [...currentSession.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUser) return;

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
    };
    addMessage(sessionId, assistantMessage);
    const run = beginRun(sessionId, assistantMessage.id);
    if (!run) return;

    await runStream(run, currentSession.messages, "重新生成失败，请稍后重试。", undefined, providerId);
  }, [addMessage, beginRun, currentSession, runStream]);

  const startEditMessage = (message: Message) => {
    setEditingMessage(message);
  };

  const applyEditMessage = (content: string) => {
    if (!currentSession || !editingMessage) return;
    editMessage(currentSession.id, editingMessage.id, content);
    setEditingMessage(null);
  };

  const stopGeneration = useCallback(() => {
    const run = activeRunRef.current;
    if (!run || run.cancelled) return;

    run.cancelled = true;
    run.controller.abort();
    if (run.buffer) updateLastAssistantMessage(run.sessionId, run.buffer);
    updateMessageStatus(run.sessionId, run.assistantMessageId, "cancelled");
    setIsStopping(true);
    setLoading(false);
    setAgentStatusLocal(null);
    setAgentStatus(run.sessionId, undefined);
    persist();
  }, [persist, setAgentStatus, updateLastAssistantMessage, updateMessageStatus]);

  const clearCurrentSession = useCallback(() => {
    const run = activeRunRef.current;
    if (run) {
      run.cancelled = true;
      run.controller.abort();
      activeRunRef.current = null;
    }
    if (currentSessionId) {
      clearSession(currentSessionId);
      setAgentStatus(currentSessionId, undefined);
    }
    setLoading(false);
    setIsStopping(false);
    setAgentStatusLocal(null);
    setError(null);
    setEditingMessage(null);
  }, [clearSession, currentSessionId, setAgentStatus]);

  const switchProjectSession = useCallback((projectId: string) => {
    getOrCreateProjectSession(projectId);
    setError(null);
    setEditingMessage(null);
    setAgentStatusLocal(null);
  }, [getOrCreateProjectSession]);

  return {
    sessions,
    currentSession,
    currentSessionId,
    loading,
    isStopping,
    error,
    editingMessage,
    agentStatus,
    createSession,
    switchProjectSession,
    switchSession,
    deleteSession,
    clearCurrentSession,
    sendMessage,
    regenerate,
    stopGeneration,
    startEditMessage,
    applyEditMessage,
  };
}
