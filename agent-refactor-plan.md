# 项目改造为 Agent 系统规划

## 一、当前系统 vs Agent 系统的本质差异

| 维度 | 当前（Chat） | Agent |
|------|-------------|-------|
| 交互模式 | 单轮请求-响应，LLM 只生成文本 | LLM 可调用工具，多轮循环直到得出最终答案 |
| 消息角色 | `user` / `assistant` | 增加 `system`、`tool` |
| 消息内容 | 纯字符串 | 支持 `tool_calls`（结构化函数调用）、`tool_call_id` |
| 流式内容 | 仅 `delta.content`（文本） | 增加 `delta.tool_calls`（函数名+参数增量） |
| 执行流程 | 一发一收 | LLM → tool_call → 执行工具 → 结果回传 LLM → 循环 |
| 前端展示 | 纯文本气泡 | 需展示工具调用过程（调用中/参数/结果/耗时） |
| 后端协议 | `text/plain` chunked | 需结构化事件流（区分文本/工具调用/工具结果/完成） |

## 二、改造分层规划

### 第1层：后端 — 工具注册与执行框架

**新增文件**：`server/services/tools.ts`

- 定义 `Tool` 类型（name、description、parameters JSON Schema）
- 实现 `executeTool(name, args)` 调度器，根据名称路由到具体实现
- 内置几个示范工具供验证，例如：
  - `get_weather`：模拟天气查询
  - `web_search`：模拟网页搜索
  - `run_code`：代码执行沙箱（可选，安全风险需评估）
- 工具执行结果统一返回为字符串（LLM 可理解）

**改动文件**：`server/services/llm.ts`

- `streamLLMResponse` 接收 `tools` 参数，传入 LLM API 的 `tools` 字段
- SSE 解析中新增对 `delta.tool_calls` 的处理（函数名增量、参数增量）
- 解析 `finish_reason`：
  - `"stop"` → 正常结束
  - `"tool_calls"` → 提取完整 tool_calls → 执行工具 → 将 assistant 消息（含 tool_calls）和 tool 角色消息加入上下文 → **循环再次调用 LLM**

### 第2层：后端 — 流式协议升级

**问题**：当前 `text/plain` chunked 无法区分文本内容和工具调用事件。

**方案**：将响应改为 **SSE 格式**（`Content-Type: text/event-stream`），定义事件类型：

```
event: text
data: {"content": "你好"}

event: tool_call_start
data: {"id": "call_xxx", "name": "get_weather", "arguments": ""}

event: tool_call_delta
data: {"id": "call_xxx", "arguments": "{\"city\":"}

event: tool_call_end
data: {"id": "call_xxx", "name": "get_weather", "arguments": "{\"city\":\"北京\"}"}

event: tool_result
data: {"id": "call_xxx", "name": "get_weather", "result": "北京：晴，25°C"}

event: done
data: {}
```

**改动文件**：`server/routes/chat.ts`

- Content-Type 改为 `text/event-stream`
- 调用 `streamLLMResponse` 时传入 `res`，由服务层按事件类型写入 SSE 格式

**改动文件**：`server/services/llm.ts`

- `res.write(content)` → `res.write(`event: text\ndata: ${JSON.stringify({content})}\n\n`)`
- 工具调用开始/增量/结束分别写入对应事件
- 工具执行结果写入 `tool_result` 事件
- 循环结束时写入 `done` 事件

### 第3层：前端 — API 层改造

**改动文件**：`web/src/services/api.ts`

- `streamChat` 返回值改为结构化事件回调：
  ```typescript
  streamChat(messages, {
    onText: (content: string) => void,
    onToolCallStart: (call: { id: string; name: string }) => void,
    onToolCallDelta: (call: { id: string; arguments: string }) => void,
    onToolCallEnd: (call: { id: string; name: string; arguments: string }) => void,
    onToolResult: (result: { id: string; name: string; result: string }) => void,
    onDone: () => void,
  }, options?)
  ```
- 解析 SSE 事件流（`EventSource` 不支持 POST，需用 `fetch` + 手动解析 SSE 文本）

### 第4层：前端 — 类型与状态扩展

**改动文件**：`web/src/store/chatStore.ts`

