# 记忆系统 (Memory System) - GraphRAG

PeroCore 的记忆系统是一个增强型的 **GraphRAG（基于图的检索增强生成）** 数据库。它在传统向量检索的基础上，引入了 **加权图遍历 (Weighted Graph Traversal)** 机制，让 AI 能够通过逻辑关联检索信息，而不仅仅是关键词匹配。

## 1. 核心架构 (Core Architecture)

记忆系统采用 **Python + Rust** 的混合架构，兼顾了业务逻辑的灵活性和计算的高性能。

Python 层负责存储和业务逻辑，Rust 层作为计算引擎处理向量搜索和图谱遍历。

<ArchitectureGraph />

## 2. 核心组件 (Core Components)

### 2.1. 图遍历引擎 (Graph Traversal Engine)

由底层的 **TriviumDB** 引擎内部提供，这是记忆图谱发生扩散的核心。它在内存中维护了一个高效的动态图结构。

- **PEDSA 算法 (Parallel Energy-Decay Spreading Activation)**:
  这是我们核心的加权图遍历算法。当一个记忆节点被检索命中（例如通过语义搜索或关键词锚点），TriviumDB 会沿着关联边（Edges）向四周进行加权传播。
  - **动态剪枝 (Dynamic Pruning)**: 每层传播会限制激活节点数量（默认 10000），通过 `select_nth_unstable_by` 快速选取 Top-K 能量节点，防止大规模图谱下的计算爆炸。
  - **并行计算 (Parallelism)**: 利用 Rust 的 Rayon 库实现多线程并行能量扩散，通过 `fold` 和 `reduce` 模式高效汇总节点增量。
  - **负向抑制 (Inhibitory Signals)**: 支持“抑制边”（EdgeType 255），传播负向能量，用于模拟矛盾关系或降低不相关分支的权重。
  - **权重衰减 (Decay)**: 能量随传播深度指数级衰减，确保只有紧密相关的上下文被激活。

- **Simulated CSR (Compressed Sparse Row)**:
  为了极致的内存效率，我们在 Rust 中使用 `SmallVec` 实现了一种动态的邻接表结构，模拟 CSR 的紧凑性，同时支持动态更新。这使得我们能够在有限的内存中存储数百万级的关联关系。

### 2.2. 向量检索引擎 (Vector Search Engine)

同样无缝集成在 **TriviumDB** 内核中。

- **SIMD 加速**: 利用 AVX2 (x86) 或 NEON (ARM) 指令集加速向量点积运算（Cosine Similarity）。
- **功能**: 负责将用户的自然语言输入转化为高维空间中的坐标，并快速定位图谱中的"入口节点"。

### 2.3. 存储层 (Storage Layer)

位于 `backend/models.py`，并与 `TriviumDB` 统一绑定。

<MemoryNetworkGraph />

- **Memory Table**: SQLite 中存储记忆的具体内容、时间戳和基础权重，与 TriviumDB 保持 ID 一比一同步。
- **TriviumDB.link()**: 取代了传统的 MemoryRelation 和共现表，所有记忆节点之间的语义关联边、时间链边以及共现边都直接作为图拓扑写入底层的 `.tdb` 存储中。
- **ConversationLog**: 对话日志（Conversation Log），用于暂存短期对话流。

## 3. 记忆动力学 (Memory Dynamics)

PeroCore 的记忆不是静态存储的，而是具有动态权重，随时间推移和访问频率而变化。

### 3.1. 权重计算公式 (Weight Calculation)

检索时的最终得分（Retrieval Score）采用 **混合加权机制**：

$$ Score*{base} = (GraphScore \times 0.7) + (VectorScore \times 0.3) $$
$$ FinalScore = Score*{base} \times (1.0 + \frac{Importance}{10}) \times (0.8 + 0.2 \times \frac{1}{1 + \ln(1 + \Delta t\_{days})}) $$

