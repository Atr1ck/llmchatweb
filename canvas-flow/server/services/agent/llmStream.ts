import type { Response } from "express";
import { getToolsPayload } from "../tools";
import type { ToolCall } from "../tools";
import { sendSSE } from "./sse";
import type { LLMessage, StreamResult } from "./types";

type ProviderChunk = {
  choices?: {
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
};

export async function callLLMStream(
  apiMessages: LLMessage[],
  providerUrl: string,
  apiKey: string,
  model: string,
  res: Response,
  runId: string,
  signal: AbortSignal
): Promise<StreamResult> {
  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: apiMessages,
      tools: getToolsPayload(),
      tool_choice: "auto",
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM 请求失败（HTTP ${response.status}）：${body.slice(0, 300)}`);
  }
  if (!response.body) throw new Error("LLM 没有返回流式响应体");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finishReason: string | null = null;
  let assistantContent = "";
  const toolCallMap = new Map<number, { id: string; name: string; args: string; started: boolean }>();

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "[DONE]") return;

    let chunk: ProviderChunk;
    try {
      chunk = JSON.parse(payload) as ProviderChunk;
    } catch {
      return;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;

    if (delta?.content) {
      assistantContent += delta.content;
      sendSSE(res, "text", { runId, content: delta.content });
    }

    for (const deltaToolCall of delta?.tool_calls ?? []) {
      let current = toolCallMap.get(deltaToolCall.index);
      if (!current) {
        current = { id: "", name: "", args: "", started: false };
        toolCallMap.set(deltaToolCall.index, current);
      }
      if (deltaToolCall.id) current.id = deltaToolCall.id;
      if (deltaToolCall.function?.name) current.name = deltaToolCall.function.name;
      if (!current.started && current.id && current.name) {
        current.started = true;
        sendSSE(res, "tool_call_start", { runId, id: current.id, name: current.name });
      }
      if (deltaToolCall.function?.arguments) {
        current.args += deltaToolCall.function.arguments;
        sendSSE(res, "tool_call_delta", {
          runId,
          id: current.id,
          arguments: deltaToolCall.function.arguments,
        });
      }
    }
  };

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(processLine);
    }
    buffer += decoder.decode();
    if (buffer) buffer.split(/\r?\n/).forEach(processLine);
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
  }

  const toolCalls: ToolCall[] = [...toolCallMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, value]) => ({ id: value.id, name: value.name, arguments: value.args }));
  for (const toolCall of toolCalls) {
    sendSSE(res, "tool_call_end", {
      runId,
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  return { finishReason, toolCalls, assistantContent };
}
