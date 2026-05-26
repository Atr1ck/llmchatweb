import type { Response } from "express";
import { getToolsPayload, executeTools } from "./tools";
import type { ToolCall } from "./tools";

// ─── 类型定义 ────────────────────────────────────────────

/** Agent 循环阶段 */
export type AgentStage = "thinking" | "tool_calling" | "observing" | "responding";

/** Agent 状态 */
export type AgentStatus = {
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  toolName?: string;
  toolResult?: string;
  toolSuccess?: boolean;
  toolDuration?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

/** LLM API 消息格式 */
type LLMessage = {
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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const USE_OPENAI = !!OPENAI_API_KEY;
const USE_DEEPSEEK = !USE_OPENAI && !!DEEPSEEK_API_KEY;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const MAX_AGENT_LOOPS = 5;

// ─── 记忆系统 ───────────────────────────────────────────

/** 会话摘要存储（内存，按 sessionId 索引） */
const sessionSummaries = new Map<string, string>();

/** 触发摘要的消息条数阈值 */
const SUMMARY_THRESHOLD = 10;

/** 保留最近的消息条数（不参与摘要） */
const KEEP_RECENT = 6;

/**
 * 调用 LLM 生成对话摘要（非流式）
 */
async function generateSummary(
  messages: ChatMessage[],
  providerUrl: string,
  apiKey: string
): Promise<string> {
  const summaryMessages: LLMessage[] = [
    {
      role: "system",
      content: "请用简洁的中文总结以下对话的关键信息，包括：用户的主要问题、助手的回答要点、涉及的实体和结论。不超过200字。",
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
      model: process.env.LLM_MODEL || (USE_OPENAI ? "gpt-4.1-mini" : "deepseek-chat"),
      messages: summaryMessages,
    }),
  });

  const data = await response.json() as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || "";
}

/**
 * 压缩消息：摘要旧消息 + 保留最近消息
 * 返回压缩后的 ChatMessage[]
 */
async function compressMessages(
  messages: ChatMessage[],
  sessionId: string | undefined,
  providerUrl: string,
  apiKey: string
): Promise<ChatMessage[]> {
  if (messages.length <= SUMMARY_THRESHOLD) {
    return messages;
  }

  // 分割：旧消息用于摘要，保留最近消息
  const olderMessages = messages.slice(0, messages.length - KEEP_RECENT);
  const recentMessages = messages.slice(messages.length - KEEP_RECENT);

  // 获取已有摘要
  const existingSummary = sessionId ? (sessionSummaries.get(sessionId) || "") : "";

  // 生成新摘要（合并旧摘要 + 旧消息）
  let newSummary: string;
  try {
    newSummary = await generateSummary(olderMessages, providerUrl, apiKey);
    // eslint-disable-next-line no-console
    console.log("[memory] 生成新摘要:", newSummary.slice(0, 100));
  } catch (err) {
    // 摘要失败则直接返回原始消息
    // eslint-disable-next-line no-console
    console.error("[memory] 摘要生成失败，使用原始消息:", err);
    return messages;
  }

  // 合并旧摘要
  const combinedSummary = existingSummary
    ? `${existingSummary}\n\n最新摘要：${newSummary}`
    : newSummary;

  // 保存摘要
  if (sessionId) {
    sessionSummaries.set(sessionId, combinedSummary);
  }

  // 返回：摘要消息 + 最近消息
  const summaryMessage: ChatMessage = {
    id: `summary_${Date.now()}`,
    role: "user",
    content: `[对话历史摘要]\n${combinedSummary}`,
  };

  return [summaryMessage, ...recentMessages];
}

// ─── System Prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `你是一个智能助手，可以调用工具来辅助回答用户问题。请严格遵守以下规则：

## 工具使用规则

1. **get_weather** — 仅在用户明确询问某地天气时调用。例如："北京天气怎么样"、"东京现在几度"。
2. **web_search** — 仅在用户明确要求搜索新闻/资讯，或需要你无法确定的事实性信息时调用。例如："最新AI新闻"、"搜索中国新闻"。
3. **calculator** — 仅在用户给出明确数学表达式需要计算时调用。例如："计算 123*456"、"2+3等于多少"。

## 限制

- **不要无意义调用工具**：如果问题可以直接用你的知识回答（如常识、编程、写作、闲聊），就直接回答，不要调用任何工具。
- **不要过度依赖工具**：用户问"你好"、"帮我写一段代码"、"解释一下XXX"等，这些都不需要工具。
- **一次只调用必要的工具**：不要同时调用多个无关工具。

## 工具结果处理

### web_search 结果
收到搜索结果后，你必须：
1. 用 **3~5 句话** 对新闻要点进行简要总结，不要逐条翻译，要提炼核心信息。
2. 在总结下方列出新闻标题和来源，格式如下：

**新闻概要：**
（3~5句总结）

**相关报道：**
1. 标题 — 来源
2. 标题 — 来源
3. 标题 — 来源

### get_weather 结果
用自然语言描述天气，包含：城市、天气状况、温度、湿度、风力。简洁友好。

