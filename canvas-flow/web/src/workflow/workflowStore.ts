import { create } from "zustand";
import { assetFromFixture, fixtureFor } from "./fixtures";
import { listWorkflowProjects, loadWorkflow, saveWorkflow } from "./storage";
import { validateWorkflowGraph, type DagValidationResult } from "./dagExecutor";
import type {
  CanvasEdge,
  CanvasNode,
  CanvasProject,
  GenerationTask,
  ImageAsset,
  ImageNodeStatus,
  ImageOperation,
  ProjectMemoryItem,
  StyleBible,
  WorkflowSnapshot,
} from "./types";

type HistoryEntry = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

type WorkflowState = {
  project: CanvasProject;
  projects: CanvasProject[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assets: ImageAsset[];
  tasks: GenerationTask[];
  selectedNodeIds: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createProject: (name?: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  renameProject: (name: string) => Promise<void>;
  selectNodes: (nodeIds: string[]) => void;
  clearSelection: () => void;
  addAsset: (asset: ImageAsset, position: { x: number; y: number }) => string;
  completeNode: (nodeId: string, asset: ImageAsset) => void;
  createDraftNode: (position: { x: number; y: number }) => string;
  updateNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodeGenerationInput: (nodeId: string, prompt: string, sourceAssetIds: string[]) => void;
  moveNodes: (nodeIds: string[], delta: { x: number; y: number }) => void;
  groupSelected: () => string | null;
  removeSelected: () => void;
  createEdge: (source: string, target: string, operation: CanvasEdge["operation"]) => void;
  validateGraph: () => DagValidationResult;
  setNodeStatus: (nodeId: string, status: ImageNodeStatus) => void;
  addTask: (task: GenerationTask) => void;
  updateTask: (taskId: string, patch: Partial<GenerationTask>) => void;
  markCandidate: (nodeId: string, candidate: boolean) => void;
  updateStyleBible: (patch: Partial<StyleBible>) => void;
  addMemoryItem: (item: ProjectMemoryItem) => void;
  undo: () => void;
  redo: () => void;
  setViewport: (viewport: CanvasProject["viewport"]) => void;
  snapshot: () => WorkflowSnapshot;
  persist: () => Promise<void>;
};

const ACTIVE_PROJECT_KEY = "ai-image-canvas-active-project";

function activeProjectId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  return id;
}

function setActiveProjectId(id: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
}

const projectId = activeProjectId();
const project: CanvasProject = {
  id: projectId,
  name: "Canvas Flow",
  nodeIds: [],
  edgeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  initialized: false,
  styleBible: {
    direction: "主体清晰、光影自然、色彩统一，优先保留用户明确的视觉意图。",
    consistency: "延续当前画布中已确认素材的主体关系和视觉语言。",
  },
  memoryItems: [],
};

function initialWorkflow(baseProject: CanvasProject): WorkflowSnapshot {
  const first = assetFromFixture(baseProject.id, fixtureFor("generate", 0), { prompt: "城市夜景参考", operation: "import" });
  const second = assetFromFixture(baseProject.id, fixtureFor("generate", 1), { prompt: "人物参考", operation: "import" });
  const firstNode = crypto.randomUUID();
  const secondNode = crypto.randomUUID();
  const nodes: CanvasNode[] = [
    { id: firstNode, projectId: baseProject.id, assetId: first.id, kind: "image", position: { x: 80, y: 100 }, width: 240, status: "success", createdAt: Date.now() },
    { id: secondNode, projectId: baseProject.id, assetId: second.id, kind: "image", position: { x: 430, y: 80 }, width: 240, status: "success", createdAt: Date.now() },
  ];
  return {
    project: { ...baseProject, initialized: true, nodeIds: nodes.map((node) => node.id), edgeIds: [], updatedAt: Date.now() },
    nodes,
    edges: [],
    assets: [first, second],
    tasks: [],
  };
}

function historyOf(state: WorkflowState): HistoryEntry {
  return {
    nodes: state.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    edges: state.edges.map((edge) => ({ ...edge })),
  };
}

function withHistory(state: WorkflowState, updater: (nodes: CanvasNode[], edges: CanvasEdge[]) => { nodes: CanvasNode[]; edges: CanvasEdge[] }) {
  const next = updater(state.nodes, state.edges);
  return {
    ...next,
    past: [...state.past.slice(-49), historyOf(state)],
    future: [],
    project: { ...state.project, updatedAt: Date.now(), nodeIds: next.nodes.map((node) => node.id), edgeIds: next.edges.map((edge) => edge.id) },
  };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  project,
  projects: [project],
  nodes: [],
  edges: [],
  assets: [],
  tasks: [],
  selectedNodeIds: [],
  past: [],
  future: [],
  hydrated: false,

  hydrate: async () => {
    const [saved, savedProjects] = await Promise.all([
      loadWorkflow(get().project.id),
      listWorkflowProjects(),
    ]);
    const restored = saved && (saved.project.initialized || saved.assets.length > 0 || saved.nodes.length > 0)
      ? saved
      : initialWorkflow(get().project);
    const restoredProject = {
      ...restored.project,
      name: restored.project.name === "未命名灵感画布" ? "Canvas Flow" : restored.project.name,
      styleBible: restored.project.styleBible ?? project.styleBible,
      memoryItems: restored.project.memoryItems ?? [],
    };
    const projects = [restoredProject, ...savedProjects.filter((item) => item.id !== restoredProject.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt);
    set({
      project: restoredProject,
      projects,
      nodes: restored.nodes,
      edges: restored.edges,
      assets: restored.assets,
      tasks: restored.tasks.map((task) => task.status === "running" || task.status === "queued" ? { ...task, status: "cancelled", updatedAt: Date.now() } : task),
      hydrated: true,
    });
  },

  createProject: async (name = "新画布") => {
    await get().persist();
    const now = Date.now();
    const id = crypto.randomUUID();
    const nextProject: CanvasProject = {
      id,
      name: name.trim() || "新画布",
      nodeIds: [],
      edgeIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: now,
      updatedAt: now,
      initialized: true,
      styleBible: { ...project.styleBible },
      memoryItems: [],
    };
    setActiveProjectId(id);
    set((state) => ({
      project: nextProject,
      projects: [nextProject, ...state.projects.filter((item) => item.id !== nextProject.id)],
      nodes: [],
      edges: [],
      assets: [],
      tasks: [],
      selectedNodeIds: [],
      past: [],
      future: [],
      hydrated: true,
    }));
    await get().persist();
  },

  switchProject: async (projectId) => {
    if (projectId === get().project.id) return;
    await get().persist();
    const saved = await loadWorkflow(projectId);
    if (!saved) return;
    const restoredProject = {
      ...saved.project,
      styleBible: saved.project.styleBible ?? project.styleBible,
      memoryItems: saved.project.memoryItems ?? [],
    };
    set((state) => ({
      project: restoredProject,
      projects: [restoredProject, ...state.projects.filter((item) => item.id !== restoredProject.id)],
      nodes: saved.nodes,
      edges: saved.edges,
      assets: saved.assets,
      tasks: saved.tasks.map((task) => task.status === "running" || task.status === "queued" ? { ...task, status: "cancelled", updatedAt: Date.now() } : task),
      selectedNodeIds: [],
      past: [],
      future: [],
      hydrated: true,
    }));
    setActiveProjectId(projectId);
  },

  renameProject: async (name) => {
    const nextName = name.trim();
    if (!nextName) return;
    set((state) => {
      const nextProject = { ...state.project, name: nextName, updatedAt: Date.now() };
      return {
        project: nextProject,
        projects: [nextProject, ...state.projects.filter((item) => item.id !== nextProject.id)],
      };
    });
    await get().persist();
  },

  selectNodes: (nodeIds) => set({ selectedNodeIds: nodeIds }),
  clearSelection: () => set({ selectedNodeIds: [] }),

  addAsset: (asset, position) => {
    const nodeId = crypto.randomUUID();
    set((state) => withHistory(state, (nodes, edges) => ({
      nodes: [...nodes, { id: nodeId, projectId: state.project.id, assetId: asset.id, kind: "image", position, width: 240, status: "success", createdAt: Date.now() }],
      edges,
    })));
    set((state) => ({ assets: [...state.assets, asset], selectedNodeIds: [nodeId] }));
    return nodeId;
  },

  completeNode: (nodeId, asset) => set((state) => {
    if (!state.nodes.some((node) => node.id === nodeId)) return state;
    return {
      assets: [...state.assets.filter((item) => item.id !== asset.id), asset],
      nodes: state.nodes.map((node) => node.id === nodeId ? { ...node, assetId: asset.id, status: "success" as const } : node),
    };
  }),

  createDraftNode: (position) => {
    const nodeId = crypto.randomUUID();
    set((state) => ({
      ...withHistory(state, (nodes, edges) => ({
        nodes: [...nodes, { id: nodeId, projectId: state.project.id, kind: "image", position, width: 240, status: "draft", createdAt: Date.now() }],
        edges,
      })),
      selectedNodeIds: [nodeId],
    }));
    return nodeId;
  },

  updateNode: (nodeId, patch) => set((state) => withHistory(state, (nodes, edges) => ({
    nodes: nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    edges,
  }))),

  setNodeGenerationInput: (nodeId, prompt, sourceAssetIds) => set((state) => ({
    nodes: state.nodes.map((node) => node.id === nodeId ? { ...node, prompt, sourceAssetIds } : node),
  })),

  moveNodes: (nodeIds, delta) => set((state) => withHistory(state, (nodes, edges) => ({
    nodes: nodes.map((node) => {
      const selectedGroups = nodeIds.filter((id) => nodes.some((item) => item.id === id && item.kind === "group"));
      const belongsToMovedGroup = node.groupId && selectedGroups.includes(node.groupId);
      return nodeIds.includes(node.id) || belongsToMovedGroup
        ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }
        : node;
    }),
    edges,
  }))),

  groupSelected: () => {
    const state = get();
    const members = state.nodes.filter((node) => node.kind === "image" && state.selectedNodeIds.includes(node.id));
    if (members.length < 2) return null;
    const padding = 28;
    const minX = Math.min(...members.map((node) => node.position.x)) - padding;
    const minY = Math.min(...members.map((node) => node.position.y)) - padding - 24;
    const maxX = Math.max(...members.map((node) => node.position.x + (node.width ?? 240))) + padding;
    const maxY = Math.max(...members.map((node) => node.position.y + (node.height ?? 280))) + padding;
    const groupId = crypto.randomUUID();
    set((current) => ({
      ...withHistory(current, (nodes, edges) => ({
        nodes: [
          ...nodes.map((node) => members.some((member) => member.id === node.id) ? { ...node, groupId } : node),
          { id: groupId, projectId: current.project.id, kind: "group", position: { x: minX, y: minY }, width: maxX - minX, height: maxY - minY, title: `图片组 ${members.length}`, createdAt: Date.now() },
        ],
        edges,
      })),
      selectedNodeIds: [groupId],
    }));
    return groupId;
  },

  removeSelected: () => set((state) => {
    const selected = new Set(state.selectedNodeIds);
    state.nodes.filter((node) => selected.has(node.id) && node.kind === "group").forEach((group) => {
      state.nodes.filter((node) => node.groupId === group.id).forEach((member) => selected.add(member.id));
    });
    return {
      ...withHistory(state, (nodes, edges) => ({
        nodes: nodes.filter((node) => !selected.has(node.id)),
        edges: edges.filter((edge) => !selected.has(edge.source) && !selected.has(edge.target)),
      })),
      selectedNodeIds: [],
    };
  }),

  createEdge: (source, target, operation) => set((state) => {
    const id = `${source}-${target}`;
    if (state.edges.some((edge) => edge.id === id)) return state;
    const nextEdges = [...state.edges, { id, projectId: state.project.id, source, target, operation }];
    if (!validateWorkflowGraph(state.nodes, nextEdges).valid) return state;
    return withHistory(state, (nodes) => ({ nodes, edges: nextEdges }));
  }),
  validateGraph: () => validateWorkflowGraph(get().nodes, get().edges),

  setNodeStatus: (nodeId, status) => set((state) => ({ nodes: state.nodes.map((node) => node.id === nodeId ? { ...node, status } : node) })),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks.filter((item) => item.id !== task.id), task] })),
  updateTask: (taskId, patch) => set((state) => ({ tasks: state.tasks.map((task) => task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task) })),
  markCandidate: (nodeId, candidate) => set((state) => {
    const node = state.nodes.find((item) => item.id === nodeId);
    const asset = node?.assetId ? state.assets.find((item) => item.id === node.assetId) : undefined;
    const memoryId = asset ? `approved-asset:${asset.id}` : undefined;
    const existing = state.project.memoryItems ?? [];
    const memoryItems = candidate && asset && memoryId
      ? [
          ...existing.filter((item) => item.id !== memoryId),
          {
            id: memoryId,
            kind: "approved_result" as const,
            text: `用户确认了这张${asset.operation === "import" ? "参考" : "生成"}图片：${asset.prompt || "未命名图片"}`,
            tags: asset.operation ? [asset.operation] : [],
            sourceAssetIds: [asset.id],
            createdAt: Date.now(),
            confirmed: true,
          },
        ]
      : existing.filter((item) => item.id !== memoryId);
    return {
      nodes: state.nodes.map((item) => item.id === nodeId ? { ...item, candidate } : item),
      project: { ...state.project, memoryItems, updatedAt: Date.now() },
    };
  }),
  updateStyleBible: (patch) => set((state) => ({ project: { ...state.project, styleBible: { ...(state.project.styleBible ?? {}), ...patch }, updatedAt: Date.now() } })),
  addMemoryItem: (item) => set((state) => ({ project: { ...state.project, memoryItems: [...(state.project.memoryItems ?? []).filter((existing) => existing.id !== item.id), item], updatedAt: Date.now() } })),

  undo: () => set((state) => {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return { nodes: previous.nodes, edges: previous.edges, past: state.past.slice(0, -1), future: [historyOf(state), ...state.future] };
  }),
  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return state;
    return { nodes: next.nodes, edges: next.edges, past: [...state.past, historyOf(state)], future: state.future.slice(1) };
  }),
  setViewport: (viewport) => set((state) => ({ project: { ...state.project, viewport, updatedAt: Date.now() } })),
  snapshot: () => {
    const state = get();
    return { project: state.project, nodes: state.nodes, edges: state.edges, assets: state.assets, tasks: state.tasks };
  },
  persist: async () => saveWorkflow(get().snapshot()),
}));

export function createMockAsset(projectId: string, operation: ImageOperation, prompt: string, parentIds: string[] = [], index = 0) {
  return assetFromFixture(projectId, fixtureFor(operation, index), { prompt, operation, parentIds });
}
