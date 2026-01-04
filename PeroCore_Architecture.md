# PeroCore 技术架构文档 (Technical Architecture)

> **版本**: 3.0 (Rust Core Integration & Hybrid Storage)
> **最后更新**: 2026-01-04
> **适用范围**: 核心开发者与架构师

## 1. 概览 (Overview)

PeroCore 是 Perofamily 项目的核心后端服务，定位为一个**高性能、具备自我反思能力与长时记忆的桌面伴侣 Agent 宿主环境**。

在 3.0 版本中，PeroCore 完成了**底层架构的重大重构**，引入了 **Rust Core** (`pero_rust_core`) 作为高性能计算内核。通过 PyO3 将 Python 的灵活性与 Rust 的极致性能（内存安全、零拷贝、并发）相结合，实现了向量检索、图谱扩散激活、文本清洗等计算密集型任务的原子化与加速。

**核心技术亮点**：
*   **Rust-Native Vector Engine**: 摒弃了沉重的外部向量库（如 ChromaDB），自研基于 `usearch` + `RwLock` 的轻量级、原子性 HNSW 向量索引，支持百万级记忆毫秒级召回。
*   **Spreading Activation Graph**: 基于 Rust 实现的扩散激活引擎，在内存中构建高频访问的记忆关联子图，模拟人脑的“联想发散”过程。
*   **NIT 2.0 Protocol**: 内置微型解释器，支持变量传递、异步任务编排与错误反思的 Agent DSL。
*   **Atomic Persistence**: 关键数据（索引、图谱）采用 Rust 实现的原子化保存策略，杜绝因断电/崩溃导致的数据损坏。

---

## 2. 系统分层架构 (Layered Architecture)

系统采用 **Python (业务逻辑) + Rust (计算内核)** 的混合架构：

### 2.1 接口层 (Interface Layer)
*   **REST API**: `FastAPI` 提供对话、记忆查询、状态管理的标准接口。
*   **WebSocket**: 
    *   `/ws/voice`: 音频流实时处理通道。
    *   `/ws/browser`: 浏览器操作指令通道。

### 2.2 核心服务层 (Python Services Layer)
负责业务流程编排与状态管理：
*   **Agent Service**: 核心控制器。负责 Prompt 构建、LLM 交互、NIT 脚本分发。
*   **Memory Service**: 记忆中枢。协调 SQLModel (元数据) 与 VectorStore (语义索引) 的读写。
*   **Memory Secretary**: 后台“海马体”服务。负责记忆的异步整理、压缩、遗忘与合并（Dreaming）。
*   **Vector Store Service**: **(New)** Python 侧的向量服务封装，负责加载 `pero_rust_core` 提供的底层索引，并管理多模态 Embedding 模型。

### 2.3 高性能计算层 (Rust Core Layer)
位于 `backend/rust_core`，通过 `maturin` 编译为 Python 扩展模块 (`pero_rust_core`)：
*   **VectorIndex**: 封装 `usearch`，提供线程安全的 HNSW 索引，支持 `add`, `search`, `save` (原子写)。
*   **SpreadingActivationEngine**: 内存图计算引擎，处理记忆节点的能量扩散算法。
*   **TextCleaner**: 基于 Rust `regex` 的高性能文本清洗器，处理 Base64 去除、敏感词过滤等 CPU 密集型任务。

### 2.4 数据基础设施层 (Data Infrastructure)
*   **SQLite**: 存储 `Memory` (元数据), `ConversationLog`, `Relation` (全量图谱) 等结构化数据。
*   **RustDB (Local File System)**: 
    *   `*.index`: 二进制向量索引文件 (Memory & Tags)。
    *   `*.json`: 标签映射表与配置。
    *   **特点**: 无需额外部署数据库服务，文件级原子操作，轻量且高效。

---

## 3. 核心模块详解 (Core Modules)

### 3.1 Rust Core (高性能内核)
这是 3.0 版本的核心升级点。

