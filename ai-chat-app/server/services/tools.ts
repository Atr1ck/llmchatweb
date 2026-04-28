/**
 * Agent 工具系统 — 类型定义与调度执行
 */

// ─── 类型定义 ────────────────────────────────────────────

/** JSON Schema 字段描述 */
export type ToolParameterProperty = {
  type: string;
  description?: string;
  enum?: string[];
};

/** JSON Schema 格式的工具参数定义 */
export type ToolParameters = {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
};

/** 工具定义 */
export type Tool = {
  name: string;
  description: string;
  parameters: ToolParameters;
};

/** LLM 返回的 tool_call 结构 */
export type ToolCall = {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
};

/** 工具执行结果 */
export type ToolResult = {
  tool_call_id: string;
  name: string;
  result: string;
};

// ─── 工具注册表 ──────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "get_weather",
    description: "查询指定城市的当前天气信息",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，如：北京、上海、东京",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "web_search",
    description: "在互联网上搜索信息",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
      },
      required: ["query"],
    },
  },
];

// ─── 工具实现 ────────────────────────────────────────────

const mockWeatherData: Record<string, string> = {
  北京: "晴，25°C，湿度 40%，西北风 3 级",
  上海: "多云，22°C，湿度 65%，东南风 2 级",
  广州: "雷阵雨，28°C，湿度 80%，南风 4 级",
  深圳: "阴，27°C，湿度 75%，南风 3 级",
  东京: "小雨，18°C，湿度 70%，东风 2 级",
  纽约: "晴，15°C，湿度 35%，西风 3 级",
};

function getWeather(args: { city: string }): string {
  const { city } = args;
  const weather = mockWeatherData[city];
  if (weather) {
    return `${city}当前天气：${weather}`;
  }
  return `${city}：暂无天气数据（mock 工具仅支持：${Object.keys(mockWeatherData).join("、")}）`;
}

function webSearch(args: { query: string }): string {
  const { query } = args;
  return (
    `搜索 "${query}" 的结果（mock）：\n` +
    `1. ${query} - 相关信息概述，来源：示例百科\n` +
    `2. 关于${query}的最新动态，来源：示例新闻\n` +
    `3. ${query}使用指南，来源：示例文档`
  );
}

// ─── 工具调度 ────────────────────────────────────────────

/** 工具名 → 实现函数的映射 */
const toolImplementations: Record<
  string,
  (args: Record<string, unknown>) => string
> = {
  get_weather: (args) => getWeather(args as { city: string }),
  web_search: (args) => webSearch(args as { query: string }),
};

/**
 * 获取所有已注册工具的定义（用于传给 LLM API 的 tools 参数）
 */
export function getToolDefinitions(): Tool[] {
  return tools;
}

/**
 * 将工具定义转换为 OpenAI/DeepSeek API 所需的 tools 格式
 */
export function getToolsPayload(): {
  type: "function";
  function: { name: string; description: string; parameters: ToolParameters };
}[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * 执行工具调用
 * @param name 工具名称
 * @param argsJson 工具参数的 JSON 字符串
 * @returns 执行结果字符串
 */
export function executeTool(name: string, argsJson: string): string {
  const impl = toolImplementations[name];
  if (!impl) {
    return `错误：未知工具 "${name}"`;
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `错误：工具 "${name}" 的参数 JSON 解析失败：${argsJson}`;
  }

  try {
    return impl(args);
  } catch (err) {
    return `错误：工具 "${name}" 执行失败：${err instanceof Error ? err.message : String(err)}`;
  }
}
