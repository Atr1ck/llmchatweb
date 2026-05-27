import type { Response } from "express";
import { mockStream } from "./agent/mock";
import { runAgentStream } from "./agent/runner";
import type { AgentStage, AgentStatus, ChatMessage } from "./agent/types";

export type { AgentStage, AgentStatus, ChatMessage };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const USE_OPENAI = Boolean(OPENAI_API_KEY);
const USE_DEEPSEEK = !USE_OPENAI && Boolean(DEEPSEEK_API_KEY);

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

function resolveProvider() {
  if (USE_OPENAI) {
    return {
      providerUrl: OPENAI_URL,
      apiKey: OPENAI_API_KEY!,
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
    };
  }

  if (USE_DEEPSEEK) {
    return {
      providerUrl: DEEPSEEK_URL,
      apiKey: DEEPSEEK_API_KEY!,
      model: process.env.LLM_MODEL || "deepseek-chat",
    };
  }

  return null;
}

export async function streamLLMResponse(
  messages: ChatMessage[],
  res: Response,
  sessionId?: string
): Promise<void> {
  const provider = resolveProvider();

  if (!provider) {
    await mockStream(messages, res);
    return;
  }

  try {
    await runAgentStream(messages, res, { ...provider, sessionId });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("LLM request failed, fallback to mock:", error);
    await mockStream(messages, res);
  }
}
