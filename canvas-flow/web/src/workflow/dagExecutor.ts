export type DagNode = { id: string };

export type DagEdge = {
  id?: string;
  source: string;
  target: string;
};

export type DagValidationIssue = {
  type: "duplicate-node" | "missing-endpoint" | "self-loop" | "duplicate-edge" | "cycle";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type DagValidationResult = {
  valid: boolean;
  issues: DagValidationIssue[];
  order: string[];
};

export type DagNodeStatus = "pending" | "running" | "success" | "error" | "skipped" | "cancelled";

export type DagNodeResult<TResult> = {
  nodeId: string;
  status: Exclude<DagNodeStatus, "pending" | "running">;
  attempts: number;
  result?: TResult;
  error?: string;
};

export type DagRunStatus = "success" | "partial_failure" | "failed" | "cancelled" | "invalid";

export type DagRunResult<TResult> = {
  status: DagRunStatus;
  validation: DagValidationResult;
  results: Map<string, DagNodeResult<TResult>>;
  order: string[];
};

export type DagExecutionEvent<TNode extends DagNode, TResult> =
  | { type: "validated"; validation: DagValidationResult }
  | { type: "queued"; node: TNode }
  | { type: "running"; node: TNode; attempt: number }
  | { type: "retrying"; node: TNode; attempt: number; error: string }
  | { type: "success"; node: TNode; attempt: number; result: TResult }
  | { type: "error"; node: TNode; attempt: number; error: string }
  | { type: "skipped"; node: TNode; reason: string }
  | { type: "cancelled"; node: TNode; reason: string }
  | { type: "complete"; status: DagRunStatus };

export type DagExecutionContext<TResult> = {
  attempt: number;
  signal: AbortSignal;
  dependencyResults: ReadonlyMap<string, TResult>;
};

export type DagExecutorOptions<TNode extends DagNode, TResult> = {
  execute: (node: TNode, context: DagExecutionContext<TResult>) => Promise<TResult>;
  maxConcurrency?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  retryOnError?: (error: unknown, node: TNode, attempt: number) => boolean | Promise<boolean>;
  onEvent?: (event: DagExecutionEvent<TNode, TResult>) => void;
};

const terminalStatuses = new Set<DagNodeStatus>(["success", "error", "skipped", "cancelled"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancellationError(): DOMException {
  return new DOMException("工作流已取消", "AbortError");
}

/** Validate references and return a deterministic topological order. */
export function validateWorkflowGraph<TNode extends DagNode, TEdge extends DagEdge>(nodes: TNode[], edges: TEdge[]): DagValidationResult {
  const issues: DagValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const nodeOrder = new Map<string, number>();

  nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      issues.push({ type: "duplicate-node", nodeId: node.id, message: `节点 ${node.id} 重复` });
    }
    nodeIds.add(node.id);
    nodeOrder.set(node.id, index);
  });

  const seenEdges = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  nodes.forEach((node) => {
    adjacency.set(node.id, new Set());
    inDegree.set(node.id, 0);
  });

  edges.forEach((edge) => {
    const edgeId = edge.id ?? `${edge.source}->${edge.target}`;
    const edgeKey = `${edge.source}->${edge.target}`;
    if (seenEdges.has(edgeKey)) {
      issues.push({ type: "duplicate-edge", edgeId, message: `连线 ${edgeKey} 重复` });
      return;
    }
    seenEdges.add(edgeKey);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ type: "missing-endpoint", edgeId, message: `连线 ${edgeKey} 引用了不存在的节点` });
      return;
    }
    if (edge.source === edge.target) {
      issues.push({ type: "self-loop", nodeId: edge.source, edgeId, message: `节点 ${edge.source} 不能连接到自身` });
      return;
    }
    adjacency.get(edge.source)?.add(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  const queue = nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0))
    .map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    order.push(nodeId);
    adjacency.get(nodeId)?.forEach((target) => {
      const nextDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
        queue.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
      }
    });
  }

  if (order.length !== nodeIds.size) {
    const cycleNodes = nodes.filter((node) => !order.includes(node.id)).map((node) => node.id);
    issues.push({ type: "cycle", message: `工作流存在环路：${cycleNodes.join("、")}`, nodeId: cycleNodes[0] });
  }

  return { valid: issues.length === 0, issues, order };
}

