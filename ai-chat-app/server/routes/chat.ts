import { Router } from "express";
import type { Request, Response } from "express";
import { streamLLMResponse } from "../services/llm";

const router = Router();

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

router.post("/", async (req: Request, res: Response) => {
  const messages: ChatMessage[] = req.body?.messages ?? [];

  // SSE 标准格式
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // 立即发送头部

  try {
    await streamLLMResponse(messages, res);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Chat stream error:", error);
    if (!res.headersSent) {
      res.status(500).end("Internal server error");
    } else {
      res.write("event: error\n");
      res.write(`data: ${JSON.stringify({ message: "Stream failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;

