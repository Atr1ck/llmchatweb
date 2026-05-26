import React, { useState, KeyboardEvent } from "react";
import { SendHorizonal, RefreshCw } from "lucide-react";

type Props = {
  disabled?: boolean;
  onSend: (content: string) => void;
  onRegenerate: () => void;
  onStop?: () => void;
  isGenerating?: boolean;
  /** centered = 空状态居中样式；bottom = 聊天底部样式 */
  variant?: "centered" | "bottom";
};

export const InputBox: React.FC<Props> = ({
  disabled,
  onSend,
  onRegenerate,
  onStop,
  isGenerating,
  variant = "bottom",
}) => {
  const [value, setValue] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!value.trim() || disabled) return;
      onSend(value.trim());
      setValue("");
    }
  };

  const handleClickSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  };

  const isCentered = variant === "centered";

  return (
    <div className={isCentered ? "w-full" : "mx-auto w-full max-w-3xl"}>
      <div className={`flex gap-2 ${isCentered ? "" : ""}`}>
        <textarea
          className={`min-h-[56px] flex-1 resize-none rounded-xl border bg-slate-50 px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 dark:bg-slate-800 dark:text-slate-50 ${
            isCentered
              ? "border-slate-300 text-slate-900 dark:border-slate-700"
              : "border-slate-300 text-slate-900 dark:border-slate-700"
          }`}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <div className="flex flex-col gap-2">
          {isGenerating ? (
            <button
              type="button"
              onClick={onStop}
              disabled={!isGenerating}
              className="inline-flex h-[26px] items-center justify-center rounded-lg bg-rose-500 px-3 text-xs font-medium text-white shadow-sm hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-400/60"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClickSend}
              disabled={disabled || !value.trim()}
              className="inline-flex h-[26px] items-center justify-center rounded-lg bg-sky-500 px-3 text-xs font-medium text-white shadow-sm hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-sky-400/60"
            >
              <SendHorizonal className="mr-1 h-3 w-3" />
              发送
            </button>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={disabled}
            className="inline-flex h-[26px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            重新生成
          </button>
        </div>
      </div>
    </div>
  );
};
