# Canvas Flow 大画布性能与 Worker 方案

## 1. 文档信息

- 状态：第一版已落地，持续通过 CI 与 benchmark 回归
- 适用模块：节点画布、工作流编排、批量选择、视口渲染和大型项目加载
- 目标岗位能力：节点画布、大数据量渲染、复杂交互、工程化、线上稳定性

## 2. 背景与问题

Canvas Flow 的画布节点、边和资产会随着创作过程持续增长。若每次缩放、拖拽、框选或视口变化都在主线程遍历全部节点，复杂项目会出现以下问题：

1. 视口查询从 `O(k)` 退化为 `O(n)`，其中 `n` 是全部节点数，`k` 是实际可见节点数。
2. React 状态更新、React Flow 节点转换和空间查询集中在主线程，容易产生长任务。
3. 框选操作需要频繁进行矩形相交判断，节点数量越多，交互延迟越明显。
4. 如果每次操作都把完整画布快照传给 Worker，数据结构化和消息传输本身会成为新的瓶颈。

本方案不把 Web Worker 当作装饰性技术，而是同时优化两个维度：

- Worker：将空间计算和大型数据处理移出主线程；
- R-tree：减少不必要的节点遍历，优化范围查询复杂度。

## 3. 目标与非目标

### 目标

- 数据层支持 10,000 个节点和 20,000 条边。
- React 主线程只渲染当前视口需要的节点。
- Worker 负责空间索引、视口查询、框选查询和后续布局计算。
- 初始化时同步一次完整快照，后续只同步节点和边的增量变更。
- 常规空间查询 P95 小于 50ms。
- Worker 异常时可以降级到主线程，不让画布失效。
- 用可重复的 benchmark 对比全量遍历和 R-tree 的性能差异。

### 非目标

- 不把 React、Zustand 或 DOM 对象放进 Worker。
- 不让 Worker 直接修改 React Flow 实例。
- 不在第一阶段实现完整的多人协同编辑。
- 不为了追求极端数据量牺牲正常项目的交互质量。

## 4. 总体架构

```text
┌─────────────────────────────────────────────┐
│ React 主线程                                 │
│                                             │
│ React Flow / Zustand / 用户交互              │
│   │                                         │
│   ├─ 初始化快照                              │
│   ├─ node:add / node:update / node:remove   │
│   ├─ edge:update                             │
│   └─ viewport / selection 查询               │
└───────────────┬─────────────────────────────┘
                │ requestId + version
                ▼
┌─────────────────────────────────────────────┐
│ Canvas Spatial Worker                        │
│                                             │
│ 节点快照 + R-tree 空间索引                   │
│   ├─ query-visible                           │
│   ├─ box-select                              │
│   ├─ layout                                  │
│   └─ 增量索引更新                             │
└───────────────┬─────────────────────────────┘
                │ nodeIds / layout / elapsedMs
                ▼
┌─────────────────────────────────────────────┐
│ 主线程渲染                                   │
│ 根据返回的 nodeIds 更新 React Flow 可见节点   │
└─────────────────────────────────────────────┘
```

## 5. 空间索引选型

### 5.1 全量遍历：性能基线

最简单的方式是逐个检查所有节点：

```ts
const matches = nodes.filter((node) => intersects(node.bounds, queryRect));
```

优点是实现简单、结果明确，适合作为正确性和性能基线。缺点是每次查询都需要检查全部节点，复杂度为 `O(n)`。

### 5.2 R-tree：生产索引

R-tree 使用层级包围盒组织二维矩形。查询一个视口时，先排除完全不相交的上层包围盒，再深入可能命中的分支。

节点索引记录：

```ts
type SpatialItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  nodeId: string;
};
```

核心操作：

```ts
tree.insert(item);
tree.remove(item);
tree.search(rect);
```

平均情况下范围查询可以近似理解为 `O(log n + k)`，其中 `k` 是命中的节点数量。R-tree 适合节点位置不规则、节点大小差异大、节点会动态移动的工作流画布。

### 5.3 Uniform Grid：备选方案

Uniform Grid 把画布切成固定大小的格子，每个节点放入其覆盖的格子。查询时只检查被查询矩形覆盖的格子。

它的实现简单，但存在三个风险：

