import type { Response } from "express";
import { getToolsPayload } from "../tools";
import type { ToolCall } from "../tools";
import { sendSSE } from "./sse";
import type { LLMessage, StreamResult } from "./types";

export async function callLLMStream(
  apiMessages: LLMessage[],
  providerUrl: string,
  apiKey: string,
  model: string,
  res: Response
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
    }),
  });

  if (!response.body) {
    throw new Error("No response body from LLM");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let sseBuffer = "";
  let finishReason: string | null = null;
  const toolCallMap = new Map<
    number,
    { id: string; name: string; args: string; started: boolean }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const dataPayload = trimmed.slice("data:".length).trim();
      if (dataPayload === "[DONE]") continue;

      try {
        const json = JSON.parse(dataPayload) as {
          choices?: {
            finish_reason?: string | null;
            delta?: {
              content?: string;
              tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
        };
        const choice = json.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (delta?.content) {
          sendSSE(res, "text", { content: delta.content });
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            let existing = toolCallMap.get(tc.index);
            if (!existing) {
              existing = { id: "", name: "", args: "", started: false };
              toolCallMap.set(tc.index, existing);
            }

            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (!existing.started && existing.id && existing.name) {
              existing.started = true;
              sendSSE(res, "tool_call_start", {
                id: existing.id,
                name: existing.name,
              });
            }
            if (tc.function?.arguments) {
              existing.args += tc.function.arguments;
              sendSSE(res, "tool_call_delta", {
                id: existing.id,
                arguments: tc.function.arguments,
              });
            }
          }
        }
      } catch {
        // Ignore malformed provider stream lines.
      }
    }
  }

  const toolCalls: ToolCall[] = [...toolCallMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: tc.args }));

  for (const tc of toolCalls) {
    sendSSE(res, "tool_call_end", {
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    });
  }

  return { finishReason, toolCalls };
}
