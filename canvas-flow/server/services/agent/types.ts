import type { ToolCall } from "../tools";

export type AgentStage =
  | "interpreting"
  | "retrieving"
  | "planning"
  | "thinking"
  | "tool_calling"
  | "observing"
  | "responding"
  | "saving";

export type AgentStatus = {
  runId?: string;
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  message?: string;
  toolName?: string;
  toolSuccess?: boolean;
  toolDuration?: number;
};

export type StyleBible = {
  direction?: string;
  palette?: string[];
  lighting?: string;
  composition?: string;
  consistency?: string;
  notes?: string;
};

export type ProjectMemoryItem = {
  id: string;
  kind: "style" | "preference" | "approved_result" | "revision_note";
  text: string;
  tags?: string[];
  sourceAssetIds?: string[];
  createdAt: number;
  confirmed?: boolean;
};

export type CanvasAssetContext = {
  id: string;
  prompt?: string;
  operation?: "generate" | "variation" | "merge" | "import";
  parentIds?: string[];
  candidate?: boolean;
  tags?: string[];
  /** Optional vision input for the currently selected canvas asset. */
  imageUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  role?: "reference" | "style" | "subject";
};

export type CreativeAgentContext = {
  mode?: "image_creation";
  project?: {
    id?: string;
    name?: string;
    styleBible?: StyleBible;
    memoryItems?: ProjectMemoryItem[];
  };
  selectedAssets?: CanvasAssetContext[];
  recentAssets?: CanvasAssetContext[];
  requestedSkillIds?: string[];
};

export type SkillRef = {
  id: string;
  version: string;
  name: string;
  summary: string;
};

export type RetrievedMemoryRef = {
  id: string;
  kind: ProjectMemoryItem["kind"];
  text: string;
  sourceAssetIds?: string[];
};

export type CreativeContextSnapshot = {
  selectedAssetIds: string[];
  skills: SkillRef[];
  memories: RetrievedMemoryRef[];
  styleBibleSummary?: string;
};

export type CreativeBrief = {
  operation: "generate" | "variation" | "merge";
  sourceAssetIds: string[];
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resultCount: number;
  skillIds: string[];
  skills: SkillRef[];
  contextNotes: string[];
};

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export function sanitizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const message = raw as Record<string, unknown>;
    const role = message.role;
    const content = message.content;
    if ((role !== "user" && role !== "assistant" && role !== "tool") || typeof content !== "string") return [];
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.flatMap((rawCall) => {
          if (!rawCall || typeof rawCall !== "object") return [];
          const call = rawCall as Record<string, unknown>;
          const fn = call.function;
          const functionValue = fn && typeof fn === "object" ? fn as Record<string, unknown> : call;
          if (typeof call.id !== "string" || typeof functionValue.name !== "string" || typeof functionValue.arguments !== "string") return [];
          return [{ id: call.id, name: functionValue.name, arguments: functionValue.arguments.slice(0, 20_000) }];
        })
      : undefined;
    return [{
      id: typeof message.id === "string" ? message.id : `message_${index}`,
      role,
      content: content.slice(0, 20_000),
      tool_calls: toolCalls?.length ? toolCalls : undefined,
      tool_call_id: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      name: typeof message.name === "string" ? message.name : undefined,
    }];
  });
}

export type LLContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type LLMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | LLContentPart[];
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
  supportsVision?: boolean;
};

export type StreamResult = {
  finishReason: string | null;
  toolCalls: ToolCall[];
  assistantContent: string;
};
