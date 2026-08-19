# 图片创作 Agent 实施方案

## 已确定的产品边界

Agent 的核心身份是图片创作助手，不再承担天气、计算、网页搜索和工作区文件读取等通用任务。唯一的外部副作用工具是 `image_operation`，负责向前端画布提交结构化图片创作意图。

模型的私有逐字思维链不直接展示。产品展示的是可审计的创作过程：检索了哪些 Skill、使用了哪些项目记忆、形成了什么 Creative Brief、调用了什么图片操作以及执行结果。

## Runtime 链路

```text
用户意图
  + 当前画布结构化状态
  + 项目 Style Bible
  + 已确认项目记忆
       ↓
Skill/RAG Context Composer
       ↓
Creative Brief
       ↓
image_operation（每次请求最多一次）
       ↓
前端生成任务队列
       ↓
用户保留/重做/标记候选
       ↓
候选结果写入项目记忆
```

## Skill Registry

首批 Skill：

- 光影强化
- 电影感色彩
- 镜头辅助
- 构图优化
- 景深与主体突出
- 材质与细节增强
- 人像优化
- 多图融合一致性

每个 Skill 使用版本化定义，包含适用场景、触发词、正向提示词策略、负向约束、参数建议和冲突关系。用户可以手动固定 Skill；不固定时由 Agent 根据用户意图、画布素材和 Style Bible 自动检索。

## RAG 与记忆

当前实现采用轻量混合检索：

1. 关键词/标签匹配 Skill。
2. 读取项目 Style Bible。
3. 从已确认的项目记忆中匹配历史风格和结果。
4. 将结果组合成上下文，并在 SSE 中发送 `creative_context`。

记忆分为全局 Skill、项目风格和用户偏好三层。当前图片元数据、prompt、父子关系和候选状态保存在浏览器 IndexedDB；未来可以将 Retriever 接口接到向量数据库或多模态 Embedding 服务。

## 图片操作契约

`image_operation` 参数包括：

```text
operation       generate | variation | merge
sourceAssetIds  当前画布中的素材 ID
prompt          正向创作提示词
negativePrompt  需要避免的视觉元素
aspectRatio     1:1 | 4:5 | 16:9 | 9:16
resultCount     1 到 4
skillIds        本次采用的 Skill
```

服务端只校验和接受意图，不直接访问客户端图片资产。前端根据 `operationId`、来源资产和 Brief 创建画布任务。

## 后续扩展

- 增加真正的文本 Embedding/关键词混合检索和 rerank。
- 增加图像 Embedding，用于按视觉相似度检索项目资产。
- 增加视觉模型结果评价，但默认由用户决定是否重做，避免 Agent 无限自我优化。
- 增加服务端用户级会话与持久化记忆。
- 增加更多图片模型和模型路由策略。
