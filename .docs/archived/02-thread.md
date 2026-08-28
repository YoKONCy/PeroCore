# Thread 模型

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> Thread 是主 Agent 与用户（或外部平台）的一次交互线程，只负责对话边界和消息存储。

---

## 1. 定义

Thread 替代当前的 `Session` 概念。它是主 Agent 的一个一等资源，负责：

- 消息的持久化存储
- 消息的软删除与编辑
- 上下文窗口策略

Thread **不负责**：

- 长期记忆（那是 Memory 的事）
- 人格定义（那是 Identity 的事）
- 工具权限（那是 Tool Capability 的事）
- 上下文编译（那是 Context Runtime 的事）

### 1.1 Channel 是持久属性

Channel 是 Thread 创建时确定的持久属性，不是 Agent 状态，也不是运行时状态：

- Agent 没有"当前 channel"状态
- 一个 Agent 可以同时在多个 Thread 中活跃
- 每次 LLM 调用时，channel 从 Thread 读取
- Channel 不随 Agent 切换而变化
- Channel 不随单次调用而变化

### 1.2 支持的 Channel 范围

Thread 模型当前仅服务主 Agent 的对话场景：

| Channel     | 用途               | 是否由 ContextCompiler 编译 |
| ----------- | ------------------ | --------------------------- |
| `desktop`   | 桌面聊天（主场景） | ✅ 是                       |
| `companion` | 陪伴模式           | ✅ 是                       |
| `social`    | 社交平台私聊       | ❌ 否（子 Agent 应用）      |
| `group`     | 群聊               | ❌ 否（子 Agent 应用）      |

