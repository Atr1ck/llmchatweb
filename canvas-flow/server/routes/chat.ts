import { Router } from "express";
import type { Request, Response } from "express";
import { getChatProviderOptions, streamLLMResponse, type CreativeAgentContext } from "../services/llm";
import { sanitizeChatMessages } from "../services/agent/types";

const router = Router();

type ChatRequestBody = {
  messages?: unknown;
  sessionId?: string;
  context?: CreativeAgentContext;
  providerId?: string;
};

router.get("/providers", (_req: Request, res: Response) => {
  res.json({ providers: getChatProviderOptions() });
});

router.post("/", async (req: Request, res: Response) => {
  const body = req.body as ChatRequestBody;
  const messages = sanitizeChatMessages(body?.messages);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
  const context = body?.context;
  const providerId = typeof body?.providerId === "string" ? body.providerId : undefined;
  const controller = new AbortController();

  req.on("aborted", () => controller.abort());
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await streamLLMResponse(messages, res, sessionId, context, controller.signal, providerId);
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      if (!res.writableEnded) res.end();
      return;
    }
    // eslint-disable-next-line no-console
    console.error("Chat stream error:", error);
    if (!res.writableEnded) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : "未知错误";
      res.write("event: error\n");
      res.write(`data: ${JSON.stringify({ message: `图片 Agent 执行失败：${detail}` })}\n\n`);
      res.write("event: done\n");
      res.write(`data: ${JSON.stringify({ stopReason: "error" })}\n\n`);
      res.end();
    }
  }
});

export default router;
