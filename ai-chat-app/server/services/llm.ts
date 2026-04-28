import type { Response } from "express";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const USE_OPENAI = !!OPENAI_API_KEY;
const USE_DEEPSEEK = !USE_OPENAI && !!DEEPSEEK_API_KEY;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

console.log("USE_OPENAI", USE_OPENAI);
console.log("USE_DEEPSEEK", USE_DEEPSEEK);
console.log("OPENAI_API_KEY", OPENAI_API_KEY);
console.log("DEEPSEEK_API_KEY", DEEPSEEK_API_KEY);
console.log("LLM_MODEL", process.env.LLM_MODEL);

export async function streamLLMResponse(
  messages: ChatMessage[],
  res: Response
): Promise<void> {
  if (!USE_OPENAI && !USE_DEEPSEEK) {
    await mockStream(messages, res);
    return;
  }

  const providerUrl = USE_OPENAI ? OPENAI_URL : DEEPSEEK_URL;
  const apiKey = USE_OPENAI ? OPENAI_API_KEY! : DEEPSEEK_API_KEY!;

  const payload = {
    model:
      process.env.LLM_MODEL || (USE_OPENAI ? "gpt-4.1-mini" : "deepseek-chat"),
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  try {
    // Node 18+ 原生支持 fetch；若环境不支持或网络错误，将进入 catch 并回退到 mock 流式。
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.body) {
      res.end("No response body");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let sseBuffer = "";

    // 解析 SSE 流，只提取 delta.content 文本返回给前端
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      const lines = sseBuffer.split("\n");
      // 最后一行可能不完整，留在 buffer 等下次拼接
      sseBuffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (payload === "[DONE]") {
          continue;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta;
          const content = delta?.content;
          if (content) {
            res.write(content);
          }
        } catch {
          // 解析失败直接忽略该行
        }
      }
    }

    res.end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("LLM request failed, fallback to mock:", error);
    await mockStream(messages, res);
  }
}

async function mockStream(messages: ChatMessage[], res: Response) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const baseText = lastUser?.content || "Hello from mock LLM!";

  const words = [
    "Hello, ",
    "this ",
    "is ",
    "a ",
    "mock ",
    "stream ",
    "response ",
    "because ",
    "no ",
    "API ",
    "key ",
    "was ",
    "configured. ",
    "\n\nYou said: ",
    baseText,
  ];

  for (const w of words) {
    res.write(w);
    await sleep(120);
  }

  res.end();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

