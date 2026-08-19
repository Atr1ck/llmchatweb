import React, { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Compass, Layers3, Sparkles } from "lucide-react";
import type { CreativeBrief, CreativeContextSnapshot } from "../store/chatStore";

type Props = {
  brief?: CreativeBrief;
  context?: CreativeContextSnapshot;
};

const operationLabels: Record<CreativeBrief["operation"], string> = {
  generate: "全新生成",
  variation: "单图变体",
  merge: "多图融合",
};

export const CreativeBriefCard: React.FC<Props> = ({ brief, context }) => {
  const [open, setOpen] = useState(false);
  if (!brief && !context) return null;

  const skills = brief?.skills ?? context?.skills ?? [];
  const memoryCount = context?.memories.length ?? 0;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-white to-violet-50 text-xs shadow-sm dark:border-cyan-900/70 dark:from-cyan-950/40 dark:via-slate-900 dark:to-violet-950/30">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800 dark:text-slate-100">创作方案</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
            {brief && <span>{operationLabels[brief.operation]} · {brief.resultCount} 张</span>}
            <span>{skills.length} 个 Skill</span>
            <span>{memoryCount} 条项目记忆</span>
          </div>
        </div>
        <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-white/70 hover:text-slate-700 dark:hover:bg-slate-800" onClick={() => setOpen((value) => !value)} aria-label={open ? "收起创作方案" : "展开创作方案"}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-cyan-100/80 px-3 py-2 dark:border-cyan-900/50">
        {skills.map((skill) => (
          <span key={`${skill.id}:${skill.version}`} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white/70 px-2 py-0.5 text-[10px] text-violet-700 dark:border-violet-800 dark:bg-slate-900/60 dark:text-violet-200">
            <Compass className="h-2.5 w-2.5" />{skill.name}
          </span>
        ))}
        {!skills.length && <span className="text-[10px] text-slate-400">使用基础创作知识</span>}
      </div>

      {open && (
        <div className="space-y-2 border-t border-cyan-100/80 px-3 py-2.5 dark:border-cyan-900/50">
          {brief && (
            <>
              <div className="flex items-start gap-2">
                <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
                <div className="min-w-0"><div className="text-[10px] font-medium text-slate-500">正向提示词</div><p className="mt-0.5 whitespace-pre-wrap leading-5 text-slate-700 dark:text-slate-200">{brief.prompt}</p></div>
              </div>
              {brief.negativePrompt && <div className="pl-5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">避免：{brief.negativePrompt}</div>}
              <div className="flex items-start gap-2">
                <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                <div className="min-w-0"><div className="text-[10px] font-medium text-slate-500">创作依据</div><p className="mt-0.5 leading-5 text-slate-600 dark:text-slate-300">{brief.contextNotes.join("；")}</p></div>
              </div>
            </>
          )}
          {context?.styleBibleSummary && <div className="border-l-2 border-cyan-400 pl-2 text-[10px] leading-4 text-slate-500 dark:text-slate-400">Style Bible：{context.styleBibleSummary}</div>}
        </div>
      )}
    </div>
  );
};
