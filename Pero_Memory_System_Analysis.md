# PeroCore 记忆与存储系统深度解析与设计 (Memory System Analysis & Design)

> **文档版本**: V2.0 (Merged)
> **整合对象**: 原 `Pero_Memory_System_Analysis.md` & `PeroCore_Memory_Base_Design.md`
> **核心目标**: 构建一个自我维护、动态生长、仿生的记忆生态系统。

---

## 1. 设计哲学与系统架构 (Philosophy & Architecture)

### 1.1 设计哲学
传统的 AI 记忆系统（如简单 RAG）往往是扁平、静态且缺乏生命力的。PeroCore 的“长记忆基底”旨在模拟人类大脑的记忆特性：

- **时间连续性 (Time Continuity)**：记忆是串联在时间轴上的故事，而非孤立的片段。
- **语义关联性 (Semantic Association)**：相似或相关的记忆会自发形成关联网（Chain-Net），模拟大脑的联想机制。
- **动态演化性 (Dynamic Evolution)**：记忆具有生命周期，会随时间衰减，也会因反复提取而增强，甚至会发生重组与融合。
- **自我维护性 (Self-Maintenance)**：Pero 拥有独立的潜意识（Memory Secretary），在后台自主整理、清洗和升华记忆，无需人工干预。

### 1.2 系统架构概览
Pero 的记忆系统采用 **"混合存储 + 双层加工"** 的架构。它不依赖单一的数据库，而是结合了关系型数据库 (SQLite) 的结构化能力和向量数据库 (ChromaDB) 的语义检索能力。

```mermaid
graph TD
    subgraph "Input Layer (感知)"
        Chat[用户对话] -->|Log| RawLogs[ConversationLog (SQLite)]
    end

    subgraph "Processing Layer (加工 - Scorer Service)"
        RawLogs -->|Async Analysis| Scorer[Scorer AI (秘书)]
        Scorer -->|Extract| Fact[事实/事件]
        Scorer -->|Extract| Emotion[情感/偏好]
        Scorer -->|Summarize| Summary[摘要]
    end

    subgraph "Storage Layer (存储)"
        direction TB
        Fact & Emotion & Summary -->|Save| MemoryDB[(SQLite - Memory Table)]
        Fact & Emotion & Summary -->|Embed| VectorDB[(ChromaDB - Vectors)]
        
        MemoryDB <-->|Chain-Net| Relations[MemoryRelation (关联图谱)]
        MemoryDB <-->|Linked List| TimeAxis[Time Axis (prev/next)]
    end

    subgraph "Retrieval Layer (回忆 - Memory Service)"
        Query[用户提问] -->|Vector Search| VectorDB
        VectorDB -->|Candidates| Candidates[候选记忆]
        Candidates -->|Spreading Activation| GraphSearch[图谱扩散 (Chain-Net)]
        GraphSearch -->|Rerank| FinalMemories[最终记忆上下文]
    end

    subgraph "Maintenance Layer (维护 - Secretary)"
        MemoryDB -->|Consolidate| Dream[做梦/整理]
        Dream -->|Update| MemoryDB
    end
```

---

## 2. 数据库模型详解 (Data Schema)

系统使用了两种主要的存储引擎：**SQLite** (海马体/皮层) 和 **ChromaDB** (联想皮层)。

### 2.1 结构化存储 (SQLite)

#### A. 记忆核心表 (`Memory`)
存储单条记忆的原始信息与核心属性。这是**核心记忆原子**。

