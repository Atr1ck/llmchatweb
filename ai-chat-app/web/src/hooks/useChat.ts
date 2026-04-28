import { useState, useEffect, useCallback } from "react";
import { streamChat } from "../services/api";
import { useChatStore, type Message } from "../store/chatStore";

export function useChat() {
  const {
    sessions,
    currentSessionId,
    createSession,
    switchSession,
    deleteSession,
    addMessage,
    updateLastAssistantMessage,
    persist,
    editMessage,
  } = useChatStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(
    null
  );
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

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

      const controller = new AbortController();
      setAbortController(controller);

      try {
        let buffer = "";
        await streamChat(
          [...currentSession.messages, userMessage],
          (chunk) => {
            buffer += chunk;
            updateLastAssistantMessage(sessionId, buffer);
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
        persist();
      }
    },
    [currentSession, addMessage, updateLastAssistantMessage, persist]
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

    const controller = new AbortController();
    setAbortController(controller);

    try {
      let buffer = "";
      await streamChat(
        currentSession.messages,
        (chunk) => {
          buffer += chunk;
          updateLastAssistantMessage(sessionId, buffer);
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
      persist();
    }
  }, [currentSession, addMessage, updateLastAssistantMessage, persist]);

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

