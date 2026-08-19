# Canvas Flow

一个以图片创作为核心的 AI 画布应用。用户可以在无限画布中导入图片、选择参考素材，并通过 Agent 生成新图、制作单图变体或融合多张图片。

## Agent 能力

- 仅保留图片创作工具 `image_operation`，避免通用工具干扰创作流程。
- 以 SSE 推送 Agent 状态、Skill 检索、Creative Brief、工具调用、工具结果和完成事件。
- 支持 8 轮 Agent 上限，但单次请求最多执行一个图片操作。
- 支持光影强化、电影感色彩、镜头辅助、构图优化、景深突出、材质细节、人像优化和多图一致性等预设 Skill。
- 支持项目级 Style Bible、候选图片记忆和基于文本/元数据的轻量 RAG 检索。
- 前端展示创作依据和执行轨迹，不展示模型私有逐字思维链。
- 客户端断开连接后，服务端会取消当前 LLM 请求和工具执行。

## 目录

```text
server/
├─ routes/chat.ts                 # Agent SSE 接口
├─ routes/images.ts               # 图片任务接口
└─ services/
   ├─ tools.ts                    # image_operation 注册与校验
   └─ agent/
      ├─ runner.ts                # Agent 循环与执行轨迹
      ├─ skills.ts                # Skill Registry 与检索
      ├─ context.ts               # RAG/Style Bible 上下文组合
      ├─ prompt.ts                # 图片 Agent 规则
      ├─ llmStream.ts             # LLM tool call 流解析
      ├─ mock.ts                  # 无 LLM Key 时的图片 Agent Mock
      ├─ sse.ts                   # SSE 事件封装
      └─ types.ts                 # Agent 契约

web/src/
├─ pages/ImageWorkspacePage.tsx   # 图片画布与 Agent 对话
├─ components/CreativeBriefCard.tsx
├─ components/StyleBiblePanel.tsx
├─ creativeSkills.ts              # 前端 Skill 选择器
├─ workflow/                      # 画布、资产、任务和项目记忆
└─ services/api.ts                # SSE 客户端解析
```

项目记录、需求说明和缺陷文档统一放在 `doc/` 目录。

核心性能方案：[canvas-performance-design.md](doc/canvas-performance-design.md)

面试深挖准备：[updream-interview-grilling.md](doc/updream-interview-grilling.md)

## 当前工程质量能力

- 工作流 DAG：加边时校验缺失节点、自环、重复边和环路；`dagExecutor.ts` 提供拓扑调度、并发限制、重试、分支级失败传播和取消语义。
- 画布性能：Spatial Worker 崩溃时自动降级到主线程 R-tree，再降级到全量扫描；开发环境显示查询 P95/Max、Worker 降级和 Long Task 计数。
- 故障演练：覆盖 Worker 崩溃、流式任务乱序/迟到事件、DAG 重试/失败/取消。
- 工程门禁：类型检查、Vitest 单测、生产构建、10,000 节点画布 benchmark 和 GitHub Actions CI。

本地验证：

```bash
npm run check
```

## 安装与启动

```bash
cd canvas-flow
npm install
cd web
npm install
cd ..
npm run dev
```

前端默认运行在 Vite 地址，后端运行在 `http://localhost:3001`。

## 环境变量

在 `canvas-flow/.env` 中配置：

```bash
OPENAI_API_KEY=your_openai_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
LLM_MODEL=gpt-4.1-mini
DRAW_API_KEY=your_image_provider_key
PORT=3001
```

未配置 LLM Key 时会使用图片创作 Mock。也可以显式设置：

```bash
AGENT_MOCK=true
```

生产环境不会在 LLM 请求失败时伪造 Mock 结果，而是通过 SSE error 事件返回真实失败状态。

## 主要 SSE 事件

```text
run_start
agent_status
creative_context
creative_brief
tool_call_start
tool_call_delta
tool_call_end
tool_result
text
agent_warning
done
```

项目记忆目前保存在浏览器 IndexedDB 中。后续接入服务端时，可将 `CreativeAgentContext` 对接 PostgreSQL/pgvector 或其他向量存储，而不需要改变 Agent Runtime 的接口。
