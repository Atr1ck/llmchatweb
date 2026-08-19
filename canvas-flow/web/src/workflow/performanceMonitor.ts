export type SpatialDiagnosticEvent = {
  type: string;
  mode: "worker-r-tree" | "main-r-tree" | "main-scan";
  elapsedMs?: number;
  detail?: string;
};

export type CanvasPerformanceSnapshot = {
  queryCount: number;
  queryP50Ms: number;
  queryP95Ms: number;
  queryMaxMs: number;
  lastQueryMs: number;
  workerFallbackCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  lastMode: SpatialDiagnosticEvent["mode"] | "unknown";
  lastDiagnostic?: string;
  sampledAt: number;
};

export function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

export function summarizeDurations(values: number[]) {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Number(Math.max(...values).toFixed(2)) : 0,
  };
}

type PerformanceObserverLike = {
  observe: (options: { entryTypes: string[] }) => void;
  disconnect: () => void;
};

/** Lightweight browser-side metrics collector for canvas interaction health. */
export class CanvasPerformanceMonitor {
  private readonly durations: number[] = [];
  private readonly listeners = new Set<(snapshot: CanvasPerformanceSnapshot) => void>();
  private observer: PerformanceObserverLike | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private workerFallbackCount = 0;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private lastQueryMs = 0;
  private lastMode: CanvasPerformanceSnapshot["lastMode"] = "unknown";
  private lastDiagnostic: string | undefined;

  start(): void {
    if (typeof PerformanceObserver === "undefined" || this.observer) return;
    try {
      const Observer = PerformanceObserver as unknown as new (callback: (list: { getEntries: () => PerformanceEntry[] }) => void) => PerformanceObserverLike;
      this.observer = new Observer((list) => {
        list.getEntries().forEach((entry) => this.recordLongTask(entry.duration));
      });
      this.observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Safari and older Chromium versions may not support longtask entries.
      this.observer = null;
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
  }

  recordSpatialDiagnostic(event: SpatialDiagnosticEvent): void {
    this.lastMode = event.mode;
    if (typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs)) {
      this.durations.push(Math.max(0, event.elapsedMs));
      if (this.durations.length > 2_000) this.durations.shift();
      this.lastQueryMs = event.elapsedMs;
    }
    if (event.mode !== "worker-r-tree" || event.type.includes("fallback") || event.type.includes("error")) {
      if (event.type.includes("fallback") || event.type.includes("error")) this.workerFallbackCount += 1;
    }
    this.lastDiagnostic = event.detail ? `${event.type}: ${event.detail}` : event.type;
    this.scheduleNotify();
  }

  recordLongTask(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.longTaskCount += 1;
    this.longTaskTotalMs += durationMs;
    this.scheduleNotify();
  }

  snapshot(): CanvasPerformanceSnapshot {
    const summary = summarizeDurations(this.durations);
    return {
      queryCount: this.durations.length,
      queryP50Ms: summary.p50,
      queryP95Ms: summary.p95,
      queryMaxMs: summary.max,
      lastQueryMs: Number(this.lastQueryMs.toFixed(2)),
      workerFallbackCount: this.workerFallbackCount,
      longTaskCount: this.longTaskCount,
      longTaskTotalMs: Number(this.longTaskTotalMs.toFixed(2)),
      lastMode: this.lastMode,
      lastDiagnostic: this.lastDiagnostic,
      sampledAt: Date.now(),
    };
  }

  subscribe(listener: (snapshot: CanvasPerformanceSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      const snapshot = this.snapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    }, 250);
  }
}

