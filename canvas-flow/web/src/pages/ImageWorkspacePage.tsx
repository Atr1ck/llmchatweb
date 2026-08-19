import React from "react";
import { Check, FolderOpen, FolderPlus, Moon, PanelLeft, PanelRight, Play, Plus, Sparkles, SunMedium, Upload, X } from "lucide-react";
import { ChatWindow } from "../components/ChatWindow";
import { InputBox } from "../components/InputBox";
import { StyleBiblePanel } from "../components/StyleBiblePanel";
import { useChat, type ImageOperationAction } from "../hooks/useChat";
import { getChatProviders, type ChatProviderId, type ChatProviderOption } from "../services/api";
import { generateImage } from "../services/draw";
import { CREATIVE_SKILLS } from "../creativeSkills";
import { WorkflowCanvas } from "../workflow/WorkflowCanvas";
import { executeWorkflowDag } from "../workflow/dagExecutor";
import { useWorkflowStore } from "../workflow/workflowStore";
import type { CreativeAgentContext, ImageAsset, GenerationTask } from "../workflow/types";

async function asDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:image/")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取参考图片");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图片转换失败"));
    reader.onerror = () => reject(new Error("参考图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function prepareVisionImage(url: string): Promise<string> {
  if (/^https?:\/\//i.test(url)) return url;
  const dataUrl = await asDataUrl(url);
  const image = new Image();
  const loaded = new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });
  image.src = dataUrl;
  await loaded;
  if (!image.naturalWidth || !image.naturalHeight) return dataUrl;

  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function assetMimeType(url: string): string {
  const dataMatch = url.match(/^data:([^;,]+)/i);
  if (dataMatch?.[1]) return dataMatch[1];
  if (/\.svg(?:$|[?#])/i.test(url)) return "image/svg+xml";
  if (/\.png(?:$|[?#])/i.test(url)) return "image/png";
  if (/\.jpe?g(?:$|[?#])/i.test(url)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/i.test(url)) return "image/webp";
  return "image/*";
}

async function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 1024 });
    image.onerror = () => resolve({ width: 1024, height: 1024 });
    image.src = url;
  });
}

function promptWithPreviousContext(prompt: string, parentAssets: ImageAsset[]) {
  const previousPrompts = [...new Set(parentAssets.map((asset) => asset.prompt?.trim()).filter((value): value is string => Boolean(value)))];
  if (!previousPrompts.length) return prompt;
  return [
    "请基于所附参考图片继续创作。",
    `上一轮提示词：${previousPrompts.join("；")}`,
    `本次修改：${prompt}`,
  ].join("\n");
}

export const ImageWorkspacePage: React.FC = () => {
  const imageOperationHandlerRef = React.useRef<(action: ImageOperationAction) => void>(() => undefined);
  const chat = useChat({ onImageOperation: (action) => imageOperationHandlerRef.current(action) });
  const project = useWorkflowStore((state) => state.project);
  const projects = useWorkflowStore((state) => state.projects);
  const nodes = useWorkflowStore((state) => state.nodes);
  const assets = useWorkflowStore((state) => state.assets);
  const selectedNodeIds = useWorkflowStore((state) => state.selectedNodeIds);
  const tasks = useWorkflowStore((state) => state.tasks);
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const hydrate = useWorkflowStore((state) => state.hydrate);
  const createProject = useWorkflowStore((state) => state.createProject);
  const switchProject = useWorkflowStore((state) => state.switchProject);
  const addAsset = useWorkflowStore((state) => state.addAsset);
  const createDraftNode = useWorkflowStore((state) => state.createDraftNode);
  const createEdge = useWorkflowStore((state) => state.createEdge);
  const completeNode = useWorkflowStore((state) => state.completeNode);
  const createMockTask = useWorkflowStore((state) => state.addTask);
  const updateTask = useWorkflowStore((state) => state.updateTask);
  const setNodeStatus = useWorkflowStore((state) => state.setNodeStatus);
  const setNodeGenerationInput = useWorkflowStore((state) => state.setNodeGenerationInput);
  const markCandidate = useWorkflowStore((state) => state.markCandidate);
  const groupSelected = useWorkflowStore((state) => state.groupSelected);
  const removeSelected = useWorkflowStore((state) => state.removeSelected);
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);
  const selectNodes = useWorkflowStore((state) => state.selectNodes);
  const persist = useWorkflowStore((state) => state.persist);
  const updateStyleBible = useWorkflowStore((state) => state.updateStyleBible);
  const [dark, setDark] = React.useState(true);
  const [detailsNodeId, setDetailsNodeId] = React.useState<string | null>(null);
  const [detailsPosition, setDetailsPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<string[]>([]);
  const [preparingContext, setPreparingContext] = React.useState(false);
  const [chatProviders, setChatProviders] = React.useState<ChatProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = React.useState<ChatProviderId | "">("");
  const [providersLoading, setProvidersLoading] = React.useState(true);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState("");
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);
  const [leftWidth, setLeftWidth] = React.useState(220);
  const [rightWidth, setRightWidth] = React.useState(360);
  const [workflowRunning, setWorkflowRunning] = React.useState(false);
  const [workflowRunMessage, setWorkflowRunMessage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const mainRef = React.useRef<HTMLElement>(null);
  const detailsDragRef = React.useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const sidebarResizeRef = React.useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const drawQueue = React.useRef<Array<() => Promise<void>>>([]);
  const activeDraws = React.useRef(0);

  React.useEffect(() => {
    let active = true;
    setProvidersLoading(true);
    void getChatProviders()
      .then((providers) => {
        if (!active) return;
        setChatProviders(providers);
        setSelectedProviderId((current) => current && providers.some((provider) => provider.id === current)
          ? current
          : providers[0]?.id ?? "");
      })
      .catch(() => {
        if (!active) return;
        setChatProviders([]);
      })
      .finally(() => {
        if (active) setProvidersLoading(false);
      });
    return () => { active = false; };
  }, []);

  const drainDrawQueue = React.useCallback(() => {
    while (activeDraws.current < 3 && drawQueue.current.length > 0) {
      const job = drawQueue.current.shift();
      if (!job) return;
      activeDraws.current += 1;
      void job().finally(() => {
        activeDraws.current -= 1;
        drainDrawQueue();
      });
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  React.useEffect(() => { void hydrate(); }, [hydrate]);

  React.useEffect(() => {
    if (hydrated) chat.switchProjectSession(project.id);
  }, [chat.switchProjectSession, hydrated, project.id]);

  React.useEffect(() => { if (hydrated) void persist(); }, [assets, hydrated, nodes, persist, project, tasks]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectNodes(useWorkflowStore.getState().nodes.map((node) => node.id));
      } else if (modifier && event.key.toLowerCase() === "g") {
        event.preventDefault();
        groupSelected();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      } else if (event.key === "Escape") {
        setDetailsNodeId(null);
        setDetailsPosition(null);
        selectNodes([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groupSelected, redo, removeSelected, selectNodes, undo]);

  const selectedAssets = selectedNodeIds.map((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return assets.find((asset) => asset.id === node?.assetId);
  }).filter((asset): asset is ImageAsset => Boolean(asset));

  const runImageOperation = React.useCallback((options: {
    nodeId: string;
    prompt: string;
    operation: "generate" | "variation" | "merge";
    parentNodeIds?: string[];
    parentAssets?: ImageAsset[];
    index?: number;
    includePreviousPrompt?: boolean;
    negativePrompt?: string;
    aspectRatio?: string;
    skillIds?: string[];
    operationId?: string;
    brief?: unknown;
  }): Promise<ImageAsset> => {
    const { nodeId, prompt, operation, parentNodeIds = [], parentAssets = [], index = 0, includePreviousPrompt = true, negativePrompt, aspectRatio = "1:1", skillIds = [], operationId, brief } = options;
    const requestPrompt = includePreviousPrompt ? promptWithPreviousContext(prompt, parentAssets) : prompt;
    setNodeGenerationInput(nodeId, requestPrompt, parentAssets.map((asset) => asset.id));
    const task: GenerationTask = {
      id: crypto.randomUUID(), projectId: project.id, nodeId, status: "queued", operation,
      input: { prompt: requestPrompt, negativePrompt, sourceAssetIds: parentAssets.map((asset) => asset.id), operation, provider: "rightapi", aspectRatio, skillIds, operationId, createdAt: Date.now() },
      progress: 0, attempt: 1, createdAt: Date.now(), updatedAt: Date.now(),
    };
    createMockTask(task);
    setNodeStatus(nodeId, "queued");
    return new Promise<ImageAsset>((resolve, reject) => {
      drawQueue.current.push(async () => {
        updateTask(task.id, { status: "running", progress: 55 });
        setNodeStatus(nodeId, "running");
        try {
          const sourceImages = await Promise.all(parentAssets.map((asset) => asDataUrl(asset.url)));
          const result = await generateImage({ prompt: requestPrompt, negativePrompt, aspectRatio, operation, sourceImages, resultCount: 1 });
          const url = result.urls[index % result.urls.length];
          if (!url) throw new Error("图片服务未返回结果");
          const dimensions = await imageDimensions(url);
          const asset: ImageAsset = {
            id: crypto.randomUUID(), projectId: project.id, url, ...dimensions, prompt, operation,
            parentIds: parentAssets.map((item) => item.id), createdAt: Date.now(),
            metadata: { model: result.model, providerTaskId: result.taskId, requestPrompt, negativePrompt, aspectRatio, skillIds, operationId, creativeBrief: brief },
          };
          completeNode(nodeId, asset);
          parentNodeIds.forEach((parentNodeId) => createEdge(parentNodeId, nodeId, operation));
          updateTask(task.id, { status: "success", progress: 100 });
          void persist();
          resolve(asset);
        } catch (error) {
          const message = error instanceof Error ? error.message : "图片生成失败";
          setNodeStatus(nodeId, "error");
          updateTask(task.id, { status: "error", error: message, progress: 100 });
          reject(error instanceof Error ? error : new Error(message));
        }
      });
      drainDrawQueue();
    });
  }, [completeNode, createEdge, createMockTask, drainDrawQueue, persist, project.id, setNodeGenerationInput, setNodeStatus, updateTask]);

  const runMockGeneration = React.useCallback((nodeId: string, prompt: string, sourceAssets: ImageAsset[] = []): Promise<ImageAsset> => {
    return runImageOperation({
      nodeId,
      prompt,
      operation: sourceAssets.length >= 2 ? "merge" : sourceAssets.length === 1 ? "variation" : "generate",
      parentAssets: sourceAssets,
      includePreviousPrompt: false,
      skillIds: selectedSkillIds,
    });
  }, [runImageOperation, selectedSkillIds]);

  const runAgentImageOperation = React.useCallback((action: ImageOperationAction) => {
    const parentAssets = action.sourceAssetIds.flatMap((assetId) => {
      const asset = useWorkflowStore.getState().assets.find((item) => item.id === assetId);
      return asset ? [asset] : [];
    });
    const expectedSourceCount = action.operation === "generate" ? 0 : action.operation === "variation" ? 1 : 2;
    if (parentAssets.length < expectedSourceCount) return;

    const state = useWorkflowStore.getState();
    const parentNodes = parentAssets.flatMap((asset) => {
      const node = state.nodes.find((item) => item.assetId === asset.id);
      return node ? [node] : [];
    });
    const origin = parentNodes.length
      ? { x: Math.max(...parentNodes.map((node) => node.position.x)), y: Math.round(parentNodes.reduce((sum, node) => sum + node.position.y, 0) / parentNodes.length) }
      : { x: 250, y: 230 };
    const resultCount = Math.min(Math.max(action.resultCount ?? 1, 1), 2);
    const offsets = Array.from({ length: resultCount }, (_value, index) => ({ x: 320 + index * 280, y: index % 2 ? 120 : -80 }));

    offsets.forEach((offset, index) => {
      const nodeId = createDraftNode({ x: origin.x + offset.x, y: origin.y + offset.y });
      void runImageOperation({
        nodeId,
        prompt: action.prompt,
        operation: action.operation,
        parentNodeIds: parentNodes.map((node) => node.id),
        parentAssets,
        index,
        negativePrompt: action.negativePrompt,
        aspectRatio: action.aspectRatio,
        skillIds: action.skillIds ?? [],
        operationId: action.operationId,
        brief: action.brief,
      }).catch(() => undefined);
    });
  }, [createDraftNode, runImageOperation]);

  React.useEffect(() => {
    imageOperationHandlerRef.current = runAgentImageOperation;
  }, [runAgentImageOperation]);

  const runWorkflow = React.useCallback(async () => {
    if (workflowRunning) return;
    const state = useWorkflowStore.getState();
    const workflowNodes = state.nodes.filter((node) => node.kind === "image");
    const nodeIds = new Set(workflowNodes.map((node) => node.id));
    const workflowEdges = state.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    setWorkflowRunning(true);
    setWorkflowRunMessage(null);
    try {
      const result = await executeWorkflowDag(workflowNodes, workflowEdges, {
        maxConcurrency: 3,
        maxAttempts: 2,
        execute: async (node, context) => {
          const current = useWorkflowStore.getState();
          const existingAsset = node.assetId ? current.assets.find((asset) => asset.id === node.assetId) : undefined;
          if (node.status === "success" && existingAsset) return existingAsset;
          const dependencyAssets = Array.from(context.dependencyResults.values()).filter((asset): asset is ImageAsset => Boolean(asset));
          const referencedAssets = (node.sourceAssetIds ?? []).flatMap((assetId) => {
            const asset = current.assets.find((item) => item.id === assetId);
            return asset ? [asset] : [];
          });
          const parentAssets = dependencyAssets.length ? dependencyAssets : referencedAssets;
          const operation = parentAssets.length >= 2 ? "merge" : parentAssets.length === 1 ? "variation" : "generate";
          return runImageOperation({
            nodeId: node.id,
            prompt: node.prompt?.trim() || "请根据工作流上下文生成图片",
            operation,
            parentNodeIds: Array.from(context.dependencyResults.keys()),
            parentAssets,
            includePreviousPrompt: false,
            skillIds: selectedSkillIds,
          });
        },
      });
      if (result.status === "invalid") {
        setWorkflowRunMessage(result.validation.issues[0]?.message ?? "工作流校验失败");
      } else if (result.status === "success") {
        setWorkflowRunMessage("工作流执行完成");
      } else {
        const failed = Array.from(result.results.values()).find((item) => item.status === "error");
        setWorkflowRunMessage(failed?.error ?? `工作流状态：${result.status}`);
      }
    } finally {
      setWorkflowRunning(false);
    }
  }, [runImageOperation, selectedSkillIds, workflowRunning]);

  const sendWithContext = React.useCallback(async (content: string) => {
    if (chat.loading || chat.isStopping || preparingContext || providersLoading) return;
    const toContextAsset = (asset: ImageAsset) => ({
      id: asset.id,
      prompt: asset.prompt,
      operation: asset.operation,
      parentIds: asset.parentIds,
      candidate: nodes.find((node) => node.assetId === asset.id)?.candidate ?? false,
      width: asset.width,
      height: asset.height,
      mimeType: assetMimeType(asset.url),
      role: "reference" as const,
    });
    setPreparingContext(true);
    try {
      const selectedContextAssets = await Promise.all(selectedAssets.map(async (asset) => ({
        ...toContextAsset(asset),
        imageUrl: await prepareVisionImage(asset.url).catch(() => asset.url),
      })));
      const agentContext: CreativeAgentContext = {
        mode: "image_creation",
        project: {
          id: project.id,
          name: project.name,
          styleBible: project.styleBible,
          memoryItems: project.memoryItems,
        },
        selectedAssets: selectedContextAssets,
        recentAssets: assets.slice(-12).map(toContextAsset),
        requestedSkillIds: selectedSkillIds.length ? selectedSkillIds : undefined,
      };
      setPreparingContext(false);
      void chat.sendMessage(content, agentContext, selectedProviderId || undefined);
    } catch {
      setPreparingContext(false);
    }
  }, [assets, chat, nodes, preparingContext, project.id, project.memoryItems, project.name, project.styleBible, providersLoading, selectedAssets, selectedProviderId, selectedSkillIds]);

  const onImport = () => fileInputRef.current?.click();

  const onFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = () => addAsset({
        id: crypto.randomUUID(), projectId: project.id, url, width: image.naturalWidth, height: image.naturalHeight,
        prompt: file.name, operation: "import", parentIds: [], createdAt: Date.now(),
      }, { x: 180 + assets.length * 30, y: 260 + assets.length * 20 });
      image.src = url;
    };
    reader.readAsDataURL(file);
  };

  const openDetails = React.useCallback((nodeId: string, point?: { x: number; y: number }) => {
    setDetailsNodeId(nodeId);
    if (!point || !mainRef.current) return;
    const bounds = mainRef.current.getBoundingClientRect();
    setDetailsPosition({
      x: Math.min(Math.max(point.x - bounds.left + 18, 12), Math.max(12, bounds.width - 296)),
      y: Math.min(Math.max(point.y - bounds.top - 30, 12), Math.max(12, bounds.height - 430)),
    });
  }, []);

  const startDetailsDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const position = detailsPosition ?? { x: 18, y: 18 };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    detailsDragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  }, [detailsPosition]);

  const moveDetailsDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = detailsDragRef.current;
    if (!drag) return;
    const bounds = mainRef.current?.getBoundingClientRect();
    const maxX = bounds ? Math.max(12, bounds.width - 292) : Number.POSITIVE_INFINITY;
    const maxY = bounds ? Math.max(12, bounds.height - 120) : Number.POSITIVE_INFINITY;
    setDetailsPosition({
      x: Math.min(Math.max(12, drag.originX + event.clientX - drag.startX), maxX),
      y: Math.min(Math.max(12, drag.originY + event.clientY - drag.startY), maxY),
    });
  }, []);

  const endDetailsDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    detailsDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const startSidebarResize = React.useCallback((side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeRef.current = { side, startX: event.clientX, startWidth: side === "left" ? leftWidth : rightWidth };
  }, [leftWidth, rightWidth]);

  const moveSidebarResize = React.useCallback((side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize || resize.side !== side) return;
    const delta = event.clientX - resize.startX;
    if (side === "left") setLeftWidth(Math.min(420, Math.max(160, resize.startWidth + delta)));
    else setRightWidth(Math.min(520, Math.max(260, resize.startWidth - delta)));
  }, []);

  const endSidebarResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    sidebarResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const detailsNode = detailsNodeId ? nodes.find((node) => node.id === detailsNodeId) : undefined;
  const detailsAsset = detailsNode ? assets.find((asset) => asset.id === detailsNode.assetId) : undefined;
  const messages = chat.currentSession?.messages ?? [];
  const regenerateCanvas = React.useCallback(() => {
    const lastPrompt = [...messages].reverse().find((message) => message.role === "user")?.content;
    if (lastPrompt) sendWithContext(lastPrompt);
  }, [messages, sendWithContext]);

  const resetCanvasView = React.useCallback(() => {
    setSelectedSkillIds([]);
    setDetailsNodeId(null);
    setDetailsPosition(null);
  }, []);

  const openNewProjectDialog = React.useCallback(() => {
    setNewProjectName(`新画布 ${projects.length + 1}`);
    setNewProjectDialogOpen(true);
  }, [projects.length]);

  const createNewCanvas = React.useCallback(async () => {
    if (chat.loading) chat.stopGeneration();
    resetCanvasView();
    await createProject(newProjectName);
    setNewProjectDialogOpen(false);
  }, [chat, createProject, newProjectName, resetCanvasView]);

  const handleProjectChange = React.useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProjectId = event.target.value;
    if (nextProjectId === project.id) return;
    if (chat.loading) chat.stopGeneration();
    resetCanvasView();
    await switchProject(nextProjectId);
  }, [chat, project.id, resetCanvasView, switchProject]);

  const handleProjectNameKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createNewCanvas();
    }
    if (event.key === "Escape") setNewProjectDialogOpen(false);
  }, [createNewCanvas]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-3 dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-sky-500" />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500"><span>Canvas Flow</span><FolderOpen className="h-3 w-3" /></div>
            <select value={project.id} onChange={(event) => void handleProjectChange(event)} className="max-w-[210px] truncate rounded-md border-0 bg-transparent p-0 pr-5 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-sky-400/30 dark:text-slate-100" aria-label="选择画布">
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => void runWorkflow()} disabled={workflowRunning || nodes.length === 0} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:border-sky-400 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300" aria-label="运行工作流"><Play className="h-3.5 w-3.5" />{workflowRunning ? "运行中" : "运行工作流"}</button>
          <button type="button" onClick={openNewProjectDialog} className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-sky-600" aria-label="新建画布"><Plus className="h-3.5 w-3.5" />新建画布</button>
          <button type="button" onClick={() => setLeftOpen((value) => !value)} className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="切换素材栏"><PanelLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setRightOpen((value) => !value)} className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="切换对话栏"><PanelRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => setDark((value) => !value)} className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="切换主题">{dark ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {leftOpen && <aside style={{ width: leftWidth }} className="flex shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"><div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-semibold dark:border-slate-800"><span>项目素材</span><button type="button" onClick={onImport} className="rounded p-1 hover:bg-slate-100 hover:text-sky-500 dark:hover:bg-slate-800" aria-label="导入图片"><Upload className="h-3.5 w-3.5" /></button><input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileImport} /></div><div className="grid flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto p-2">{assets.map((asset) => <button key={asset.id} type="button" className="group min-w-0 overflow-hidden rounded-lg border border-slate-200 text-left hover:border-sky-400 dark:border-slate-700" onClick={() => { const node = nodes.find((item) => item.assetId === asset.id); if (node) useWorkflowStore.getState().selectNodes([node.id]); }}><img src={asset.url} alt={asset.prompt || "素材"} className="h-20 w-full object-cover transition duration-200 group-hover:scale-[1.02]" /><span className="block truncate px-1.5 py-1 text-[10px] text-slate-500">{asset.operation === "import" ? "导入素材" : "生成结果"}</span></button>)}</div><div className="border-t border-slate-100 p-3 text-[10px] text-slate-400 dark:border-slate-800">{assets.length} 个资产 · {nodes.length} 个节点</div></aside>}
        {leftOpen && <div role="separator" aria-orientation="vertical" aria-label="调整左侧栏宽度" tabIndex={0} className="group relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-sky-400/30 focus:bg-sky-400/30" onPointerDown={(event) => startSidebarResize("left", event)} onPointerMove={(event) => moveSidebarResize("left", event)} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize}><span className="absolute inset-y-0 left-0 w-px bg-slate-200 group-hover:bg-sky-400 dark:bg-slate-800" /></div>}
        <main ref={mainRef} className="relative min-w-0 flex-1"><WorkflowCanvas darkMode={dark} onGenerate={runMockGeneration} onOpenDetails={openDetails} />{workflowRunMessage && <div className="absolute left-3 top-3 z-20 rounded-md border border-slate-200 bg-white/90 px-2.5 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300">{workflowRunMessage}</div>}{selectedNodeIds.length >= 2 && <button type="button" onClick={() => groupSelected()} className="absolute right-3 top-3 z-20 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900"><FolderPlus className="h-3.5 w-3.5" />编组</button>}{detailsAsset && <div className="absolute z-30 flex max-h-[70vh] w-[280px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" style={{ left: detailsPosition?.x ?? 18, top: detailsPosition?.y ?? 18 }}><div className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-semibold dark:border-slate-800" onPointerDown={startDetailsDrag} onPointerMove={moveDetailsDrag} onPointerUp={endDetailsDrag} onPointerCancel={endDetailsDrag}><span>图片详情 · 拖动标题栏移动</span><button type="button" onClick={() => { setDetailsNodeId(null); setDetailsPosition(null); }} aria-label="关闭详情"><X className="h-4 w-4" /></button></div><img src={detailsAsset.url} alt={detailsAsset.prompt || "图片详情"} className="max-h-56 w-full shrink-0 object-cover" /><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs"><div><span className="text-slate-400">提示词</span><p className="mt-1 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words leading-5 text-slate-700 dark:text-slate-200">{detailsAsset.prompt || "未记录"}</p></div><div className="flex items-center justify-between gap-2 text-slate-400"><span>来源 {detailsAsset.parentIds.length} 张</span><button type="button" onClick={() => detailsNode && markCandidate(detailsNode.id, !detailsNode.candidate)} className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:border-sky-400 dark:border-slate-700">{detailsNode?.candidate ? "取消候选" : "设为候选"}</button></div></div></div>}</main>
        {rightOpen && <div role="separator" aria-orientation="vertical" aria-label="调整右侧栏宽度" tabIndex={0} className="group relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-sky-400/30 focus:bg-sky-400/30" onPointerDown={(event) => startSidebarResize("right", event)} onPointerMove={(event) => moveSidebarResize("right", event)} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize}><span className="absolute inset-y-0 right-0 w-px bg-slate-200 group-hover:bg-sky-400 dark:bg-slate-800" /></div>}
        {rightOpen && <aside style={{ width: rightWidth }} className="flex min-h-0 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold dark:border-slate-800">AI 创作对话</div>
          {selectedAssets.length > 0 && <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800"><div className="mb-1 text-[10px] text-slate-400">当前上下文 · {selectedAssets.length} 张图片 · 会随消息发送</div><div className="flex gap-1.5 overflow-x-auto">{selectedAssets.map((asset) => <div key={asset.id} className="relative shrink-0"><img src={asset.url} alt="上下文" className="h-10 w-10 rounded object-cover" /><button type="button" onClick={() => { const node = nodes.find((item) => item.assetId === asset.id); if (node) useWorkflowStore.getState().selectNodes(selectedNodeIds.filter((id) => id !== node.id)); }} className="absolute -right-1 -top-1 rounded-full bg-slate-900 text-white" aria-label="移除上下文"><X className="h-3 w-3" /></button></div>)}</div></div>}
          <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">创作 Skill</span><span className="text-[10px] text-cyan-600 dark:text-cyan-300">{selectedSkillIds.length ? `已固定 ${selectedSkillIds.length}` : "Agent 自动匹配"}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{CREATIVE_SKILLS.map((skill) => { const active = selectedSkillIds.includes(skill.id); return <button key={skill.id} type="button" onClick={() => setSelectedSkillIds((ids) => active ? ids.filter((id) => id !== skill.id) : [...ids, skill.id])} className={`rounded-full border px-2 py-1 text-[10px] transition ${active ? "border-cyan-400 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200" : "border-slate-200 bg-white text-slate-500 hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"}`}>{skill.name}</button>; })}</div><p className="mt-2 text-[10px] leading-4 text-slate-400">不选择时，Agent 会结合画布和项目记忆自动推荐。</p></div>
          <StyleBiblePanel value={project.styleBible} onSave={updateStyleBible} />
          <div className="flex min-h-0 flex-1 flex-col"><ChatWindow messages={messages} loading={chat.loading} agentStatus={chat.agentStatus} onEditMessage={chat.startEditMessage} /></div>
          <div className="border-t border-slate-200 p-3 dark:border-slate-800"><InputBox disabled={chat.loading || chat.isStopping || preparingContext || providersLoading} onSend={sendWithContext} onRegenerate={regenerateCanvas} onStop={chat.stopGeneration} isGenerating={chat.loading || chat.isStopping} isStopping={chat.isStopping} isPreparing={preparingContext} providerOptions={chatProviders} selectedProviderId={selectedProviderId} onProviderChange={setSelectedProviderId} providerDisabled={providersLoading || chat.loading || chat.isStopping || preparingContext} /></div>
        </aside>}
      </div>
      {newProjectDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={() => setNewProjectDialogOpen(false)}>
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-500">Canvas Flow</p><h2 id="new-project-title" className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">新建画布</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">新画布会使用独立的图片资产、项目记忆和对话上下文。</p></div>
            <button type="button" onClick={() => setNewProjectDialogOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="关闭新建画布"><X className="h-4 w-4" /></button>
          </div>
          <label className="mt-5 block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="new-project-name">项目名称</label>
          <input id="new-project-name" autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={handleProjectNameKeyDown} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" placeholder="例如：清新治愈兔" />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setNewProjectDialogOpen(false)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">取消</button>
            <button type="button" onClick={() => void createNewCanvas()} disabled={!newProjectName.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800"><Check className="h-3.5 w-3.5" />创建画布</button>
          </div>
        </div>
      </div>}
    </div>
  );
};
