import { PackedRTree, scanSpatialItems, type SpatialItem, type SpatialRect } from "./spatialIndex";
import type { CanvasSpatialRequest, CanvasSpatialResponse } from "./spatialProtocol";
import type { SpatialDiagnosticEvent } from "./performanceMonitor";

export type SpatialClientMode = "worker-r-tree" | "main-r-tree" | "main-scan";

type QueryKind = "query-visible" | "box-select";

type QueryJob = {
  kind: QueryKind;
  rect: SpatialRect;
  resolve: (nodeIds: string[]) => void;
};

export type CanvasWorkerLike = {
  onmessage: ((event: MessageEvent<CanvasSpatialResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: CanvasSpatialRequest) => void;
  terminate: () => void;
};

export type CanvasSpatialClientOptions = {
  onDiagnostic?: (event: SpatialDiagnosticEvent) => void;
  createWorker?: () => CanvasWorkerLike;
};

export class CanvasSpatialClient {
  private worker: CanvasWorkerLike | null = null;

  private readonly mainIndex = new PackedRTree();

  private readonly items = new Map<string, SpatialItem>();

  private mode: SpatialClientMode = "main-r-tree";

  private version = 0;

  private ready = false;

  private readyResolver: (() => void) | null = null;

  private workerNeedsResync = false;

  private activeQuery: { requestId: string; job: QueryJob } | null = null;

  private queuedQuery: QueryJob | null = null;

  private pending = new Map<string, (response: CanvasSpatialResponse) => void>();

  constructor(private readonly options: CanvasSpatialClientOptions = {}) {
    const createWorker = options.createWorker ?? (() => {
      if (typeof Worker === "undefined") return null;
      return new Worker(new URL("./canvasSpatial.worker.ts", import.meta.url), { type: "module" }) as unknown as CanvasWorkerLike;
    });
    if (!options.createWorker && typeof Worker === "undefined") return;
    try {
      this.worker = createWorker();
      if (!this.worker) return;
      this.mode = "worker-r-tree";
      this.worker.onmessage = (event: MessageEvent<CanvasSpatialResponse>) => this.handleResponse(event.data);
      this.worker.onerror = (event) => {
        this.fallbackToMain("worker-error", event.message || "Worker 执行异常");
      };
    } catch (error) {
      this.mode = "worker-r-tree";
      this.fallbackToMain("worker-init-failed", error instanceof Error ? error.message : "Worker 初始化失败");
    }
  }

  get currentMode(): SpatialClientMode {
    return this.mode;
  }

  async init(nodes: SpatialItem[]): Promise<void> {
    this.workerNeedsResync = false;
    this.items.clear();
    nodes.forEach((node) => this.items.set(node.nodeId, node));
    this.mainIndex.replace(nodes);
    this.version = 0;

    if (!this.worker || this.mode !== "worker-r-tree") {
      this.ready = true;
      return;
    }

    this.ready = false;
    const requestId = crypto.randomUUID();
    const request: CanvasSpatialRequest = { type: "init", requestId, version: this.version, nodes };
    await new Promise<void>((resolve) => {
      this.readyResolver = resolve;
      this.pending.set(requestId, () => resolve());
      this.worker?.postMessage(request);
    });
  }

  async updateNodes(patch: { upserts: SpatialItem[]; removes: string[] }): Promise<void> {
    patch.upserts.forEach((node) => this.items.set(node.nodeId, node));
    patch.removes.forEach((nodeId) => this.items.delete(nodeId));
    try {
      this.mainIndex.upsertMany(patch.upserts);
      this.mainIndex.removeMany(patch.removes);
    } catch (error) {
      this.fallbackToScan("main-index-update-failed", error instanceof Error ? error.message : "主线程索引更新失败");
      return;
    }

    if (!this.worker || this.mode !== "worker-r-tree") return;
    if (!this.ready) {
      this.workerNeedsResync = true;
      return;
    }
    const nextVersion = this.version + 1;
    const requestId = crypto.randomUUID();
    const request: CanvasSpatialRequest = {
      type: "update",
      requestId,
      baseVersion: this.version,
      nextVersion,
      upserts: patch.upserts,
      removes: patch.removes,
    };
    this.version = nextVersion;
    await new Promise<void>((resolve) => {
      this.pending.set(requestId, () => resolve());
      this.worker?.postMessage(request);
    });
  }

  queryVisible(rect: SpatialRect): Promise<string[]> {
    return this.query("query-visible", rect);
  }

  boxSelect(rect: SpatialRect): Promise<string[]> {
    return this.query("box-select", rect);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.activeQuery = null;
    this.queuedQuery = null;
  }

  private query(kind: QueryKind, rect: SpatialRect): Promise<string[]> {
    if (!this.worker || this.mode !== "worker-r-tree" || !this.ready) {
      const startedAt = performance.now();
      const nodeIds = this.searchFallback(rect);
      this.options.onDiagnostic?.({ type: kind, mode: this.mode, elapsedMs: performance.now() - startedAt });
      return Promise.resolve(nodeIds);
    }

    return new Promise<string[]>((resolve) => {
      const job = { kind, rect, resolve };
      if (this.activeQuery) {
        this.queuedQuery?.resolve([]);
        this.queuedQuery = job;
        return;
      }
      this.dispatchQuery(job);
    });
  }

  private dispatchQuery(job: QueryJob): void {
    if (!this.worker) {
      job.resolve(this.searchFallback(job.rect));
      return;
    }
    const requestId = crypto.randomUUID();
    this.activeQuery = { requestId, job };
    const request: CanvasSpatialRequest = { type: job.kind, requestId, version: this.version, rect: job.rect };
    this.pending.set(requestId, (response) => {
      if (!this.activeQuery || this.activeQuery.requestId !== requestId) return;
      const current = this.activeQuery;
      this.activeQuery = null;
      if (response.type === "error") {
        this.fallbackToMain("worker-response-error", response.error);
        current.job.resolve(this.searchFallback(current.job.rect));
      } else {
        current.job.resolve(response.nodeIds ?? []);
        this.options.onDiagnostic?.({ type: response.type, mode: this.mode, elapsedMs: response.elapsedMs });
      }
      if (this.queuedQuery) {
        const queued = this.queuedQuery;
        this.queuedQuery = null;
        this.dispatchQuery(queued);
      }
    });
    this.worker.postMessage(request);
  }

  private handleResponse(response: CanvasSpatialResponse): void {
    if (response.type === "ready") {
      this.ready = true;
      this.pending.get(response.requestId)?.(response);
      this.pending.delete(response.requestId);
      this.readyResolver?.();
      this.readyResolver = null;
      if (this.workerNeedsResync) {
        this.workerNeedsResync = false;
        void this.init(Array.from(this.items.values()));
      }
      return;
    }
    const resolver = this.pending.get(response.requestId);
    if (!resolver) return;
    this.pending.delete(response.requestId);
    resolver(response);
  }

  private fallbackToMain(type: string, detail?: string): void {
    if (this.mode !== "worker-r-tree") return;
    this.mode = "main-r-tree";
    this.worker?.terminate();
    this.worker = null;
    this.ready = true;
    this.options.onDiagnostic?.({ type, mode: this.mode, detail });
    this.pending.forEach((resolve) => resolve({ requestId: "fallback", type: "error", version: this.version, error: detail }));
    this.pending.clear();
    this.readyResolver?.();
    this.readyResolver = null;
  }

  private searchFallback(rect: SpatialRect): string[] {
    if (this.mode === "main-scan") return scanSpatialItems(Array.from(this.items.values()), rect);
    try {
      return this.mainIndex.search(rect);
    } catch (error) {
      this.fallbackToScan("main-index-query-failed", error instanceof Error ? error.message : "主线程索引查询失败");
      return scanSpatialItems(Array.from(this.items.values()), rect);
    }
  }

  private fallbackToScan(type: string, detail?: string): void {
    if (this.mode === "main-scan") return;
    this.mode = "main-scan";
    this.worker?.terminate();
    this.worker = null;
    this.ready = true;
    this.options.onDiagnostic?.({ type, mode: this.mode, detail });
    this.pending.forEach((resolve) => resolve({ requestId: "fallback", type: "error", version: this.version, error: detail }));
    this.pending.clear();
    this.readyResolver?.();
    this.readyResolver = null;
  }
}
