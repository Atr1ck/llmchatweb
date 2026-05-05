/**
 * Agent 工具系统 — 可扩展的工具注册框架
 * 支持真实 API 调用 + Mock 回退
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
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameters;
};

/** 工具执行函数类型（支持异步） */
export type ToolExecuteFn = (args: Record<string, unknown>) => Promise<ToolResult>;

/** 统一工具执行结果格式 */
export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number; // 毫秒
};

/** LLM 返回的 tool_call 结构 */
export type ToolCall = {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
};

// ─── 通用辅助 ────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== "production";

function devLog(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[tools]", ...args);
}

/** 从 URL 中移除 API key 参数，用于安全日志输出 */
function sanitizeUrl(url: string): string {
  return url.replace(/([?&])(key|apiKey|apikey|token)=[^&]+/g, "$1$2=***");
}

/** 安全解析 JSON 响应，解析失败时返回 null 并打印原始文本 */
async function safeParseJson(res: Response, label: string): Promise<unknown | null> {
  const text = await res.text();
  devLog(`${label}: HTTP ${res.status}, body: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    devLog(`${label}: JSON 解析失败`, parseErr instanceof Error ? parseErr.message : String(parseErr));
    return null;
  }
}

/** 带超时的 fetch 请求 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    devLog(`请求: ${sanitizeUrl(url)} (超时: ${timeoutMs}ms)`);
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── get_weather 工具实现 ────────────────────────────────

const QWEATHER_API_KEY = process.env.QWEATHER_API_KEY;

/** Mock 天气数据（API Key 未配置时使用） */
const mockWeatherData: Record<string, { weather: string; temp: string; humidity: string; wind: string }> = {
  北京: { weather: "晴", temp: "25", humidity: "40", wind: "西北风3级" },
  上海: { weather: "多云", temp: "22", humidity: "65", wind: "东南风2级" },
  广州: { weather: "雷阵雨", temp: "28", humidity: "80", wind: "南风4级" },
  深圳: { weather: "阴", temp: "27", humidity: "75", wind: "南风3级" },
  东京: { weather: "小雨", temp: "18", humidity: "70", wind: "东风2级" },
  纽约: { weather: "晴", temp: "15", humidity: "35", wind: "西风3级" },
};

/**
 * 真实天气查询（和风天气 QWeather API）
 * 步骤：1) 城市查询获取 locationId  2) 天气查询获取实况
 * 
 * DEBUG: 临时绕过 fetchWithTimeout，直接使用原生 fetch + 详细日志
 */
async function executeGetWeatherReal(city: string): Promise<ToolResult> {
  const start = Date.now();

  // ── 第一步：城市查询 ──────────────────────────────────
  devLog("get_weather: 查询城市", city);
  const lookupUrl = `https://kk4d94j9tb.re.qweatherapi.com/geo/v2/city/lookup?location=${encodeURIComponent(city)}`;
  devLog("get_weather: 最终请求 URL =", sanitizeUrl(lookupUrl));

  let lookupRes: Response;
  try {
    lookupRes = await fetchWithTimeout(lookupUrl, {method: 'GET', 
      headers: {'X-QW-Api-Key': QWEATHER_API_KEY} as HeadersInit}
    , 5000);
  } catch (err) {
    const msg = `城市查询网络错误: ${err instanceof Error ? err.message : String(err)}`;
    devLog("get_weather: 城市查询请求失败", msg);
    return { success: false, error: msg, duration: Date.now() - start };
  }

  // DEBUG: 打印响应元信息
  devLog("get_weather: res.url =", lookupRes.url);
  devLog("get_weather: res.status =", lookupRes.status);
  devLog("get_weather: res.headers =", JSON.stringify(Object.fromEntries(lookupRes.headers.entries())));

  // DEBUG: 读取原始文本，不直接 JSON.parse
  const lookupText = await lookupRes.text();
  devLog("get_weather: 原始响应 text =", lookupText.slice(0, 1000));

  // DEBUG: 如果 body 为空
  if (!lookupText || lookupText.trim().length === 0) {
    devLog("get_weather: ⚠️ 响应 body 为空！检查是否被代理/中间件改写或 fetch 被 abort");
    return { success: false, error: `城市查询响应 body 为空 (HTTP ${lookupRes.status})`, duration: Date.now() - start };
  }

  let lookupData: { code?: string; location?: { id: string; name: string; adm1?: string; adm2?: string }[] };
  try {
    lookupData = JSON.parse(lookupText);
  } catch (parseErr) {
    devLog("get_weather: JSON 解析失败", parseErr instanceof Error ? parseErr.message : String(parseErr));
    return { success: false, error: "城市查询响应解析失败（非 JSON）", duration: Date.now() - start };
  }

  if (lookupData.code !== "200" || !lookupData.location?.length) {
    const errMsg = lookupData.code === "401"
      ? "和风天气 API Key 无效或已过期"
      : lookupData.code === "404"
      ? `未找到城市 "${city}"`
      : `城市查询失败（code: ${lookupData.code}）`;
    devLog("get_weather: 城市查询返回错误", lookupData.code, lookupData);
    return { success: false, error: errMsg, duration: Date.now() - start };
  }

  const locationId = lookupData.location[0].id;
  const locationName = lookupData.location[0].name;
  devLog("get_weather: 找到城市", locationName, "ID:", locationId);

  // ── 第二步：天气实况查询 ──────────────────────────────
  const weatherUrl = `https://kk4d94j9tb.re.qweatherapi.com/v7/weather/now?location=${locationId}`;
  devLog("get_weather: 天气查询 URL =", sanitizeUrl(weatherUrl));

  let weatherRes: Response;
  try {
    weatherRes = await fetchWithTimeout(weatherUrl, {method: 'GET', 
      headers: {'X-QW-Api-Key': QWEATHER_API_KEY} as HeadersInit}
    , 5000)
  } catch (err) {
    const msg = `天气查询网络错误: ${err instanceof Error ? err.message : String(err)}`;
    devLog("get_weather: 天气查询请求失败", msg);
    return { success: false, error: msg, duration: Date.now() - start };
  }

  // DEBUG: 打印响应元信息
  devLog("get_weather: weather res.url =", weatherRes.url);
  devLog("get_weather: weather res.status =", weatherRes.status);
  devLog("get_weather: weather res.headers =", JSON.stringify(Object.fromEntries(weatherRes.headers.entries())));

  const weatherText = await weatherRes.text();
  devLog("get_weather: weather 原始响应 text =", weatherText.slice(0, 1000));

  if (!weatherText || weatherText.trim().length === 0) {
    devLog("get_weather: ⚠️ 天气响应 body 为空！");
    return { success: false, error: `天气查询响应 body 为空 (HTTP ${weatherRes.status})`, duration: Date.now() - start };
  }

  let weatherData: { code?: string; now?: { text: string; temp: string; humidity: string; windDir: string; windScale: string } };
  try {
    weatherData = JSON.parse(weatherText);
  } catch (parseErr) {
    devLog("get_weather: 天气 JSON 解析失败", parseErr instanceof Error ? parseErr.message : String(parseErr));
    return { success: false, error: "天气查询响应解析失败（非 JSON）", duration: Date.now() - start };
  }

  if (weatherData.code !== "200" || !weatherData.now) {
    devLog("get_weather: 天气查询返回错误", weatherData.code, weatherData);
    return { success: false, error: `天气查询失败（code: ${weatherData.code}）`, duration: Date.now() - start };
  }

  const now = weatherData.now;
  devLog("get_weather: 查询成功", now);

  return {
    success: true,
    data: {
      city: locationName,
      weather: now.text,
      temp: now.temp,
      humidity: now.humidity,
      wind: `${now.windDir} ${now.windScale}级`,
    },
    duration: Date.now() - start,
  };
}

/** get_weather 工具入口 */
async function executeGetWeather(args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now();
  const city = args.city as string;

  if (!city) {
    return { success: false, error: "缺少必需参数 city", duration: Date.now() - start };
  }

  // 有 API Key 则调用真实接口
  if (QWEATHER_API_KEY) {
    return executeGetWeatherReal(city);
  }

  // Mock 回退
  devLog("get_weather: QWEATHER_API_KEY 未配置，使用 Mock 数据");
  const mock = mockWeatherData[city];
  if (mock) {
    return { success: true, data: { city, ...mock }, duration: Date.now() - start };
  }
  return {
    success: true,
    data: { city, weather: null, message: `暂无天气数据（Mock 仅支持：${Object.keys(mockWeatherData).join("、")}）` },
    duration: Date.now() - start,
  };
}

// ─── web_search 工具实现 ────────────────────────────────

const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

/**
 * 真实新闻搜索（GNews API）
 * 失败时自动 fallback 到 mock 结果
 */
async function executeWebSearchReal(query: string): Promise<ToolResult> {
  const start = Date.now();
  devLog("web_search: 搜索", query);

  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=zh&max=3&apikey=${GNEWS_API_KEY}`;
  devLog("web_search: 请求 URL =", sanitizeUrl(url));

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {}, 10000);
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? "搜索请求超时（10s）"
      : `搜索网络错误: ${err instanceof Error ? err.message : String(err)}`;
    devLog("web_search: 请求失败，fallback 到 mock", msg);
    return executeWebSearchMock(query, start);
  }

  devLog("web_search: HTTP status =", res.status);

  // 读取原始响应文本
  const text = await res.text();
  devLog("web_search: 原始响应（前200字符）=", text.slice(0, 200));

  // 非 200 或空 body → fallback
  if (res.status !== 200 || !text || text.trim().length === 0) {
    devLog("web_search: HTTP 非 200 或 body 为空，fallback 到 mock");
    return executeWebSearchMock(query, start);
  }

  // JSON 解析
  let data: {
    totalArticles?: number;
    articles?: {
      title: string;
      url: string;
      publishedAt: string;
      source?: { name: string };
    }[];
  };
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    devLog("web_search: JSON 解析失败，fallback 到 mock", parseErr instanceof Error ? parseErr.message : String(parseErr));
    return executeWebSearchMock(query, start);
  }

  if (!data.articles || data.articles.length === 0) {
    devLog("web_search: 无搜索结果，fallback 到 mock");
    return executeWebSearchMock(query, start);
  }

  const results = data.articles.map((a) => ({
    title: a.title,
    url: a.url,
    source: a.source?.name || "",
    publishedAt: a.publishedAt || "",
  }));

  devLog("web_search: 搜索成功，共", data.totalArticles ?? results.length, "条，返回", results.length, "条");

  return {
    success: true,
    data: { query, totalResults: data.totalArticles ?? results.length, results },
    duration: Date.now() - start,
  };
}

/** Mock 搜索结果（GNews 失败或未配置时使用） */
function executeWebSearchMock(query: string, start: number): ToolResult {
  devLog("web_search: 使用 Mock 数据");
  const results = [
    { title: `（模拟）${query}相关新闻1`, url: "#", source: "模拟新闻源", publishedAt: "" },
    { title: `（模拟）${query}相关新闻2`, url: "#", source: "模拟新闻源", publishedAt: "" },
  ];
  return { success: true, data: { query, totalResults: 2, results }, duration: Date.now() - start };
}

/** web_search 工具入口 */
async function executeWebSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now();
  const query = args.query as string;

  if (!query) {
    return { success: false, error: "缺少必需参数 query", duration: Date.now() - start };
  }

  // 有 API Key 则尝试调用真实接口（失败自动 fallback）
  if (GNEWS_API_KEY) {
    return executeWebSearchReal(query);
  }

  // 无 Key 直接 mock
  devLog("web_search: GNEWS_API_KEY 未配置，使用 Mock 数据");
  return executeWebSearchMock(query, start);
}

// ─── calculator 工具实现 ────────────────────────────────

async function executeCalculator(args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now();
  const expression = args.expression as string;

  if (!expression) {
    return { success: false, error: "缺少必需参数 expression", duration: Date.now() - start };
  }

  // 安全性检查：只允许数字、运算符、小数点和空格
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    return { success: false, error: "表达式包含非法字符，只允许数字和运算符 + - * / ( )", duration: Date.now() - start };
  }

  try {
    const result = new Function(`return (${expression})`)();
    if (!Number.isFinite(result)) {
      return { success: false, error: "计算结果无效（除以零或其他数学错误）", duration: Date.now() - start };
    }
    return {
      success: true,
      data: { expression, result, type: Number.isInteger(result) ? "integer" : "float" },
      duration: Date.now() - start,
    };
  } catch (err) {
    return { success: false, error: `计算错误: ${err instanceof Error ? err.message : String(err)}`, duration: Date.now() - start };
  }
}

// ─── 工具注册表 ──────────────────────────────────────────

/** 已注册的工具定义 */
const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_weather",
    description: "查询指定城市的当前天气信息。适用于：旅行规划、穿衣建议、户外活动安排等。支持国内和国际主要城市。",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，如：北京、上海、东京、纽约",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "web_search",
    description: "在互联网上搜索新闻和资讯。适用于：查找新闻、获取最新资讯、了解未知概念等。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，尽量精确以获得更准确的结果",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculator",
    description: "执行基础数学计算。适用于：算术运算、百分比计算、单位换算等。支持：加(+)、减(-)、乘(*)、除(/)、括号。",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "数学表达式，如：2 + 3 * 4、(100 - 20) / 4、15 * 0.15",
        },
      },
      required: ["expression"],
    },
  },
];

/** 工具名 → 执行函数的映射 */
const toolExecutors: Record<string, ToolExecuteFn> = {
  get_weather: executeGetWeather,
  web_search: executeWebSearch,
  calculator: executeCalculator,
};

// ─── 工具调度 ────────────────────────────────────────────

/**
 * 获取所有已注册工具的定义
 */
export function getToolDefinitions(): ToolDefinition[] {
  return toolDefinitions;
}

/**
 * 将工具定义转换为 OpenAI/DeepSeek API 所需的 tools 格式
 */
export function getToolsPayload(): {
  type: "function";
  function: { name: string; description: string; parameters: ToolParameters };
}[] {
  return toolDefinitions.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * 检查工具是否存在
 */
export function hasTool(name: string): boolean {
  return name in toolExecutors;
}

/**
 * 执行工具调用
 */
export async function executeTool(name: string, argsJson: string): Promise<{
  result: string;
  success: boolean;
  duration: number;
}> {
  const start = Date.now();

  // 检查工具是否存在
  const executor = toolExecutors[name];
  if (!executor) {
    return {
      success: false,
      result: `错误：未知工具 "${name}"，可用工具：${Object.keys(toolExecutors).join("、")}`,
      duration: Date.now() - start,
    };
  }

  // 解析参数
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return {
      success: false,
      result: `错误：工具 "${name}" 的参数 JSON 解析失败：${argsJson}`,
      duration: Date.now() - start,
    };
  }

  // 执行工具
  try {
    const result = await executor(args);
    if (result.success) {
      return {
        success: true,
        result: JSON.stringify(result.data),
        duration: result.duration,
      };
    } else {
      return {
        success: false,
        result: result.error || "未知错误",
        duration: result.duration,
      };
    }
  } catch (err) {
    return {
      success: false,
      result: `错误：工具 "${name}" 执行失败：${err instanceof Error ? err.message : String(err)}`,
      duration: Date.now() - start,
    };
  }
}

/**
 * 批量执行工具调用
 */
export async function executeTools(toolCalls: ToolCall[]): Promise<{
  tool_call_id: string;
  name: string;
  result: string;
  success: boolean;
  duration: number;
}[]> {
  const results = [];
  for (const tc of toolCalls) {
    const execResult = await executeTool(tc.name, tc.arguments);
    results.push({
      tool_call_id: tc.id,
      name: tc.name,
      result: execResult.result,
      success: execResult.success,
      duration: execResult.duration,
    });
  }
  return results;
}
