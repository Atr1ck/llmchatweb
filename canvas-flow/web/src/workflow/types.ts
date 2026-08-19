export type ImageOperation = "generate" | "variation" | "merge";

export type ImageNodeStatus =
  | "draft"
  | "queued"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type GenerationTaskStatus = Exclude<ImageNodeStatus, "draft">;

export type ImageAsset = {
  id: string;
  projectId: string;
  url: string;
  width: number;
  height: number;
  prompt?: string;
  operation?: ImageOperation | "import";
  parentIds: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
};

export type StyleBible = {
  direction?: string;
  palette?: string[];
  lighting?: string;
  composition?: string;
  consistency?: string;
  notes?: string;
};

export type ProjectMemoryItem = {
  id: string;
  kind: "style" | "preference" | "approved_result" | "revision_note";
  text: string;
  tags?: string[];
  sourceAssetIds?: string[];
  createdAt: number;
  confirmed?: boolean;
};

export type GenerationInputSnapshot = {
  prompt: string;
  negativePrompt?: string;
  sourceAssetIds: string[];
  operation: ImageOperation;
  provider: string;
  aspectRatio?: string;
  skillIds?: string[];
  operationId?: string;
  createdAt: number;
};

export type GenerationAttempt = {
  id: string;
  taskId: string;
  attempt: number;
  inputHash: string;
  status: Exclude<GenerationTaskStatus, "queued">;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type GenerationTask = {
  id: string;
  projectId: string;
  nodeId: string;
  status: GenerationTaskStatus;
  operation: ImageOperation;
  input: GenerationInputSnapshot;
  progress: number;
  error?: string;
  attempt: number;
  createdAt: number;
  updatedAt: number;
};

export type CanvasNode = {
  id: string;
  projectId: string;
  assetId?: string;
  kind: "image" | "group";
  position: { x: number; y: number };
  width?: number;
  height?: number;
  status?: ImageNodeStatus;
  /** The full prompt submitted for this node, including any inherited context. */
  prompt?: string;
  /** Reference assets submitted together with this node's prompt. */
  sourceAssetIds?: string[];
  title?: string;
  groupId?: string;
  candidate?: boolean;
  createdAt: number;
};

export type CanvasEdge = {
  id: string;
  projectId: string;
  source: string;
  target: string;
  operation: ImageOperation | "import";
};

export type CanvasProject = {
  id: string;
  name: string;
  nodeIds: string[];
  edgeIds: string[];
  viewport: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
  initialized?: boolean;
  styleBible?: StyleBible;
  memoryItems?: ProjectMemoryItem[];
};

export type WorkflowSnapshot = {
  project: CanvasProject;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assets: ImageAsset[];
  tasks: GenerationTask[];
};

export type ImageOperationRequest = {
  operation: ImageOperation;
  sourceAssetIds: string[];
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "4:5" | "16:9" | "9:16";
  resultCount?: number;
  skillIds?: string[];
};

export type CreativeAgentContext = {
  mode: "image_creation";
  project: {
    id: string;
    name: string;
    styleBible?: StyleBible;
    memoryItems?: ProjectMemoryItem[];
  };
  selectedAssets: Array<Pick<ImageAsset, "id" | "prompt" | "operation" | "parentIds"> & {
    candidate?: boolean;
    tags?: string[];
    imageUrl?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    role?: "reference" | "style" | "subject";
  }>;
  recentAssets: Array<Pick<ImageAsset, "id" | "prompt" | "operation" | "parentIds"> & {
    candidate?: boolean;
    tags?: string[];
    imageUrl?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    role?: "reference" | "style" | "subject";
  }>;
  requestedSkillIds?: string[];
};

export const MAX_CONCURRENT_TASKS = 3;
