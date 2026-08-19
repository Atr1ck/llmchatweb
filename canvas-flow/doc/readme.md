Canvas Flow

一个以图片创作为核心的 AI 画布与对话应用，支持流式输出、视觉参考图、多项目管理和图片生成。

该项目用于生成一个现代化 AI 图片画布前端 + Node 后端应用，适合：

Canvas Flow 应用开发

LLM Web UI

ChatGPT Clone

AI SaaS 原型

技术栈
前端

React

TypeScript

Vite

TailwindCSS

Zustand（状态管理）

UI增强

react-markdown

remark-gfm

rehype-highlight

highlight.js

lucide-react

后端

Node.js

Express

LLM API

支持接入：

OpenAI API

DeepSeek API

通过 环境变量配置 API Key

项目目标

实现一个 ChatGPT 风格 AI 聊天界面，包含以下功能：

左侧区域：

会话列表

新建会话

切换历史会话

删除会话

右侧区域：

聊天消息区域

Markdown 渲染

代码高亮

代码复制按钮

自动滚动

输入框

发送按钮

支持：

流式输出

多轮对话

会话管理

消息编辑

重新生成回答

项目目录结构
canvas-flow
│
├─ server
│  ├─ index.ts
│  ├─ routes
│  │   └─ chat.ts
│  └─ services
│      └─ llm.ts
│
├─ web
│  ├─ src
│  │  ├─ components
│  │  │  ├─ ChatWindow.tsx
│  │  │  ├─ MessageItem.tsx
│  │  │  ├─ InputBox.tsx
│  │  │  ├─ Sidebar.tsx
│  │  │  └─ CodeBlock.tsx
│  │  │
│  │  ├─ hooks
│  │  │  └─ useChat.ts
│  │  │
│  │  ├─ store
│  │  │  └─ chatStore.ts
│  │  │
│  │  ├─ services
│  │  │  └─ api.ts
│  │  │
│  │  ├─ pages
│  │  │  └─ ChatPage.tsx
│  │  │
│  │  ├─ App.tsx
│  │  ├─ main.tsx
│  │  └─ index.css
│
└─ package.json
消息数据结构
type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}
Chat UI 布局

页面布局参考 ChatGPT：

--------------------------------
| Sidebar |      Chat          |
|         |                    |
| 会话列表 |   消息列表         |
| 新建对话 |                    |
|         |                    |
|         |                    |
|         |     输入框         |
--------------------------------
Markdown 渲染

AI 消息支持：

Markdown

代码块

表格

列表

使用库：

react-markdown
remark-gfm
rehype-highlight
代码高亮

使用：

highlight.js
代码块复制按钮

代码块右上角需要提供：

Copy

点击后复制代码内容。

自动滚动

当新消息出现时自动滚动到底部：

scrollToBottom()
输入框行为

输入框需要支持：

Enter 发送
Shift + Enter 换行
Loading 状态

AI 回复时：

显示 Thinking...

输入框 disabled

流式输出（核心功能）

必须实现 LLM 流式返回。

前端使用：

fetch
ReadableStream
TextDecoder

示例逻辑：

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()

  if (done) break

  const chunk = decoder.decode(value)

  appendAssistantMessage(chunk)
}

实现 逐字生成效果。

useChat Hook

封装聊天逻辑：

messages
loading
sendMessage()
regenerate()
editMessage()

负责：

调用 API

处理流式返回

更新消息状态

状态管理（Zustand）

store 文件：

chatStore.ts

管理：

messages
sessions
currentSessionId
addMessage()
createSession()
switchSession()
deleteSession()
后端 API

使用 Express。

接口：

POST /api/chat

请求结构：

{
  "messages": []
}
LLM 调用

后端调用：

https://api.openai.com/v1/chat/completions

支持：

stream: true

如果没有 API Key，需要 模拟流式返回：

例如：

Hello
Hello, how
Hello, how can
Hello, how can I help

实现方式：

res.write()
UI 设计规范

用户消息：

右侧

蓝色气泡

AI消息：

左侧

灰色气泡

额外增强功能

建议实现：

1 自动滚动到底部
2 代码复制按钮
3 多会话
4 删除会话
5 重新生成回答
6 编辑用户消息
7 深色模式（Tailwind Dark Mode）

代码要求

项目代码必须：

使用 TypeScript

组件拆分清晰

Hooks 逻辑独立

代码结构合理

可以直接运行

无明显 bug

输出要求（用于 AI 代码生成）

生成代码时请按顺序输出：

项目完整目录结构

每个文件完整代码

安装依赖命令

启动命令

目标效果

最终 UI 接近：

ChatGPT Web 界面：

左侧会话管理

右侧聊天窗口

Markdown 渲染

代码高亮

AI 流式生成