async function executeWithRetry<TNode extends DagNode, TResult>(
  node: TNode,
  dependencyResults: ReadonlyMap<string, TResult>,
  options: DagExecutorOptions<TNode, TResult>,
  signal: AbortSignal,
): Promise<DagNodeResult<TResult>> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 1));
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    if (signal.aborted) return { nodeId: node.id, status: "cancelled", attempts: attempt - 1, error: "工作流已取消" };
    options.onEvent?.({ type: "running", node, attempt });
    try {
      const result = await options.execute(node, { attempt, signal, dependencyResults });
      if (signal.aborted) return { nodeId: node.id, status: "cancelled", attempts: attempt, error: "工作流已取消" };
      return { nodeId: node.id, status: "success", attempts: attempt, result };
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return { nodeId: node.id, status: "cancelled", attempts: attempt, error: "工作流已取消" };
      const message = errorMessage(error);
      const shouldRetry = attempt < maxAttempts && (await options.retryOnError?.(error, node, attempt) ?? true);
      if (!shouldRetry) return { nodeId: node.id, status: "error", attempts: attempt, error: message };
      options.onEvent?.({ type: "retrying", node, attempt, error: message });
    }
  }

  return { nodeId: node.id, status: "error", attempts: attempt, error: "工作流节点执行失败" };
}

