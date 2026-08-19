import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { executeTools } from "../tools";
import { materializeImageUrl } from "../imageUrl";
import { retrieveCreativeContext, type CreativeRetrieval } from "./context";
import { callLLMStream } from "./llmStream";
import { buildSystemPrompt } from "./prompt";
import { sendAgentStatus, sendSSE } from "./sse";
import { getSkillById, versionedSkillId } from "./skills";
import type { ChatMessage, CreativeAgentContext, CreativeBrief, LLContentPart, LLMessage, LLMProviderConfig } from "./types";

export const MAX_AGENT_LOOPS = 8;
const MAX_CONTEXT_MESSAGES = 16;
const MAX_VISION_ASSETS = 6;

function toApiMessage(message: ChatMessage): LLMessage {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.tool_call_id, name: message.name };
  }
  if (message.role === "assistant" && message.tool_calls) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        type: "function" as const,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function lastUserText(messages: ChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

async function attachSelectedImages(
  messages: LLMessage[],
  context: CreativeAgentContext,
  signal: AbortSignal,
): Promise<{ messages: LLMessage[]; skippedAssetIds: string[] }> {
  const selectedAssets = (context.selectedAssets ?? [])
    .filter((asset): asset is typeof asset & { imageUrl: string } => typeof asset.imageUrl === "string" && asset.imageUrl.trim().length > 0)
    .filter((asset, index, assets) => assets.findIndex((candidate) => candidate.id === asset.id) === index)
    .slice(0, MAX_VISION_ASSETS);
  if (!selectedAssets.length) return { messages, skippedAssetIds: [] };

  const preparedAssets = await Promise.all(selectedAssets.map(async (asset) => ({
    asset,
    imageUrl: await materializeImageUrl(asset.imageUrl, signal),
  })));
  const usableAssets = preparedAssets.filter((item): item is { asset: typeof selectedAssets[number]; imageUrl: string } => Boolean(item.imageUrl));
  const skippedAssetIds = preparedAssets.filter((item) => !item.imageUrl).map(({ asset }) => asset.id);
  if (!usableAssets.length) return { messages, skippedAssetIds };

  const userIndex = messages.reduce(
    (lastIndex, message, index) => message.role === "user" ? index : lastIndex,
    -1,
  );
  if (userIndex < 0) return { messages, skippedAssetIds };

  const userMessage = messages[userIndex];
  const text = typeof userMessage.content === "string" ? userMessage.content : "";
  const imageLabels = usableAssets
    .map(({ asset }, index) => `第 ${index + 1} 张参考图：资产 ID=${asset.id}；用途=${asset.role ?? "reference"}；尺寸=${asset.width ?? "?"}x${asset.height ?? "?"}；MIME=${asset.mimeType ?? "unknown"}`)
    .join("\n");
  const visionText = [
    text,
    "\n当前用户选中的参考图（请优先根据图片本身识别，不要仅凭历史 prompt 猜测）：",
    imageLabels,
  ].join("\n");
  const imageParts: LLContentPart[] = usableAssets.map(({ imageUrl }) => ({
    type: "image_url" as const,
    image_url: { url: imageUrl, detail: "high" as const },
  }));

  return {
    messages: messages.map((message, index) => index === userIndex
      ? { ...message, content: [{ type: "text", text: visionText }, ...imageParts] }
      : message
    ),
    skippedAssetIds,
  };
}

function useSelectedAssetsForTool(
  toolCall: { id: string; name: string; arguments: string },
  context: CreativeAgentContext,
) {
  if (toolCall.name !== "image_operation") return toolCall;
  const sourceAssetIds = [...new Set((context.selectedAssets ?? []).map((asset) => asset.id))];

  try {
    const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    if (sourceAssetIds.length) {
      args.operation = sourceAssetIds.length === 1 ? "variation" : "merge";
      args.sourceAssetIds = sourceAssetIds;
    }
    const operation = args.operation === "variation" ? "variation" : "generate";
    if (args.resultCount === undefined) {
      args.resultCount = operation === "variation" ? 2 : 1;
    } else if (typeof args.resultCount === "number" && Number.isFinite(args.resultCount)) {
      args.resultCount = Math.min(Math.max(Math.round(args.resultCount), 1), 2);
    }
    return { ...toolCall, arguments: JSON.stringify(args) };
  } catch {
    return toolCall;
  }
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(argumentsJson) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function createBrief(
  toolArguments: string,
  retrieval: CreativeRetrieval,
  context: CreativeAgentContext
): CreativeBrief | null {
  const args = parseToolArguments(toolArguments);
  if (!args) return null;
  const sourceAssetIds = Array.isArray(args.sourceAssetIds) ? args.sourceAssetIds.filter((id): id is string => typeof id === "string") : [];
  const operation = args.operation === "variation" || args.operation === "merge" ? args.operation : "generate";
  const requestedSkillIds = Array.isArray(args.skillIds) ? args.skillIds.filter((id): id is string => typeof id === "string") : [];
  const normalizedSkillIds = requestedSkillIds
    .map((id) => getSkillById(id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    .map(versionedSkillId);
  const skillIds = normalizedSkillIds.length ? normalizedSkillIds : retrieval.skills.map(versionedSkillId);
  const selectedSkillIds = new Set(skillIds.map((id) => id.slice(0, id.lastIndexOf("@"))));
  return {
    operation,
    sourceAssetIds,
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    negativePrompt: typeof args.negativePrompt === "string" ? args.negativePrompt : undefined,
    aspectRatio: typeof args.aspectRatio === "string" ? args.aspectRatio : "1:1",
    resultCount: typeof args.resultCount === "number" ? Math.min(Math.max(Math.round(args.resultCount), 1), 2) : operation === "variation" ? 2 : 1,
    skillIds,
    skills: retrieval.skills.filter((skill) => selectedSkillIds.has(skill.id)).map((skill) => ({
      id: skill.id,
      version: skill.version,
      name: skill.name,
      summary: skill.summary,
    })),
    contextNotes: [
      `${context.selectedAssets?.length ?? 0} 张当前选中参考图`,
      retrieval.memories.length ? `参考了 ${retrieval.memories.length} 条项目记忆` : "未使用历史项目记忆",
      retrieval.styleBibleSummary ? "沿用了项目 Style Bible" : "项目尚未设置 Style Bible",
    ],
  };
}

export async function runAgentStream(
  messages: ChatMessage[],
  res: Response,
  config: LLMProviderConfig,
  context: CreativeAgentContext = {},
  signal: AbortSignal
): Promise<void> {
  const runId = randomUUID();
  const retrieval = retrieveCreativeContext(lastUserText(messages), context);
  const baseMessages: LLMessage[] = [
    { role: "system", content: buildSystemPrompt(context, retrieval) },
    ...messages.slice(-MAX_CONTEXT_MESSAGES).map(toApiMessage),
  ];
  let apiMessages = baseMessages;
  let skippedVisionAssetIds: string[] = [];
  if (config.supportsVision) {
    const prepared = await attachSelectedImages(baseMessages, context, signal);
    apiMessages = prepared.messages;
    skippedVisionAssetIds = prepared.skippedAssetIds;
  }

  sendSSE(res, "run_start", { runId, mode: "image_creation", maxRounds: MAX_AGENT_LOOPS });
  if (skippedVisionAssetIds.length) {
    sendSSE(res, "agent_warning", {
      runId,
      message: `${skippedVisionAssetIds.length} 张参考图已失效或无法下载，本次将忽略这些图片并继续处理文本请求。`,
    });
  }
  sendAgentStatus(res, { runId, currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "retrieving", message: "正在检索创作 Skill 与项目风格" });
  sendSSE(res, "creative_context", { runId, ...retrieval.snapshot });

  let stopReason = "completed";
  let toolCallCount = 0;

  try {
    for (let loop = 0; loop < MAX_AGENT_LOOPS; loop += 1) {
      if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
      const currentRound = loop + 1;
      sendAgentStatus(res, {
        runId,
        currentRound,
        maxRounds: MAX_AGENT_LOOPS,
        stage: loop === 0 ? "interpreting" : "thinking",
        message: loop === 0 ? "正在理解创作意图" : "正在整理工具结果",
      });
      if (loop === 0) sendAgentStatus(res, { runId, currentRound, maxRounds: MAX_AGENT_LOOPS, stage: "planning", message: "正在形成图片创作方案" });

      const result = await callLLMStream(
        apiMessages,
        config.providerUrl,
        config.apiKey,
        config.model,
        res,
        runId,
        signal
      );

      if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
        sendAgentStatus(res, { runId, currentRound, maxRounds: MAX_AGENT_LOOPS, stage: "responding", message: "正在整理创作说明" });
        break;
      }

      if (toolCallCount >= 1) {
        stopReason = "tool_limit";
        sendSSE(res, "agent_warning", { runId, message: "本次请求已完成一个图片操作，已停止重复执行。" });
        break;
      }

      const toolCalls = result.toolCalls
        .slice(0, 1)
        .map((toolCall) => useSelectedAssetsForTool(toolCall, context));
      toolCallCount += toolCalls.length;
      sendAgentStatus(res, {
        runId,
        currentRound,
        maxRounds: MAX_AGENT_LOOPS,
        stage: "tool_calling",
        toolName: toolCalls[0]?.name,
        message: "正在提交图片创作任务",
      });
      const brief = createBrief(toolCalls[0]?.arguments ?? "{}", retrieval, context);
      if (brief) sendSSE(res, "creative_brief", { runId, brief });

      apiMessages.push({
        role: "assistant",
        content: result.assistantContent || null,
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: { name: toolCall.name, arguments: toolCall.arguments },
        })),
      });

      const toolResults = await executeTools(toolCalls, signal, {
        allowedAssetIds: new Set((context.selectedAssets ?? []).map((asset) => asset.id)),
      });
      for (const toolResult of toolResults) {
        sendAgentStatus(res, {
          runId,
          currentRound,
          maxRounds: MAX_AGENT_LOOPS,
          stage: "observing",
          toolName: toolResult.name,
          toolSuccess: toolResult.success,
          toolDuration: toolResult.duration,
          message: toolResult.success ? "图片创作任务已接受" : "图片创作参数未通过校验",
        });
        sendSSE(res, "tool_result", {
          runId,
          id: toolResult.tool_call_id,
          name: toolResult.name,
          result: toolResult.result,
          success: toolResult.success,
          duration: toolResult.duration,
        });
        apiMessages.push({
          role: "tool",
          content: toolResult.result,
          tool_call_id: toolResult.tool_call_id,
          name: toolResult.name,
        });
      }
    }

    if (toolCallCount >= 1) {
      sendAgentStatus(res, { runId, currentRound: Math.min(MAX_AGENT_LOOPS, toolCallCount + 1), maxRounds: MAX_AGENT_LOOPS, stage: "saving", message: "正在记录本次创作轨迹" });
    }
    if (!res.writableEnded) {
      sendSSE(res, "done", { runId, stopReason });
      res.end();
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw error;
  }
}
