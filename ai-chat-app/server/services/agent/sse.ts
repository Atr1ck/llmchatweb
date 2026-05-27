import type { Response } from "express";
import type { AgentStatus } from "./types";

export function sendSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sendAgentStatus(res: Response, status: AgentStatus) {
  sendSSE(res, "agent_status", status);
}
