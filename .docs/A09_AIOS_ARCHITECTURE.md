# AIOS 核心架构与演进边界

> **适用范围**：infOS-TS 全项目（后端 Daemon、前端客户端、Electron 壳、资产与扩展）
> **状态**：当前架构基线 + 后续演进约束
> **最后更新**：2026-08-12
> **来源**：融合 [./archived](./archived/00-overview.md) 目录（原 `.aios/00` 至 `.aios/12`）的设计原则、已完成重构结论与后续设计草案。`.docs/archived/` 保留为历史重构档案，不再作为日常开发的唯一入口。

---

## 1. 架构使命与不可变原则

infOS 是以 **PrincipalAgent（主 Agent）内核** 为中心、可由 AgentApplication 扩展的 AI 工作站。系统必须从“单个后端进程围绕一次聊天请求集中编排状态”的模型，演进为资源边界明确、可多客户端接入、可跨发行形态运行的 Agent Runtime。

### 1.1 六个一等资源

每个 PrincipalAgent（例如 Pero、Nana）拥有六个平级资源；它们通过 `agentId` 关联，不能用其中任意一个替代另一个。

| 资源 | 职责 | 生命周期 | 权威存储 |
|---|---|---|---|
| Identity | 人格、表达风格、行为边界与 channel 补丁 | Agent 长期存在 | Agent 定义文件与数据库元数据 |
| Long-term Memory | 跨 Thread 的提炼记忆、候选和来源追溯 | Agent 长期存在 | SQLite + TriviumDB |
| Principal Workspace | Agent 的个人文件空间 | Agent 长期存在 | `@data/principals/{agentId}/workspace/` |
| Context Runtime | 只读编译 LLM 输入 | 单次调用临时存在 | 内存 |
| Thread | 对话边界与消息事实记录 | 用户创建、归档或删除 | SQLite |
| Tool Capability | 工具、资源范围、参数约束和审批策略 | 随 Agent 配置存在 | Agent/扩展配置 |

### 1.2 状态所有权

**持久状态**必须由后端权威维护，包含 Agent 配置、Thread 与消息、记忆、Workspace 文件、Capability 配置、入站路由及用户安装资产。

**运行时状态**重启后可重建，包含 LLM 调用、Context Bundle/Manifest、连接、Scheduler 执行态与取消控制器。

关键规则：

1. 后端不维护“全局活跃 Agent”或“全局活跃 Thread”。它们是**前端窗口级 UI 路由状态**。
2. 后端可同时服务多个 Agent、多个 Thread，所有请求必须显式携带或由 Thread 推导 `agentId`、`threadId`、`channel`。
3. 前端只拥有显示缓存和窗口偏好；不组装权威上下文，也不保存业务真相。
4. 切换 Agent 时必须原子地切换或创建匹配的 Thread，禁止出现不同 Agent 与 Thread 混配。
5. 消息存储、上下文编译与前端展示彼此独立；“模型看到什么”由 Context Compiler 决定，不应反向改变事实存储。

---

## 2. PrincipalAgent 与 Identity

### 2.1 Agent 身份边界

PrincipalAgent 是有长期人格、记忆和工作区的逻辑身份，不是会话、上下文包、工具清单或未来 SubAgent。

```text
PrincipalAgent
├─ Identity
├─ Long-term Memory
├─ Principal Workspace
├─ Context Runtime
├─ Threads
└─ Tool Capability
```

Agent 逻辑身份应与未来可能存在的运行实例区分：`pero@desktop`、`pero@mobile` 和 `pero@cloud` 可代表同一 PrincipalAgent 的不同接入点；长期记忆始终归属逻辑身份，而不是某台设备。

### 2.2 Identity 组成与补丁规则

```text
Identity
├─ basePersona            核心人格，始终存在
├─ channelPatches         仅叠加场景差异
└─ behaviorBoundary       安全、隐私与内容边界
```

