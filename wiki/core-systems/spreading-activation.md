# 扩散激活算法 (Spreading Activation)

> **"Stop Vector Search, Start Knowledge Diffusion."**
>
> 传统的向量检索 (Vector Search) 只能找到“长得像”的片段，而扩散激活 (Spreading Activation) 能找到“有关系”的逻辑链。

PeroCore 的核心记忆引擎基于 **PEDSA (Parallel Energy-Decay Spreading Activation)** 算法构建。这是一种受认知神经科学启发的图计算模型，旨在模拟人类大脑在回忆事物时的“联想”过程。

## 1. 核心原理：PEDSA 算法

PEDSA 全称为 **并行能量衰减扩散激活** 算法，由 PeroCore 团队自主研发。它不仅仅是简单的图遍历，而是一个模拟能量在神经网络中流动、衰减和汇聚的动力学系统。

### 1.1 能量传播公式

在每一轮扩散（Step）中，节点 $j$ 接收到的能量 $E_{t+1}(j)$ 由其所有上游邻居节点 $i$ 传递而来：

$$E_{t+1}(j) = \sum_{i \in Neighbors(j)} \left( E_t(i) \times W_{ij} \times D_{decay} \right)$$

其中：
*   $E_t(i)$: 节点 $i$ 在当前时刻的能量值。
*   $W_{ij}$: 节点 $i$ 到节点 $j$ 的连接强度（突触权重），范围 $[0, 1]$。
*   $D_{decay}$: 全局能量衰减系数（Decay Factor），通常取 $0.5 \sim 0.9$。

### 1.2 关键特性

*   **动态剪枝 (Dynamic Pruning)**: 为了在千万级节点中保持毫秒级响应，算法在每一步扩散后，只保留能量最高的 **Top-K**（默认 10,000）个活跃节点继续下一轮传播。这有效抑制了“计算爆炸”，同时保留了最重要的信号。
*   **能量衰减 (Energy Decay)**: 能量随着传播距离指数级衰减，确保只有紧密相关的概念被激活，避免“蝴蝶效应”导致的无关联想。
*   **并行计算 (Parallelization)**: 底层使用 Rust 的 `rayon` 库实现无锁并行计算，充分利用多核 CPU 性能。

### 1.3 为什么不是 RAG？

传统的 RAG (Retrieval-Augmented Generation) 依赖于 Top-K 向量相似度搜索，存在以下缺陷：
1.  **孤岛效应**: 只能找到字面或语义相似的片段，无法发现通过逻辑链条（A -> B -> C）连接的知识。
2.  **多跳性能崩塌**: 执行多步推理时，延迟呈指数级增长。
3.  **超级节点困境**: 难以处理像“我”、“是”这种高频连接的超级节点（Hubs）。

PEDSA 通过图结构和能量流动，天然解决了上述问题，实现了 **O(1)** 复杂度的多跳逻辑穿透。

---

## 2. 向量的生命周期 (Lifecycle of a Vector)

当用户输入一句话时，它在 PeroCore 记忆网络中的旅程如下：

### 第一阶段：感知与向量化 (Sensation & Embedding)
*   **输入**: 用户说 "System, tell me about Apple."
*   **处理**: 文本被送入 Embedding 模型（如 `all-MiniLM-L6-v2` 等本地模型）。
*   **产物**: 一个 384 维的高维浮点向量 $V_{input}$。

### 第二阶段：共振与锚点搜索 (Resonance & Anchor Search)
*   **动作**: 引擎使用 **SIMD 加速** 的点积运算，计算 $V_{input}$ 与现有记忆库中所有节点的相似度。
*   **筛选**: 选取相似度最高的 Top-N 个节点（例如 Top 10），作为“初始激活点”（Intent Anchors）。
*   **意义**: 这相当于大脑在听到关键词时，瞬间“点亮”的几个核心概念（如“苹果公司”、“乔布斯”、“水果”）。

### 第三阶段：能量扩散 (Diffusion)
*   **动作**: 初始激活点被赋予初始能量（如 1.0），开始向周围扩散。
    *   **Step 1**: “苹果公司”激活了“iPhone”、“MacBook”、“库克”。
    *   **Step 2**: “iPhone”进一步激活了“iOS”、“智能手机”。
*   **控制**: 每一跳能量都会乘以衰减系数（Decay），且低于阈值的微弱信号会被丢弃。

### 第四阶段：涌现与汇聚 (Emergence & Convergence)
*   **动作**: 经过数轮扩散后，系统收集所有被激活的节点。
*   **排序**: 按最终累积能量值降序排列。
*   **结果**: 最终提取出的不仅仅是包含“Apple”的句子，还可能包含“Steve Jobs”或“1984”，即使这些内容在原始输入中从未出现。这就是**联想**。

---

## 3. 核心库：pero-memory-core

我们将 PeroCore 的扩散激活引擎封装为了独立的 Python 库 `pero-memory-core`，底层由 Rust 编写，兼具 Python 的易用性和 Rust 的极致性能。

### 3.1 安装

```bash
pip install pero-memory-core
```

### 3.2 快速上手示例

以下代码展示了如何初始化引擎、构建简单的联想网络并执行扩散：

```python
from pero_memory_core import CognitiveGraphEngine

# 1. 初始化引擎
# max_active_nodes: 每层最大活跃节点数
# max_fan_out: 每个节点最大扩散分支数
engine = CognitiveGraphEngine(max_active_nodes=10000, max_fan_out=20)

# 2. 注入记忆 (源ID, 目标ID, 关联强度)
# 这种关联是有向且带权的，模拟突触连接
# 模拟逻辑链: 苹果 -> 乔布斯 -> 皮克斯 -> 玩具总动员
connections = [
    (101, 102, 0.9),  # "Apple" -> "Steve Jobs"
    (102, 103, 0.85), # "Steve Jobs" -> "Pixar"
    (103, 104, 0.7)   # "Pixar" -> "Toy Story"
]
engine.batch_add_connections(connections)

# 3. 执行激活扩散 (PEDSA)
# initial_scores: 初始激活点 {节点ID: 初始能量}
# steps: 扩散步数 (逻辑链深度)
# decay: 能量衰减系数
results = engine.propagate_activation(
    initial_scores={101: 1.0}, # 从 "Apple" 开始联想
    steps=3, 
    decay=0.8
)

# 4. 输出结果
print("联想结果 (按能量排序):")
for node_id, score in sorted(results.items(), key=lambda x: x[1], reverse=True):
    print(f"节点 ID: {node_id}, 激活能量: {score:.4f}")

# 预期输出:
# 节点 101 (Apple): 能量最高 (源头)
# 节点 102 (Steve Jobs): 被强激活
# 节点 103 (Pixar): 被次级激活
# 节点 104 (Toy Story): 被微弱激活 (如果步数够多且衰减没耗尽能量)
```

### 3.3 性能指标

在百万级边（Edges）的测试环境下：
*   **单步检索延迟**: < 3ms
*   **11步深层逻辑穿透**: < 5ms
*   **内存占用**: 相比传统向量索引降低 70%

> 引擎已针对 AVX2/AVX-512 指令集进行优化，在现代 CPU 上可获得最佳性能。
