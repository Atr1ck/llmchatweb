import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import type { Message } from "../store/chatStore";

type Props = {
  message: Message;
  onEdit?: (message: Message) => void;
};

export const MessageItem: React.FC<Props> = ({ message, onEdit }) => {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex w-full gap-3 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isUser
            ? "bg-sky-500 text-white"
            : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50"
        }`}
      >
        {isUser ? (
          <div>{message.content}</div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code({ inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const value = String(children).replace(/\n$/, "");
                if (inline) {
                  return (
                    <code
                      className="rounded bg-slate-900/20 px-1 py-0.5 text-xs"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <CodeBlock
                    language={match?.[1]}
                    value={value}
                  />
                );
              },
            }}
          >
            {message.content || "Thinking..."}
          </ReactMarkdown>
        )}
        {isUser && onEdit && (
          <button
            type="button"
            className="mt-1 text-xs text-slate-200/80 underline"
            onClick={() => onEdit(message)}
          >
            编辑
          </button>
        )}
      </div>
    </div>
  );
};

