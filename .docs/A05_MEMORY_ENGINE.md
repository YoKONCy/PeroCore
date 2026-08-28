# 记忆引擎架构 (PEDSA)

> **适用范围**：`packages/backend/src/services/memory/`
> **核心引擎**：SQLite (Drizzle) + TriviumDB (Vector + Graph)
> **理论基础**：PEDSA v2 (Pipeline for Embedded Directed Semantic Analysis)
> **最后更新**：2026-08-19

---

## 1. PEDSA 存储层级 (Layer 0-3)

| 分层                  | 载体               | 存储内容               | 检索方式          | 生命周期         |
| --------------------- | ------------------ | ---------------------- | ----------------- | ---------------- |
| **Layer 0 (Working)** | JSON / LLM Context | 当前会话 Context       | 顺序读取          | 短期（单次会话） |
| **Layer 1 (Vector)**  | **TriviumDB**      | 原始片段向量 + 文本    | 向量检索 + BM25   | 长期             |
| **Layer 2 (Graph)**   | **TriviumDB**      | 实体/事件图谱 + 关系   | 图谱扩散 + Cypher | 长期             |
| **Layer 3 (Diary)**   | **SQLite / TDB**   | 每日/周总结 + 逻辑闪回 | 关键词 + 时间轴   | 永久             |

---

## 2. 处理管线 (Memory Pipeline)

记忆存储不是简单的 `INSERT`，而是经过 5 个反思阶段：

1. **Ingest (摄入)**：接收原始对话片段。
2. **Tag (标注)**：LLM 提取实体、关键词、情感倾向。
3. **Consolidate (整合)**：检测是否与现有记忆冲突或重叠。
4. **Link (关联)**：在 TriviumDB 中建立实体 ↔ 事件的边。
5. **Flush (落盘)**：写入 SQLite (关系) 和 TriviumDB (语义)。

---

## 3. 混合检索策略 (SocialEnricher)

后端采用 **HyDE + Hybrid Search** 策略：

1. **HyDE**：使用 LLM 生成"假设回答"以增强检索向量命中。
2. **向量检索**：命中语义相近的记忆片段。
3. **BM25 检索**：通过 `indexText` 确保人名、日期等关键词精确命中。
4. **图谱扩散**：命中激活节点 2 跳路径内的关联背景。

---

## 4. 记忆维护与提炼 (Scorer)

**Scorer** 是后台定时任务，负责"记忆分层"：

- **攒批处理**：不实时生成总结，每 200 条消息或 50000 字符触发。
- **降维打击**：将琐碎消息压缩为 Layer 3 的日记条目。
- **图谱修剪**：自动合并等价节点（`equality` 边），衰减低权重边。

---

## 5. TriviumDB 接入规范

TS 层必须通过 `VectorWriteHelper` 操作数据库，确保原子性：

```typescript
// insertWithId 确保 SQLite ID ↔ TriviumDB ID 一致
store.insertWithId(sqliteId, vector, payload)
// 必须调 buildTextIndex() 增量索引才生效
store.buildTextIndex()
// 开启自动压缩防止内存膨胀
store.enableAutoCompaction(300)
```

---

## 6. 核心数据对象

### 6.1 MemoryNode (SQLite)

存储基础元数据：`agentId`, `content`, `importance`, `type(chat/event/fact)`, `createdAt`.

### 6.2 Entity (TDB Feature)

存储知识节点：`name`, `type(person/topic/location)`, `synonyms`.

## 7. AIOS 记忆边界与来源追溯

完整的 Candidate / Gate / CanonicalMemory 模型见 [A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md#5-long-term-memory候选门控与来源)。PEDSA 管线必须遵守以下约束：

1. 长期记忆归属 `agentId`，不归属 Session 或 Thread；Thread 仅提供可追溯来源。
2. Scorer 必须至少按 `agentId + threadId + channel` 分批，禁止混合不同 Thread 的原始消息进行提炼。
3. MemoryCandidate 先经过去重、冲突/时间关系判断和重要性门控，再写入 CanonicalMemory；低价值信息保留在 Thread 事实流。
4. CanonicalMemory 必须保留 `originThreadId`、来源消息、channel、平台和创建方式等 Provenance。
5. `main`、`social`、`diary` TriviumDB Store 按 Agent 隔离；Mmap 模式同步时须将 `.tdb/.vec/.flush_ok` 视作一致性组，同时保留 WAL 恢复能力。

---

## 8. Memory Resource与Context映射

长期记忆是跨Execution持久的Resource，不是Prompt字符串或Context Compiler私有状态。Memory Region进入模型前必须记录：

- `agentId`、Store与来源对象；
- Snapshot/Revision或查询时间；
- 检索Query、命中依据和排序分数；
- Token预算、裁剪原因与可见性；
- Provenance、Trust与是否为Derived Observation。

Context Compiler只能按Policy将Memory Resource物化为Region，不得在编译期间修改CanonicalMemory。RAG按需检索等价于Context地址空间的缺页处理；相同资源Snapshot、Query和Policy应产生可复现的Context Manifest。Observer产生的Agent State属于独立Derived Resource，默认不进入Prompt，必须由Thread ContextPolicy与Observer Policy双重启用。

记忆跨Application回流必须经过`infos.knowledge.submit_candidate`或等价Checkpoint/MemoryCandidate Port与主Agent MemoryGate；Application自己的领域状态和私有记忆仍由其Store/Authority持有，不能直接写入CanonicalMemory。Application查询知识使用收窄的`infos.knowledge.query` Capability，只获得结果与Provenance，不获得TriviumDB文件、Repository或数据库连接。具体协议见 [A11_APPLICATION_INTEGRATION](./A11_APPLICATION_INTEGRATION.md)。

---

_本文档由 Carola 整理，适用于 infOS-TS 记忆引擎架构规范。_
