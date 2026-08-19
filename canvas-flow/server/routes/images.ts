import { Router } from "express";
import type { Request, Response } from "express";
import { materializeImageUrls } from "../services/imageUrl";

const DRAW_API_KEY = process.env.DRAW_API_KEY;
const DRAW_GENERATIONS_URL = "https://www.rightapi.ai/draw/v1/images/generations";
const DRAW_TASK_URL = "https://www.rightapi.ai/v1/tasks";
const DRAW_MODEL = "gpt-image-2";

type DrawTask = {
  task_id?: string;
  status?: string;
  progress?: number;
  data?: Array<{ url?: string; b64_json?: string }>;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string } | string;
};

type TaskEnvelope = DrawTask & {
  data?: DrawTask | DrawTask["data"];
  result?: DrawTask;
};

type ImageGenerationRequest = {
  prompt?: unknown;
  negativePrompt?: unknown;
  operation?: unknown;
  sourceImages?: unknown;
  resultCount?: unknown;
  aspectRatio?: unknown;
};

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const value = body as { error?: { message?: unknown } | unknown; message?: unknown };
  if (typeof value.message === "string") return value.message;
  if (value.error && typeof value.error === "object" && typeof (value.error as { message?: unknown }).message === "string") {
    return (value.error as { message: string }).message;
  }
  if (typeof value.error === "string") return value.error;
  return fallback;
}

async function readJson(response: globalThis.Response): Promise<unknown> {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return { message: body.slice(0, 300) };
  }
}

function unwrapTask(body: unknown): DrawTask {
  if (!body || typeof body !== "object") return {};
  const task = body as TaskEnvelope;
  if (typeof task.status === "string" || typeof task.task_id === "string") return task;
  if (task.data && !Array.isArray(task.data) && typeof task.data === "object") return unwrapTask(task.data);
  if (task.result && typeof task.result === "object") return unwrapTask(task.result);
  return task;
}

function imageUrls(task: DrawTask) {
  const urls = task.data?.flatMap((item) => {
    if (item.url) return [item.url];
    if (item.b64_json) return [`data:image/png;base64,${item.b64_json}`];
    return [];
  }) ?? [];
  if (urls.length) return urls;
  return task.candidates?.flatMap((candidate) => candidate.content?.parts?.flatMap((part) => {
    if (!part.text) return [];
    const matches = part.text.match(/https?:\/\/\S+/g);
    return matches ?? [];
  }) ?? []) ?? [];
}

async function taskResponse(taskId: string) {
  const response = await fetch(`${DRAW_TASK_URL}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${DRAW_API_KEY}` },
  });
  const body = await readJson(response);
  const task = unwrapTask(body);
  if (!response.ok) throw new Error(errorMessage(body, `任务查询失败（HTTP ${response.status}）`));
  if (task.status === "failed") throw new Error(errorMessage(task.error, "图片生成失败"));

  const urls = await materializeImageUrls(imageUrls(task));
  // Some RightAPI task responses omit `status` once results are ready.
  const status = task.status ?? (urls.length > 0 ? "completed" : "queued");
  if (status === "completed" && !urls.length) throw new Error("图片服务已完成，但未返回图片地址");
  return {
    taskId,
    model: DRAW_MODEL,
    status,
    progress: typeof task.progress === "number" ? task.progress : undefined,
    urls: urls.length ? urls : undefined,
  };
}

const router = Router();

router.post("/generate", async (req: Request, res: Response) => {
  if (!DRAW_API_KEY) {
    res.status(503).json({ error: "DRAW_API_KEY 未配置" });
    return;
  }

  const { prompt, negativePrompt, operation, sourceImages, resultCount, aspectRatio } = req.body as ImageGenerationRequest;
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt 不能为空" });
    return;
  }
  if (operation !== "generate" && operation !== "variation" && operation !== "merge") {
    res.status(400).json({ error: "operation 不合法" });
    return;
  }
  if (!Array.isArray(sourceImages) || !sourceImages.every((image) => typeof image === "string")) {
    res.status(400).json({ error: "sourceImages 必须是图片 URL 或 data URL 数组" });
    return;
  }
  if ((operation === "generate" && sourceImages.length > 0) || (operation === "variation" && sourceImages.length !== 1) || (operation === "merge" && sourceImages.length < 2)) {
    res.status(400).json({ error: "图片操作与来源图片数量不匹配" });
    return;
  }
  if (typeof resultCount !== "number" || !Number.isInteger(resultCount) || resultCount < 1 || resultCount > 2) {
    res.status(400).json({ error: "resultCount 必须是 1 到 2 的整数" });
    return;
  }
  if (negativePrompt !== undefined && typeof negativePrompt !== "string") {
    res.status(400).json({ error: "negativePrompt 必须是字符串" });
    return;
  }
  const allowedAspectRatios = ["1:1", "4:5", "16:9", "9:16"];
  if (aspectRatio !== undefined && (typeof aspectRatio !== "string" || !allowedAspectRatios.includes(aspectRatio))) {
    res.status(400).json({ error: "aspectRatio 不合法" });
    return;
  }

  try {
    const requestBody: Record<string, unknown> = {
      model: DRAW_MODEL,
      prompt: prompt.trim(),
      n: resultCount,
      size: typeof aspectRatio === "string" ? aspectRatio : "1:1",
      async: true,
    };
    if (typeof negativePrompt === "string" && negativePrompt.trim()) requestBody.negative_prompt = negativePrompt.trim();
    if (sourceImages.length) requestBody.image = sourceImages;

    const submitResponse = await fetch(DRAW_GENERATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DRAW_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const submittedBody = await readJson(submitResponse);
    const submitted = unwrapTask(submittedBody);
    if (!submitResponse.ok) throw new Error(errorMessage(submittedBody, `图片任务提交失败（HTTP ${submitResponse.status}）`));
    if (!submitted.task_id) throw new Error("图片服务未返回 task_id");

    if (submitted.status === "failed") throw new Error(errorMessage(submitted.error, "图片生成失败"));
    if (submitted.status === "completed") {
      const urls = await materializeImageUrls(imageUrls(submitted));
      if (!urls.length) throw new Error("图片服务已完成，但未返回图片地址");
      res.json({ taskId: submitted.task_id, model: DRAW_MODEL, status: "completed", urls });
      return;
    }

    res.status(202).json({
      taskId: submitted.task_id,
      model: DRAW_MODEL,
      status: submitted.status ?? "queued",
      progress: typeof submitted.progress === "number" ? submitted.progress : undefined,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "图片生成服务请求失败" });
  }
});

router.get("/tasks/:taskId", async (req: Request, res: Response) => {
  if (!DRAW_API_KEY) {
    res.status(503).json({ error: "DRAW_API_KEY 未配置" });
    return;
  }

  try {
    const result = await taskResponse(req.params.taskId);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "图片任务查询失败" });
  }
});

export default router;