/** Execute a validated DAG with bounded concurrency and branch-local failure propagation. */
export async function executeWorkflowDag<TNode extends DagNode, TEdge extends DagEdge, TResult>(
  nodes: TNode[],
  edges: TEdge[],
  options: DagExecutorOptions<TNode, TResult>,
): Promise<DagRunResult<TResult>> {
  const validation = validateWorkflowGraph(nodes, edges);
  options.onEvent?.({ type: "validated", validation });
  if (!validation.valid) {
    const result = { status: "invalid" as const, validation, results: new Map<string, DagNodeResult<TResult>>(), order: [] };
    options.onEvent?.({ type: "complete", status: result.status });
    return result;
  }

  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const dependencies = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set<string>()]));
  const dependents = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set<string>()]));
  edges.forEach((edge) => {
    dependencies.get(edge.target)?.add(edge.source);
    dependents.get(edge.source)?.add(edge.target);
  });

  const states = new Map<string, DagNodeStatus>(nodes.map((node) => [node.id, "pending"]));
  const results = new Map<string, DagNodeResult<TResult>>();
  const ready: string[] = [];
  const readySet = new Set<string>();
  const active = new Map<string, Promise<DagNodeResult<TResult>>>();
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 3));

  const enqueue = (nodeId: string) => {
    if (states.get(nodeId) !== "pending" || readySet.has(nodeId)) return;
    ready.push(nodeId);
    readySet.add(nodeId);
    options.onEvent?.({ type: "queued", node: nodeById.get(nodeId) as TNode });
  };

  const markSkippedIfBlocked = () => {
    let changed = false;
    nodes.forEach((node) => {
      if (states.get(node.id) !== "pending") return;
      const dependencyStates = Array.from(dependencies.get(node.id) ?? [], (dependencyId) => states.get(dependencyId));
      if (dependencyStates.some((status) => status === "error" || status === "skipped" || status === "cancelled")) {
        const cancelled = signal.aborted || dependencyStates.some((status) => status === "cancelled");
        const nextStatus = cancelled ? "cancelled" as const : "skipped" as const;
        const reason = cancelled ? "工作流已取消" : "上游节点未成功";
        states.set(node.id, nextStatus);
        const blocked = { nodeId: node.id, status: nextStatus, attempts: 0, error: reason };
        results.set(node.id, blocked);
        if (cancelled) options.onEvent?.({ type: "cancelled", node, reason });
        else options.onEvent?.({ type: "skipped", node, reason });
        changed = true;
      } else if (dependencyStates.every((status) => status === "success")) {
        enqueue(node.id);
      }
    });
    return changed;
  };

  nodes.filter((node) => (dependencies.get(node.id)?.size ?? 0) === 0).forEach((node) => enqueue(node.id));
  markSkippedIfBlocked();

  try {
    while (active.size > 0 || ready.length > 0 || Array.from(states.values()).some((status) => status === "pending")) {
      while (!signal.aborted && active.size < maxConcurrency && ready.length > 0) {
        const nodeId = ready.shift();
        if (!nodeId) break;
        readySet.delete(nodeId);
        if (states.get(nodeId) !== "pending") continue;
        const node = nodeById.get(nodeId) as TNode;
        const dependencyResults = new Map<string, TResult>();
        dependencies.get(nodeId)?.forEach((dependencyId) => {
          const dependencyResult = results.get(dependencyId)?.result;
          if (dependencyResult !== undefined) dependencyResults.set(dependencyId, dependencyResult);
        });
        states.set(nodeId, "running");
        const promise = executeWithRetry(node, dependencyResults, options, signal);
        active.set(nodeId, promise);
      }

      if (signal.aborted) {
        ready.splice(0).forEach((nodeId) => {
          readySet.delete(nodeId);
          if (states.get(nodeId) !== "pending") return;
          const node = nodeById.get(nodeId) as TNode;
          states.set(nodeId, "cancelled");
          results.set(nodeId, { nodeId, status: "cancelled", attempts: 0, error: "工作流已取消" });
          options.onEvent?.({ type: "cancelled", node, reason: "工作流已取消" });
        });
      }

      if (active.size > 0) {
        const completed = await Promise.race(active.values());
        active.delete(completed.nodeId);
        const node = nodeById.get(completed.nodeId) as TNode;
        states.set(completed.nodeId, completed.status);
        results.set(completed.nodeId, completed);
        if (completed.status === "success") {
          options.onEvent?.({ type: "success", node, attempt: completed.attempts, result: completed.result as TResult });
        } else if (completed.status === "cancelled") {
          options.onEvent?.({ type: "cancelled", node, reason: completed.error ?? "工作流已取消" });
        } else {
          options.onEvent?.({ type: "error", node, attempt: completed.attempts, error: completed.error ?? "节点执行失败" });
        }
        markSkippedIfBlocked();
        continue;
      }

      if (signal.aborted) break;
      if (!markSkippedIfBlocked() && ready.length === 0) {
        // Defensive guard: validation should have caught this, but never spin on a
        // malformed graph supplied by a caller that mutates its arrays in flight.
        nodes.filter((node) => states.get(node.id) === "pending").forEach((node) => {
          states.set(node.id, "skipped");
          results.set(node.id, { nodeId: node.id, status: "skipped", attempts: 0, error: "节点无法调度" });
          options.onEvent?.({ type: "skipped", node, reason: "节点无法调度" });
        });
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }

  if (signal.aborted) {
    nodes.filter((node) => !terminalStatuses.has(states.get(node.id) ?? "pending")).forEach((node) => {
      states.set(node.id, "cancelled");
      const cancelled = { nodeId: node.id, status: "cancelled" as const, attempts: results.get(node.id)?.attempts ?? 0, error: "工作流已取消" };
      results.set(node.id, cancelled);
      options.onEvent?.({ type: "cancelled", node, reason: cancelled.error ?? "工作流已取消" });
    });
  }

  const hasError = Array.from(results.values()).some((result) => result.status === "error");
  const hasSuccess = Array.from(results.values()).some((result) => result.status === "success");
  const hasCancelled = Array.from(results.values()).some((result) => result.status === "cancelled");
  const status: DagRunStatus = hasCancelled && !hasSuccess ? "cancelled" : hasError ? (hasSuccess ? "partial_failure" : "failed") : "success";
  const finalResult = { status, validation, results, order: validation.order };
  options.onEvent?.({ type: "complete", status });
  return finalResult;
}
