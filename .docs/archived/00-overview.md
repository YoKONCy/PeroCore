# AIOS 架构总则与重构路线图

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 本文档是 PeroCore AIOS 重构的顶层基准。所有后续设计文档均以此为准绳。

---

## 1. 使命

将 PeroCore 从一个"以聊天请求为中心、由单个后端进程集中编排状态"的桌面 Agent 系统，重构为一个**主 Agent 内核 + 可扩展插件应用**的 AI 工作站（AIOS）。

---

## 2. 核心原则

### 2.1 主 Agent 内核优先

先只做主 Agent 内核，次 Agent 和应用作为可扩展插件预留，暂不实现。

### 2.2 六个一等资源

主 Agent 拥有六个平级一等资源，不存在谁包含谁：

| 资源                    | 职责                     | 生命周期           |
| ----------------------- | ------------------------ | ------------------ |
| **Identity**            | 人格、表达风格、行为边界 | 随 Agent 长期存在  |
| **Long-term Memory**    | 跨会话的提炼记忆         | 随 Agent 长期存在  |
| **Principal Workspace** | 个人文件空间             | 随 Agent 长期存在  |
| **Context Runtime**     | 上下文编译               | 每次调用时临时编译 |
| **Thread**              | 交互线程与消息存储       | 用户显式创建/关闭  |
| **Tool Capability**     | 工具注册与资源级权限     | 随 Agent 配置存在  |

### 2.3 持久状态与运行时状态分离

系统的所有状态必须明确区分为持久状态或运行时状态，不可混淆。

**持久状态**（数据库/文件，跨重启保留）：

- Agent 配置、人格文件
- Thread 记录（含 channel、policies）
- Thread 消息（含 status、pairId、revision）
- CanonicalMemory、MemoryCandidate
- Workspace 文件
- ToolCapability 配置

**运行时状态**（内存，重启后重建）：

- 活跃 Agent / 活跃 Thread（**前端窗口级**，不是后端全局状态）
- LLM 调用状态（单次调用，用完丢弃）
- Context Bundle / Manifest（单次编译产物）
- SSE 连接、平台适配器连接
- Scheduler 任务执行状态
- AbortController

### 2.4 后端权威 + 前端窗口自治

- 后端是 Thread、Memory、Workspace 等持久资源的唯一权威。
- 前端只是视图订阅者，不拥有持久状态真相。
- **后端不维护"全局活跃 Agent"**——活跃 Agent 是前端窗口级状态，用于 UI 路由。
- 后端可同时处理多个 Agent、多个 Thread 的请求，互不干扰。
- 前端发送请求时只提交当前输入，不组装上下文。

### 2.5 Context Compiler 只读

- Context Compiler 从各资源**只读消费**，编译为 LLM 输入。
- Compiler 不反向修改任何资源。
- 最终 LLM Messages 是临时产物，不是持久化真相。

### 2.6 存储与上下文分离

- 消息存储、上下文编译和前端显示是三件独立的事。
- 存储层只负责事实记录，不关心"发给模型什么"。
- 上下文窗口是 Compiler 的编译策略，不是存储规则。

### 2.7 Daemon 独立 + 能力提供者

- 后端 Daemon 是纯 Node 进程，不依赖 Electron 或任何 GUI 框架。
- Electron 壳只是一个特殊的"节点客户端"，自带平台能力（截图、通知等）。
- 平台能力通过 **Tool Provider** 机制委托给有能力的节点执行。
- 能力不可用时 Daemon 可降级处理。
- 详见 [10-node-architecture.md](10-node-architecture.md)。

---

## 3. Agent 分层模型

```text
PrincipalAgent（主 Agent）
  Pero、Nana 等完整人格主体
  拥有长期记忆、个人工作区
  ├─ Identity（人格）
  ├─ Long-term Memory（记忆）
  ├─ Principal Workspace（工作区）
  ├─ Context Runtime（上下文运行时）
  ├─ Thread（交互线程）
  └─ Tool Capability（工具权限）

AgentApplication（应用，暂不实现）
  Coding / Research / Office 等运行环境
  拥有独立工作区、工具链和任务运行时

SubAgent（次 Agent，暂不实现）
  主 Agent 在应用内的任务化投影
  只拥有临时工作上下文
  通过检查点和记忆候选与主 Agent 交换信息
```

---

## 4. Thread 替代 Session