- 大节点跨越很多格子，会产生重复存储；
- 节点聚簇时某个格子会形成热点，查询退化为大列表遍历；
- 格子大小需要在节点尺寸和分布变化之间取平衡。

### 5.4 选择结论

Canvas Flow 采用 R-tree 作为生产索引，同时保留全量遍历作为 benchmark 基线。Uniform Grid 作为后续对照实验，不作为第一阶段生产实现。

## 6. Worker 边界与消息协议

### 6.1 线程职责

主线程负责：

- React Flow 渲染；
- Zustand 状态；
- 用户输入和拖拽事件；
- 将业务状态转换成纯数据消息；
- 根据 Worker 返回的 ID 更新可见节点。

Worker 负责：

- 保存空间索引中的节点边界；
- 处理增量更新；
- 执行视口查询和框选查询；
- 执行不依赖 DOM 的自动布局计算；
- 返回计算耗时和结果版本。

### 6.2 请求协议

```ts
type CanvasWorkerRequest =
  | {
      type: "init";
      requestId: string;
      version: number;
      nodes: SpatialItem[];
    }
  | {
      type: "node:upsert";
      requestId: string;
      version: number;
      node: SpatialItem;
    }
  | {
      type: "node:remove";
      requestId: string;
      version: number;
      nodeId: string;
    }
  | {
      type: "edge:update";
      requestId: string;
      version: number;
      edges: Array<{ source: string; target: string }>;
    }
  | {
      type: "query-visible";
      requestId: string;
      version: number;
      rect: { minX: number; minY: number; maxX: number; maxY: number };
    }
  | {
      type: "box-select";
      requestId: string;
      version: number;
      rect: { minX: number; minY: number; maxX: number; maxY: number };
    }
  | {
      type: "layout";
      requestId: string;
      version: number;
      nodeIds: string[];
    };
```

### 6.3 响应协议

```ts
type CanvasWorkerResponse = {
  requestId: string;
  version: number;
  type: "ready" | "query-visible" | "box-select" | "layout" | "error";
  nodeIds?: string[];
  positions?: Array<{ nodeId: string; x: number; y: number }>;
  elapsedMs?: number;
  error?: string;
};
```

`requestId` 用来关联请求和响应，`version` 用来判断结果是否过期。主线程只接受当前版本或更新版本的响应，丢弃旧的视口查询结果，避免快速缩放时出现结果闪回。

## 7. 数据同步策略

### 初始化

画布加载或 Worker 重启时发送一次完整节点快照：

```text
init(10,000 nodes)
      ↓
Worker 建立 R-tree
      ↓
ready(version)
```

### 增量同步

初始化之后不再重复发送全量快照，只发送：

- `node:upsert`：新增或更新节点边界；
- `node:remove`：删除节点；
- `edge:update`：边关系变化；
- `viewport` 查询：只发送查询矩形。

节点移动时，Worker 内部执行“删除旧索引项 + 插入新索引项”。主线程不发送完整节点数组，降低结构化克隆和消息传输成本。

## 8. 降级与稳定性策略

执行优先级：

```text
Worker + R-tree
    ↓ Worker 初始化失败或异常
主线程 + R-tree
    ↓ 索引不可用
主线程 + 全量遍历
```

三种实现共用同一个查询接口：

```ts
queryVisible(rect): Promise<string[]>;
boxSelect(rect): Promise<string[]>;
upsertNode(node): Promise<void>;
removeNode(nodeId): Promise<void>;
```

异常场景包括：

- Worker 初始化失败；
- Worker 执行异常；
- Worker 响应超时；
- 页面快速缩放造成响应过期；
- 项目切换过程中旧项目响应晚到；
- 节点增量消息乱序。

处理原则：

1. 每个项目拥有独立的 `projectVersion`。
2. 每个请求拥有唯一 `requestId`。
3. 项目切换时，旧项目的请求全部视为过期。
4. Worker 超时后记录错误并切换到主线程 R-tree。
5. 降级次数、查询耗时和错误原因写入开发环境性能日志。

## 9. Benchmark 设计

### 9.1 运行方式

提供可重复执行的脚本：

```bash
npm run benchmark:canvas
```

Benchmark 不依赖手动拖动画布，而是使用固定随机种子生成数据，确保每次运行可以比较。