| 字段 | 类型 | 说明 | 用途与逻辑 |
| :--- | :--- | :--- | :--- |
| `id` | Integer (PK) | 唯一标识 | 主键 |
| `content` | Text | 记忆内容 | 具体的事件描述或事实 |
| `type` | String | 记忆类型 | `event`, `fact`, `preference`, `interaction_summary`, `tool_experience` |
| `tags` | String | 标签 | 逗号分隔的语义标签 (e.g., "日常, 编程") |
| `clusters` | String | 思维簇 | 所属的高层思维簇 (e.g., "[逻辑推理簇]") |
| `importance` / `base_importance` | Float/Int | 重要性 | 初始评分 (1-10) 及当前权重 |
| `access_count` | Integer | 访问次数 | 用于回忆增强 (Reinforcement) |
| `last_accessed` | DateTime | 最后访问时间 | 用于计算遗忘曲线 |
| `timestamp` | Float | 时间戳 | 记忆产生的绝对时间 |
| `prev_id` | Integer (FK) | **前序记忆** | 构成时间轴的双向链表 |
| `next_id` | Integer (FK) | **后序记忆** | 构成时间轴的双向链表 |
| `embedding_json` | JSON String | 向量备份 | 语义向量的冷备份 (主要查询走 VectorDB) |

#### B. 记忆关联表 (`MemoryRelation`)
存储记忆之间的动态关联，构成 **Chain-Net 知识图谱**。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | Integer (PK) | 唯一标识 |
| `source_id` | Integer (FK) | 源记忆 ID |
| `target_id` | Integer (FK) | 目标记忆 ID |
| `relation_type` | String | `associative` (联想), `causal` (因果), `thematic` (主题) |
| `strength` | Float | 关联强度 (0.0 - 1.0) |
| `description` | String | 关联描述 (例如 "都提到了喜欢吃拉面") |

#### C. 原始对话流 (`ConversationLog`)
存储原始对话记录 (Raw History Logs)。

| 字段 | 说明 |
| :--- | :--- |
| `session_id` | 会话 ID |
| `role` | `user`, `assistant`, `system` |
| `content` | 原始对话内容 (超长技术内容会被折叠) |
| `pair_id` | 用于绑定问答对 |
| `metadata_json` | 额外元数据 |

#### D. 其他辅助表
*   **`PetState`**: 存储 Pero 的当前状态 (`mood`, `vibe`, `mind`) 及交互触发器。
*   **`MaintenanceRecord`**: 存储 `MemorySecretary` 的整理操作记录，支持“撤回”记忆修改。

### 2.2 向量存储 (ChromaDB)

| 集合 (Collection) | 存储内容 | 用途 |
| :--- | :--- | :--- |
| **`pero_memory`** | Document: `content`<br>Metadata: `tags`, `importance`, `timestamp` | **语义索引**。支持将 Tags 加权混入 Content 进行 Embedding。 |
| **`pero_tags`** | Document: `tag_name` | **标签索引**。用于 Tag Cloud 的语义聚类和搜索。 |

---

## 3. 核心机制与算法 (Core Mechanisms)

### 3.1 记忆写入流程 (Ingestion Pipeline)
1.  **记录 (Logging)**: 用户和 Pero 的对话被实时存入 `ConversationLog`。
2.  **异步分析 (Scoring)**: 
    *   后台 `ScorerService` (秘书) 读取未分析的 Log。
    *   调用 LLM 提取 **Fact**, **Sentiment**, **Importance**，并生成 3-5 个 **Tags**。
3.  **存储与链接 (Storage)**:
    *   存入 SQLite `Memory` 表。
    *   **链入主轴**: 自动找到上一条记忆，建立 `prev_id` -> `id` 连接。
    *   **向量化**: 计算 Embedding 并存入 ChromaDB。

### 3.2 权重衰减与增强算法 (Weight & Decay)
记忆的 **检索优先级 (Retrieval Score)** 由混合公式决定：

$$ Score = (Sim \times w_1) + (Importance \times w_2) \times \text{Decay}(t) + (\text{Recency} \times w_3) $$

*   **衰减函数 $\text{Decay}(t)$** (艾宾浩斯模拟):
    $$ \text{Decay}(t) = e^{-\lambda \Delta t} $$
    其中 $\Delta t$ 是当前时间与 `timestamp` 的差值。
*   **回忆增强**: 每次记忆被检索并使用，`access_count` +1，小幅提升 `base_importance`，抵抗遗忘。

