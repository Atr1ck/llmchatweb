import type { Response } from "express";
import { mockStream } from "./agent/mock";
import { runAgentStream } from "./agent/runner";
import type { AgentStage, AgentStatus, ChatMessage, CreativeAgentContext } from "./agent/types";

export type { AgentStage, AgentStatus, ChatMessage, CreativeAgentContext };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const SILICON_FLOW_API_KEY = process.env.SILCON_FLOW_API_KEY || process.env.SILICON_FLOW_API_KEY;
const USE_MOCK = process.env.AGENT_MOCK === "true" || (!OPENAI_API_KEY && !DEEPSEEK_API_KEY && !SILICON_FLOW_API_KEY);

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const SILICON_FLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";

export type ChatProviderId = "openai" | "deepseek" | "siliconflow" | "mock";

export type ChatProviderOption = {
  id: ChatProviderId;
  label: string;
  model: string;
  supportsVision: boolean;
};

type ProviderConfig = ChatProviderOption & {
  providerUrl: string;
  apiKey: string;
};

function configuredProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  if (SILICON_FLOW_API_KEY) {
    providers.push({
      id: "siliconflow",
      label: "硅基流动 · Kimi K2.7 Code",
      model: process.env.SILICON_FLOW_MODEL || "moonshotai/Kimi-K2.7-Code",
      supportsVision: true,
      providerUrl: SILICON_FLOW_URL,
      apiKey: SILICON_FLOW_API_KEY,
    });
  }
  if (OPENAI_API_KEY) {
    providers.push({
      id: "openai",
      label: "OpenAI",
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
      supportsVision: true,
      providerUrl: OPENAI_URL,
      apiKey: OPENAI_API_KEY,
    });
  }
  if (DEEPSEEK_API_KEY) {
    providers.push({
      id: "deepseek",
      label: "DeepSeek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      supportsVision: false,
      providerUrl: DEEPSEEK_URL,
      apiKey: DEEPSEEK_API_KEY,
    });
  }
  return providers;
}

export function getChatProviderOptions(): ChatProviderOption[] {
  if (USE_MOCK) {
    return [{ id: "mock", label: "本地 Mock", model: "mock", supportsVision: false }];
  }
  return configuredProviders().map(({ id, label, model, supportsVision }) => ({ id, label, model, supportsVision }));
}

function resolveProvider(providerId?: string) {
  const providers = configuredProviders();
  if (!providers.length) return null;
  return providers.find((provider) => provider.id === providerId) ?? providers[0];
}

export async function streamLLMResponse(
  messages: ChatMessage[],
  res: Response,
  sessionId: string | undefined,
  context: CreativeAgentContext | undefined,
  signal: AbortSignal,
  providerId?: string,
): Promise<void> {
  const provider = resolveProvider(providerId);
  if (USE_MOCK || !provider) {
    await mockStream(messages, res, context, signal);
    return;
  }
  await runAgentStream(messages, res, { ...provider, sessionId }, context, signal);
}
