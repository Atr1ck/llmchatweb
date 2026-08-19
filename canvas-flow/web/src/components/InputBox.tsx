import React, { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CircleStop, LoaderCircle, RefreshCw, SendHorizonal } from "lucide-react";
import type { ChatProviderId, ChatProviderOption } from "../services/api";

type Props = {
  disabled?: boolean;
  onSend: (content: string) => void;
  onRegenerate: () => void;
  onStop?: () => void;
  isGenerating?: boolean;
  isStopping?: boolean;
  isPreparing?: boolean;
  providerOptions?: ChatProviderOption[];
  selectedProviderId?: ChatProviderId | "";
  onProviderChange?: (providerId: ChatProviderId) => void;
  providerDisabled?: boolean;
  /** centered = 空状态居中样式；bottom = 聊天底部样式 */
  variant?: "centered" | "bottom";
};

export const InputBox: React.FC<Props> = ({
  disabled,
  onSend,
  onRegenerate,
  onStop,
  isGenerating = false,
  isStopping = false,
  isPreparing = false,
  providerOptions = [],
  selectedProviderId = "",
  onProviderChange,
  providerDisabled = false,
  variant = "bottom",
}) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isCentered = variant === "centered";

  useEffect(() => {
    if (!isGenerating || !onStop) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onStop();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isGenerating, onStop]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 88), 220)}px`;
  }, [value]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const content = value.trim();
    if (!content || disabled || isGenerating) return;
    onSend(content);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={isCentered ? "w-full" : "mx-auto w-full max-w-3xl"}>
      <form
        onSubmit={submit}
        className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.08)] transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/20 dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
      >
        <textarea
          ref={textareaRef}
          rows={2}
          className="block min-h-[88px] max-h-[220px] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-50 dark:placeholder:text-slate-500"
          placeholder="描述你想聊的内容…"
          aria-label="输入消息"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
            {isPreparing ? (
              <>
                <LoaderCircle className="h-3 w-3 animate-spin text-cyan-500" />
                <span>正在准备参考图…</span>
              </>
            ) : isStopping ? (
              <>
                <LoaderCircle className="h-3 w-3 animate-spin text-amber-500" />
                <span>正在取消生成…</span>
              </>
            ) : isGenerating ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                <span>正在生成 · 按 Esc 停止</span>
              </>
            ) : (
              <span>Enter 发送 · Shift + Enter 换行</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={disabled || isGenerating || isPreparing}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              title="重新生成上一条回答"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">重新生成</span>
            </button>

            {providerOptions.length > 0 && (
              <select
                value={selectedProviderId}
                onChange={(event) => onProviderChange?.(event.target.value as ChatProviderId)}
                disabled={providerDisabled || isGenerating || isPreparing}
                aria-label="选择对话模型"
                title="选择对话模型"
                className="h-8 w-[142px] min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-600 outline-none transition hover:border-sky-300 focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              >
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}{provider.supportsVision ? " · 视觉" : " · 文本"}
                  </option>
                ))}
              </select>
            )}

            {isPreparing ? (
              <button
                type="button"
                disabled
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-200 px-3 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              >
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                <span>准备参考图…</span>
              </button>
            ) : isGenerating ? (
              <button
                type="button"
                onClick={onStop}
                disabled={!onStop || isStopping}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-500 px-3 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-400/70"
                aria-label="停止生成"
              >
                {isStopping ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CircleStop className="h-3.5 w-3.5" />}
                <span>{isStopping ? "正在取消…" : "停止生成"}</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || !value.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-500 px-3 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                <SendHorizonal className="h-3.5 w-3.5" />
                <span>发送</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
