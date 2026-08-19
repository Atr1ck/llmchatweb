import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { executeTools } from "../tools";
import { retrieveCreativeContext } from "./context";
import { MAX_AGENT_LOOPS } from "./runner";
import { sendAgentStatus, sendSSE } from "./sse";
import type { ChatMessage, CreativeAgentContext } from "./types";

export async function mockStream(
  messages: ChatMessage[],
  res: Response,
  context: CreativeAgentContext = {},
  signal: AbortSignal
) {
  const runId = randomUUID();
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const userText = lastUser?.content ?? "";
  const retrieval = retrieveCreativeContext(userText, context);
  const selectedIds = (context.selectedAssets ?? []).map((asset) => asset.id);
  const operation = selectedIds.length >= 2 ? "merge" : selectedIds.length === 1 ? "variation" : "generate";
  const resultCount = operation === "variation" ? 2 : 1;
  const isImageRequest = Boolean(context.selectedAssets?.length || /生成|创作|图片|画面|海报|人像|变体|融合|设计|画一个|做一张|场景|风格|镜头|光影/.test(userText));

  sendSSE(res, "run_start", { runId, mode: "image_creation", maxRounds: MAX_AGENT_LOOPS });
  sendAgentStatus(res, { runId, currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "retrieving", message: "正在检索创作 Skill 与项目风格" });
  sendSSE(res, "creative_context", { runId, ...retrieval.snapshot });
  await sleep(250, signal);

  if (!isImageRequest) {
    sendAgentStatus(res, { runId, currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "responding", message: "准备说明能力边界" });
    sendSSE(res, "text", { runId, content: "我是图片创作助手，可以帮你生成图片、制作单图变体或融合多张参考图。请描述你想要的主体、风格和画面氛围。" });
    sendSSE(res, "done", { runId, stopReason: "completed" });
    res.end();
    return;
  }

  const prompt = userText.replace(/^\s*\[画布创作上下文\]\s*/u, "").trim() || "根据当前画布参考图继续创作，保持主体关系和整体风格一致。";
  const args = JSON.stringify({
    operation,
    sourceAssetIds: selectedIds,
    prompt,
    negativePrompt: "画面混乱、主体变形、无意义文字、水印、过度锐化",
    aspectRatio: "1:1",
    resultCount,
    skillIds: retrieval.skills.slice(0, 3).map((skill) => skill.id),
  });
  const toolCallId = `mock_${randomUUID()}`;
  sendAgentStatus(res, { runId, currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "planning", message: "正在形成图片创作方案" });
  sendSSE(res, "tool_call_start", { runId, id: toolCallId, name: "image_operation" });
  sendSSE(res, "tool_call_delta", { runId, id: toolCallId, arguments: args });
  sendSSE(res, "tool_call_end", { runId, id: toolCallId, name: "image_operation", arguments: args });
  sendSSE(res, "creative_brief", {
    runId,
    brief: {
      operation,
      sourceAssetIds: selectedIds,
      prompt,
      negativePrompt: "画面混乱、主体变形、无意义文字、水印、过度锐化",
      aspectRatio: "1:1",
      resultCount,
      skillIds: retrieval.skills.slice(0, 3).map((skill) => skill.id),
      skills: retrieval.snapshot.skills.slice(0, 3),
      contextNotes: [`${selectedIds.length} 张当前选中参考图`, retrieval.memories.length ? `参考了 ${retrieval.memories.length} 条项目记忆` : "未使用历史项目记忆"],
    },
  });

  const [toolResult] = await executeTools([{ id: toolCallId, name: "image_operation", arguments: args }], signal, {
    allowedAssetIds: new Set(selectedIds),
  });
  sendAgentStatus(res, { runId, currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "observing", toolName: "image_operation", toolSuccess: toolResult.success, toolDuration: toolResult.duration, message: "图片创作任务已接受" });
  sendSSE(res, "tool_result", { runId, id: toolResult.tool_call_id, name: toolResult.name, result: toolResult.result, success: toolResult.success, duration: toolResult.duration });
  sendAgentStatus(res, { runId, currentRound: 2, maxRounds: MAX_AGENT_LOOPS, stage: "responding", message: "正在整理创作说明" });
  sendSSE(res, "text", { runId, content: "已根据画布上下文整理创作方案，正在将结果添加到画布。" });
  sendSSE(res, "done", { runId, stopReason: "completed" });
  res.end();
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("请求已取消", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("请求已取消", "AbortError"));
    }, { once: true });
  });
}
