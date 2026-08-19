import type { ImageOperation } from "../workflow/types";

type DrawGenerationInput = {
  prompt: string;
  negativePrompt?: string;
  operation: ImageOperation;
  sourceImages: string[];
  resultCount: number;
  aspectRatio?: string;
};

type DrawGenerationResult = {
  taskId: string;
  model: "gpt-image-2";
  urls: string[];
};

type DrawTaskResponse = {
  taskId: string;
  model: "gpt-image-2";
  status: string;
  progress?: number;
  urls?: string[];
  error?: string;
};

const TASK_POLL_INTERVAL_MS = 1_500;
const TASK_POLL_TIMEOUT_MS = 10 * 60_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponse(response: Response): Promise<DrawTaskResponse> {
  const body = await response.json() as DrawTaskResponse;
  if (!response.ok) throw new Error(body.error || "图片生成请求失败");
  return body;
}

async function waitForResult(task: DrawTaskResponse): Promise<DrawGenerationResult> {
  let current = task;
  const deadline = Date.now() + TASK_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (current.status === "completed") {
      if (!current.urls?.length) throw new Error("图片服务已完成，但未返回图片地址");
      return { taskId: current.taskId, model: current.model, urls: current.urls };
    }
    await wait(TASK_POLL_INTERVAL_MS);
    const response = await fetch(`/api/images/tasks/${encodeURIComponent(current.taskId)}`);
    current = await readResponse(response);
  }
  throw new Error("图片生成仍在处理中，请稍后查看该节点");
}

export async function generateImage(input: DrawGenerationInput): Promise<DrawGenerationResult> {
  const response = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
  });
  return waitForResult(await readResponse(response));
}
