import { describe, expect, it } from "vitest";
import { CanvasSpatialClient, type CanvasWorkerLike } from "./canvasSpatialClient";
import type { CanvasSpatialRequest, CanvasSpatialResponse } from "./spatialProtocol";
import { summarizeDurations, CanvasPerformanceMonitor } from "./performanceMonitor";

class DrillWorker implements CanvasWorkerLike {
  onmessage: ((event: MessageEvent<CanvasSpatialResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  failNextQuery = false;

  postMessage(request: CanvasSpatialRequest): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      if (request.type === "init") {
        this.onmessage?.({ data: { requestId: request.requestId, type: "ready", version: request.version } } as MessageEvent<CanvasSpatialResponse>);
        return;
      }
      if (this.failNextQuery) {
        this.failNextQuery = false;
        this.onerror?.({ message: "simulated worker crash" } as ErrorEvent);
        return;
      }
      this.onmessage?.({ data: { requestId: request.requestId, type: request.type, version: 0, nodeIds: ["a"], elapsedMs: 0.5 } } as MessageEvent<CanvasSpatialResponse>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("fault drills", () => {
  it("falls back to the main-thread index when the Worker crashes", async () => {
    const worker = new DrillWorker();
    const diagnostics: string[] = [];
    const client = new CanvasSpatialClient({
      createWorker: () => worker,
      onDiagnostic: (event) => diagnostics.push(event.type),
    });
    await client.init([{ nodeId: "a", minX: 0, minY: 0, maxX: 10, maxY: 10 }]);
    worker.failNextQuery = true;
    const result = await client.queryVisible({ minX: 0, minY: 0, maxX: 20, maxY: 20 });

    expect(result).toEqual(["a"]);
    expect(client.currentMode).toBe("main-r-tree");
    expect(diagnostics).toContain("worker-error");
    client.dispose();
  });

  it("records long tasks and keeps percentile metrics bounded", () => {
    const monitor = new CanvasPerformanceMonitor();
    monitor.recordSpatialDiagnostic({ type: "query-visible", mode: "worker-r-tree", elapsedMs: 3 });
    monitor.recordSpatialDiagnostic({ type: "query-visible", mode: "worker-r-tree", elapsedMs: 9 });
    monitor.recordLongTask(120);
    const snapshot = monitor.snapshot();
    expect(summarizeDurations([3, 9])).toEqual({ p50: 3, p95: 9, max: 9 });
    expect(snapshot.queryP95Ms).toBe(9);
    expect(snapshot.longTaskCount).toBe(1);
    expect(snapshot.longTaskTotalMs).toBe(120);
  });
});