- `basePersona` 不因 channel 或客户端切换而替换。
- `channelPatches` 仅叠加差异，不可覆盖核心人格。
- 补丁由 Context Compiler 在编译时只读加载；Identity 本身不维护“当前模式”。
- 客户端输入或 `extraVars` 不得覆盖 `agent_name`、人格、记忆、所有者信息等核心变量。

官方、Workshop 与用户 Agent 定义可以参与资产联邦，但官方/Workshop 定义只读；运行时 Workspace 必须始终位于 `@data`，不得写入安装目录或订阅目录。

---

## 3. Thread、Channel 与消息事实流

### 3.1 Thread 的职责

Thread 是一次交互的持久边界，负责消息存储、软删除、修订版本与策略归属；不负责人格、长期记忆、工具权限或上下文编译。

```text
Thread
├─ id / agentId / channel
├─ platform / platformIdentifier
├─ title / status / 时间字段
├─ contextPolicy
├─ messageCount / pairCount
└─ ThreadMessage[]
```

`ThreadMessage` 必须保留 `role`、内容、`pairId`、状态、`revision`、真实 `agentId`（适用于 assistant 消息）、元数据与时间戳。删除默认是软删除，Compiler 只读取 active 消息；敏感数据擦除应使用保留 tombstone 的物理清除流程。

### 3.2 Channel 是 Thread 的持久属性

```text
ThreadChannel = 'desktop' | 'social' | 'group'
```

- Channel 创建后不可变；需要变更场景时创建新 Thread。
- Channel 不属于 Agent 的“当前模式”，也不是临时调用参数。
- 同一 Agent 可并发拥有不同 channel 的 Thread。
- `ambient` 是请求级 Capability Scope，不是 Channel；它只能在当前 Channel 权限基础上做减法。
- App 聊天与 Pet3DView 都使用同一 Agent 最新的 `desktop/conversation` Thread，确保历史与短期上下文连续。
- 主动陪伴开关只控制 Agent 主动行为调度，不切换 Thread、Channel 或人格。

| Channel | 主要处理路径 | 记忆边界 | 说明 |
|---|---|---|---|
| desktop | PrincipalAgent Context Compiler | 主记忆 | App、Pet3DView 与本地快捷入口共享的连续交互 |
| social | 社交应用运行时 | 社交记忆 | 外部私聊、独立节奏和状态机 |
| group | 据点/社交应用运行时 | 社交或房间事件流 | 多人房间交互 |

### 3.3 据点群聊的双层模型

据点群聊同时存在两种不同用途的数据：

1. **房间权威消息流**：按 `roomId` 存储和展示，代表用户实际看到的房间会话。
2. **按 Agent 隔离的 group Thread**：例如 `stronghold_{roomId}_{agentId}`，仅用于每个 Agent 的独立上下文编译、人格与工具边界。

两者不可混淆。对话日志必须按房间聚合并读取权威消息流，不能因内部隔离 Thread 而将同一房间拆成多个角色会话；内部 Thread 也不应被房间日志的改名、删除操作误伤。

### 3.4 主动行为与临时输入

主动陪伴、定时事件和系统触发属于通用主动行为，不创建专用 Channel。调度器复用目标 Agent 最新的 `desktop/conversation` Thread，并以 `capabilityScope='ambient'` 执行。内部触发指令使用 `inputPersistence='ephemeral'`，只参与本轮上下文；最终 assistant 回复正常写入 Thread 并推送到客户端。这样既保留完整用户历史，也避免内部系统指令污染聊天记录。

旧 `companion` Thread 在迁移启动时统一软删除，不合并到 Desktop 历史。

---

## 4. Context Runtime：只读编译而非状态容器

### 4.1 职责与边界

Context Runtime 在每次 LLM 调用时从 Identity、Memory、Thread、Workspace 和 Tool Capability **只读消费**，编译出 LLM Messages 与可审计 Manifest。

