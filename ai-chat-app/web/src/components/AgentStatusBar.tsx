import React from "react";
import { Brain, Wrench, Eye, MessageSquare, Loader2 } from "lucide-react";
import type { AgentStage } from "../store/chatStore";

type AgentStatusBarProps = {
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  toolName?: string;
};

const stageConfig: Record<AgentStage, { icon: React.ReactNode; label: string; description: string; color: string }> = {
  thinking: {
    icon: <Brain className="h-4 w-4" />,
    label: "思考中",
    description: "LLM 正在分析问题...",
    color: "text-violet-500",
  },
  tool_calling: {
    icon: <Wrench className="h-4 w-4" />,
    label: "调用工具",
    description: "正在调用工具...",
    color: "text-amber-500",
  },
  observing: {
    icon: <Eye className="h-4 w-4" />,
    label: "观察结果",
    description: "正在获取工具执行结果...",
    color: "text-sky-500",
  },
  responding: {
    icon: <MessageSquare className="h-4 w-4" />,
    label: "生成回答",
    description: "正在生成最终回答...",
    color: "text-emerald-500",
  },
};

export const AgentStatusBar: React.FC<AgentStatusBarProps> = ({
  currentRound,
  maxRounds,
  stage,
  toolName,
}) => {
  const config = stageConfig[stage];

  return (
    <div className="my-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/90">
      {/* 循环指示器 */}
      <div className="flex items-center gap-1 rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/70 dark:text-slate-300">
        <span className="text-[11px]">🔄</span>
        <span>第 {currentRound}/{maxRounds} 轮</span>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-slate-300 dark:bg-slate-600" />

      {/* 阶段指示器 */}
      <div className={`flex items-center gap-1.5 ${config.color}`}>
        {config.icon}
        <span className="font-medium">{config.label}</span>
        {toolName && (
          <span className="text-slate-500 dark:text-slate-400">• {toolName}</span>
        )}
      </div>

      {/* 加载动画 */}
      <div className="ml-auto">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
      </div>
    </div>
  );
};