### calculator 结果
直接给出计算结果，格式如：\`表达式 = 结果\`。

## 回答风格

- 优先直接回答，工具只是辅助。
- 调用工具后，严格按上述格式组织回答，不要输出原始 JSON。`;

console.log("USE_OPENAI", USE_OPENAI);
console.log("USE_DEEPSEEK", USE_DEEPSEEK);
console.log("OPENAI_API_KEY", OPENAI_API_KEY);
console.log("DEEPSEEK_API_KEY", DEEPSEEK_API_KEY);
console.log("LLM_MODEL", process.env.LLM_MODEL);

// ─── SSE 辅助 ────────────────────────────────────────────

/** 发送 SSE 事件 */
function sendSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 发送 Agent 状态事件 */
function sendAgentStatus(res: Response, status: AgentStatus) {
  sendSSE(res, "agent_status", status);
}

// ─── 单次 LLM 流式调用 ──────────────────────────────────

type StreamResult = {
  finishReason: string | null;
  toolCalls: ToolCall[];
};

/**
 * 执行一次 LLM 流式请求，使用 SSE 格式将数据写入 res
 */
async function callLLMStream(
  apiMessages: LLMessage[],
  providerUrl: string,
  apiKey: string,
  res: Response
): Promise<StreamResult> {
  const payload = {
    model:
      process.env.LLM_MODEL || (USE_OPENAI ? "gpt-4.1-mini" : "deepseek-chat"),
    stream: true,
    messages: apiMessages,
    tools: getToolsPayload(),
  };

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.body) {
    throw new Error("No response body from LLM");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let sseBuffer = "";

  let finishReason: string | null = null;
  // tool_calls 增量累积：以 index 为 key 拼接
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

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
                type?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
        };
        const choice = json.choices?.[0];
        if (!choice) continue;

        // 收集 finish_reason（非 null 时记录）
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;

        // 文本增量 — 使用 SSE 格式
        if (delta?.content) {
          sendSSE(res, "text", { content: delta.content });
        }

        // 工具调用增量 — 使用 SSE 格式
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            let existing = toolCallMap.get(idx);
            if (!existing) {
              existing = { id: "", name: "", args: "" };
              toolCallMap.set(idx, existing);
              // 发送 tool_call_start 事件
              if (tc.id && tc.function?.name) {
                sendSSE(res, "tool_call_start", { id: tc.id, name: tc.function.name });
              }
            }
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.args += tc.function.arguments;
              // 发送 tool_call_delta 事件
              sendSSE(res, "tool_call_delta", { id: existing.id, arguments: tc.function.arguments });
            }
          }
        }
      } catch {
        // 解析失败直接忽略该行
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  // 按 index 排序，组装结果
  const sorted = [...toolCallMap.entries()].sort(([a], [b]) => a - b);
  for (const [idx, tc] of sorted) {
    toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.args });
    // 发送 tool_call_end 事件
    sendSSE(res, "tool_call_end", { id: tc.id, name: tc.name, arguments: tc.args });
  }

  return { finishReason, toolCalls };
}

// ─── Agent 主循环 ───────────────────────────────────────

export async function streamLLMResponse(
  messages: ChatMessage[],
  res: Response,
  sessionId?: string
): Promise<void> {
  if (!USE_OPENAI && !USE_DEEPSEEK) {
    await mockStream(messages, res);
    return;
  }

  const providerUrl = USE_OPENAI ? OPENAI_URL : DEEPSEEK_URL;
  const apiKey = USE_OPENAI ? OPENAI_API_KEY! : DEEPSEEK_API_KEY!;

  // ── 记忆压缩：超过阈值时摘要旧消息 ──
  const compressedMessages = await compressMessages(messages, sessionId, providerUrl, apiKey);

  // 将 ChatMessage 转为 LLM API 消息格式
  let apiMessages: LLMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...compressedMessages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.tool_call_id,
        name: m.name,
      };
    }
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  }),
  ];

  try {
    for (let loop = 0; loop < MAX_AGENT_LOOPS; loop++) {
      const currentRound = loop + 1;

      // ─── 阶段 1: thinking ─────────────────────────────
      sendAgentStatus(res, {
        currentRound,
        maxRounds: MAX_AGENT_LOOPS,
        stage: "thinking",
      });

      // ─── 阶段 2: tool_calling ──────────────────────────
      const result = await callLLMStream(apiMessages, providerUrl, apiKey, res);

      // finish_reason 不是 tool_calls → 正常结束
      if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
        // 进入 responding 阶段
        sendAgentStatus(res, {
          currentRound,
          maxRounds: MAX_AGENT_LOOPS,
          stage: "responding",
        });
        break;
      }

      // ─── 阶段 3: observing (执行工具) ──────────────────

      // 先将 assistant 的 tool_calls 消息加入上下文（API 要求的格式）
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

        // 发送工具结果给前端
        sendSSE(res, "tool_result", {
          id: tr.tool_call_id,
          name: tr.name,
          result: tr.result,
          success: tr.success,
          duration: tr.duration,
        });

        // 将工具结果加入上下文（每个 tool_call 必须有对应的 tool 消息）
        apiMessages.push({
          role: "tool",
          content: tr.result,
          tool_call_id: tr.tool_call_id,
          name: tr.name,
        });
      }

      // 继续循环，再次调用 LLM（携带完整上下文：user → assistant[tool_calls] → tool → ...）
    }

    sendSSE(res, "done", {});
    res.end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("LLM request failed, fallback to mock:", error);
    await mockStream(messages, res);
  }
}

