import { describe, expect, it, vi } from "vitest";
import { executeWorkflowDag, validateWorkflowGraph } from "./dagExecutor";

const node = (id: string) => ({ id });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

describe("validateWorkflowGraph", () => {
  it("returns a stable topological order", () => {
    const result = validateWorkflowGraph([node("b"), node("a"), node("c")], [edge("a", "b"), edge("b", "c")]);
    expect(result.valid).toBe(true);
    expect(result.order).toEqual(["a", "b", "c"]);
  });

  it("rejects cycles and invalid endpoints", () => {
    const result = validateWorkflowGraph([node("a"), node("b")], [edge("a", "b"), edge("b", "a"), edge("b", "missing")]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.type)).toEqual(expect.arrayContaining(["missing-endpoint", "cycle"]));
  });
});

describe("executeWorkflowDag", () => {
  it("honors dependencies, retries transient errors and caps concurrency", async () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    let bAttempts = 0;
    const result = await executeWorkflowDag(nodes, [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")], {
      maxConcurrency: 2,
      maxAttempts: 2,
      execute: async (current, context) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(`${current.id}:${context.attempt}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (current.id === "b" && bAttempts++ === 0) throw new Error("temporary");
        return current.id;
      },
    });

    expect(result.status).toBe("success");
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(calls).toContain("b:2");
    expect(result.results.get("d")?.result).toBe("d");
  });

  it("skips only descendants of a failed node", async () => {
    const result = await executeWorkflowDag([node("root"), node("dependent"), node("independent")], [edge("root", "dependent")], {
      execute: async (current) => {
        if (current.id === "root") throw new Error("provider down");
        return current.id;
      },
    });

    expect(result.status).toBe("partial_failure");
    expect(result.results.get("root")?.status).toBe("error");
    expect(result.results.get("dependent")?.status).toBe("skipped");
    expect(result.results.get("independent")?.status).toBe("success");
  });

  it("cancels queued branches without resurrecting them", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (current: { id: string }, context: { signal: AbortSignal }) => {
      if (current.id === "root") {
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
      }
      if (context.signal.aborted) throw new DOMException("cancelled", "AbortError");
      return current.id;
    });
    const result = await executeWorkflowDag([node("root"), node("next")], [edge("root", "next")], { signal: controller.signal, execute });

    expect(result.status).toBe("cancelled");
    expect(result.results.get("root")?.status).toBe("cancelled");
    expect(result.results.get("next")?.status).toBe("cancelled");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