它不得：写入记忆、修改人格、持久化消息、执行工具或创建文件。

```text
ContextRuntime
├─ ContextCompiler
├─ ContextBundle       单次调用临时产物
├─ ContextManifest     资源使用与裁剪记录
├─ TokenBudget
└─ ContextPolicy       由 Thread 持有
```

### 4.2 三层上下文机制

| 层级 | 内容 | LLM 介入 | 触发方式 |
|---|---|---|---|
| 短上下文 | 最近窗口内的原生消息 | 否 | Compiler 直接读取 |
| 长记忆 | 后台提炼的结构化事实 | 提炼阶段有 | RAG / 策略检索 |
| 即时检索 | Agent 主动调用的记忆工具 | 是 | ReAct 决策 |

滚动摘要不是事实真相层。它会造成双重压缩、维护复杂和额外 LLM 调用；超出窗口的历史应由可追溯的长期记忆兜底，而不是把历史反复摘要后注入 Prompt。

### 4.3 编译顺序与原生消息要求

高层编译顺序为：权限过滤 → 相关记忆检索 → active/latest revision 消息选择 → 去重 → Token 预算 → 槽位排序 → 输出 Messages/Manifest。

最近消息必须保留原生 `user` / `assistant` 角色，禁止序列化为 XML 后再塞进 system prompt，以避免历史重复注入。

典型槽位顺序：

| 位置 | 内容 |
|---|---|
| 100–200 | 核心人格、行为边界、channel 补丁 |
| 300 | 经策略筛选的长期记忆 |
| 500 | 工具和技能描述 |
| 600 | Workspace 引用（可选） |
| 700 | 最近 Thread 原生消息 |
| 800 | 当前用户输入 |
| 900 | 时间与一致性提醒 |

### 4.4 Token 预算与 Manifest

不可压缩内容包括人格、硬规则和当前输入；近期消息、channel 补丁和必要工具为高优先级；工作区描述与旧消息可裁剪；记忆和系统知识按需检索。

`ContextManifest` 至少应记录人格/补丁版本、记忆检索项、消息范围、工具筛选、Token 明细和裁剪原因，用于回答“这条信息为何进入本轮 Prompt”。

---

## 5. Long-term Memory：候选、门控与来源

长期记忆归属 PrincipalAgent，不归属 Thread；Thread 是记忆的来源，不是记忆容器。

```text
Thread 消息 / 日记 / Scheduler
  → MemoryCandidate
  → MemoryGate（去重、冲突、合并、重要性）
  → CanonicalMemory（SQLite 元数据 + TriviumDB 索引）
  → MemoryRetrieval
  → Context Compiler
```

### 5.1 CanonicalMemory 与 Provenance

每条正式记忆应记录：`agentId`、类型、内容、摘要、重要性、可信度、状态、向量 ID，以及完整 provenance：来源 Thread、消息 ID、channel、平台、创建方式和时间。

来源追溯支持：

- 审计记忆为何存在；
- 判断可信度；
- 按来源处理隐私请求；
- 删除或归档 Thread 时定位受影响的记忆；
- 避免不同 Thread、不同场景的消息混批提炼。

### 5.2 Memory Gate 的决策

Memory Gate 应依次处理结构化去重、向量候选召回、冲突/时间关系判断，再决定丢弃、合并、supersede、标记待确认或创建新记忆。低重要度信息应留在原始 Thread，而不是被强行提升。

### 5.3 存储隔离与 TriviumDB 文件组

当前每个 Agent 的向量存储按 `agent_{agentId}` 隔离：`main.tdb`、`social.tdb`、`diary.tdb`。Mmap 存储模式下，一个 TDB 的持久化一致性组包括：

- `*.tdb`：元数据、图和 payload；
- `*.tdb.vec`：向量本体；
- `*.tdb.flush_ok`：跨文件提交标记；
- `*.tdb.wal`：崩溃恢复日志；
- `*.tdb.quiver`：可重建的 ANN 索引。

