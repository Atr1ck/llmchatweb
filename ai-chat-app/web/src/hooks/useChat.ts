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
    editMessage,
  } = useChatStore();

  const [loading, setLoading] = useState(false);
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

      setLoading(true);

      try {
        let buffer = "";
        await streamChat(
          [...currentSession.messages, userMessage],
          (chunk) => {
            buffer += chunk;
            updateLastAssistantMessage(sessionId, buffer);
          }
        );
      } finally {
        setLoading(false);
      }
    },
    [currentSession, addMessage, updateLastAssistantMessage]
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

    setLoading(true);
    try {
      let buffer = "";
      await streamChat(currentSession.messages, (chunk) => {
        buffer += chunk;
        updateLastAssistantMessage(sessionId, buffer);
      });
    } finally {
      setLoading(false);
    }
  }, [currentSession, addMessage, updateLastAssistantMessage]);

  const startEditMessage = (message: Message) => {
    setEditingMessage(message);
  };

  const applyEditMessage = (content: string) => {
    if (!currentSession || !editingMessage) return;
    editMessage(currentSession.id, editingMessage.id, content);
    setEditingMessage(null);
  };

  return {
    sessions,
    currentSession,
    currentSessionId,
    loading,
    editingMessage,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    regenerate,
    startEditMessage,
    applyEditMessage,
  };
}

