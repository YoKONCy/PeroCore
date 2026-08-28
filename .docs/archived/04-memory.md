# Memory 模型

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 长期记忆归属于 PrincipalAgent，不归属 Session/Thread。只有主 Agent 拥有长期记忆。

---

## 1. 定义

Memory 是 PrincipalAgent 的一个一等资源，负责：

- 跨会话的提炼信息存储
- 记忆候选的审核与合并
- 按需检索供 Context Compiler 消费
- 来源追溯（Provenance）

Memory **不负责**：

- 原始消息存储（那是 Thread 的事）
- 上下文编译（那是 Context Runtime 的事）
- 日记生成（那是 Scheduler 的独立任务）

---

## 2. 记忆分层

```text
Memory
├─ CanonicalMemory          ← 已确认的长期记忆
├─ MemoryCandidate          ← 待确认的记忆候选
├─ MemoryGate               ← 审核与合并机制
├─ MemoryRetrieval          ← 检索服务
└─ MemoryProvenance         ← 来源追溯
```

### 2.1 记忆流转

```text
Thread 消息产生
  ↓
Activity Log（追加事件）
  ↓
MemoryCandidate（提取候选）
  ├─ 来源：threadId, messageId
  ├─ 摘要
  ├─ 证据引用
  └─ 建议类型
  ↓
MemoryGate（审核）
  ├─ 去重判断
  ├─ 冲突检测
  ├─ 合并或替换
  └─ 重要性评估
  ↓
CanonicalMemory（写入长期记忆）
  ├─ 向量索引（TriviumDB）
  ├─ 元数据（SQLite）
  └─ Provenance 记录
  ↓
MemoryRetrieval（按需检索）
  ↓
Context Compiler（消费检索结果）
```

---

## 3. CanonicalMemory

```text
CanonicalMemory
├─ id: string
├─ agentId: string                   ← 归属主 Agent
├─ type: MemoryType
│  ├─ 'experience'                   ← 经历
│  ├─ 'preference'                   ← 偏好
│  ├─ 'knowledge'                    ← 知识
│  ├─ 'relationship'                 ← 关系
│  └─ 'event'                        ← 事件
├─ content: string                   ← 记忆内容
├─ summary: string                   ← 简短摘要
├─ importance: number                ← 重要性 0-1
├─ confidence: number                ← 可信度 0-1
├─ status: 'active' | 'archived' | 'superseded'
│
├─ provenance: MemoryProvenance
│  ├─ originThreadId: string         ← 来源 Thread
│  ├─ originMessageIds: string[]     ← 来源消息
│  ├─ originChannel: string          ← 来源 channel
│  ├─ originPlatform?: string        ← 来源平台
│  └─ createdAt: string
│
├─ supersededBy?: string             ← 被哪条记忆取代
├─ supersedes?: string[]             ← 取代了哪些记忆
│
├─ vectorId: string                  ← TriviumDB 向量 ID
├─ createdAt: string
└─ updatedAt: string
```

---

## 4. MemoryCandidate

```text
MemoryCandidate
├─ id: string
├─ agentId: string
├─ source: 'thread' | 'diary' | 'scheduler' | 'manual'
├─ originThreadId: string
├─ originMessageIds: string[]
├─ summary: string                   ← 候选摘要
├─ evidenceRefs: string[]            ← 证据引用
├─ importance: number                ← 建议重要性
├─ confidence: number                ← 建议可信度
├─ suggestedType: MemoryType
├─ status: 'pending' | 'accepted' | 'rejected' | 'merged'
├─ createdAt: string
└── processedAt?: string
```

---

## 5. MemoryGate

### 5.1 职责

Memory Gate 决定：

- 候选是否值得长期记忆
- 是否与已有记忆重复
- 是否与已有记忆冲突
- 是否需要合并或替换
- 是否只应保留在 Thread 日志

### 5.2 判断流程

```text
MemoryCandidate
  ↓
1. 去重判断
   ├─ 结构化主键（subject/predicate）匹配
   ├─ 血缘覆盖检查
   └─ 向量相似度候选召回
  ↓
2. 冲突检测
   ├─ 相同 subject 不同 value → 冲突
   └─ 时间因果判断 → supersedes 或 conflict
  ↓
3. 决策
   ├─ 重复 → 丢弃
   ├─ 更新 → supersede 旧记忆
   ├─ 冲突 → 标记冲突，待确认
   ├─ 新增 → 写入 CanonicalMemory
   └─ 不重要 → 留在 Thread 日志，不提升
```

### 5.3 Scorer 改进

现有 Scorer 拉取待处理日志时只按 `agentId`，不按 session/source 分组。新架构要求：

- 至少按 `agentId + threadId + channel` 分批
- 禁止不同 Thread 的日志混合提炼
- 避免跨场景记忆污染

---

## 6. 记忆隔离

### 6.1 存储隔离