云同步必须同步持久化一致性组，排除 `*.tmp` 与 `*.lock` 等运行中间态；加载端以 `flush_ok` 校验并在必要时由 WAL 恢复。

---

## 6. Workspace 与 Tool Capability

### 6.1 Workspace 分类

| 空间 | 所属 | 用途 |
|---|---|---|
| Principal Workspace | PrincipalAgent | 日记、笔记、草稿、计划和个人文件 |
| Application Workspace | AgentApplication | 未来应用项目、产物与任务资源 |
| Runtime Data Space | 系统 | DB、配置、缓存、向量索引 |

Principal Workspace 的唯一可写根为：

```text
@data/principals/{agentId}/workspace/
├─ inbox/ notes/ diary/ drafts/ plans/
├─ documents/ attachments/ exports/
└─ archive/
```

所有 Workspace 文件操作必须做规范化 containment 检查，拒绝绝对路径、`..` 逃逸、软链接/junction 越界和未授权扩展名。`@principal` / Agent Workspace 逻辑前缀只能解析到 `@data` 下的 Agent 私有根。

### 6.2 Capability 的多层约束

权限不只是工具名白名单，而是：

```text
(agentId, channel)
  ∩ capabilityScope（default / ambient，只减不增）
  → ToolPermission
     ├─ toolName
     ├─ resourceScope（允许根、拒绝路径、scope）
     ├─ paramPolicy（可选）
     └─ requiresApproval
```

原则：

1. 工具定义注入和实际执行必须经过同一个 CapabilityGate。
2. 未配置 channel 必须 fail-closed，不能回退 desktop 全开放。
3. 平台能力（截图、剪贴板等）也必须先通过 CapabilityGate，再路由给 Provider。
4. 工具执行上下文必须显式传递 `agentId + threadId + channel + capabilityScope`，禁止默认回退到某个 Agent。
5. `ambient` 只能对 Channel 的工具、Skill 与 Prompt Fragment 取交集，禁止动态 `load_skill` 扩权。
6. 文件和终端操作默认受 Workspace scope 限制；高风险动作进入审批层。
7. `run_script` 等快捷路径不得绕过统一执行器。

---

## 7. Daemon、节点与能力提供者

### 7.1 角色划分

Daemon 是纯 Node 后端，承载 Agent Runtime、Thread、Memory、Context Compiler、Scheduler、资产注册表与业务 API；它不得依赖 Electron。

Electron、CLI、Web、移动端都是客户端节点。Electron 额外具备窗口、托盘、屏幕截图、系统通知等平台能力，但仍通过业务 HTTP/SSE/WS 与 Daemon 交互。

```text
客户端 ↔ Daemon：业务通信（HTTP / SSE / WS）
Daemon → Provider Node：能力调用（IPC / WS）
```

### 7.2 Tool Provider

节点注册自身能力与心跳；Daemon 查能力注册表，向在线 Provider 发出 `{ toolName, args, callId }`，并以 `{ callId, result, success }` 接收结果。能力不可用时返回明确错误或采取可解释的降级，而不是假装执行成功。

能力协议、截图结果和注册消息应置于 `@infos/shared`，防止 Daemon 与 Electron 维护不兼容的重复类型。

### 7.3 入站路由替代全局活跃 Agent

外部消息由 `InboundRoute` 决定归属：

```text
(source, identifier) → { agentId, channel, threadId?, config? }
```

桌面聊天由 Thread 的 `agentId` 决定，后台任务由 SchedulerTask 的 `agentId` 决定，外部消息由 InboundRoute 的 `agentId` 决定。三者互不替代。

---

## 8. 资产联邦与多发行数据边界

资产联邦的覆盖优先级固定为：

```text
官方 @app  <  Workshop @workshop  <  用户本地 @data
```