// ─── Mock 流式（无 API Key 时使用）────────────────────────

/**
 * Mock 模式：模拟 Agent 循环，演示工具调用流程
 * 根据用户输入自动触发对应工具
 */
async function mockStream(messages: ChatMessage[], res: Response) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content || "";

  sendAgentStatus(res, { currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "thinking" });
  await sleep(500);

  // 根据用户输入判断是否需要调用工具
  const toolToCall = detectMockTool(userText);

  if (toolToCall) {
    // 模拟工具调用
    const toolCallId = `mock_${Date.now()}`;

    sendSSE(res, "tool_call_start", { id: toolCallId, name: toolToCall.name });
    await sleep(200);
    sendSSE(res, "tool_call_delta", { id: toolCallId, arguments: JSON.stringify(toolToCall.args).slice(0, -1) });
    await sleep(100);
    sendSSE(res, "tool_call_delta", { id: toolCallId, arguments: JSON.stringify(toolToCall.args).slice(-1) });
    sendSSE(res, "tool_call_end", { id: toolCallId, name: toolToCall.name, arguments: JSON.stringify(toolToCall.args) });

    // 执行工具
    const toolResults = await executeTools([{ id: toolCallId, name: toolToCall.name, arguments: JSON.stringify(toolToCall.args) }]);
    const tr = toolResults[0];

    sendAgentStatus(res, { currentRound: 1, maxRounds: MAX_AGENT_LOOPS, stage: "observing", toolName: tr.name, toolSuccess: tr.success, toolDuration: tr.duration });
    await sleep(300);

    sendSSE(res, "tool_result", { id: tr.tool_call_id, name: tr.name, result: tr.result, success: tr.success, duration: tr.duration });

    // 第二轮：基于工具结果生成回答
    sendAgentStatus(res, { currentRound: 2, maxRounds: MAX_AGENT_LOOPS, stage: "thinking" });
    await sleep(400);

    const answer = toolToCall.mockAnswer;
    for (const ch of answer) {
      sendSSE(res, "text", { content: ch });
      await sleep(30);
    }
  } else {
    // 无工具调用，直接回答
    const words = [
      "你好！这是一个 Mock 模式的回复，因为没有配置 API Key。\n\n",
      "你可以尝试以下问题来测试工具系统：\n",
      "- **北京天气怎么样？** → 触发 get_weather\n",
      "- **计算 123 * 456 + 789** → 触发 calculator\n",
      "- **搜索 React 19 有什么新特性** → 触发 web_search\n",
    ];
    for (const w of words) {
      sendSSE(res, "text", { content: w });
      await sleep(80);
    }
  }

  sendAgentStatus(res, { currentRound: toolToCall ? 2 : 1, maxRounds: MAX_AGENT_LOOPS, stage: "responding" });
  sendSSE(res, "done", {});
  res.end();
}

/** 检测用户输入是否匹配 Mock 工具 */
function detectMockTool(text: string): { name: string; args: Record<string, unknown>; mockAnswer: string } | null {
  // 天气检测
  const weatherMatch = text.match(/([\u4e00-\u9fa5]+)(?:的?天气|天气怎么样)/);
  if (weatherMatch) {
    const city = weatherMatch[1];
    return {
      name: "get_weather",
      args: { city },
      mockAnswer: `根据查询结果，${city}当前天气：晴，25°C，湿度40%，西北风3级。适合外出活动！`,
    };
  }

  // 计算器检测
  const calcMatch = text.match(/(?:计算|算一下|算)\s*([\d+\-*/().\s]+)/);
  if (calcMatch) {
    const expression = calcMatch[1].trim();
    try {
      const result = new Function(`return (${expression})`)();
      return {
        name: "calculator",
        args: { expression },
        mockAnswer: `计算结果：\`${expression} = ${result}\``,
      };
    } catch {
      // 表达式无效，不走工具
    }
  }

  // 搜索检测
  const searchMatch = text.match(/(?:搜索|搜一下|查找|查一下)\s*(.+)/);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    return {
      name: "web_search",
      args: { query },
      mockAnswer: `关于「${query}」的搜索结果：\n\n1. **${query}** - 相关信息概述（来源：示例百科）\n2. **关于${query}** - ${query}的最新动态（来源：示例新闻）\n3. **${query}使用指南** - ${query}的详细使用方法（来源：示例文档）\n\n以上是 Mock 模式的示例搜索结果。`,
    };
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
