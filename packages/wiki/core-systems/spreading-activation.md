# 加权图遍历算法 (Weighted Graph Traversal)

> **"Stop Vector Search, Start Graph Traversal."**
>
> 传统的向量检索 (Vector Search) 只能找到“长得像”的片段，而加权图遍历 (Weighted Graph Traversal) 能找到“有关系”的逻辑链。

PeroCore 的核心记忆引擎基于 **PEDSA (Parallel Energy-Decay Spreading Activation)** 算法构建。这是一种加权图计算模型，旨在模拟关联检索过程。

## 1. 核心原理：PEDSA 算法

PEDSA 全称为 **并行权重衰减传播** 算法，由 PeroCore Team 自研。它是一个模拟权重在图中传播、衰减和汇聚的动力学系统。
v2 引入了 **PPR 回家概率**，进一步强化了图扩散对查询的主题相关性约束。

### 1.1 传播公式

在每一轮遍历（Step）中，节点 $j$ 接收到的传播分值 $E_{t+1}(j)$ 由其所有上游邻居节点 $i$ 传递而来：

$$E_{t+1}(j) = (1-\alpha) \sum_{i \in Neighbors(j)} \left( E_t(i) \times W_{ij} \times D_{decay} \right) + \alpha \cdot E_0(j)$$

其中：

- $E_t(i)$: 节点 $i$ 在当前时刻的分数。
- $W_{ij}$: 节点 $i$ 到节点 $j$ 的连接权重，范围 $[0, 1]$。
- $D_{decay}$: 全局衰减系数（Decay Factor），通常取 $0.5 \sim 0.9$。
- $\alpha$: PPR 回家概率（Teleport Alpha），默认 $0.0$（不启用），推荐 $0.1 \sim 0.2$。
- $E_0(j)$: 节点 $j$ 的初始种子能量（非种子节点则为 0）。

### 1.2 关键特性

- **动态剪枝 (Dynamic Pruning)**: 为了在千万级节点中保持毫秒级响应，算法在每一步传播后，只保留分数最高的 **Top-K**（默认 10,000）个活跃节点继续下一轮传播。这有效抑制了“计算爆炸”，同时保留了最重要的信号。
- **权重衰减 (Weight Decay)**: 分数随着传播距离指数级衰减，确保只有紧密相关的概念被检索，避免无关联想。
- **并行计算 (Parallelization)**: 底层使用 Rust 的 `rayon` 库实现无锁并行计算，充分利用多核 CPU 性能。
- **PPR 回家概率 (Teleport)** _(v2 新增)_: 引入 PageRank 中的 “回家”弹动机制。在每步传播中，传播能量乘以 `(1-α)`，并将种子节点的当前能量按 `α` 混合回初始値。当 `α=0` 时等价于原始 PEDSA；当 `α=0.15` 时扩散范围实现较弱的收敛，防止能量在大图谱中漂移到无关区域。

### 1.3 为什么不是 RAG？

传统的 RAG (Retrieval-Augmented Generation) 依赖于 Top-K 向量相似度搜索，存在以下缺陷：

1.  **孤岛效应**: 只能找到字面或语义相似的片段，无法发现通过逻辑链条（A -> B -> C）连接的知识。
2.  **多跳性能崩塌**: 执行多步推理时，延迟呈指数级增长。
3.  **超级节点困境**: 难以处理像“我”、“是”这种高频连接的超级节点（Hubs）。

PEDSA 通过图结构和权重传播，天然解决了上述问题，实现了 **O(1)** 复杂度的多跳逻辑穿透。

---

## 2. 向量的生命周期 (Lifecycle of a Vector)

当用户输入一句话时，它在 PeroCore 记忆网络中的流程如下：

### 第一阶段：向量化 (Embedding)

- **输入**: 用户说 "System, tell me about Apple."
- **处理**: 文本被送入 Embedding 模型（如 `all-MiniLM-L6-v2` 等本地模型）。
- **产物**: 一个 384 维的高维浮点向量 $V_{input}$。

### 第二阶段：锚点搜索 (Anchor Search)

- **动作**: 引擎使用 **SIMD 加速** 的点积运算，计算 $V_{input}$ 与现有记忆库中所有节点的相似度。
- **筛选**: 选取相似度最高的 Top-N 个节点（例如 Top 10），作为“初始锚点”（Intent Anchors）。
- **意义**: 这相当于找到了几个核心概念（如“苹果公司”、“乔布斯”、“水果”）。

### 第三阶段：图遍历 (Traversal)

- **动作**: 初始锚点被赋予初始分数（如 1.0），开始向周围传播。
  - **Step 1**: “苹果公司”关联到了“iPhone”、“MacBook”、“库克”。
  - **Step 2**: “iPhone”进一步关联到了“iOS”、“智能手机”。
- **控制**: 每一跳分数都会乘以衰减系数（Decay），且低于阈值的微弱信号会被丢弃。

### 第四阶段：汇聚 (Convergence)

- **动作**: 经过数轮传播后，系统收集所有被命中的节点。
- **排序**: 按最终累积传播分数降序排列。
- **结果**: 最终提取出的不仅仅是包含“Apple”的句子，还可能包含“Steve Jobs”或“1984”，即使这些内容在原始输入中从未出现。这就是**关联检索**。

---

## 3. 核心引擎：TriviumDB

我们将图遍历、向量检索和属性图谱统一封装为了三位一体的 AI 原生嵌入式引擎 **TriviumDB**。底层由 Rust 编写，兼具 Python 的易用性和 Rust 的极致性能。

### 3.1 安装

```bash
pip install triviumdb
```

### 3.2 快速上手示例

以下代码展示了如何初始化引擎、构建简单的关联网络并执行检索传播：

```python
import triviumdb

# 1. 初始化引擎
db = triviumdb.TriviumDB("demo.tdb", dim=1536)

# 2. 注入关联关系 (结合具体的向量与属性)
# 假定节点已经通过 db.insert([...], payload) 录入
db.link(101, 102, label="associative", weight=0.9)  # "Apple" -> "Steve Jobs"
db.link(102, 103, label="associative", weight=0.85) # "Steve Jobs" -> "Pixar"
db.link(103, 104, label="associative", weight=0.7)  # "Pixar" -> "Toy Story"

# 3. 执行高级检索 (向量召回 + PEDSA 图扩散 + PPR + 多样性采样)
results = db.search_advanced(
    query_vector=[0.1, ...],
    top_k=5,
    expand_depth=3,      # 扩散 3 跳
    teleport_alpha=0.15, # PPR 回家概率 (防止过度扩散发散)
    enable_dpp=True      # 开启行列式点过程质量多样性采样
)

# 4. 输出结果
print("关联结果:")
for hit in results:
    print(f"节点 ID: {hit.id}, 综合分数: {hit.score:.4f}")
```

### 3.3 性能指标

在千万级边（Edges）的测试环境下：

- **单步检索延迟**: < 3ms
- **11步深层逻辑穿透**: < 5ms
- **内存占用**: 相比传统向量索引+独立图数据库降低 70%

> 引擎已针对多线程 Mmap / Rayon 并行进行深度优化，在现代 CPU 系统中可以做到零拷贝极速热启动。