官方与 Workshop 资源为只读。模型需要动态生成 manifest 时，应在内存中通过受限虚拟协议提供，不能回写安装或订阅目录。后端与 Electron 分别扫描其所属资源类型，但必须遵守同一覆盖顺序和 PathResolver containment 规则。

跨发行版共享同一数据语义：Agent 数据、Workspace、SQLite、TriviumDB、用户安装的 Skills/Extensions 和自定义资源位于 `@data`。安装资源与 Workshop 订阅内容可重新获取，不能被当作用户存档写入或云同步的唯一来源。

---

## 9. API 与流式契约

### 9.1 后端权威 API

客户端创建或选择 Thread 后，只提交当前输入：

```text
POST /api/chat
{ threadId, content, attachmentIds? }
```

后端从 Thread 读取 Agent、channel、策略与历史，编译上下文并持久化消息。客户端不得上传完整历史数组来参与上下文组装。

REST 保持统一响应信封；API DTO 与 SSE discriminated union 放在 `@infos/shared`，防止前后端字段漂移。

### 9.2 SSE 事件

流式事件至少包括：`delta`、`thinking`、`tool_call`、`tool_result`、`status`、`error`、`done`。

- 工具调用与结果必须用 `callId` 关联；
- 工具参数统一为 `args`，结果统一为 `result`，状态使用 `success`；
- 流成功结束必须显式发送 `done`，前端不能仅依赖 EOF 判断成功；
- 未收到 `done` 的流应视为可恢复的截断状态。

---

## 10. 迁移策略与架构修复经验

### 10.1 演进原则

AIOS 迁移采用小步、可验证和可回滚的方式：每次只解决一个边界问题，旧数据先备份后迁移，接口兼容层只在明确过渡期存在。任何迁移完成后都应能独立运行、通过类型检查和覆盖相应的领域测试。

| 演进主题 | 核心结果 | 验证重点 |
|---|---|---|
| Session → Thread | 后端权威 Thread 与消息事实流 | 客户端不再提交完整历史 |
| Context 编译 | 历史仅作为原生消息注入一次 | 无 XML 历史重复 |
| 前端适配 | 窗口级 UI 状态与 Thread 视图订阅 | 刷新后持久资源不丢失 |
| Workspace | Agent 私有根和 containment | 非授权路径不能读写 |
| Memory | Candidate、Gate、Provenance | 不同 Thread 不混批提炼 |
| Capability | `(agentId, channel)` + fail-closed | 社交/群聊不暴露高风险工具 |
| Daemon / Provider | Node 后端与 Electron 能力解耦 | 无桌面 Provider 时可解释降级 |

历史 `conversation_logs` 迁移到 `thread_messages` 时，应按 `(sessionId, agentId, source)` 建 Thread，生成 `pairId`、默认 active 状态和初始 revision，并保留原表/备份以支持审计。旧 `session.{agentId}.current` 等全局指针不可作为新架构的权威来源。

### 10.2 能力桥接的已验证教训

能力提供者链路必须避免以下常见断点：

1. 所有启动入口都需要启动同一 CapabilityBridge，不能只在某个 daemon 入口注册。
2. 工具名与能力名可以不同，必须存在显式映射（例如 `take_screenshot → screen_capture`），不能依赖偶然同名。
3. Provider 返回值必须在边界处标准化；截图等多模态能力需要返回可供 ReAct/LLM 消费的结构，而非底层 API 的随意字段。
4. 权限检查优先于 Provider 路由，防止平台工具绕过 CapabilityGate。
5. Provider 协议置于 shared 包；注册、心跳、调用、结果和错误格式不可由两端各自复制。
6. Provider WebSocket/IPC 连接在生产形态必须鉴权；主动断连与心跳超时统一为 offline 语义，避免节点记录行为不一致。

### 10.3 API 兼容期