### 9.2 数据规模

- 节点：10,000；
- 边：20,000；
- 重复查询：每个场景至少 1,000 次；
- 记录：P50、P95、Max、正确性和内存变化。

### 9.3 数据分布

#### 均匀分布

节点均匀散落在大画布中，验证常规空间查询效率。

#### 聚簇分布

大部分节点集中在几个区域，模拟用户在局部区域持续创作的情况。

#### 高重叠分布

大量节点互相覆盖，模拟复杂工作流和多轮生成结果堆叠，观察 R-tree 在高命中量下的退化情况。

### 9.4 查询场景

- 小视口查询：命中少量节点；
- 大视口查询：命中较多节点；
- 小范围框选；
- 大范围框选；
- 节点移动后的增量更新；
- 连续缩放期间的查询取消和过期响应丢弃。

### 9.5 对比组

```text
baseline-1：主线程 + 全量遍历
baseline-2：Worker + 全量遍历
optimized：Worker + R-tree
fallback：主线程 + R-tree
```

这样可以分离两个优化因素：

- Worker 的收益：减少主线程阻塞；
- R-tree 的收益：减少无效节点遍历。

### 9.6 性能目标

- 常规空间查询 P95 小于 50ms；
- 优化方案的查询结果必须与全量遍历一致；
- 连续视口变化时不应用过期响应；
- 在同等数据集上记录内存变化和索引更新时间；
- 对比优化前后长任务数量和持续时间。

## 10. 测试策略

### 单元测试

- 矩形相交判断；
- R-tree 插入、删除、更新；
- 视口查询结果；
- 框选结果；
- 乱序响应丢弃；
- 项目版本隔离；
- Worker 失败后的降级。

### 集成测试

- 初始化快照后查询可见节点；
- 增量更新后查询结果变化；
- 节点移动后旧位置不再命中；
- 项目切换后旧项目响应不会污染新项目；
- Worker 断开后主线程 fallback 继续工作。

### Benchmark 正确性校验

每个查询场景都同时运行全量遍历和 R-tree，比较排序后的 `nodeIds`。如果结果不同，benchmark 直接失败，不输出性能结论。

## 11. 分阶段落地

### Phase 1：纯算法与基线

- 提取矩形类型和相交算法；
- 实现全量遍历查询；
- 实现 R-tree 适配器；
- 增加固定种子 benchmark；
- 增加正确性测试。

### Phase 2：Worker 化

- 新增 `canvasSpatial.worker.ts`；
- 实现 `init`、增量同步、`query-visible`、`box-select`；
- 增加 requestId、version 和超时处理；
- 增加 Worker 单元测试和消息协议测试。

### Phase 3：React Flow 接入

- 根据 Worker 返回的可见节点 ID 渲染节点；
- 框选改用 Worker 查询；
- 节点拖拽结束后发送增量更新；
- 保留主线程 R-tree 和全量遍历 fallback。

### Phase 4：可观测性与文档

- 输出查询耗时和降级日志；
- 记录 benchmark 结果；
- 在 README 和技术方案中说明限制；
- 评估是否需要进一步引入 Web Worker 布局计算或 OffscreenCanvas。

## 12. 面试追问准备

### 为什么用了 Worker？

因为空间查询、框选和布局计算会随着节点规模增长，并且这些工作不依赖 DOM，适合移出主线程，减少交互长任务。

### 为什么还需要 R-tree？

Worker 只解决“在哪个线程计算”，R-tree 解决“需要计算多少对象”。前者优化主线程阻塞，后者优化查询复杂度，两者是互补关系。

### 为什么不直接用 Uniform Grid？

当前节点位置和尺寸不规则，且可能出现聚簇与高重叠。R-tree 对不规则矩形范围查询更稳定；Uniform Grid 作为简单备选保留在对照实验中。

### Worker 失败怎么办？

使用同一查询接口降级到主线程 R-tree，必要时再降级到主线程全量遍历，优先保证画布可用性。

### 怎么证明优化有效？

用固定随机种子的 10,000 节点、20,000 边数据集，分别测全量遍历、Worker 全量遍历、Worker + R-tree 和主线程 fallback，比较 P50、P95、Max、内存和结果正确性。
