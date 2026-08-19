import type { Response } from "express";
import type { AgentStatus } from "./types";

export function sendSSE(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false;
  const sequence = Number(res.locals.__sseSequence ?? 0) + 1;
  res.locals.__sseSequence = sequence;
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), sequence }
    : data;
  res.write(`id: ${sequence}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

export function sendAgentStatus(res: Response, status: AgentStatus) {
  sendSSE(res, "agent_status", status);
}
