import { describe, expect, it } from "vitest";
import { PackedRTree, scanSpatialItems, type SpatialItem } from "./spatialIndex";

const items: SpatialItem[] = [
  { nodeId: "a", minX: 0, minY: 0, maxX: 10, maxY: 10 },
  { nodeId: "b", minX: 20, minY: 20, maxX: 30, maxY: 30 },
  { nodeId: "c", minX: 40, minY: 0, maxX: 50, maxY: 10 },
];

describe("PackedRTree", () => {
  it("matches the scan baseline after updates", () => {
    const tree = new PackedRTree(items);
    const rect = { minX: 5, minY: 5, maxX: 25, maxY: 25 };
    expect(tree.search(rect).sort()).toEqual(scanSpatialItems(items, rect).sort());
    tree.upsert({ nodeId: "c", minX: 5, minY: 20, maxX: 15, maxY: 30 });
    tree.remove("a");
    const updated = [...items.slice(1, 2), { nodeId: "c", minX: 5, minY: 20, maxX: 15, maxY: 30 }];
    expect(tree.search(rect).sort()).toEqual(scanSpatialItems(updated, rect).sort());
  });
});

