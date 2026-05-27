import type { ChatMessage, LLMessage } from "./types";

const sessionSummaries = new Map<string, string>();

const SUMMARY_THRESHOLD = 10;
const KEEP_RECENT = 6;

async function generateSummary(
  messages: ChatMessage[],
  providerUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  const summaryMessages: LLMessage[] = [
    {
      role: "system",
      content:
        "请用简洁的中文总结以下对话的关键信息，包括：用户的主要问题、助手的回答要点、涉及的实体和结论。不超过200字。",
    },
    {
      role: "user",
      content: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content.slice(0, 300)}`)
        .join("\n"),
    },
  ];

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: summaryMessages,
    }),
  });

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || "";
}

export async function compressMessages(
  messages: ChatMessage[],
  sessionId: string | undefined,
  providerUrl: string,
  apiKey: string,
  model: string
): Promise<ChatMessage[]> {
  if (messages.length <= SUMMARY_THRESHOLD) {
    return messages;
  }

  const olderMessages = messages.slice(0, messages.length - KEEP_RECENT);
  const recentMessages = messages.slice(messages.length - KEEP_RECENT);
  const existingSummary = sessionId ? sessionSummaries.get(sessionId) || "" : "";

  let newSummary: string;
  try {
    newSummary = await generateSummary(olderMessages, providerUrl, apiKey, model);
    // eslint-disable-next-line no-console
    console.log("[memory] 生成新摘要:", newSummary.slice(0, 100));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[memory] 摘要生成失败，使用原始消息:", err);
    return messages;
  }

  const combinedSummary = existingSummary
    ? `${existingSummary}\n\n最新摘要：${newSummary}`
    : newSummary;

  if (sessionId) {
    sessionSummaries.set(sessionId, combinedSummary);
  }

  return [
    {
      id: `summary_${Date.now()}`,
      role: "user",
      content: `[对话历史摘要]\n${combinedSummary}`,
    },
    ...recentMessages,
  ];
}