#### 3.1.1 VectorIndex (向量检索引擎)
*   **实现**: 基于 `usearch` (C++/Rust bindings) 封装。
*   **特性**:
    *   **Thread-Safe**: 使用 `Arc<RwLock<Index>>` 保证多线程并发读写的安全性。
    *   **Atomic Save**: 实现“写入临时文件 -> 原子重命名”的落盘策略，彻底解决崩溃导致索引损坏的问题。
    *   **Lazy Loading**: Python 侧实现懒加载，仅在首次查询时读取磁盘文件，加快启动速度。

#### 3.1.2 Spreading Activation (扩散激活引擎)
*   **逻辑**: 模拟神经元激活。当检索到一个记忆节点（Anchor）时，能量会沿着关系网（Relation）向四周扩散。
*   **算法**:
    ```rust
    // Rust 伪代码
    for _ in 0..steps {
        for (node, energy) in current_nodes {
            for neighbor in node.neighbors {
                next_nodes[neighbor] += energy * weight * decay;
            }
        }
    }
    ```
*   **性能**: 相比 Python 实现提升 50-100 倍，允许在单次 Request 中进行深度的图谱遍历。

### 3.2 Memory System (双模态记忆系统)

PeroCore 的记忆系统由“热数据”（向量索引）和“冷数据”（SQL 数据库）共同构成：

| 组件 | 技术栈 | 职责 |
| :--- | :--- | :--- |
| **Semantic Cortex** | **Rust VectorIndex** | 负责“模糊联想”。存储 `(id, embedding)`，提供 Top-K 相似度搜索。 |
| **Episodic Store** | **SQLite (Memory Table)** | 负责“精准回忆”。存储完整文本、时间戳 (`prev/next` 链表)、标签与元数据。 |
| **Associative Net** | **SQLite + Rust Graph** | 负责“逻辑推理”。数据库存储全量关系，Rust 引擎加载热点子图进行实时计算。 |

### 3.3 NIT 2.0 Engine (解释器)
支持 `<nit>` 脚本的嵌入式解释器，实现复杂的工具链调用。

*   **Parser**: 将脚本解析为 AST (Abstract Syntax Tree)。
*   **Runtime**: 支持 `async` 异步非阻塞调用，允许 Agent 在后台执行耗时任务（如爬虫、文件分析）的同时继续与用户对话。
*   **Reflection**: 运行时捕获异常，并反馈给 LLM 进行自我修正。

---

## 4. 关键交互流程 (Interaction Flows)

### 4.1 记忆检索流程 (The Retrieval Path)
当 User 发送 Query 时：
1.  **Embed**: Python 调用 Embedding 模型生成 `query_vec`。
2.  **Recall (Rust)**: 调用 `vector_store.search_memory(query_vec)`，Rust 索引毫秒级返回 Top-20 候选 ID。
3.  **Expand (Rust)**: 将 Top-20 ID 传入 `SpreadingActivationEngine`，在关系网中进行 2-3 层能量扩散，挖掘潜在相关记忆。
4.  **Fetch (SQL)**: 根据最终得分高的 ID，从 SQLite 批量拉取完整文本与时间上下文 (`prev/next`)。
5.  **Rerank**: 综合语义分、关联分与时间衰减 (`Decay`)，生成最终 Context。

### 4.2 记忆写入流程 (The Ingestion Path)
1.  **Analysis**: Scorer 分析对话，生成新记忆。
2.  **SQL Write**: 存入 SQLite，获取自增 ID。
3.  **Vector Write (Rust)**: 调用 `vector_store.add_memory(id, vec)`。
    *   Rust 端获取写锁。
    *   更新内存中的 HNSW 结构。
    *   触发原子化 `save()` 落盘 (或定期触发)。

---

## 5. 开发指南 (Development)

### 5.1 Rust Core 编译
```bash
cd backend/rust_core
maturin develop --release
# 或者构建 wheel
maturin build --release
```

### 5.2 目录结构
```
PeroCore/
├── backend/
│   ├── rust_core/          # Rust 源码 (lib.rs)
│   ├── services/
│   │   ├── vector_store_service.py  # Rust 模块的 Python 封装
│   │   └── ...
│   ├── rust_db/            # [GitIgnored] 本地向量索引文件存储
│   └── ...
```
