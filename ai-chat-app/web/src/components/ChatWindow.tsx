import React, { useEffect, useRef } from "react";
import { MessageItem } from "./MessageItem";
import type { Message } from "../store/chatStore";

type Props = {
  messages: Message[];
  loading: boolean;
  onEditMessage: (message: Message) => void;
};

export const ChatWindow: React.FC<Props> = ({
  messages,
  loading,
  onEditMessage,
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading, lastContent]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/40 px-4 py-4 dark:bg-slate-900/40">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} onEdit={onEditMessage} />
        ))}
        {loading && (
          <div className="text-xs text-slate-500">Thinking...</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