当前 `Session` 承载了过多含义。重构后用 `Thread` 替代：

| 概念    | 当前 Session                 | 新 Thread                |
| ------- | ---------------------------- | ------------------------ |
| 身份    | 聊天 ID + Agent 当前指针     | 交互线程，只负责对话边界 |
| 上下文  | 前端全量提交 + 后端 XML 注入 | 后端 Compiler 统一加载   |
| Profile | 绑定 Session                 | Context Policy 独立配置  |
| 权威    | 前后端多份并行               | 后端单一权威             |

Thread 的 channel 属性定义对话场景，channel 是 Thread 的**持久属性**，创建时确定，不随 Agent 切换或单次调用变化：

| Channel     | 场景         | 由主 Agent 编译        | 记忆写入              |
| ----------- | ------------ | ---------------------- | --------------------- |
| `desktop`   | 桌面聊天     | ✅ 是                  | 写入主记忆            |
| `companion` | 陪伴模式     | ✅ 是                  | 写入主记忆            |
| `social`    | 社交平台私聊 | ❌ 否（子 Agent 应用） | 社交子 Agent 独立管理 |
| `group`     | 群聊         | ❌ 否（子 Agent 应用） | 社交子 Agent 独立管理 |

> `social`/`group` 场景将从主 Agent 剥离，作为独立的社交子 Agent 应用设计。
> 当前社交继续走现有 SocialBridge + SocialEnricher 独立路径。

### 4.1 Channel 不是 Agent 状态

- Agent 没有"当前模式"或"当前 channel"状态。
- 一个 Agent 可以同时在多个 Thread 中活跃。
- "模式"只属于 Thread，不属于 Agent。
- 每次 LLM 调用时，channel 从 Thread 读取，不是独立运行时状态。

---

## 5. 模式清理

| 当前模式      | 重构后处理                               |
| ------------- | ---------------------------------------- |
| `default`     | 保留，变为 `channel=desktop`             |
| `work`        | **移除**，留给未来 Coding App + SubAgent |
| `social`      | 社交子 Agent 应用（待重构）              |
| `group_chat`  | 社交子 Agent 应用（待重构）              |
| `companion`   | 保留，变为 `channel=companion`           |
| `lightweight` | 变为 Context Policy 配置项，不是模式     |

---

## 6. 状态所有权总表

### 6.1 持久状态（数据库/文件，跨重启保留）

| 状态                | 存储位置           | 归属                     |
| ------------------- | ------------------ | ------------------------ |
| Agent 配置          | SQLite + 文件系统  | 全局                     |
| Thread 记录         | SQLite             | PrincipalAgent           |
| Thread 消息         | SQLite             | Thread                   |
| Thread 摘要         | SQLite             | Thread                   |
| CanonicalMemory     | SQLite + TriviumDB | PrincipalAgent           |
| MemoryCandidate     | SQLite             | PrincipalAgent           |
| Workspace 文件      | 文件系统           | PrincipalAgent           |
| ToolCapability 配置 | 配置文件           | PrincipalAgent + channel |
| 群聊成员关系        | SQLite             | Thread                   |
| 日记                | SQLite + TriviumDB | PrincipalAgent           |

### 6.2 运行时状态（内存，重启后重建）

| 状态                      | 归属           | 生命周期             |
| ------------------------- | -------------- | -------------------- |
| 活跃 Agent / 活跃 Thread  | **前端窗口**   | 窗口级               |
| LLM 调用状态              | Thread         | 单次调用             |
| Context Bundle / Manifest | Thread         | 单次调用，用完丢弃   |
| SSE 连接                  | 前端窗口       | 连接级               |
| 平台适配器连接            | Thread         | 连接级               |
| Agent 情绪状态            | PrincipalAgent | 运行时（可定期快照） |
| Scheduler 运行状态        | 后端进程       | 进程级               |
| AbortController           | Thread         | 单次调用             |

### 6.3 关键规则

1. **后端不维护"全局活跃 Agent"**——活跃 Agent 是前端窗口级状态。
2. **后端不维护"全局活跃 Thread"**——活跃 Thread 是前端窗口级状态。
3. **后端维护"正在进行的 LLM 调用"**——按 threadId 索引，用于中断和状态查询。
4. **Channel 是 Thread 的持久属性**——不是 Agent 状态，不是运行时状态。
5. **Agent 没有"当前模式"**——一个 Agent 可同时参与多个不同 channel 的 Thread。
6. **前端各窗口自治**——两个窗口可以分别和不同 Agent、不同 Thread 交互。
7. **切换 Agent 必须原子切换 Thread**——不能出现 Nana 的 agentId 配 Pero 的 threadId。

