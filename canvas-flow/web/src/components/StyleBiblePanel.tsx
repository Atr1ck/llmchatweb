import React, { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { StyleBible } from "../workflow/types";

type Props = {
  value?: StyleBible;
  onSave: (patch: Partial<StyleBible>) => void;
};

export const StyleBiblePanel: React.FC<Props> = ({ value, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.direction ?? "");

  useEffect(() => {
    if (!editing) setDraft(value?.direction ?? "");
  }, [editing, value?.direction]);

  const save = () => {
    if (draft.trim()) onSave({ direction: draft.trim() });
    setEditing(false);
  };

  return (
    <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Style Bible</div>
        {!editing ? <button type="button" onClick={() => setEditing(true)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-cyan-600 dark:hover:bg-slate-800" aria-label="编辑 Style Bible"><Pencil className="h-3 w-3" /></button> : <div className="flex items-center gap-1"><button type="button" onClick={save} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" aria-label="保存 Style Bible"><Check className="h-3 w-3" /></button><button type="button" onClick={() => setEditing(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="取消编辑"><X className="h-3 w-3" /></button></div>}
      </div>
      {editing ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} className="mt-1.5 w-full resize-none rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-[10px] leading-4 text-slate-700 outline-none focus:ring-2 focus:ring-cyan-400/30 dark:border-cyan-800 dark:bg-slate-950 dark:text-slate-200" placeholder="例如：低饱和蓝绿色、侧光、叙事感人像" /> : <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{value?.direction || "尚未设置项目视觉方向"}</p>}
    </div>
  );
};
