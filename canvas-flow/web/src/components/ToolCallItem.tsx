import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench, CheckCircle, XCircle, Clock, ImagePlus } from "lucide-react";

type ToolCallStatus = "pending" | "success" | "error";

type ToolCallProps = {
  name: string;
  arguments: string;
  status?: ToolCallStatus;
  result?: string;
  duration?: number;
};

// 工具友好名称与图标映射
const toolMeta: Record<string, { label: string; icon: React.ReactNode }> = {
  image_operation: { label: "图片创作", icon: <ImagePlus className="h-3.5 w-3.5" /> },
};

/** 从工具结果中提取一行摘要 */
function extractSummary(name: string, result: string): string | null {
  try {
    const parsed = JSON.parse(result);
    if (name === "image_operation" && parsed?.accepted) return `已接受${parsed.operation === "variation" ? "变体" : parsed.operation === "merge" ? "融合" : "生成"}任务 · ${parsed.resultCount ?? 1} 张`;
    if (typeof parsed === "string") return parsed.length > 80 ? parsed.slice(0, 80) + "…" : parsed;
    if (parsed?.message) return parsed.message;
    if (parsed?.error) return parsed.error;
  } catch {
    if (result.length > 0) return result.length > 80 ? result.slice(0, 80) + "…" : result;
  }
  return null;
}

export const ToolCallItem: React.FC<ToolCallProps> = ({
  name,
  arguments: args,
  status,
  result,
  duration,
}) => {
  const [argsOpen, setArgsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const meta = toolMeta[name] || { label: name, icon: <Wrench className="h-3.5 w-3.5" /> };

  let parsedArgs: string;
  try {
    parsedArgs = JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    parsedArgs = args || "{}";
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const statusConfig: Record<ToolCallStatus, { icon: React.ReactNode; label: string; color: string; borderColor: string }> = {
    pending: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />,
      label: "执行中",
      color: "text-sky-500",
      borderColor: "border-sky-200 dark:border-sky-800",
    },
    success: {
      icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
      label: "成功",
      color: "text-emerald-500",
      borderColor: "border-emerald-200 dark:border-emerald-800",
    },
    error: {
      icon: <XCircle className="h-3.5 w-3.5 text-red-500" />,
      label: "失败",
      color: "text-red-500",
      borderColor: "border-red-200 dark:border-red-800",
    },
  };

  const config = status ? statusConfig[status] : statusConfig.pending;

  let formattedResult = result || "";
  if (result) {
    try {
      const parsed = JSON.parse(result);
      if (typeof parsed === "object" && parsed !== null) {
        formattedResult = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // 不是 JSON，保持原样
    }
  }

  const summary = status && result ? extractSummary(name, result) : null;

  return (
    <div className={`my-1 rounded-lg border bg-slate-50/80 text-xs dark:bg-slate-800/80 ${config.borderColor}`}>
      {/* 标题行 */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 dark:text-slate-300">
        <span className={status === "error" ? "text-red-500" : status === "success" ? "text-emerald-500" : "text-slate-400"}>
          {meta.icon}
        </span>
        <span className="font-medium">{meta.label}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        {status ? (
          <>
            {config.icon}
            <span className={config.color}>{config.label}</span>
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
            <span className="text-sky-500">调用中...</span>
          </>
        )}
        {duration !== undefined && status && (
          <>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <Clock className="h-3 w-3 text-slate-400" />
            <span className="text-slate-400">{formatDuration(duration)}</span>
          </>
        )}
      </div>

      {/* 结果摘要行 — 成功时直接展示关键信息 */}
      {summary && status === "success" && (
        <div className="border-t border-slate-200 px-2.5 py-1 text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {summary}
        </div>
      )}

      {/* 参数折叠 */}
      {parsedArgs && parsedArgs !== "{}" && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className="flex w-full items-center gap-1 px-2.5 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={() => setArgsOpen(!argsOpen)}
          >
            {argsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>参数</span>
          </button>
          {argsOpen && (
            <pre className="mx-2.5 mb-1.5 max-h-40 overflow-auto rounded bg-white/80 p-2 text-[11px] text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              {parsedArgs}
            </pre>
          )}
        </div>
      )}

      {/* 结果折叠 */}
      {status && formattedResult && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className="flex w-full items-center gap-1 px-2.5 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={() => setResultOpen(!resultOpen)}
          >
            {resultOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>详细结果</span>
            {status === "error" && (
              <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-600 dark:bg-red-900/30 dark:text-red-400">
                查看错误
              </span>
            )}
          </button>
          {resultOpen && (
            <pre className={`mx-2.5 mb-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px] ${
              status === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                : "bg-white/80 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
            }`}>
              {formattedResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
