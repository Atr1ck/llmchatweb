import type { SpatialItem, SpatialRect } from "./spatialIndex";

export type CanvasSpatialRequest =
  | { type: "init"; requestId: string; version: number; nodes: SpatialItem[] }
  | { type: "update"; requestId: string; baseVersion: number; nextVersion: number; upserts: SpatialItem[]; removes: string[] }
  | { type: "query-visible"; requestId: string; version: number; rect: SpatialRect }
  | { type: "box-select"; requestId: string; version: number; rect: SpatialRect }
  | { type: "layout"; requestId: string; version: number; nodeIds: string[] };

export type CanvasSpatialResponse = {
  requestId: string;
  type: "ready" | "update" | "query-visible" | "box-select" | "layout" | "error";
  version: number;
  nodeIds?: string[];
  positions?: Array<{ nodeId: string; x: number; y: number }>;
  elapsedMs?: number;
  error?: string;
};