- **GraphScore (扩散分)**: 由 TriviumDB 的 PEDSA 扩散计算得到的能量值。
- **VectorScore (向量分)**: 语义检索得到的原始 Cosine Similarity。
- **Importance (重要性权重)**: 0-10 的离散值，由 Scorer 评估或通过访问频率（Access Count）强化。
- **Logarithmic Decay (对数时间衰减)**: 相比指数衰减，对数衰减能更好地保留“虽然久远但极度重要”的核心记忆。

### 3.2. 记忆强化机制 (Reinforcement Learning)

PeroCore 实现了类似神经元突触强化的机制：

- **访问计数 (Access Count)**: 每次记忆被成功检索，其 `access_count` 加 1。
- **重要性强化**: 每次被激活时，其 `base_importance` 会获得微小提升，从而在未来的检索中拥有更高的竞争力，实现“常用的知识更深刻”。
- **思维簇 (Thinking Clusters)**: `ReflectionService` 会定期将记忆归类为“计划”、“社交”、“创造”、“知识”等簇，增强特定语境下的检索专注度。

## 4. 时序与上下文 (Temporal Context)

为了解决 RAG 系统常见的"碎片化"问题（即只检索到孤立的片段，丢失了前因后果），我们引入了双向链表结构。

- **prev_id / next_id**: 每个记忆节点都存储了其前驱和后继节点的 ID。
- **上下文注入**: 在 TriviumDB 图遍历过程中，除了语义关联，搜索也会沿着时间轴（Prev/Next）自然连接生成的边进行扩散。
- **叙事重构**: 当检索到一个关键事件时，系统会自动拉取其前后的节点，重组为一个完整的"情景记忆 (Episodic Memory)"片段，让 AI 理解事情的来龙去脉。

## 5. 后台维护服务 (Background Services)

记忆系统的健康运行依赖于一系列后台异步服务（Workers）：

### 5.1. ScorerService (评分器)

- **职责**: 实时监听 `ConversationLog`。
- **动作**: 当一段对话结束，Scorer 会调用 LLM 分析对话内容，提取关键信息（Fact/Event），计算情感（Sentiment）和重要性，并生成新的记忆节点。
- **去噪**: 自动过滤掉"Thinking"过程和无意义的寒暄，只保留核心交互。

### 5.2. ReflectionService (整合服务)

- **职责**: 周期性维护长期记忆的质量。
- **Consolidation (记忆整合)**: 扫描那些陈旧（>3天）且重要性较低（Importance < 4）的碎片记忆。
- **压缩**: 调用 LLM 将这些碎片合并为一条更概括的"陈述性记忆"（例如将"周一吃了苹果"、"周二吃了香蕉"合并为"用户喜欢吃水果"），然后删除原始碎片。这极大地节省了存储空间并提高了检索质量。

## 6. 检索全流程详解 (Retrieval Pipeline v2)

当用户发送消息时，系统按以下 8 个步骤进行混合检索：

1. **Anchor Position (锁点定位)**:
   - 从用户输入中提取关键词，在 `Memory` 表中查找 `type="entity"` 节点。
   - 在 TriviumDB `search_advanced` 中，匹配到的实体会被赋予高初始能量（默认 2.0），作为图扩散“入口”。

2. **Vector Recall (向量召回)**:
   - 使用 Embedding 对用户输入编码，从 TriviumDB 召回 Top-20 语义相似候选节点，注入初始能量。

3. **NMF Semantic Analysis (NMF 语义结构分析)** _(v2 新增)_:
   - 对 Entity 嵌入矩阵执行非负矩阵分解（Multiplicative Update NMF），得到 k 个语义主题向量组成的基矩阵 H。
   - 将查询向量投影到主题空间，输出三个诊断指标：`semantic_depth`（聚焦度）、`topic_coverage`（主题覆盖数）、`novelty`（新颖度）。
   - 基矩阵按 Agent 缓存，Entity 集合不变时跳过重算。

