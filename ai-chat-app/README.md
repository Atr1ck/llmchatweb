## 项目目录结构

ai-chat-app
├─ server
│  ├─ index.ts
│  ├─ tsconfig.json
│  ├─ routes
│  │   └─ chat.ts
│  └─ services
│      └─ llm.ts
│
├─ web
│  ├─ index.html
│  ├─ vite.config.ts
│  ├─ tsconfig.json
│  ├─ tailwind.config.cjs
│  ├─ postcss.config.cjs
│  └─ src
│      ├─ index.css
│      ├─ main.tsx
│      ├─ pages
│      │   └─ ChatPage.tsx
│      ├─ components
│      │   ├─ ChatWindow.tsx
│      │   ├─ MessageItem.tsx
│      │   ├─ InputBox.tsx
│      │   ├─ Sidebar.tsx
│      │   └─ CodeBlock.tsx
│      ├─ hooks
│      │   └─ useChat.ts
│      ├─ store
│      │   └─ chatStore.ts
│      └─ services
│          └─ api.ts
│
└─ package.json

## 安装依赖

```bash
cd ai-chat-app
npm install
cd web
npm install
```

## 启动命令

### 启动后端

```bash
cd ai-chat-app
npm run server
```

### 启动前端（开发模式）

```bash
cd ai-chat-app/web
npm run dev
```

### 同时启动前后端（在 ai-chat-app 根目录）

```bash
cd ai-chat-app
npm run dev
```

## 环境变量

在 `ai-chat-app` 根目录下创建 `.env` 文件，可配置：

```bash
OPENAI_API_KEY=your_openai_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
LLM_MODEL=gpt-4.1-mini
PORT=3001
```

未配置任意 API Key 时，后端会使用 `mockStream` 模拟流式返回，方便本地开发体验。

