import React, { useEffect, useRef } from "react";
import { MessageItem } from "./MessageItem";
import { AgentStatusBar } from "./AgentStatusBar";
import type { Message, AgentStatus } from "../store/chatStore";

type Props = {
  messages: Message[];
  loading: boolean;
  agentStatus?: AgentStatus | null;
  onEditMessage: (message: Message) => void;
};

export const ChatWindow: React.FC<Props> = ({
  messages,
  loading,
  agentStatus,
  onEditMessage,
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading, lastContent]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-[#212121]">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-4">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} onEdit={onEditMessage} />
        ))}
        {/* Agent 状态条 */}
        {loading && agentStatus && (
          <AgentStatusBar
            currentRound={agentStatus.currentRound}
            maxRounds={agentStatus.maxRounds}
            stage={agentStatus.stage}
            toolName={agentStatus.toolName}
            message={agentStatus.message}
          />
        )}
        {loading && !agentStatus && (
          <div className="text-xs text-slate-500">正在连接…</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
