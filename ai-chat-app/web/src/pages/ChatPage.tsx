import React from "react";
import { Moon, SunMedium } from "lucide-react";
import { useChat } from "../hooks/useChat";
import { Sidebar } from "../components/Sidebar";
import { ChatWindow } from "../components/ChatWindow";
import { InputBox } from "../components/InputBox";

export const ChatPage: React.FC = () => {
  const {
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
  } = useChat();

  const [dark, setDark] = React.useState(true);
  const [editValue, setEditValue] = React.useState("");

  React.useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [dark]);

  React.useEffect(() => {
    if (editingMessage) {
      setEditValue(editingMessage.content);
    } else {
      setEditValue("");
    }
  }, [editingMessage]);

  return (
    <div className={`flex h-full ${dark ? "dark" : ""}`}>
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onCreateSession={createSession}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              AI Chat Web
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              ChatGPT 风格界面
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDark((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {dark ? (
              <SunMedium className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
        </header>

        <ChatWindow
          messages={currentSession?.messages ?? []}
          loading={loading}
          agentStatus={agentStatus}
          onEditMessage={startEditMessage}
        />

        {error && (
          <div className="mx-auto mb-1 mt-1 w-full max-w-3xl px-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
              {error}
            </div>
          </div>
        )}

        {editingMessage && (
          <div className="border-t border-slate-200 bg-amber-50 px-4 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-amber-900/30 dark:text-amber-100">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
              <span>正在编辑上一条用户消息</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  onClick={() => applyEditMessage(editValue)}
                >
                  保存修改
                </button>
                <button
                  type="button"
                  className="rounded border border-transparent px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => applyEditMessage(editingMessage.content)}
                >
                  取消
                </button>
              </div>
            </div>
            <div className="mx-auto mt-1 max-w-3xl">
              <textarea
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 shadow-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                rows={2}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </div>
          </div>
        )}

        <InputBox
          disabled={loading}
          onSend={sendMessage}
          onRegenerate={regenerate}
          onStop={stopGeneration}
          isGenerating={loading}
        />
      </main>
    </div>
  );
};

