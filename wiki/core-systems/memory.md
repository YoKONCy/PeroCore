# 记忆系统 (Memory System) - KDN

PeroCore 的记忆系统不仅仅是一个简单的 RAG（检索增强生成）数据库，而是一个基于**认知科学**原理构建的**知识扩散网络 (Knowledge Diffusion Network, KDN)**。它模拟了人类大脑的"激活扩散"机制，让 AI 能够像人类一样通过联想来回忆信息，而不仅仅是关键词匹配。

## 1. 核心架构 (Core Architecture)

记忆系统采用 **Python + Rust** 的混合架构，兼顾了业务逻辑的灵活性和计算的高性能。

Python 层负责存储和业务逻辑，Rust 层作为计算引擎处理向量搜索和图谱扩散。

<ArchitectureGraph />

## 2. 核心组件 (Core Components)

### 2.1. 认知图谱引擎 (Cognitive Graph Engine)
位于 `backend/rust_core`，这是记忆系统的心脏。它维护了一个内存中的动态图结构。

*   **PEDSA 算法 (Parallel Energy-Decay Spreading Activation)**:
    这是我们核心的激活扩散算法。当一个记忆节点被激活（例如通过语义搜索匹配到），能量会沿着突触（关系边）向四周扩散。
    *   **能量衰减 (Decay)**: 能量在传播过程中会随距离衰减，确保只有真正相关的上下文被唤醒。
    *   **并行计算**: 利用 Rust 的并发特性，高效处理大规模节点的能量流动。

*   **Simulated CSR (Compressed Sparse Row)**:
    为了极致的内存效率，我们在 Rust 中使用 `SmallVec` 实现了一种动态的邻接表结构，模拟 CSR 的紧凑性，同时支持动态更新。这使得我们能够在有限的内存中存储数百万级的关联关系。

### 2.2. 意图引擎 (Intent Engine)
同样位于 `backend/rust_core`。
*   **SIMD 加速**: 利用 AVX2 (x86) 或 NEON (ARM) 指令集加速向量点积运算（Cosine Similarity）。
*   **功能**: 负责将用户的自然语言输入转化为高维空间中的坐标，并快速定位图谱中的"入口节点"。

### 2.3. 存储层 (Storage Layer)
位于 `backend/models.py` 和 `backend/services/memory_service.py`。

<MemoryNetworkGraph />

*   **Memory Table**: 存储记忆的具体内容、Embedding 向量和重要性权重。
*   **MemoryRelation Table**: 存储记忆之间的关联（突触），定义了图谱的拓扑结构。
*   **ConversationLog**: 感觉记忆（Sensory Memory），用于暂存短期对话流。

## 3. 记忆动力学 (Memory Dynamics)

PeroCore 的记忆不是静态存储的，而是像生物神经元一样具有动态权重，随时间推移和访问频率而变化。

### 3.1. 权重计算公式 (Weight Calculation)
每个记忆节点在检索时的最终得分（Retrieval Score）由以下公式决定：

$$ Score = (Sim \times 0.7) + ClusterBonus + (Importance \times 0.3 \times Decay(t)) + RecencyBonus $$

*   **Sim (Similarity)**: 向量检索的原始相似度分数。
*   **ClusterBonus**: **记忆簇 (Memory Cluster)** 奖励。如果当前对话意图命中特定的簇（如"计划"、"创造"、"反思"），且记忆节点属于该簇，则给予额外加分（+0.15）。这有助于让 AI 在特定语境下更"专注"。
*   **Importance**: 记忆的基础重要性（归一化到 0-1），由 Scorer 在写入时评估。
*   **Decay(t)**: **艾宾浩斯遗忘曲线 (Ebbinghaus Forgetting Curve)**。
*   **RecencyBonus**: 近期性奖励。短期记忆（<1天）会获得线性提升的额外权重，模拟"工作记忆"的高活性。

### 3.2. 遗忘机制 (Forgetting Mechanism)
我们模拟了人类的遗忘规律，确保 AI 不会被陈旧的琐事困扰，但又能铭记重要的核心事实。

*   **衰减函数**: $Decay(t) = e^{-0.023 \times \Delta t_{days}}$
    *   这意味着一个记忆在 30 天后，其基于重要性的权重分量会衰减至约 50%。
    *   **对抗遗忘**: 每次记忆被成功检索并使用（Re-activation），其 `importance` 会获得微小提升，从而抵抗未来的衰减。这实现了"常用的知识记得更牢"。