兼容接口只能内部转换到 Thread API，且必须有移除计划：旧 Session 创建/清空/查询接口迁移到 `/api/threads`，旧聊天全量 `messages` 载荷迁移到 `{ threadId, content }`。兼容层不得重新引入前端上下文组装。

---

## 11. AgentApplication 与 SubAgent（后续应用层）

AgentApplication 与 SubAgent 位于 PrincipalAgent 内核之上，不应反向污染其六个一等资源。

### 11.1 上下文持有与委派模式

采用**上下文持有**而非“主 Agent 编译后整体转交”的上下文委派：SubAgent 自行维护历史、独立编译上下文和执行工具；主 Agent 只委派 TaskContext、授予资源并接收 Checkpoint。

```text
主 Agent → TaskContext → SubAgent
SubAgent
├─ 主人格只读投影
├─ SubAgentWorkspace
├─ 独立历史与 AppContextCompiler
├─ AppToolCapability 的受限子集
└─ AppMemoryStore / Checkpoint
       ↓
CheckpointExchange → 主 Agent MemoryGate / 产出处理 / 主 Thread 通知
```

### 11.2 隔离约束

1. SubAgent 不写入主 Agent Thread。
2. SubAgent 工具权限 = 应用白名单与其资源 scope 的交集。
3. SubAgent 记忆候选不能直接写入 CanonicalMemory，必须经 Checkpoint 与 MemoryGate。
4. SubAgent 只能读取人格投影，不能修改宿主人格。
5. SubAgent Workspace 是 AppWorkspace 下的隔离子目录。

### 11.3 预留持久模型与通信

后续实现可使用 `agent_applications`（应用注册与宿主 Agent）、`sub_agents`（任务状态、TaskContext、Checkpoint）和 `app_memory_candidates`（应用候选池）等独立表。主/子通信采用消息队列：主侧发送任务、取消、资源授权和状态查询；子侧上报进度、完成、失败、审批/资源请求。

Checkpoint 至少携带任务摘要、产出引用、记忆候选和可接续的 handover context。CheckpointExchange 决定候选经 Gate 的结果、产出物移动/归档和向主 Thread 发布的通知。第一阶段为同进程沙箱级隔离；多节点调度、跨节点工具调用和移动端节点不应假定已实现。

---

## 12. 开发与演进检查表

新增或修改架构相关功能时，应验证：

- [ ] Agent、Thread、Memory、Workspace、Capability 的状态所有权明确；
- [ ] 后端没有引入全局活跃 Agent/Thread 依赖；
- [ ] Context Compiler 对资源保持只读，历史不会重复注入；
- [ ] 新 channel 显式配置权限并 fail-closed；
- [ ] 任何文件路径经过 containment 检查；
- [ ] 任何平台工具也经过 CapabilityGate；
- [ ] Thread 与消息 API/SSE 契约同步更新 shared 类型；
- [ ] 官方/Workshop 只读资源不被运行时写入；
- [ ] 新存档或同步规则覆盖 SQLite 与 TriviumDB 多文件一致性；
- [ ] 未来 Application/SubAgent 功能不绕过 Checkpoint、Workspace 或 MemoryGate 隔离。

---

## 13. 相关规范

- [项目结构](./A01_PROJECT_STRUCTURE.md)
- [后端架构](./A02_BACKEND_ARCHITECTURE.md)
- [前端架构](./A03_FRONTEND_ARCHITECTURE.md)
- [部署与多发行](./A04_DEPLOYMENT.md)
- [记忆引擎](./A05_MEMORY_ENGINE.md)
- [扩展系统](./A06_EXTENSION_SYSTEM.md)
- [跨平台与路径](./A07_CROSS_PLATFORM.md)
- [模式与角色管理](./M01_MODE_SYSTEM.md)
- [能力门控](./M02_CAPABILITY_GATE.md)
- [API 响应与流式规范](./S02_API_SPEC.md)
- [Steam 与资产联邦](./M04_STEAM_INTEGRATION.md)
