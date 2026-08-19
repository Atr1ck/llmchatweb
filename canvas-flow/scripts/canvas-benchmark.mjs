import { performance } from "node:perf_hooks";

const NODE_COUNT = 10_000;
const EDGE_COUNT = 20_000;
const QUERY_COUNT = 300;
const MAX_ENTRIES = 16;

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4_294_967_295;
  };
}

function intersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function boundsOf(children) {
  return children.reduce((bounds, child) => ({
    minX: Math.min(bounds.minX, child.minX),
    minY: Math.min(bounds.minY, child.minY),
    maxX: Math.max(bounds.maxX, child.maxX),
    maxY: Math.max(bounds.maxY, child.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function makeNode(children, leaf) {
  return { ...boundsOf(children), leaf, children };
}

function buildPackedLevel(children, leaf) {
  if (children.length <= MAX_ENTRIES) return makeNode(children, leaf);
  const groupCount = Math.ceil(children.length / MAX_ENTRIES);
  const sliceCount = Math.max(1, Math.ceil(Math.sqrt(groupCount)));
  const sliceSize = Math.ceil(children.length / sliceCount);
  const sorted = [...children].sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  const nextLevel = [];
  for (let start = 0; start < sorted.length; start += sliceSize) {
    const slice = sorted.slice(start, start + sliceSize).sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    for (let offset = 0; offset < slice.length; offset += MAX_ENTRIES) {
      nextLevel.push(makeNode(slice.slice(offset, offset + MAX_ENTRIES), leaf));
    }
  }
  return buildPackedLevel(nextLevel, false);
}

function buildIndex(items) {
  return buildPackedLevel(items, true);
}

function searchIndex(root, rect) {
  if (!root || !intersects(root, rect)) return [];
  const result = [];
  const visit = (node) => {
    if (!intersects(node, rect)) return;
    for (const child of node.children) {
      if (!intersects(child, rect)) continue;
      if (node.leaf) result.push(child.nodeId);
      else visit(child);
    }
  };
  visit(root);
  return result;
}

function scan(items, rect) {
  return items.filter((item) => intersects(item, rect)).map((item) => item.nodeId);
}

function makeDataset(kind) {
  const random = rng(kind === "uniform" ? 17 : kind === "clustered" ? 31 : 47);
  const centers = Array.from({ length: 8 }, (_value, index) => ({
    x: (index % 4) * 2_500 - 3_750,
    y: Math.floor(index / 4) * 2_500 - 1_250,
  }));
  const items = Array.from({ length: NODE_COUNT }, (_value, index) => {
    const cluster = centers[index % centers.length];
    const spread = kind === "overlap" ? 900 : kind === "clustered" ? 1_700 : 10_000;
    const x = kind === "uniform" ? (random() - 0.5) * 12_000 : cluster.x + (random() - 0.5) * spread;
    const y = kind === "uniform" ? (random() - 0.5) * 8_000 : cluster.y + (random() - 0.5) * spread * 0.7;
    const width = kind === "overlap" ? 280 + random() * 260 : 120 + random() * 220;
    const height = kind === "overlap" ? 220 + random() * 220 : 120 + random() * 260;
    return { nodeId: `node-${index}`, minX: x, minY: y, maxX: x + width, maxY: y + height };
  });
  return items;
}

function makeQueries(kind) {
  const random = rng(kind === "uniform" ? 101 : kind === "clustered" ? 211 : 307);
  return Array.from({ length: QUERY_COUNT }, (_value, index) => {
    const large = index % 2 === 1;
    const width = large ? 2_400 : 720;
    const height = large ? 1_600 : 520;
    const x = (random() - 0.5) * (kind === "clustered" ? 7_000 : 12_000);
    const y = (random() - 0.5) * (kind === "clustered" ? 5_000 : 8_000);
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  });
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function run(label, queries, fn) {
  // Warm up JIT before recording timings.
  queries.slice(0, 20).forEach(fn);
  const samples = queries.map((query) => {
    const startedAt = performance.now();
    fn(query);
    return performance.now() - startedAt;
  });
  return { label, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) };
}

const distributions = ["uniform", "clustered", "overlap"];
console.log(`Canvas benchmark: nodes=${NODE_COUNT}, edges=${EDGE_COUNT}, queries=${QUERY_COUNT}`);
console.log("Distribution | Baseline P50/P95/Max (ms) | R-tree P50/P95/Max (ms) | Correct");

for (const distribution of distributions) {
  const items = makeDataset(distribution);
  const queries = makeQueries(distribution);
  const tree = buildIndex(items);
  let correct = true;
  const baseline = run("full-scan", queries, (query) => scan(items, query));
  queries.forEach((query) => {
    const baselineIds = scan(items, query).sort();
    const treeIds = searchIndex(tree, query).sort();
    if (baselineIds.length !== treeIds.length || baselineIds.some((id, index) => id !== treeIds[index])) correct = false;
  });
  const optimized = run("r-tree", queries, (query) => {
    return searchIndex(tree, query);
  });
  console.log(`${distribution.padEnd(11)} | ${baseline.p50.toFixed(2)} / ${baseline.p95.toFixed(2)} / ${baseline.max.toFixed(2)} | ${optimized.p50.toFixed(2)} / ${optimized.p95.toFixed(2)} / ${optimized.max.toFixed(2)} | ${correct ? "PASS" : "FAIL"}`);
  if (!correct) process.exitCode = 1;
}