4. **Sparse Coding Residual (稀疏编码残差)** _(v2 新增, 由 NMF novelty 门控)_:
   - `novelty` 超过阈值时触发：使用 FISTA 算法求解 LASSO 问题，得到查询的最稀疏 Entity 表示。
   - 计算残差向量 `R = query - reconstruction`，若残差范数足够大，以 R 为新查询发起二次向量检索，发现被主流结果逐蔽的次要意图。

5. **PEDSA + PPR Graph Spreading (PEDSA + 回家概率图扩散 - TriviumDB)** _(v2 增强)_:
   - 由 TriviumDB 原生负责，底层全自动执行 2 跳深度的 PEDSA 扩散。
   - 新增 `teleport_alpha` 回家概率：每步传播能量乘以 `(1-α)`，每步结束后将种子节点能量按 `α` 混合回初始値，防止能量在大图谱中发散到无关区域。

6. **Co-occurrence Boost (共现增益)** _(v2 新增)_:
   - 查询 `EntityCooccurrence` 表，获取本次锁点 Entity 的历史共现邻居。
   - 对共现邻居施加对数阻尼增益：`bonus = score × log(1 + co_count) × scale`，叠加在 PEDSA 扩散分上。

7. **Multi-dimensional Ranking (多维重排)**:
   - 应用混合评分公式，结合 GraphScore、VectorScore、Importance 和对数时间衰减，按综合分降序排列全部候选。

8. **DPP Diversity Sampling (DPP 多样性采样)** _(v2 新增)_:
   - 从排序后取 `limit × multiplier` 个候选，构建质量加权 L-ensemble 核矩阵。
   - 使用贪心行列式点过程（DPP）选取 `limit` 个内容多样且质量高的记忆，避免语义重叠的记忆重复占位。

9. **Reconstruction (语境重构)**:
   - 根据选定记忆的 `prev_id` 和 `next_id` 自动拉取前后上下文，格式化为自然语言文本注入 Prompt。

> **运行时参数调控**: 所有 v2 增强算法的开关与参数均通过 `backend/retrieval_params.json` 配置，支持**热更新**（修改文件后下次检索自动生效，无需重启服务）。

## 7. 数据结构 (Data Structures)

### 7.1. Memory Node (记忆节点)

```python
class Memory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    type: str = "event"          # entity(实体), event(事件), fact(事实), etc.
    clusters: Optional[str]      # 思维簇 (如 "计划", "社交")

    # 权重与动力学
    importance: int = 1          # 0-10 权重
    base_importance: float       # 基础重要性 (动态强化)
    access_count: int = 0        # 激活次数
    last_accessed: datetime      # 最后激活时间

    # 时序上下文 (Linked List)
    timestamp: float             # 毫秒级时间戳
    prev_id: Optional[int]
    next_id: Optional[int]

    agent_id: str = "pero"       # 隔离多 Agent
    embedding_json: str          # 向量数据
```

_(注: 传统的 `MemoryRelation` 以及 `EntityCooccurrence` 表已在此次全面重构中被清理废弃，其复杂的拓扑关系和相关统计能力现在全部交由 TriviumDB 内部原生的底层边结构（Edges）直接处理。)_

## 8. 开发者指南 (Developer Guide)

如果你需要修改记忆系统，请参考以下文件：

- **TriviumDB 接口封装**: `backend/services/memory/trivium_store.py` (底层核心对接点)
- **底层引擎源码**: 请参考与本项目同级的 `TriviumDB` 核心源码仓库
- **检索编排 (Python)**: `backend/services/memory/memory_service.py`（8 层记忆检索管线调用）
- **检索增强算法 (Python)**: `backend/services/memory/retrieval_enhancer.py`（NMF / FISTA / DPP / 共现增益）
- **图谱构建 (Python)**: `backend/services/memory/reflection_service.py`（GraphGardener + 共现统计）
- **数据模型 (Python)**: `backend/models.py`（Memory / MemoryRelation / EntityCooccurrence）
- **运行时参数**: `backend/retrieval_params.json`（热更新，无需重启）
