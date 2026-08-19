import { PackedRTree } from "./spatialIndex";
import type { CanvasSpatialRequest, CanvasSpatialResponse } from "./spatialProtocol";

const index = new PackedRTree();
let currentVersion = 0;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CanvasSpatialRequest>) => void) | null;
  postMessage: (message: CanvasSpatialResponse) => void;
};

function respond(response: CanvasSpatialResponse): void {
  workerScope.postMessage(response);
}

workerScope.onmessage = (event) => {
  const request = event.data;
  const startedAt = performance.now();

  try {
    if (request.type === "init") {
      index.replace(request.nodes);
      currentVersion = request.version;
      respond({ requestId: request.requestId, type: "ready", version: currentVersion, elapsedMs: performance.now() - startedAt });
      return;
    }

    if (request.type === "update") {
      if (request.baseVersion !== currentVersion) {
        throw new Error(`版本不连续：Worker=${currentVersion}，请求=${request.baseVersion}`);
      }
      index.upsertMany(request.upserts);
      index.removeMany(request.removes);
      currentVersion = request.nextVersion;
      respond({ requestId: request.requestId, type: "update", version: currentVersion, elapsedMs: performance.now() - startedAt });
      return;
    }

    if (request.type === "query-visible" || request.type === "box-select") {
      respond({
        requestId: request.requestId,
        type: request.type,
        version: currentVersion,
        nodeIds: index.search(request.rect),
        elapsedMs: performance.now() - startedAt,
      });
      return;
    }

    // Layout is deliberately kept as an extensible protocol boundary. It is
    // not enabled until benchmark data proves layout is a main-thread hotspot.
    respond({ requestId: request.requestId, type: "layout", version: currentVersion, positions: [], elapsedMs: performance.now() - startedAt });
  } catch (error) {
    respond({
      requestId: request.requestId,
      type: "error",
      version: currentVersion,
      error: error instanceof Error ? error.message : "Worker 处理失败",
      elapsedMs: performance.now() - startedAt,
    });
  }
};
