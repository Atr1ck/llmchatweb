export type TaskLifecycleStatus = "created" | "queued" | "running" | "streaming" | "success" | "error" | "cancelled";

export type TaskEvent = {
  taskId: string;
  runId: string;
  sequence: number;
  type: "queued" | "started" | "chunk" | "completed" | "failed" | "cancelled";
  progress?: number;
  error?: string;
};

export type TaskLifecycleState = {
  taskId: string;
  runId: string;
  status: TaskLifecycleStatus;
  progress: number;
  lastSequence: number;
  error?: string;
};

const terminalStatuses = new Set<TaskLifecycleStatus>(["success", "error", "cancelled"]);

/**
 * Reducer used by streaming task consumers. Duplicate, out-of-order and late
 * events are ignored so a cancelled task cannot be resurrected by a delayed
 * provider chunk.
 */
export function reduceTaskEvent(state: TaskLifecycleState, event: TaskEvent): TaskLifecycleState {
  if (event.taskId !== state.taskId || event.runId !== state.runId) return state;
  if (event.sequence <= state.lastSequence || terminalStatuses.has(state.status)) return state;

  switch (event.type) {
    case "queued":
      return { ...state, status: "queued", lastSequence: event.sequence };
    case "started":
      return { ...state, status: "running", progress: Math.max(state.progress, event.progress ?? 0), lastSequence: event.sequence };
    case "chunk":
      return { ...state, status: "streaming", progress: Math.max(state.progress, event.progress ?? state.progress), lastSequence: event.sequence };
    case "completed":
      return { ...state, status: "success", progress: 100, lastSequence: event.sequence };
    case "failed":
      return { ...state, status: "error", lastSequence: event.sequence, error: event.error ?? "任务失败" };
    case "cancelled":
      return { ...state, status: "cancelled", lastSequence: event.sequence };
  }
}