## 4. 时序与叙事 (Temporal Context)

为了解决 RAG 系统常见的"碎片化"问题（即只检索到孤立的片段，丢失了前因后果），我们引入了双向链表结构。

*   **prev_id / next_id**: 每个记忆节点都存储了其前驱和后继节点的 ID。
*   **上下文注入**: 在 Rust 扩散过程中，除了语义关联，能量也会沿着时间轴（Prev/Next）流动。
*   **叙事重构**: 当检索到一个关键事件时，系统会自动拉取其前后的节点，重组为一个完整的"情景记忆 (Episodic Memory)"片段，让 AI 理解事情的来龙去脉。

## 5. 后台维护服务 (Background Services)

记忆系统的健康运行依赖于一系列后台异步服务（Workers）：

### 5.1. ScorerService (秘书)
*   **职责**: 实时监听 `ConversationLog`。
*   **动作**: 当一段对话结束，Scorer 会调用 LLM 分析对话内容，提取关键信息（Fact/Event），计算情感（Sentiment）和重要性，并生成新的记忆节点。
*   **去噪**: 自动过滤掉"Thinking"过程和无意义的寒暄，只保留核心交互。

### 5.2. ReflectionService (整合者)
*   **职责**: 周期性维护长期记忆的质量。
*   **Consolidation (记忆整合)**: 扫描那些陈旧（>3天）且重要性较低（Importance < 4）的碎片记忆。
*   **压缩**: 调用 LLM 将这些碎片合并为一条更概括的"陈述性记忆"（例如将"周一吃了苹果"、"周二吃了香蕉"合并为"用户喜欢吃水果"），然后删除原始碎片。这极大地节省了存储空间并提高了检索质量。

## 6. 检索全流程详解 (Retrieval Pipeline)

当用户发送一条消息时，系统按以下步骤决定注入哪些记忆：

1.  **Trigger (触发)**:
    *   对用户输入进行 Embedding。
    *   **Intent Clustering**: 检测输入是否属于特定意图簇（如"制定计划"）。
    *   **Vector Recall**: 从 VectorDB 召回 Top-60 个语义相似的候选节点。

2.  **Spreading (扩散 - Rust)**:
    *   将召回的节点作为"锚点 (Anchors)"注入认知图谱。
    *   执行 **PEDSA** 算法，能量在语义网络和时间轴上扩散 1-2 跳。
    *   收集所有被激活的节点 ID（包括锚点和被联想唤醒的节点）。

3.  **Ranking (排序)**:
    *   应用上述的 **权重计算公式**。
    *   结合语义分数、簇奖励、时间衰减和近期奖励，计算最终得分。
    *   截取 Top-K（通常为 10-20 个）。

4.  **Rerank (重排序)**:
    *   (可选) 使用 Cross-Encoder 对 Top-K 结果进行精细的语义重排序，确保相关性最高。

5.  **Reconstruction (重构)**:
    *   将最终选定的节点格式化为自然语言文本，注入到 Prompt 的 `Context` 部分。

## 7. 数据结构 (Data Structures)

### 7.1. Memory Node (神经元)
```python
class Memory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str          # 记忆内容
    tags: str = ""        # 索引标签
    importance: int = 1   # 长期增强 (LTP) 权重
    embedding_json: str   # 向量数据 (JSON string)
    
    # 双向链表结构，用于维护时序上下文
    prev_id: Optional[int]
    next_id: Optional[int]
```

### 7.2. Synapse (突触/关系)
```python
class MemoryRelation(SQLModel, table=True):
    source_id: int        # 突触前神经元
    target_id: int        # 突触后神经元
    strength: float       # 连接强度 (决定能量传导效率)
    relation_type: str    # 关系类型 (e.g., "causes", "is_a", "related_to")
```

## 8. 开发者指南 (Developer Guide)

如果你需要修改记忆系统，请参考以下文件：

*   **核心算法 (Rust)**: `backend/rust_core/src/lib.rs` (包含 `CognitiveGraphEngine` 实现)
*   **向量搜索 (Rust)**: `backend/rust_core/src/intent_engine.rs`
*   **业务编排 (Python)**: `backend/services/memory_service.py`
*   **数据模型 (Python)**: `backend/models.py`
