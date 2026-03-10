import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Session } from "../store/chatStore";

type Props = {
  sessions: Session[];
  currentSessionId: string | null;
  onCreateSession: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
};

export const Sidebar: React.FC<Props> = ({
  sessions,
  currentSessionId,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
}) => {
  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-slate-50/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          会话
        </span>
        <button
          type="button"
          onClick={onCreateSession}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-50 shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
        >
          <Plus className="h-3 w-3" />
          新建
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.map((s) => {
          const isActive = s.id === currentSessionId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSwitchSession(s.id)}
              className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
                isActive
                  ? "bg-slate-900 text-slate-50 shadow-sm dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <span className="line-clamp-1">{s.title}</span>
              <Trash2
                className={`ml-2 h-3 w-3 ${
                  isActive
                    ? "text-slate-200 group-hover:text-slate-100 dark:text-slate-700"
                    : "text-slate-400 group-hover:text-slate-600"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(s.id);
                }}
              />
            </button>
          );
        })}
        {sessions.length === 0 && (
          <p className="px-3 text-xs text-slate-500">
            暂无会话，点击「新建」开始聊天。
          </p>
        )}
      </div>
    </aside>
  );
};

