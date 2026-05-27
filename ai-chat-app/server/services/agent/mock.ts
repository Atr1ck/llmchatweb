import type { Response } from "express";
import { executeTools } from "../tools";
import { MAX_AGENT_LOOPS } from "./runner";
import { sendAgentStatus, sendSSE } from "./sse";
import type { ChatMessage } from "./types";

type MockTool = {
  name: string;
  args: Record<string, unknown>;
  mockAnswer: string;
};

export async function mockStream(messages: ChatMessage[], res: Response) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content || "";

  sendAgentStatus(res, {
    currentRound: 1,
    maxRounds: MAX_AGENT_LOOPS,
    stage: "thinking",
  });
  await sleep(500);

  const toolToCall = detectMockTool(userText);

  if (toolToCall) {
    const toolCallId = `mock_${Date.now()}`;
    const argsJson = JSON.stringify(toolToCall.args);

    sendSSE(res, "tool_call_start", { id: toolCallId, name: toolToCall.name });
    await sleep(200);
    sendSSE(res, "tool_call_delta", {
      id: toolCallId,
      arguments: argsJson.slice(0, -1),
    });
    await sleep(100);
    sendSSE(res, "tool_call_delta", {
      id: toolCallId,
      arguments: argsJson.slice(-1),
    });
    sendSSE(res, "tool_call_end", {
      id: toolCallId,
      name: toolToCall.name,
      arguments: argsJson,
    });

    const [toolResult] = await executeTools([
      { id: toolCallId, name: toolToCall.name, arguments: argsJson },
    ]);

    sendAgentStatus(res, {
      currentRound: 1,
      maxRounds: MAX_AGENT_LOOPS,
      stage: "observing",
      toolName: toolResult.name,
      toolSuccess: toolResult.success,
      toolDuration: toolResult.duration,
    });
    await sleep(300);

    sendSSE(res, "tool_result", {
      id: toolResult.tool_call_id,
      name: toolResult.name,
      result: toolResult.result,
      success: toolResult.success,
      duration: toolResult.duration,
    });

    sendAgentStatus(res, {
      currentRound: 2,
      maxRounds: MAX_AGENT_LOOPS,
      stage: "thinking",
    });
    await sleep(400);

    for (const ch of toolToCall.mockAnswer) {
      sendSSE(res, "text", { content: ch });
      await sleep(30);
    }
  } else {
    const chunks = [
      "你好！这是一个 Mock 模式的回复，因为没有配置 API Key。\n\n",
      "你可以尝试以下问题来测试工具系统：\n",
      "- **北京天气怎么样？** → 触发 get_weather\n",
      "- **计算 123 * 456 + 789** → 触发 calculator\n",
      "- **搜索 React 19 有什么新特性** → 触发 web_search\n",
    ];
    for (const chunk of chunks) {
      sendSSE(res, "text", { content: chunk });
      await sleep(80);
    }
  }

  sendAgentStatus(res, {
    currentRound: toolToCall ? 2 : 1,
    maxRounds: MAX_AGENT_LOOPS,
    stage: "responding",
  });
  sendSSE(res, "done", {});
  res.end();
}

function detectMockTool(text: string): MockTool | null {
  const weatherMatch = text.match(/([\u4e00-\u9fa5]+)(?:的?天气|天气怎么样)/);
  if (weatherMatch) {
    const city = weatherMatch[1];
    return {
      name: "get_weather",
      args: { city },
      mockAnswer: `根据查询结果，${city}当前天气：晴，25°C，湿度40%，西北风3级。适合外出活动！`,
    };
  }

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
      // Invalid expression: answer without a mock tool call.
    }
  }

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
