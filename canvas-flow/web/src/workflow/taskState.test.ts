import { describe, expect, it } from "vitest";
import { reduceTaskEvent, type TaskLifecycleState } from "./taskState";

const initial: TaskLifecycleState = { taskId: "task-1", runId: "run-1", status: "running", progress: 20, lastSequence: 2 };

describe("reduceTaskEvent", () => {
  it("ignores duplicate and out-of-order events", () => {
    const duplicate = reduceTaskEvent(initial, { taskId: "task-1", runId: "run-1", sequence: 2, type: "chunk", progress: 80 });
    const older = reduceTaskEvent(initial, { taskId: "task-1", runId: "run-1", sequence: 1, type: "queued" });
    expect(duplicate).toEqual(initial);
    expect(older).toEqual(initial);
  });

  it("does not resurrect a cancelled task with a late completion", () => {
    const cancelled = reduceTaskEvent(initial, { taskId: "task-1", runId: "run-1", sequence: 3, type: "cancelled" });
    const late = reduceTaskEvent(cancelled, { taskId: "task-1", runId: "run-1", sequence: 4, type: "completed" });
    expect(cancelled.status).toBe("cancelled");
    expect(late).toEqual(cancelled);
  });

  it("ignores events from another run", () => {
    const foreign = reduceTaskEvent(initial, { taskId: "task-1", runId: "run-2", sequence: 99, type: "completed" });
    expect(foreign).toEqual(initial);
  });
});

