第 1 步：读取 readme.md 并分析项目需求与目录结构，确定要实现的技术栈（React+TS+Vite+Tailwind、Zustand、Node+Express+LLM 流式接口）和功能列表。
第 2 步：在工作目录下创建 ai-chat-app 根目录的 package.json，配置前端/后端开发脚本（server、web:dev、dev）以及 TypeScript/ts-node-dev 等基础依赖。
第 3 步：为根 package.json 补充 Express、CORS、dotenv 及对应类型依赖，准备后端运行环境。
第 4 步：在 server 目录新增 tsconfig.json，统一服务端 TypeScript 编译配置。
第 5 步：实现 server/index.ts，配置 Express 应用、CORS、JSON 解析、中间件挂载 /api/chat 路由及 /health 健康检查。
第 6 步：在 server/routes/chat.ts 定义 POST /api/chat 接口，接收 messages 数组并调用 LLM 服务，使用 Transfer-Encoding: chunked 输出流式文本。
第 7 步：在 server/services/llm.ts 封装 streamLLMResponse，支持 OpenAI/DeepSeek（通过环境变量选择），未配置 API Key 时走 mockStream 逐段写入模拟流式回复。
第 8 步：在 web 目录初始化前端 package.json，加入 React、Vite、TypeScript、TailwindCSS、Zustand、react-markdown、remark-gfm、rehype-highlight、highlight.js、lucide-react 等依赖。
第 9 步：配置 web/vite.config.ts，启用 React 插件并通过 dev server 代理 /api 到本地 Node 服务。
第 10 步：新增 web/tsconfig.json、tailwind.config.cjs、postcss.config.cjs、index.html 及 src/index.css，启用 Tailwind 并设置全局样式与暗色模式基础。
第 11 步：实现前端状态管理 src/store/chatStore.ts，使用 Zustand 管理 sessions、messages、currentSessionId 以及多会话相关操作。
第 12 步：实现 src/services/api.ts 的 streamChat 方法，封装 fetch + ReadableStream + TextDecoder 的流式读取逻辑。
第 13 步：实现 useChat Hook（src/hooks/useChat.ts），封装 messages、loading、sendMessage、regenerate、editMessage 等聊天逻辑并对接 store 与流式 API。
第 14 步：实现 UI 组件 CodeBlock、MessageItem、InputBox、Sidebar、ChatWindow，完成 Markdown 渲染、代码高亮、代码复制按钮、会话列表、输入框行为等。
第 15 步：实现 ChatPage 页面布局，组合 Sidebar + ChatWindow + InputBox，并加入暗色模式切换、用户消息编辑条等 UI 细节。
第 16 步：在 ai-chat-app/README.md 中整理项目目录结构、安装依赖命令、启动命令及环境变量说明，便于直接运行与二次开发。
第 17 步：为 server/services/llm.ts 中的外部 LLM 请求增加 try/catch，若 fetch 或网络/鉴权失败则记录错误并自动回退到 mockStream 流式输出，避免前端出现 500 错误。
第 18 步：修正根 package.json 的 server 启动脚本，增加 --project server/tsconfig.json 参数，使 ts-node-dev 使用 server 下的 tsconfig（避免 TS5109 模块解析报错），确保后端能正常编译启动。
第 19 步：修正 useChat Hook 中流式回调的累加逻辑，改为在 sendMessage/regenerate 中使用本地 buffer 逐块追加 chunk 并调用 updateLastAssistantMessage，避免因闭包持有旧 messages 导致只显示最后一块内容，保证前端真正实现逐字流式输出效果。
第 20 步：调整 server/services/llm.ts 中对 OpenAI/DeepSeek SSE 流的处理逻辑，逐行解析以 data: 开头的 JSON，提取 choices[0].delta.content 并只把纯文本内容写回前端，避免前端看到整段 SSE JSON，而是正常的逐字回答。