```text
agent_{agentId}/main.tdb     ← 主记忆（desktop/companion 写入）
social.tdb                    ← 社交记忆（social/group 写入）
shared/diary.tdb              ← 日记（需改为按 agent 隔离）
```

### 6.2 检索隔离

Context Compiler 按 Thread 的 MemoryPolicy 决定检索范围：

| Channel   | 检索 Main Memory | 检索 Social Memory |
| --------- | ---------------- | ------------------ |
| desktop   | 是               | 否                 |
| social    | 否               | 是（可选）         |
| group     | 否               | 是（可选）         |
| companion | 是               | 否                 |

### 6.3 写入隔离

| Channel   | 写入 Main | 写入 Social | 写入 Event Log |
| --------- | --------- | ----------- | -------------- |
| desktop   | 是        | 否          | 是             |
| social    | 否        | 可选        | 是             |
| group     | 否        | 否          | 是             |
| companion | 是        | 否          | 是             |

### 6.4 跨记忆提升

社交记忆中的重要信息可通过 Memory Gate 提升为主记忆：

```text
Social Thread 消息
  ↓
Social Event Log（追加）
  ↓
Social Memory（可选写入）
  ↓
Memory Gate 定期扫描
  ├─ 无关内容 → 留在 Event Log
  ├─ 重要内容 → 提升为 Main Memory（带 provenance）
  └─ 如"主人提到明天开会" → 提升为主记忆
```

这样 Pero 在 QQ 上知道主人明天开会，回到桌面聊天时也能想起来。

---

## 7. MemoryProvenance

每条 CanonicalMemory 必须记录来源：

```text
MemoryProvenance
├─ originThreadId: string         ← 来自哪个 Thread
├─ originMessageIds: string[]     ← 来自哪些消息
├─ originChannel: string          ← 来自什么场景
├─ originPlatform?: string        ← 来自什么平台
├─ createdFrom: 'scorer' | 'manual' | 'gate' | 'diary'
└─ createdAt: string
```

好处：

- 可以追溯记忆来源
- 可以按 Thread 删除相关记忆
- 可以判断记忆可靠性
- 隐私请求时可以定位

---

## 8. 数据存储

### 8.1 SQLite

```sql
-- canonical_memories 表
canonical_memories (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  type            TEXT NOT NULL,
  content         TEXT NOT NULL,
  summary         TEXT,
  importance      REAL DEFAULT 0.5,
  confidence      REAL DEFAULT 0.5,
  status          TEXT DEFAULT 'active',
  provenance      TEXT NOT NULL,          -- JSON
  superseded_by   TEXT,
  supersedes      TEXT,                   -- JSON array
  vector_id       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
)

-- memory_candidates 表
memory_candidates (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  source          TEXT NOT NULL,
  origin_thread_id TEXT,
  origin_message_ids TEXT,               -- JSON array
  summary         TEXT NOT NULL,
  evidence_refs   TEXT,                   -- JSON array
  importance      REAL DEFAULT 0.5,
  confidence      REAL DEFAULT 0.5,
  suggested_type  TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  created_at      TEXT NOT NULL,
  processed_at    TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
)
```

### 8.2 TriviumDB

复用现有 Store 架构：

```text
agent_{agentId}/main.tdb     ← 主记忆向量库
social.tdb                    ← 社交记忆向量库
```

需修复：

- 日记 Store 从 `shared/diary.tdb` 改为 `agent_{agentId}/diary.tdb`
- 语义检索必须按 `agentId` 过滤

---

## 9. 与现有代码的对应

| 现有模块              | 新架构角色           | 处理方式                 |
| --------------------- | -------------------- | ------------------------ |
| `MemoryService`       | CanonicalMemory 管理 | 重构，加 Provenance      |
| `MemorySearchService` | MemoryRetrieval      | 保留，接入 Policy        |
| `MemoryScorer`        | MemoryGate 的一部分  | 重构，按 Thread 分批     |
| `conversation_logs`   | Activity Log         | 迁移为 Thread Message    |
| 无 MemoryCandidate    | 新增                 | 新建表和服务             |
| 无 MemoryGate         | 新增                 | 新建审核流程             |
| 无 Provenance         | 新增                 | 在记忆节点上加来源字段   |
| Social Memory 未注入  | 修复                 | Social Memory 按策略注入 |
| Diary 共享 Store      | 修复                 | 改为按 Agent 隔离        |
| Scorer 不分批         | 修复                 | 按 Thread + Channel 分批 |

---

## 10. 第一版简化

第一版可以简化为：

```text
1. 保留现有 MemoryService 和 TriviumDB
2. 新增 memory_candidates 表
3. Scorer 写入候选而非直接写入正式记忆
4. 简单 Gate：去重 + 新增（不做冲突检测）
5. 记忆加 provenance 字段
6. Social Memory 修复注入

暂不实现：
  - 冲突检测和 supersede 链
  - 跨记忆提升
  - 复杂聚类
```