> `social`/`group` 不走 ContextCompiler，将由独立的社交子 Agent 应用处理。
> 详见 [03-context-runtime.md 第 0.2 节](./03-context-runtime.md#02-社交场景从-contextcompiler-剥离)。
> 社交场景的 Thread 字段保留 `platform`/`platformIdentifier` 以便未来扩展。

---

## 2. 领域模型

### 2.1 Thread

```text
Thread
├─ id: string                        ← 唯一标识
├─ agentId: string                   ← 归属的主 Agent
├─ channel: ThreadChannel            ← 对话场景
├─ platform?: string                 ← 外部平台标识
├─ title: string                     ← 线程标题
├─ status: 'active' | 'archived'     ← 线程状态
│
├─ contextPolicy: ContextPolicy      ← 上下文编译策略
├─ memoryPolicy: MemoryPolicy        ← 记忆写入策略
├─ personaPatchId?: string           ← 人格补丁标识
│
├─ platformAdapter?: PlatformAdapter ← 平台适配器（社交场景）
│
├─ messageCount: number              ← 消息总数（含已删除）
├─ activeMessageCount: number        ← 未删除消息数
├─ pairCount: number                 ← 聊天对数量
│
├─ createdAt: string
├─ updatedAt: string
└─ lastMessageAt: string
```

### 2.2 ThreadChannel

```text
type ThreadChannel =
  | 'desktop'       ← 桌面聊天（主 Agent）
  | 'companion'     ← 陪伴模式（主 Agent）
  | 'social'        ← 社交平台私聊（预留，子 Agent 应用）
  | 'group'         ← 群聊（预留，子 Agent 应用）
```

> 注：`social`/`group` 在 Thread schema 中保留，但当前不由 ContextCompiler 编译。
> 社交场景继续走现有 SocialBridge + SocialEnricher 独立路径。

### 2.3 ThreadMessage

```text
ThreadMessage
├─ id: string                        ← 消息唯一标识（数据库数字 ID）
├─ threadId: string                  ← 归属线程
├─ role: 'user' | 'assistant' | 'system'
├─ content: string                   ← 消息内容
├─ pairId: string                    ← 聊天对 ID（user + assistant 共享）
├─ status: 'active' | 'deleted'     ← 软删除标记
├─ deletedAt?: string
├─ deletedBy?: string
│
├─ metadata: MessageMetadata
│  ├─ model?: string                 ← 使用的模型
│  ├─ tokenUsage?: TokenUsage        ← Token 消耗
│  ├─ toolCalls?: ToolCall[]         ← 工具调用记录
│  ├─ thinking?: string              ← 思考过程
│  └─ duration?: number              ← 生成耗时（ms）
│
├─ revision: number                  ← 内容修订版本（用于编辑）
├─ createdAt: string
└─ updatedAt: string
```

### 2.4 ContextPolicy

```text
ContextPolicy
├─ messageWindow: number             ← 最近 N 条消息作为上下文
├─ tokenBudget?: number              ← Token 上限（可选，优先于条数）
├─ includeToolCalls: boolean         ← 是否包含工具调用记录
├─ includeThinking: boolean          ← 是否包含思考过程
├─ enableMemoryRetrieval: boolean    ← 是否检索长期记忆
├─ enableToolDescription: boolean    ← 是否注入工具描述
```

### 2.5 MemoryPolicy

```text
MemoryPolicy
├─ writeTarget: 'main' | 'social' | 'none'  ← 记忆写入目标
├─ enableMemoryGate: boolean                 ← 是否启用 Memory Gate 提升
├─ gateScanInterval?: number                 ← Gate 扫描间隔（ms）
```

---

## 3. 消息生命周期

### 3.1 追加

消息一旦写入，**内容不可修改**。修改通过新增 revision 实现。

```text
用户发消息
  → 写入 ThreadMessage (role=user, status=active, revision=1)
  → 发布 MessageAdded 事件

Agent 回复
  → 流式推送 token
  → 完成后写入 ThreadMessage (role=assistant, status=active, revision=1, pairId=同user)
  → 发布 MessageAdded 事件
  → 异步提取记忆候选
```

### 3.2 软删除

```text
DELETE /api/threads/{threadId}/messages/{pairId}

后端执行：
  1. 找到该 pairId 对应的所有消息（user + assistant）
  2. 标记 status = 'deleted'
  3. 记录 deletedAt 和 deletedBy
  4. 发布 ThreadMessageDeleted 事件
  5. 前端收到事件后从显示列表移除
  6. 下一次 Context Compiler 编译时自动排除 deleted 消息
```

### 3.3 物理擦除

对于敏感信息，提供 PURGE 操作：

```text
  1. 物理删除消息内容
  2. 保留 tombstone 记录（只保留 id + deletedAt + reason）
  3. 删除对应的向量索引
```

### 3.4 编辑

```text
PUT /api/threads/{threadId}/messages/{messageId}

  1. 原内容保留为 revision N
  2. 写入新内容作为 revision N+1
  3. Context Compiler 默认使用最新 revision
  4. 发布 ThreadMessageEdited 事件
```

---

## 4. 多 Thread 共存

一个主 Agent 可以同时拥有多个活跃 Thread：

```text
Pero
├─ Thread A: desktop-chat-001 (channel=desktop)
│  └─ 最近 20 条作为上下文
│
├─ Thread B: companion-001 (channel=companion)
│  └─ 最近 8 条作为上下文
│
└─ （社交场景由子 Agent 应用管理，不走主 Agent Thread）
```

切换 Thread 不影响其他 Thread 的上下文。新建 Thread 不清除记忆，只开始新的短期交互边界。

---

## 5. 新建 Thread

```text
新建 Thread ≠ 清除记忆
新建 Thread ≠ 删除历史
新建 Thread ≠ 重置角色
新建 Thread = 开始一个新的短期对话线程
```

具体行为：

- 创建新的 Thread 记录
- 清空当前页面的短期消息窗口（前端视图）
- 不继承旧 Thread 的原始消息和摘要
- 保留 Agent 的长期记忆
- 不删除旧 Thread 的日志
- 不切换全局 Identity
- 重置属于 Thread 的工具状态

---

## 6. 平台适配器

社交和群聊场景需要平台适配器：

```text
PlatformAdapter
├─ platform: 'qq' | 'discord' | 'web' | ...
├─ threadId: string
├─ config: AdapterConfig
│
├─ 入站：平台消息 → 统一格式 → 写入 Thread
├─ 出站：Thread 回复 → 平台格式 → 发送
├─ 平台特有能力：表情、图片、@提醒、引用回复
└─ 多人消息归属（群聊谁说了什么）
```

现有 NapCat 适配器可迁移为 QQ PlatformAdapter，对接特定 Social Thread。

---

## 7. 数据存储

### 7.1 SQLite

```sql
-- threads 表
threads (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  channel         TEXT NOT NULL,          -- desktop | companion (主 Agent)；social/group 预留（子 Agent 应用）
  platform        TEXT,                   -- qq | discord | web | null
  title           TEXT,
  status          TEXT DEFAULT 'active',
  context_policy  TEXT NOT NULL,          -- JSON
  memory_policy   TEXT NOT NULL,          -- JSON
  persona_patch_id TEXT,
  message_count   INTEGER DEFAULT 0,
  active_message_count INTEGER DEFAULT 0,
  pair_count      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_message_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
)

-- thread_messages 表
thread_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL,
  role            TEXT NOT NULL,          -- user | assistant | system
  content         TEXT NOT NULL,
  pair_id         TEXT NOT NULL,
  status          TEXT DEFAULT 'active',  -- active | deleted
  deleted_at      TEXT,
  deleted_by      TEXT,
  metadata        TEXT,                   -- JSON
  revision        INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
)
```

> 注：`thread_summaries` 表已废弃（见 [03-context-runtime.md](./03-context-runtime.md) 第 0 节决策）。超出窗口的早期消息由长记忆系统兜底，不再生成滚动摘要。

### 7.2 索引

```sql
CREATE INDEX idx_thread_messages_thread_id ON thread_messages(thread_id);
CREATE INDEX idx_thread_messages_pair_id ON thread_messages(pair_id);
CREATE INDEX idx_thread_messages_thread_status ON thread_messages(thread_id, status);
CREATE INDEX idx_threads_agent_id ON threads(agent_id);
CREATE INDEX idx_threads_agent_channel ON threads(agent_id, channel);
```

---

## 8. 查询接口

### 8.1 获取 Thread 活跃消息（供 Compiler 使用）

```text
输入：threadId, limit?
输出：按时间正序的 active 消息列表

SELECT * FROM thread_messages
WHERE thread_id = ? AND status = 'active'
ORDER BY created_at ASC
LIMIT ?
```

### 8.2 获取 Thread 列表

```text
输入：agentId, channel?, page, pageSize
输出：Thread 摘要列表（含 pairCount、lastMessageAt、preview）
```

### 8.3 获取 Thread 详情

```text
输入：threadId
输出：Thread 信息 + 最近 N 条消息
```

---

## 9. 与现有代码的对应

| 现有                            | 新架构                         | 处理方式                           |
| ------------------------------- | ------------------------------ | ---------------------------------- |
| `SessionService`                | Thread 管理                    | 整体替换                           |
| `SessionService.activeSessions` | Thread 列表                    | 移除内存指针，改为数据库查询       |
| `session.{agentId}.current`     | Thread 列表最新项              | 移除 ConfigRepo 指针               |
| `ConversationLogService`        | ThreadMessage 存储             | 迁移表结构                         |
| `conversation_logs` 表          | `thread_messages` 表           | 新增 status、pairId、revision 字段 |
| `source` 字段                   | `channel` 字段                 | 语义重命名                         |
| `sessionId` 字段                | `threadId` 字段                | 语义重命名                         |
| 前端 `useSessionStore`          | `useThreadStore`               | 重构为视图订阅者                   |
| 前端全量提交 messages           | 只提交 `{ threadId, content }` | 移除前端上下文组装                 |

---

## 10. 迁移兼容

现有 `conversation_logs` 数据需要迁移：

```text
1. 创建 threads 表
2. 从 conversation_logs 的唯一 sessionId + agentId + source 创建 Thread 记录
3. 将 conversation_logs 的消息迁移到 thread_messages
4. 为每对 user+assistant 生成 pairId
5. 默认所有消息 status='active'
6. source 映射为 channel：
   desktop/mobile/scheduler → desktop
   social/group_chat/group → 暂不迁移（社交场景由子 Agent 应用独立处理）
```

迁移完成后，旧的 `conversation_logs` 表可保留作为备份。
