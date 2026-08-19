import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Activity, Folder, ImagePlus, MoreHorizontal, RefreshCw, Sparkles, X } from "lucide-react";
import { useWorkflowStore } from "./workflowStore";
import type { CanvasEdge, CanvasNode, ImageAsset } from "./types";
import { CanvasSpatialClient } from "./canvasSpatialClient";
import { spatialItemForNode, type SpatialItem, type SpatialRect } from "./spatialIndex";
import { CanvasPerformanceMonitor, type CanvasPerformanceSnapshot } from "./performanceMonitor";

type ImageNodeData = {
  asset?: ImageAsset;
  sourceAssets: ImageAsset[];
  node: CanvasNode;
  onGenerate: (nodeId: string, prompt: string, sourceAssets?: ImageAsset[]) => void;
  onOpenDetails: (nodeId: string, point?: { x: number; y: number }) => void;
};

type ContextMenuState = { x: number; y: number; flowX: number; flowY: number } | null;

function ImageCanvasNode({ data, selected }: NodeProps<Node<ImageNodeData>>) {
  const { node, asset, sourceAssets, onGenerate, onOpenDetails } = data;
  const [prompt, setPrompt] = useState("");
  const isDraft = node.status === "draft";
  const isRunning = node.status === "running" || node.status === "queued";

  return (
    <div className={`relative w-[210px] overflow-hidden rounded-xl border bg-white shadow-xl transition dark:bg-slate-900 ${selected ? "border-sky-400 ring-2 ring-sky-400/40" : "border-slate-200 dark:border-slate-700"}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-400" />
      {asset ? (
        <div className="block w-full cursor-grab active:cursor-grabbing" onDoubleClick={(event) => onOpenDetails(node.id, { x: event.clientX, y: event.clientY })}>
          <img src={asset.url} alt={asset.prompt || "图片资产"} className="block h-auto max-h-[220px] w-full object-cover" draggable={false} />
        </div>
      ) : (
        <div className="flex min-h-[190px] flex-col justify-between bg-slate-100 p-3 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-200"><Sparkles className="h-4 w-4 text-sky-500" />新图片</div>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onPointerDown={(event) => event.stopPropagation()} placeholder="描述你想生成的图片" className="nodrag my-3 min-h-[90px] resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          <button type="button" className="nodrag inline-flex items-center justify-center gap-1 rounded-lg bg-sky-500 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={!prompt.trim() || isRunning} onPointerDown={(event) => event.stopPropagation()} onClick={() => onGenerate(node.id, prompt.trim())}><ImagePlus className="h-3.5 w-3.5" />生成图片</button>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>{isDraft ? "待输入" : node.status === "error" ? "生成失败" : isRunning ? "生成中" : "图片"}</span>
        <button type="button" className="nodrag rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => onOpenDetails(node.id, { x: event.clientX, y: event.clientY })} aria-label="打开图片详情"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      </div>
      {isRunning && <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-sky-400" />}
      {node.status === "error" && <button type="button" className="nodrag absolute right-2 top-2 rounded-full bg-white/90 p-1 text-rose-500 shadow" onPointerDown={(event) => event.stopPropagation()} onClick={() => onGenerate(node.id, node.prompt || asset?.prompt || "重新生成这张图片", sourceAssets)} aria-label="重试"><RefreshCw className="h-3.5 w-3.5" /></button>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-400" />
    </div>
  );
}

function GroupCanvasNode({ data, selected }: NodeProps<Node<ImageNodeData>>) {
  const { node } = data;
  return <div className={`h-full w-full rounded-lg border border-dashed bg-sky-400/5 p-2 ${selected ? "border-sky-400 ring-2 ring-sky-400/30" : "border-sky-300/60 dark:border-sky-800"}`}><span className="flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300"><Folder className="h-3.5 w-3.5" />{node.title || "图片组"}</span></div>;
}

const nodeTypes = { image: ImageCanvasNode, group: GroupCanvasNode };

function toFlowNodes(nodes: CanvasNode[], assets: ImageAsset[], selectedIds: string[], callbacks: Pick<ImageNodeData, "onGenerate" | "onOpenDetails">): Node<ImageNodeData>[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    selected: selectedIds.includes(node.id),
    style: node.kind === "group" ? { width: node.width, height: node.height, zIndex: 0 } : { zIndex: 1 },
    data: {
      node,
      asset: node.assetId ? assetsById.get(node.assetId) : undefined,
      sourceAssets: (node.sourceAssetIds ?? []).flatMap((assetId) => {
        const asset = assetsById.get(assetId);
        return asset ? [asset] : [];
      }),
      ...callbacks,
    },
  }));
}

function toFlowEdges(edges: CanvasEdge[], selectedIds: string[], visibleIds?: Set<string>): Edge[] {
  return edges.filter((edge) => !visibleIds || visibleIds.has(edge.source) || visibleIds.has(edge.target) || selectedIds.includes(edge.source) || selectedIds.includes(edge.target)).map((edge) => {
    const highlighted = selectedIds.includes(edge.source) || selectedIds.includes(edge.target);
    const colors: Record<CanvasEdge["operation"], string> = { generate: "#38bdf8", variation: "#a78bfa", merge: "#fb923c", import: "#94a3b8" };
    return { id: edge.id, source: edge.source, target: edge.target, type: "smoothstep", animated: highlighted, style: { stroke: colors[edge.operation], strokeWidth: highlighted ? 3 : 1.5, opacity: highlighted ? 1 : 0.5 } };
  });
}

function viewportRect(viewport: { x: number; y: number; zoom: number }, element: HTMLElement): SpatialRect {
  const bounds = element.getBoundingClientRect();
  const zoom = Math.max(viewport.zoom, 0.01);
  const overscan = 480 / zoom;
  return {
    minX: -viewport.x / zoom - overscan,
    minY: -viewport.y / zoom - overscan,
    maxX: (bounds.width - viewport.x) / zoom + overscan,
    maxY: (bounds.height - viewport.y) / zoom + overscan,
  };
}

function sameSpatialItem(left: SpatialItem | undefined, right: SpatialItem): boolean {
  return Boolean(left)
    && left?.nodeId === right.nodeId
    && left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY;
}

export type WorkflowCanvasProps = {
  onGenerate: (nodeId: string, prompt: string, sourceAssets?: ImageAsset[]) => void;
  onOpenDetails: (nodeId: string, point?: { x: number; y: number }) => void;
  darkMode?: boolean;
};

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({ onGenerate, onOpenDetails, darkMode = false }) => {
  const { nodes, edges, assets, project, selectedNodeIds, selectNodes, createDraftNode, moveNodes, setViewport } = useWorkflowStore();
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<ImageNodeData>>([]);
  const [instance, setInstance] = useState<ReactFlowInstance<Node<ImageNodeData>, Edge> | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spatialRef = useRef<CanvasSpatialClient | null>(null);
  const nodeItemsRef = useRef(new Map<string, SpatialItem>());
  const spatialProjectIdRef = useRef<string | null>(null);
  const querySequenceRef = useRef(0);
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string> | null>(null);
  const [performanceMonitor] = useState(() => new CanvasPerformanceMonitor());
  const [performanceMetrics, setPerformanceMetrics] = useState<CanvasPerformanceSnapshot>(() => performanceMonitor.snapshot());

  const callbacks = useMemo(() => ({ onGenerate, onOpenDetails }), [onGenerate, onOpenDetails]);
  const shouldCull = nodes.length > 300;

  useEffect(() => {
    performanceMonitor.start();
    return performanceMonitor.subscribe(setPerformanceMetrics);
  }, [performanceMonitor]);

  const refreshVisible = useCallback(async (viewport: { x: number; y: number; zoom: number }) => {
    if (!shouldCull) {
      setVisibleNodeIds(null);
      return;
    }
    const element = containerRef.current;
    const spatial = spatialRef.current;
    if (!element || !spatial) return;
    const sequence = ++querySequenceRef.current;
    const ids = await spatial.queryVisible(viewportRect(viewport, element));
    if (sequence !== querySequenceRef.current) return;
    setVisibleNodeIds(new Set(ids));
  }, [shouldCull]);

  useEffect(() => {
    const spatial = new CanvasSpatialClient({
      onDiagnostic: (event) => {
        performanceMonitor.recordSpatialDiagnostic(event);
        if (import.meta.env.DEV && event.type.includes("error")) console.warn("Canvas spatial fallback", event);
      },
    });
    spatialRef.current = spatial;
    return () => {
      spatial.dispose();
      spatialRef.current = null;
    };
  }, [performanceMonitor]);

  useEffect(() => {
    const spatial = spatialRef.current;
    if (!spatial) return;
    const nextItems = new Map(nodes.map((node) => [node.id, spatialItemForNode(node)]));
    if (spatialProjectIdRef.current !== project.id) {
      spatialProjectIdRef.current = project.id;
      nodeItemsRef.current = nextItems;
      setVisibleNodeIds(null);
      void spatial.init(Array.from(nextItems.values())).then(() => refreshVisible(project.viewport));
      return;
    }

    const upserts: SpatialItem[] = [];
    nextItems.forEach((item, nodeId) => {
      const previous = nodeItemsRef.current.get(nodeId);
      if (!sameSpatialItem(previous, item)) upserts.push(item);
    });
    const removes = Array.from(nodeItemsRef.current.keys()).filter((nodeId) => !nextItems.has(nodeId));
    nodeItemsRef.current = nextItems;
    if (upserts.length || removes.length) {
      void spatial.updateNodes({ upserts, removes }).then(() => refreshVisible(project.viewport));
    } else if (shouldCull && !visibleNodeIds) {
      void refreshVisible(project.viewport);
    }
  }, [nodes, project.id, project.viewport, refreshVisible, shouldCull, visibleNodeIds]);

  const displayNodes = useMemo(() => {
    if (!visibleNodeIds) return nodes;
    const selected = new Set(selectedNodeIds);
    return nodes.filter((node) => visibleNodeIds.has(node.id) || selected.has(node.id) || node.status === "running" || node.status === "queued");
  }, [nodes, selectedNodeIds, visibleNodeIds]);
  const displayNodeIds = useMemo(() => new Set(displayNodes.map((node) => node.id)), [displayNodes]);

  useEffect(() => setRfNodes(toFlowNodes(displayNodes, assets, selectedNodeIds, callbacks)), [assets, callbacks, displayNodes, selectedNodeIds, setRfNodes]);
  useEffect(() => {
    if (instance) void instance.setViewport(project.viewport, { duration: 0 });
  }, [instance, project.viewport]);
  const flowEdges = useMemo(() => toFlowEdges(edges, selectedNodeIds, visibleNodeIds ? displayNodeIds : undefined), [displayNodeIds, edges, selectedNodeIds, visibleNodeIds]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    if (!instance) return;
    const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setContextMenu({ x: event.clientX, y: event.clientY, flowX: point.x, flowY: point.y });
  }, [instance]);

  const onNodeClick = useCallback((event: React.MouseEvent | MouseEvent, node: Node<ImageNodeData>) => {
    const additive = event.ctrlKey || event.metaKey;
    const groupedIds = node.data.node.kind === "group" ? nodes.filter((item) => item.groupId === node.id).map((item) => item.id) : [];
    const currentIds = [node.id, ...groupedIds];
    const next = additive ? (selectedNodeIds.includes(node.id) ? selectedNodeIds.filter((id) => !currentIds.includes(id)) : [...selectedNodeIds, ...currentIds]) : currentIds;
    selectNodes(next);
  }, [nodes, selectNodes, selectedNodeIds]);

  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: Node<ImageNodeData>) => {
    const previous = nodes.find((item) => item.id === node.id);
    if (previous) moveNodes([node.id], { x: node.position.x - previous.position.x, y: node.position.y - previous.position.y });
  }, [moveNodes, nodes]);

  const closeMenu = () => setContextMenu(null);
  const createDraft = () => { if (contextMenu) createDraftNode({ x: contextMenu.flowX, y: contextMenu.flowY }); closeMenu(); };

  return (
    <div ref={containerRef} className="relative h-full min-h-0 bg-[#f8fafc] dark:bg-[#101827]" onClick={closeMenu}>
      <ReactFlow<Node<ImageNodeData>, Edge> nodes={rfNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onInit={setInstance} onPaneContextMenu={onPaneContextMenu} onNodeClick={onNodeClick} onNodeDragStop={onNodeDragStop} onMove={(_event, viewport) => { void refreshVisible(viewport); }} onMoveEnd={(_event, viewport) => { setViewport(viewport); void refreshVisible(viewport); }} onPaneClick={() => selectNodes([])} defaultViewport={project.viewport} minZoom={0.05} maxZoom={20} selectionOnDrag selectionKeyCode="Control" multiSelectionKeyCode="Control" panOnDrag panActivationKeyCode="Space" proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "smoothstep" }}>
        <Background gap={24} size={1} color={darkMode ? "#334155" : "#cbd5e1"} />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable nodeColor={darkMode ? "#38bdf8" : "#0284c7"} maskColor={darkMode ? "rgba(2, 6, 23, 0.72)" : "rgba(226, 232, 240, 0.72)"} bgColor={darkMode ? "#172033" : "#ffffff"} />
      </ReactFlow>
      {nodes.length === 0 && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><div className="rounded-xl border border-slate-200/80 bg-white/90 px-5 py-4 text-center shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90"><p className="text-sm font-semibold">从一张图片开始</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">在空白处右键，选择“生成图片”</p></div></div>}
      {contextMenu && (
        <div className="absolute z-20 w-44 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-2xl dark:border-slate-700 dark:bg-slate-900" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={createDraft}><ImagePlus className="h-4 w-4 text-sky-500" />生成图片</button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={closeMenu}><X className="h-4 w-4" />取消</button>
        </div>
      )}
      {import.meta.env.DEV && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-2 text-[10px] leading-4 text-slate-500 shadow-lg backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90 dark:text-slate-400" aria-label="画布性能诊断">
          <div className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200"><Activity className="h-3 w-3 text-emerald-500" />画布诊断 · {performanceMetrics.lastMode}</div>
          <div>查询 P95 {performanceMetrics.queryP95Ms}ms · Max {performanceMetrics.queryMaxMs}ms</div>
          <div>降级 {performanceMetrics.workerFallbackCount} 次 · 长任务 {performanceMetrics.longTaskCount} 次</div>
        </div>
      )}
    </div>
  );
};
