import type { Response } from "express";
import { executeTools } from "../tools";
import { callLLMStream } from "./llmStream";
import { compressMessages } from "./memory";
import { SYSTEM_PROMPT } from "./prompt";
import { sendAgentStatus, sendSSE } from "./sse";
import type { ChatMessage, LLMProviderConfig, LLMessage } from "./types";

export const MAX_AGENT_LOOPS = 5;

function toApiMessage(message: ChatMessage): LLMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.tool_call_id,
      name: message.name,
    };
  }

  if (message.role === "assistant" && message.tool_calls) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

export async function runAgentStream(
  messages: ChatMessage[],
  res: Response,
  config: LLMProviderConfig
): Promise<void> {
  const compressedMessages = await compressMessages(
    messages,
    config.sessionId,
    config.providerUrl,
    config.apiKey,
    config.model
  );

  const apiMessages: LLMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...compressedMessages.map(toApiMessage),
  ];

  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop++) {
    const currentRound = loop + 1;

    sendAgentStatus(res, {
      currentRound,
      maxRounds: MAX_AGENT_LOOPS,
      stage: "thinking",
    });

    const result = await callLLMStream(
      apiMessages,
      config.providerUrl,
      config.apiKey,
      config.model,
      res
    );

    if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
      sendAgentStatus(res, {
        currentRound,
        maxRounds: MAX_AGENT_LOOPS,
        stage: "responding",
      });
      break;
    }

    apiMessages.push({
      role: "assistant",
      content: null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const toolResults = await executeTools(result.toolCalls);

    for (const tr of toolResults) {
      sendAgentStatus(res, {
        currentRound,
        maxRounds: MAX_AGENT_LOOPS,
        stage: "observing",
        toolName: tr.name,
        toolSuccess: tr.success,
        toolDuration: tr.duration,
      });

      sendSSE(res, "tool_result", {
        id: tr.tool_call_id,
        name: tr.name,
        result: tr.result,
        success: tr.success,
        duration: tr.duration,
      });

      apiMessages.push({
        role: "tool",
        content: tr.result,
        tool_call_id: tr.tool_call_id,
        name: tr.name,
      });
    }
  }

  sendSSE(res, "done", {});
  res.end();
}