### 3.3 记忆检索流程 (Chain-Net Retrieval)
当用户输入 Query 时，系统执行以下步骤：

1.  **向量召回 (Anchor Search)**:
    *   在 ChromaDB 中检索 Top 20 相似的记忆片段作为 **"锚点" (Anchors)**。
2.  **扩散激活 (Spreading Activation)**:
    *   **关系网扩散**: 沿着 `MemoryRelation` 寻找与锚点关联强度高的记忆。
    *   **时间轴扩散**: 沿着 `prev_id` / `next_id` 寻找时间轴前后的上下文。
3.  **重排序 (Reranking)**:
    *   综合相似度、时间权重、关联强度进行最终排序。
    *   使用 Cross-Encoder 或 LLM 选出 Top K。

### 3.4 记忆维护机制 (Self-Maintenance / Dreaming)
`MemorySecretaryService` 模拟大脑的“睡眠整理”机制：

1.  **记忆审计 (Auditor)**:
    *   清洗脏数据（逻辑矛盾、幻觉、过度重复）。
    *   检查时效性（如更新过时的偏好）。
2.  **灵魂映射 (Soul Mapper)**:
    *   从碎片对话中提炼 User 的长期特质 (`preference`)。
3.  **记忆固化 (Consolidation)**:
    *   将时间相近、主题相同的多条碎片记忆 (`event`) 合并为一条叙事性总结 (`interaction_summary`)。
    *   **去冗余**: 合并后删除原始碎片，释放空间。
4.  **维护记录**: 每次维护生成 `MaintenanceRecord`，支持全量撤回。

---

## 4. NIT协议与记忆系统的协同进化

### 4.1 工具使用经验的记忆化
NIT协议的每次工具调用都会成为记忆系统的一部分，形成 **"工具使用经验库"**。

```python
# NIT工具调用被自动记录为特殊类型的记忆
async def save_tool_usage_memory(tool_name: str, params: dict, result: any, success: bool):
    memory_content = f"使用工具 {tool_name} {'成功' if success else '失败'}"
    if not success:
        memory_content += f"，错误信息：{result.get('error', 'Unknown')}"
    
    # 标记为[反思簇]以便学习
    clusters = "[反思簇],[工具使用簇]"
    importance = 7 if not success else 3  # 失败经验更重要
    
    await MemoryService.save_memory(
        content=memory_content,
        clusters=clusters,
        importance=importance,
        memory_type="tool_experience"
    )
```

### 4.2 上下文感知检索与推荐
*   **上下文感知**: 检索时融合基础语义和工具经验（`[工具使用簇]`）。
*   **主动推荐**: 基于历史成功案例，主动推荐适合当前任务的工具。

### 4.3 反思驱动的工具优化
*   **失败模式分析**: 识别参数错误、权限问题等常见失败模式。
*   **策略生成**: 针对失败模式自动生成改进策略（例如“调用前先验证参数”）。

---

## 5. 模型矩阵配置 (Model Stack)

*   **Embedding**: `text-embedding-3-small` (或本地 `BGE-m3`)
*   **Scorer/Secretary LLM**: `GPT-4o-mini` / `Gemini 1.5 Flash` (负责：总结、打标、评分、清洗)
*   **Reflection LLM**: `DeepSeek-V3` / `Claude 3.5 Sonnet` (负责：深度关联挖掘、复杂逻辑推理)
*   **Reranker**: `BGE-Reranker-v2-m3`

---

## 6. 总结与预期效果

Pero 的记忆系统是一个**仿生**的设计：
*   **长久陪伴感**：能记起久远的细节，并通过当下触发联想。
*   **自我进化**：通过 Memory Secretary 的日夜维护，记忆库越用越“干净”，越用越“懂你”。
*   **性格一致性**：通过权重控制，对“重要时刻”表现出更强的反应。
*   **智能错误预防**：基于历史经验，预见并避免工具使用错误。