---

## 7. 重构路线图

### 第一阶段：后端权威状态 + Thread 模型

- 定义 Thread 领域模型（替代 Session）
- 建立 ThreadService + RuntimeStateService（持久资源权威）
- Thread 消息存储（含软删除、pairId、revision）
- 后端从 Thread 加载历史，不再靠前端提交
- **后端不维护全局活跃 Agent**（前端窗口级状态）

### 第二阶段：Context Compiler 初版

- 后端统一编译 LLM 输入
- 移除前端全量历史提交
- 移除 HistoryEnricher 的 XML 注入
- 前端只发 `{ threadId, content }`

### 第三阶段：前端适配

- Transport 连接 NodeEndpoint
- 前端变为 Thread 视图订阅者
- 流式回复按 messageId 关联
- 删除/编辑通过 API + 事件同步

### 第四阶段：Workspace 做实

- Principal Workspace 物理目录
- 文件工具加 scope 边界
- PathResolver 增加 `@principal`

### 第五阶段：Memory 整理

- Memory Candidate + Gate
- Provenance 记录来源 Thread
- 社交记忆隔离策略

### 第六阶段：Identity 和 Tool 清理

- 人格补丁改为 channel 属性
- work 模式移除
- 工具权限加 Resource Scope
- lightweight 变为 Context Policy

### 第七阶段：Daemon 独立 + 前后端解耦

- Daemon 独立启动，不依赖 Electron
- Electron 壳变为能力提供者
- 能力注册表 + IPC Tool Channel
- 入站路由表替代全局活跃 Agent
- 移除后端全局活跃 Agent
- 详见 [10-node-architecture.md](10-node-architecture.md)

---

## 8. 文档索引

| 文档                                               | 内容                           |
| -------------------------------------------------- | ------------------------------ |
| [00-overview.md](00-overview.md)                   | 架构总则与重构路线图（本文档） |
| [01-principal-agent.md](01-principal-agent.md)     | PrincipalAgent 模型            |
| [02-thread.md](02-thread.md)                       | Thread 模型                    |
| [03-context-runtime.md](03-context-runtime.md)     | Context Runtime 模型           |
| [04-memory.md](04-memory.md)                       | Memory 模型                    |
| [05-workspace.md](05-workspace.md)                 | Workspace 模型                 |
| [06-tool-capability.md](06-tool-capability.md)     | Tool Capability 模型           |
| [07-channel-isolation.md](07-channel-isolation.md) | Channel 隔离策略               |
| [08-api-contract.md](08-api-contract.md)           | API 契约草案                   |
| [09-migration.md](09-migration.md)                 | 迁移策略                       |
| [10-node-architecture.md](10-node-architecture.md) | 节点架构与能力提供者           |

---

## 9. 术语表

| 术语                | 定义                                                |
| ------------------- | --------------------------------------------------- |
| PrincipalAgent      | 主 Agent，拥有完整人格和长期记忆的数字生命主体      |
| Thread              | 交互线程，主 Agent 与用户或外部平台的一次对话边界   |
| Context Runtime     | 上下文运行时，含 Compiler、Bundle、Manifest         |
| Context Compiler    | 只读编译器，从各资源编译 LLM 输入                   |
| Context Bundle      | 一次编译的上下文包                                  |
| Context Manifest    | 编译清单，记录使用了哪些资源、版本和裁剪策略        |
| Principal Workspace | 主 Agent 的个人文件空间                             |
| Memory Candidate    | 待确认的记忆候选                                    |
| Canonical Memory    | 已由 Memory Gate 确认的长期记忆                     |
| Memory Gate         | 记忆审核与合并机制                                  |
| Channel             | Thread 的对话场景类型                               |
| NodeEndpoint        | 后端节点连接信息                                    |
| RuntimeStateService | 后端持久资源权威服务（不含全局活跃 Agent）          |
| Daemon              | PeroCore 后端独立运行时，纯 Node 进程               |
| Tool Provider       | 平台能力提供者机制，Daemon 委托节点执行平台特有操作 |
| InboundRoute        | 入站路由表，外部消息查找归属 Agent 的机制           |
