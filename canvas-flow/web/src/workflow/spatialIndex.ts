export type SpatialRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SpatialItem = SpatialRect & { nodeId: string };

type TreeChild = SpatialItem | TreeNode;

type TreeNode = SpatialRect & {
  leaf: boolean;
  children: TreeChild[];
};

const MAX_ENTRIES = 16;

function intersects(left: SpatialRect, right: SpatialRect): boolean {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY;
}

function boundsOf(children: TreeChild[]): SpatialRect {
  return children.reduce<SpatialRect>((bounds, child) => ({
    minX: Math.min(bounds.minX, child.minX),
    minY: Math.min(bounds.minY, child.minY),
    maxX: Math.max(bounds.maxX, child.maxX),
    maxY: Math.max(bounds.maxY, child.maxY),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function makeNode(children: TreeChild[], leaf: boolean): TreeNode {
  return { ...boundsOf(children), leaf, children };
}

function buildPackedLevel(children: TreeChild[], leaf: boolean): TreeNode {
  if (children.length <= MAX_ENTRIES) return makeNode(children, leaf);

  // Sort-Tile-Recursive bulk loading keeps nearby rectangles in the same
  // branch. This is enough for our read-heavy viewport queries while keeping
  // updates batchable and predictable.
  const groupCount = Math.ceil(children.length / MAX_ENTRIES);
  const sliceCount = Math.max(1, Math.ceil(Math.sqrt(groupCount)));
  const sliceSize = Math.ceil(children.length / sliceCount);
  const sortedByX = [...children].sort((left, right) => left.minX - right.minX || left.minY - right.minY);
  const nextLevel: TreeNode[] = [];

  for (let start = 0; start < sortedByX.length; start += sliceSize) {
    const slice = sortedByX.slice(start, start + sliceSize)
      .sort((left, right) => left.minY - right.minY || left.minX - right.minX);
    for (let offset = 0; offset < slice.length; offset += MAX_ENTRIES) {
      nextLevel.push(makeNode(slice.slice(offset, offset + MAX_ENTRIES), leaf));
    }
  }

  return buildPackedLevel(nextLevel, false);
}

function isTreeNode(child: TreeChild): child is TreeNode {
  return "children" in child;
}

/**
 * A small packed R-tree implementation for rectangle range queries.
 *
 * Mutations mark the tree dirty and are rebuilt together on the next query.
 * The client batches pointer-move patches, so this avoids rebuilding once per
 * mouse event while keeping the implementation dependency-free.
 */
export class PackedRTree {
  private readonly items = new Map<string, SpatialItem>();

  private root: TreeNode | null = null;

  private dirty = true;

  constructor(items: SpatialItem[] = []) {
    this.replace(items);
  }

  replace(items: SpatialItem[]): void {
    this.items.clear();
    items.forEach((item) => this.items.set(item.nodeId, item));
    this.dirty = true;
  }

  upsert(item: SpatialItem): void {
    this.items.set(item.nodeId, item);
    this.dirty = true;
  }

  upsertMany(items: SpatialItem[]): void {
    items.forEach((item) => this.items.set(item.nodeId, item));
    this.dirty = true;
  }

  remove(nodeId: string): void {
    if (this.items.delete(nodeId)) this.dirty = true;
  }

  removeMany(nodeIds: string[]): void {
    nodeIds.forEach((nodeId) => this.items.delete(nodeId));
    this.dirty = true;
  }

  search(rect: SpatialRect): string[] {
    this.ensureBuilt();
    if (!this.root || !intersects(this.root, rect)) return [];

    const result: string[] = [];
    const visit = (node: TreeNode) => {
      if (!intersects(node, rect)) return;
      for (const child of node.children) {
        if (!intersects(child, rect)) continue;
        if (node.leaf) {
          result.push((child as SpatialItem).nodeId);
        } else if (isTreeNode(child)) {
          visit(child);
        }
      }
    };
    visit(this.root);
    return result;
  }

  get size(): number {
    return this.items.size;
  }

  private ensureBuilt(): void {
    if (!this.dirty) return;
    const entries = Array.from(this.items.values());
    this.root = entries.length ? buildPackedLevel(entries, true) : null;
    this.dirty = false;
  }
}

export function scanSpatialItems(items: SpatialItem[], rect: SpatialRect): string[] {
  return items.filter((item) => intersects(item, rect)).map((item) => item.nodeId);
}

export function spatialItemForNode(node: { id: string; position: { x: number; y: number }; width?: number; height?: number }): SpatialItem {
  const width = node.width ?? 210;
  const height = node.height ?? 220;
  return {
    nodeId: node.id,
    minX: node.position.x,
    minY: node.position.y,
    maxX: node.position.x + width,
    maxY: node.position.y + height,
  };
}
