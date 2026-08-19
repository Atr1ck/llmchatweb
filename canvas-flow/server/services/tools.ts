import { randomUUID } from "node:crypto";
import { getSkillById } from "./agent/skills";

export type ToolParameterProperty = {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: { type: "string" | "number" | "boolean" | "object" };
};

export type ToolParameters = {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameters;
};

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolExecuteFn = (
  args: Record<string, unknown>,
  signal?: AbortSignal,
  context?: { allowedAssetIds?: ReadonlySet<string> }
) => Promise<ToolResult>;

function asStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function executeImageOperation(
  args: Record<string, unknown>,
  signal?: AbortSignal,
  context?: { allowedAssetIds?: ReadonlySet<string> }
): Promise<ToolResult> {
  const start = Date.now();
  if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");

  const operation = args.operation;
  const sourceAssetIds = args.sourceAssetIds;
  const prompt = args.prompt;
  const negativePrompt = args.negativePrompt;
  const aspectRatio = args.aspectRatio ?? "1:1";
  const resultCount = args.resultCount ?? (operation === "variation" ? 2 : 1);
  const skillIds = args.skillIds ?? [];

  if (operation !== "generate" && operation !== "variation" && operation !== "merge") {
    return { success: false, error: "operation 必须是 generate、variation 或 merge", duration: Date.now() - start };
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return { success: false, error: "prompt 不能为空", duration: Date.now() - start };
  }
  if (!asStringArray(sourceAssetIds)) {
    return { success: false, error: "sourceAssetIds 必须是字符串数组", duration: Date.now() - start };
  }
  if (!asStringArray(skillIds)) {
    return { success: false, error: "skillIds 必须是字符串数组", duration: Date.now() - start };
  }
  if (context?.allowedAssetIds && sourceAssetIds.some((id) => !context.allowedAssetIds?.has(id))) {
    return { success: false, error: "sourceAssetIds 中包含不在当前画布上下文中的图片", duration: Date.now() - start };
  }
  if (skillIds.some((id) => !getSkillById(id))) {
    return { success: false, error: "skillIds 中包含未注册的创作 Skill", duration: Date.now() - start };
  }
  if (operation === "variation" && sourceAssetIds.length !== 1) {
    return { success: false, error: "生成变体需要且只能使用一张来源图片", duration: Date.now() - start };
  }
  if (operation === "merge" && sourceAssetIds.length < 2) {
    return { success: false, error: "融合图片至少需要两张来源图片", duration: Date.now() - start };
  }
  if (operation === "generate" && sourceAssetIds.length > 0) {
    return { success: false, error: "普通生成不应携带来源图片", duration: Date.now() - start };
  }
  if (typeof resultCount !== "number" || !Number.isInteger(resultCount) || resultCount < 1 || resultCount > 2) {
    return { success: false, error: "resultCount 必须是 1 到 2 的整数", duration: Date.now() - start };
  }
  if (typeof aspectRatio !== "string" || !["1:1", "4:5", "16:9", "9:16"].includes(aspectRatio)) {
    return { success: false, error: "aspectRatio 必须是 1:1、4:5、16:9 或 9:16", duration: Date.now() - start };
  }
  if (negativePrompt !== undefined && typeof negativePrompt !== "string") {
    return { success: false, error: "negativePrompt 必须是字符串", duration: Date.now() - start };
  }

  return {
    success: true,
    data: {
      accepted: true,
      operationId: `image_op_${randomUUID()}`,
      operation,
      prompt: prompt.trim(),
      negativePrompt: typeof negativePrompt === "string" ? negativePrompt.trim() : undefined,
      aspectRatio,
      sourceAssetIds,
      resultCount,
      skillIds,
    },
    duration: Date.now() - start,
  };
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: "image_operation",
    description: "在图片创作画布中执行图片生成、单图变体或多图融合。只能使用当前画布提供的来源图片资产 ID。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: { type: "string", enum: ["generate", "variation", "merge"], description: "图片操作类型" },
        sourceAssetIds: { type: "array", description: "来源图片资产 ID；generate 为空、variation 恰好一个、merge 至少两个", items: { type: "string" } },
        prompt: { type: "string", description: "经过创作 Skill 整理后的正向图片提示词" },
        negativePrompt: { type: "string", description: "需要避免的视觉元素，可选" },
        aspectRatio: { type: "string", enum: ["1:1", "4:5", "16:9", "9:16"], description: "输出画幅比例" },
        resultCount: { type: "number", description: "结果数量，范围 1 到 2，单图变体默认 2" },
        skillIds: { type: "array", description: "实际采用的图片创作 Skill ID，可使用 skill-id 或 skill-id@version", items: { type: "string" } },
      },
      required: ["operation", "sourceAssetIds", "prompt", "skillIds"],
    },
  },
];

const toolExecutors: Record<string, ToolExecuteFn> = {
  image_operation: executeImageOperation,
};

export function getToolDefinitions(): ToolDefinition[] {
  return toolDefinitions;
}

export function getToolsPayload() {
  return toolDefinitions.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function hasTool(name: string): boolean {
  return name in toolExecutors;
}

export async function executeTool(
  name: string,
  argsJson: string,
  signal?: AbortSignal,
  context?: { allowedAssetIds?: ReadonlySet<string> }
): Promise<{ result: string; success: boolean; duration: number }> {
  const start = Date.now();
  const executor = toolExecutors[name];
  if (!executor) {
    return { success: false, result: `错误：未知工具 "${name}"，当前仅支持图片创作。`, duration: Date.now() - start };
  }

  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("参数必须是 JSON 对象");
    args = parsed as Record<string, unknown>;
  } catch {
    return { success: false, result: `错误：工具 "${name}" 的参数 JSON 解析失败。`, duration: Date.now() - start };
  }

  try {
    const result = await executor(args, signal, context);
    return result.success
      ? { success: true, result: JSON.stringify(result.data), duration: result.duration }
      : { success: false, result: result.error || "工具执行失败", duration: result.duration };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return {
      success: false,
      result: `错误：工具 "${name}" 执行失败：${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    };
  }
}

export async function executeTools(
  toolCalls: ToolCall[],
  signal?: AbortSignal,
  context?: { allowedAssetIds?: ReadonlySet<string> }
) {
  const results: {
    tool_call_id: string;
    name: string;
    result: string;
    success: boolean;
    duration: number;
  }[] = [];

  for (const toolCall of toolCalls) {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const result = await executeTool(toolCall.name, toolCall.arguments, signal, context);
    results.push({ tool_call_id: toolCall.id, name: toolCall.name, ...result });
  }
  return results;
}
