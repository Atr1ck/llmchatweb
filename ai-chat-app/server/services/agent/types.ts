import type { ToolCall } from "../tools";

export type AgentStage = "thinking" | "tool_calling" | "observing" | "responding";

export type AgentStatus = {
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  toolName?: string;
  toolResult?: string;
  toolSuccess?: boolean;
  toolDuration?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type LLMessage = {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
};

export type LLMProviderConfig = {
  providerUrl: string;
  apiKey: string;
  model: string;
  sessionId?: string;
};

export type StreamResult = {
  finishReason: string | null;
  toolCalls: ToolCall[];
};
