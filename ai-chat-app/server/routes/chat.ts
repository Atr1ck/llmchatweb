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

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    await streamLLMResponse(messages, res);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Chat stream error:", error);
    if (!res.headersSent) {
      res.status(500).end("Internal server error");
    } else {
      res.write("\n[Error] Chat stream failed.");
      res.end();
    }
  }
});

export default router;