- `Message.role` 扩展为 `"user" | "assistant" | "system" | "tool"`
- `Message` 新增可选字段：
  ```typescript
  tool_calls?: { id: string; name: string; arguments: string }[];
  tool_call_id?: string;  // tool 角色消息专用
  name?: string;          // tool 角色消息：工具名称
  ```
- Store 新增方法：
  - `updateAssistantToolCalls(sessionId, toolCalls)` — 流式更新工具调用状态
  - `addToolResultMessage(sessionId, toolCallId, name, result)` — 添加工具执行结果

### 第5层：前端 — UI 展示工具调用过程

**新增组件**：`web/src/components/ToolCallItem.tsx`

- 展示工具调用卡片：
  - 调用中：显示工具名 + 旋转 loading 图标
  - 已完成：折叠/展开显示参数和结果
  - 调用失败：红色错误提示

**改动文件**：`web/src/components/MessageItem.tsx`

- assistant 消息中，`tool_calls` 部分渲染为 `ToolCallItem` 列表
- `content` 部分仍用 ReactMarkdown 渲染

**改动文件**：`web/src/components/ChatWindow.tsx`

- tool 角色消息可以隐藏或折叠展示（对用户来说，工具结果是中间过程）

### 第6层：前端 — Hook 适配 Agent 循环

**改动文件**：`web/src/hooks/useChat.ts`

- `sendMessage` 改为监听多种事件回调：
  - `onText` → 追加到 assistant 消息的 content（同当前逻辑）
  - `onToolCallStart` → 在 assistant 消息的 tool_calls 中添加一条，状态为 "running"
  - `onToolCallDelta` → 更新对应 tool_call 的 arguments
  - `onToolCallEnd` → 标记该 tool_call 状态为 "complete"
  - `onToolResult` → 在消息列表中追加一条 tool 角色消息
  - `onDone` → 结束 loading，调用 `persist()`

## 三、改造优先级与依赖关系

```
第1层 工具框架 ──┐
                  ├──▶ 第2层 流式协议 ──▶ 第3层 前端 API ──▶ 第4层 类型/状态 ──▶ 第5层 UI ──▶ 第6层 Hook
                  │
                (可并行)
```

**建议实施顺序**：
1. **先做第1层+第2层**（后端）：定义工具、实现循环、升级协议。可用 curl 直接验证 SSE 事件流。
2. **再做第4层**（类型）：扩展 Message 类型，这是前端一切改动的基础。
3. **然后第3层+第6层**（前端逻辑）：API 解析 + Hook 适配。
4. **最后第5层**（UI）：工具调用可视化。

## 四、涉及文件汇总

| 操作 | 文件 |
|------|------|
| **新增** | `server/services/tools.ts` — 工具定义与执行 |
| **新增** | `web/src/components/ToolCallItem.tsx` — 工具调用 UI 卡片 |
| **重写** | `server/services/llm.ts` — Agent 循环 + SSE 事件输出 + tool_calls 解析 |
| **修改** | `server/routes/chat.ts` — Content-Type 改为 SSE |
| **修改** | `web/src/services/api.ts` — SSE 解析 + 结构化事件回调 |
| **修改** | `web/src/store/chatStore.ts` — 类型扩展 + 新增 store 方法 |
| **修改** | `web/src/hooks/useChat.ts` — 适配 Agent 多事件流 |
| **修改** | `web/src/components/MessageItem.tsx` — 渲染 tool_calls |
| **修改** | `web/src/components/ChatWindow.tsx` — tool 消息展示策略 |

## 五、风险与注意事项

1. **DeepSeek 的 tool_calls 兼容性**：DeepSeek API 支持 function calling，但格式可能与 OpenAI 有细微差异（如 `tool_calls` 的 delta 结构），需实测验证。
2. **SSE 解析可靠性**：前端用 `fetch` + 手动解析 SSE 比用 `EventSource` 复杂，需处理事件边界（类似后端之前的问题）。
3. **工具执行安全**：`run_code` 等工具存在安全风险，需要沙箱隔离；生产环境应限制可调用工具白名单。
4. **Agent 循环超时**：工具调用可能触发多轮循环，需设置最大迭代次数（如 10 轮）和总超时时间，避免无限循环。
5. **流式中断**：Agent 循环中用户点"停止"需要能中断当前 LLM 请求和正在执行的工具。
6. **向后兼容**：如果暂时不启用工具，系统应仍能作为纯 Chat 使用（`tools` 参数为空时走原有逻辑）。
