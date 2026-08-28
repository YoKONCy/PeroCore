# infOS 操作系统化架构演进计划

> **归档状态**：已于 2026-08-19 拆分并固化到 A03/A05/A06/A07/A08/A09；本文仅保留历史演进记录。
> **适用范围**：infOS-TS 全项目（Daemon、前端客户端、Electron、自治 Application、扩展、原生能力与未来运行时）
> **文档状态**：生产收口基线；后续演进按未完成项继续实施
> **最后更新**：2026-08-19
> **上游基线**：[A09 AIOS 核心架构与演进边界](../A09_AIOS_ARCHITECTURE.md)
> **文档目标**：在不丢失现有功能、数据与用户体验的前提下，以操作系统设计思维将 infOS 从模块化 Agent 宿主演进为具有统一对象、执行、能力、事件、调度与 Surface 协议的 Agent OS。

---

## 0. 2026-08-18 生产收口状态

以下路径已经完成生产收口，后续不得重新引入旧实现：

```text
Electron Node Hello / Offer
→ NodeRegistry + CapabilityDirectory
→ Capability Handle + Bound Port
→ Browser / Desktop Tool ABI
```

- Electron `web.page` 与 `desktop.environment` 是 Browser和桌面资源的唯一生产 Provider；Backend不再加载 Server Chromium或 nut-js桌面 Provider。
- Browser Tool保留原 ABI，执行前后由 `BrowserInteractionRuntime`生成 Scene、网页注入检测、Receipt与 SiteModel；Generation句柄、Dialog、Network、受控上传下载由 Electron Runtime提供。
- Conversation、ReAct、Tool与跨 Node Envelope共享同一 Execution因果链。
- Gateway正文、工具状态和完成状态统一使用 Surface；旧 `stream_delta`、`stream_end`、`tool_status`协议已删除。Social Realm 已通过 Storage/Event/Surface Port 与 Capability Handle接入，不再直接依赖 Backend DrizzleDb 或 GatewayHub；自治 Application走 Arca式 Node Host与 Federation。
- Package体系已实现 Ed25519 Publisher签名、文件完整性、Permission Grant、撤销停用、非官方贡献隔离和升级防降级/Publisher替换。正常关机依次停止 Social、Capability与 Kernel生命周期，最后执行 SQLite WAL checkpoint并关闭连接。

---

## 1. 使命与问题定义

infOS 的目标不是给聊天应用添加更多工具，也不是把传统桌面操作系统的名词机械套到 Agent 上。它要解决的是：

> 如何像操作系统管理进程、内存、设备、权限、文件、显示与中断一样，管理 Agent 的身份、上下文、执行、记忆、应用、能力、外部环境与用户交互。

当前系统已经具备 AIOS 的重要基础：PrincipalAgent、Thread、Context Compiler、CapabilityGate、ToolExecutor、自治 Application 基线、后台任务、Checkpoint、Provider Node、Gateway、TriviumDB 隔离存储和稳定区/尾部区流式渲染。下一阶段的重点不是堆叠功能，而是将这些局部机制收敛为可组合、可审计、可调度、可替换的系统协议。

### 1.1 目标状态

```text
┌────────────────────────────────────────────────────────────┐
│ User Experience                                            │
│ Shell · Desktop · Pet · Notification · Accessibility      │
├────────────────────────────────────────────────────────────┤
│ Compositor                                                 │
│ Surface Tree · Input Routing · Theme · Visibility · Replay │
├────────────────────────────────────────────────────────────┤
│ Main Application Modules                                   │
│ Stronghold · Conversation · Companion · Dashboard          │
├────────────────────────────────────────────────────────────┤
│ Application Realms                                         │
│ Arca · Social · Coding · Future Autonomous Applications    │
├────────────────────────────────────────────────────────────┤
│ Agent libc / Runtime Ports                                 │
│ Context · Tool · Storage · Surface · Event · Checkpoint    │
├────────────────────────────────────────────────────────────┤
│ infOS Kernel                                               │
│ Object · Execution · IPC · Scheduler · Capability · Audit  │
├────────────────────────────────────────────────────────────┤
│ Drivers / Adapters                                         │
│ Electron · Web · Mobile · Terminal · Native · WASM · MCP   │
├────────────────────────────────────────────────────────────┤
│ Physical / Logical Resources                               │
│ LLM · File · Network · Screen · Audio · TDB · GPU · Device │
└────────────────────────────────────────────────────────────┘
```

### 1.2 非目标

本计划不要求：

1. 一次性重写现有系统；
2. 为追求“微内核”而立即拆成大量进程；
3. 模拟 POSIX、Linux 或 Windows 的具体 API；
4. 将所有业务都下沉到内核；
5. 用新的抽象替换已经稳定且不存在边界问题的业务代码；
6. 直接移植外部项目的运行时、文档工作站、浏览器代理或人格观测实现；
7. 以牺牲现有 UX、数据兼容性或发行稳定性换取架构纯洁性。

---

## 2. 架构宪法

以下原则是后续设计和代码评审的最高约束。

1. **Agent 是 Principal，不是 Process。** Agent 是长期身份、安全主体和资源所有者；一次具体运行才是 Execution 或 Process。
2. **任何执行都有唯一身份。** 所有 LLM 调用、工具调用、后台任务、应用命令和主动行为都必须归属明确的 `executionId`。
3. **任何副作用都有来源。** 可观察副作用必须能追溯到 Principal、Execution、Capability 和调用因果链。
4. **资源先于工具。** Resource 是存在之物，Capability 是访问权，Tool 是操作 ABI；不能以工具名白名单代替完整资源授权模型。
5. **能力只能收窄。** Capability 可以委派、限制、到期和撤销，不能通过 fallback、Skill 或运行时默认值隐式扩权。
6. **持久事实与临时帧分离。** 任务状态迁移和工具提交是 Durable Event；Token delta、动画帧和心跳是 Ephemeral Frame。
7. **应用不能直接持有内核。** 用户空间应用最终只能持有 Port 和 Capability Handle，不应直接访问数据库、Service Locator 或全局状态。
8. **Renderer 不拥有业务事实。** Surface 是事实的视觉投影，关闭窗口或销毁 DOM 不得改变权威业务状态。
9. **Context Compiler 只映射资源。** 它不得拥有或修改 Identity、Memory、Thread、Workspace 与 Capability。
10. **Observer 不改变被观测对象。** 人格、情绪和性能观测服务只能产生测量结果；是否注入上下文由独立 Policy 决定。
11. **跨边界操作可取消、可超时、可校验代次。** 所有远程调用、设备调用和可变目标操作都必须防止过期句柄误操作。
12. **崩溃后日志必须是合法前缀。** 系统可以只完成部分工作，但不能留下伪造的“成功完成”状态。
13. **内核提供机制，策略尽量位于用户空间。** 不同 Agent、Channel、App 和运行时可以选择不同的上下文、记忆、渲染和调度策略。
14. **对用户稳定，对数据保守，对内部接口果断。** 用户能力和持久数据优先兼容；内部重复协议不承诺永久兼容。
15. **性能和 UX 是架构约束。** 调度、渲染、IPC 和持久化设计必须有延迟、吞吐、内存与可见性目标，不能在功能完成后再补优化。
16. **Stronghold永久属于主应用。** Stronghold、房间权威消息流、管家、多Agent房间调度及`group` Channel不得迁移为Application Realm、独立Application或可安装子应用；Realm基础设施必须显式拒绝`infos.stronghold/stronghold`注册。
17. **Application身份不进入Channel。** 主应用Channel只表达内部交互入口；Arca、Social、Coding等身份由`appId/realmId`表达。
18. **Application Realm首期已落地。** Realm拥有稳定`appId/realmId/principalId/instanceId`、独立LifecycleScope、Scoped Tool与持久任务绑定；Arca协作任务和Social私有会话已迁移，`arca/social`应用型Thread Channel及Agent静态应用能力矩阵已删除。Stronghold注册被Realm Manager硬拒绝。

---

## 3. 领域本体与 OS 映射

OS 类比仅用于厘清责任，不作为命名装饰。

### 3.1 核心映射

| infOS 概念                | OS 类比                           | 准确含义                                     |
| ------------------------- | --------------------------------- | -------------------------------------------- |
| PrincipalAgent            | User / Security Principal         | 长期身份、人格、私有资源与授权主体           |
| Thread                    | TTY / Session / Journal           | 持久交互边界和消息事实流，不执行代码         |
| Task                      | Job                               | 用户期望完成的工作，可跨多次执行             |
| Process                   | Process                           | Task、应用或驻留服务的运行载体               |
| Execution                 | Execution attempt                 | 一次具有明确起止、预算和结果的运行实例       |
| Turn                      | Transaction boundary              | 从输入提交到系统静默的一次交互事务           |
| ReAct Step                | Timeslice / step                  | 一次 LLM 推理及其后续系统调用阶段            |
| Tool Call                 | System call                       | 对内核服务或设备能力的结构化请求             |
| ToolExecutor              | Syscall dispatcher                | 权限、策略、路由、执行、审计和结果归一化     |
| CapabilityGate            | Capability security / LSM         | 决定主体是否可对资源执行特定操作             |
| Context Runtime           | Virtual address space             | 本轮模型可见资源的临时映射                   |
| ContextRegion             | Memory mapping                    | 可延迟物化、可裁剪、可审计的上下文区域       |
| Long-term Memory          | Persistent object store           | 跨执行持久存在的语义与情景状态               |
| TriviumDB                 | Indexed object store / page cache | 向量、图谱、Payload 和检索索引载体           |
| Workspace                 | Filesystem namespace              | Agent 或 App 的可写文件资源空间              |
| ApplicationRealmManager   | User-space realm host             | 承载受信任自治应用的隔离生命周期与Scoped资源 |
| Node Capability Transport | Device/RPC bus                    | Node Hello、Offer、Session与跨 Node调用承载  |
| GatewayHub                | IPC/message bus                   | 多节点业务消息与订阅通道                     |
| BackgroundTaskService     | Job scheduler 原型                | 持久任务、恢复、取消和状态迁移               |
| Checkpoint                | Process snapshot / handover       | 可恢复状态、产出和上下文交接                 |
| Frontend Shell            | Desktop shell                     | 用户导航、窗口级偏好与资源视图               |
| Surface Compositor        | Display server/compositor         | 管理语义 Surface、输入、可见性与增量提交     |

### 3.2 必须明确的概念边界

```text
PrincipalAgent
├─ Identity
├─ Long-term Memory
├─ Principal Workspace
├─ Threads
├─ Capability Roots
└─ Processes
   ├─ Conversation Process
   ├─ Background Task Process
   ├─ Application Process
   ├─ Observer Service
   └─ Resident Service
```

```text
Task       = 要完成什么
Process    = 谁在承载运行
Execution  = 某次具体尝试
Turn       = 一次用户可感知事务
Step       = 执行内部的一个推理/调用阶段
Thread     = 持久交流与事实记录
```

禁止继续把 Thread 当执行线程，或用“当前活跃 Agent”推导后台执行主体。

---

## 4. 当前资产保留策略

本演进不是产品重写。现有能力、数据和视觉语言原则上全部保留。

### 4.1 必须保留的产品能力

- Agent 对话、多角色与多 Channel；
- ReAct 工具调用、NIT 与 Skill；
- 心流、长期记忆、日记、梦境、反思与整理；
- TriviumDB 图谱、向量、BM25 与混合检索；
- Workspace、终端、代码搜索、文件编辑与回滚；
- 后台任务、调度器、提醒与主动陪伴；
- 社交应用、据点、群聊和多平台桥接；
- MCP、扩展、Hook 与外部工具；
- 语音、桌宠、Live2D/3D 和动画；
- 审批、资源授权和审计；
- 多设备能力节点与跨平台发行；
- 当前前端信息架构、浅色/暗色主题与像素视觉语言。

### 4.2 必须保留的持久数据

SQLite、TriviumDB、Workspace 与资产目录中的现有数据必须通过幂等迁移继续可读。现有 `agentId`、`threadId`、`pairId`、`messageId`、`taskId`、`appId`、`instanceId`、`callId` 等稳定标识尽量不变。

新 Kernel Object 应包装旧 ID，而非无理由替换：

```typescript
interface KernelObjectRef {
  objectType: string
  objectId: string
  generation: number
  ownerPrincipalId: string
}
```

### 4.3 允许被替换的内容

可以逐步删除的是重复基础设施，而非用户能力：

- 重复的 SSE、Gateway、CapabilityBridge 与 App Event 信封；
- 多处手写 correlation、超时和错误映射；
- 隐式全局活跃 Agent/Thread；
- 用户空间 App 对 DB 和 Service 的直连；
- 前端多处自行拼装同一执行状态的逻辑；
- 完成迁移后的 Legacy Adapter；
- 不能提供实际隔离保证却以 Sandbox 命名的软边界。

### 4.4 兼容层原则

采用 Strangler Fig 增量迁移：

```text
现有业务模块
    ↓
Compatibility Adapter
    ↓
Kernel Protocol
    ↓
现有或新 Renderer / Client
```

兼容层必须具备明确的移除条件，禁止永久双写和无限期维护双协议。

---

## 5. 目标内核对象模型

### 5.1 Kernel Object

所有可寻址、可授权、可订阅或可管理生命周期的系统实体，应能投影为 Kernel Object。

```typescript
interface KernelObjectRef {
  objectType: string
  objectId: string
  generation: number
  ownerPrincipalId: string
}

interface KernelObjectMetadata {
  ref: KernelObjectRef
  lifecycle: 'created' | 'active' | 'suspended' | 'closed' | 'failed'
  createdAt: string
  updatedAt: string
  labels?: Record<string, string>
}
```

第一阶段不要求创建统一数据库大表。各领域仍持有自己的权威表，通过 Registry 提供对象投影。

### 5.2 通用操作

不同对象按能力选择性支持：

```text
inspect
subscribe
snapshot
grant
revoke
suspend
resume
close
```

通用操作不意味着所有对象拥有相同生命周期；Thread 归档、Task 取消和 Surface 销毁仍由各自领域语义决定。

### 5.3 Generation

`generation` 用于避免旧引用操作新状态，适用于：

- 页面导航后的旧 DOM Handle；
- 重启后的 App Instance；
- 被替换的 Surface Tree；
- 文档 Revision；
- Provider Node 重连；
- Checkpoint 恢复后的 Execution。

当调用携带的代次落后时，应返回明确的 stale-object 错误，而不是静默重试到未知目标。

---

## 6. Execution 与 Process 模型

### 6.1 Execution 最小模型

```typescript
interface ExecutionDescriptor {
  executionId: string
  processId: string
  principalId: string
  taskId?: string
  parentExecutionId?: string
  threadId?: string
  channel?: string
  class: 'interactive' | 'foreground' | 'background' | 'resident' | 'maintenance' | 'realtime'
  priority: number
  deadline?: string
  budget: ExecutionBudget
}

interface ExecutionBudget {
  maxDurationMs?: number
  maxLlmCalls?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxToolCalls?: number
  maxConcurrentIo?: number
}
```

### 6.2 状态机

```text
created
  → queued
  → running
  → waiting_io | waiting_approval | suspended
  → running
  → completed | failed | cancelled | timed_out
```

终态必须有结构化 ExitStatus，不能只依赖异常字符串。

### 6.3 现有系统映射

- 普通聊天：每个 Turn 创建一个 interactive Execution；
- 后台任务：Task 持久存在，每次运行创建 background Execution；
- 主动陪伴：ambient Capability 下的 resident/maintenance Execution；
- App 命令：归属 App Process 的 foreground/background Execution；
- SubAgent：独立 Process，持有收窄后的 Capability 与 Workspace；
- Tool Call：Execution 内部 syscall，不是新的 Principal。

### 6.4 调度目标

统一 Scheduler 最终负责：

- 交互延迟优先；
- 同 Agent 与跨 Agent 公平性；
- 模型 Provider 并发与速率限制；
- Token、工具 I/O、网络与原生设备预算；
- 前台/后台/驻留/维护/实时调度类；
- Backpressure、取消、Deadline 和饥饿保护；
- 暂停后的资源释放和恢复；
- 可解释的调度状态与用户控制。

第一阶段只统一身份与状态，不立即替换 BackgroundTaskService 的成熟队列。

---

## 7. Capability 与系统调用模型

### 7.1 从工具白名单到对象能力

当前 `(agentId, channel) → allowedTools + ResourceScope` 继续作为兼容根策略。目标模型增加不可伪造、可撤销、可衰减的 Capability Handle：

```typescript
interface CapabilityHandle {
  handleId: string
  subjectId: string
  resource: KernelObjectRef
  operations: readonly string[]
  scope?: Record<string, unknown>
  parentHandleId?: string
  issuedAt: string
  expiresAt?: string
  revocable: boolean
}
```

授权应表达为：

```text
主体持有对 workspace://pero/project-a 的 read/list 句柄
```

而非仅表达为：

```text
主体可以调用 read_file
```

### 7.2 委派规则

子 Capability 必须满足：

```text
child.operations ⊆ parent.operations
child.resource ⊆ parent.resource
child.expiry ≤ parent.expiry
child.risk ≤ parent policy
```

Skill、App、SubAgent、ambient 作用域和远程 Provider 只能获得父能力的子集。

### 7.3 Tool ABI

ToolExecutor 继续作为系统调用分发器，并逐步统一请求上下文：

```typescript
interface KernelCallContext {
  principalId: string
  processId: string
  executionId: string
  threadId?: string
  capabilityHandleId: string
  correlationId: string
  deadline?: string
  idempotencyKey?: string
}
```

执行链保持：

```text
解析对象与操作
→ 校验 Capability
→ Policy / Approval
→ 路由内核服务或 Adapter
→ Deadline / Cancellation
→ 结构化结果
→ Durable Audit Event
```

---

### 7.4 用户空间 Package 与跨包能力

升级后的 `MOD` / `Extension` 是安装与分发单元，不是统一运行时对象。一个 Package 可以同时贡献 App、Service Process、Capability Provider、Runtime Adapter、Tool ABI、Skill Resource、Policy、Event Subscriber、Presenter 与 Asset。

Package 间能力组合必须遵循：

```text
Consumer Requirement
→ Capability Directory 匹配在线 Offer
→ Policy 选择 Provider
→ Capability Authority 校验或签发收窄 Handle
→ 绑定 LifecycleScope 所有的 Port
→ Kernel Envelope 调用 Provider
```

Consumer 不能 import Provider 实现、持有对方实例、共享 AppContext，或使用任意 `serviceId + method` 绕过契约。Provider 的权限不能替 Consumer 扩权；有效权限是 Consumer Handle、Provider 实现范围、Provider 运行权限与 Policy 的交集。

Skill 是 Context Resource 与流程知识，只能声明 Capability Requirement；加载 Skill 不得解锁父 Execution 原本没有的能力。Tool 是 Capability 面向 LLM 的 ABI，App 和其他 Package 则直接使用 Bound Port。

---

## 8. Context Runtime 与 mmap 思想

### 8.1 Context 是地址空间，不是字符串容器

一次模型调用的上下文应视为从多个资源映射出的临时虚拟地址空间：

```text
Identity Region
Memory Region
Thread Region
Capability Region
Skill Region
Workspace Region
Flow State Region
Environment Region
Current Input Region
```

### 8.2 ContextRegion

```typescript
interface ContextRegion {
  regionId: string
  source: KernelObjectRef
  visibility: 'model' | 'host' | 'audit'
  priority: number
  tokenEstimate: number
  freshness: 'snapshot' | 'live'
  required: boolean
  materialize(): Promise<ContextBlock>
}
```

### 8.3 OS 思想映射

| Context 机制          | OS 思想                    |
| --------------------- | -------------------------- |
| ContextRegion         | memory mapping             |
| ResourceRef           | file-backed mapping        |
| 临时输入              | anonymous mapping          |
| lazy materialize      | demand paging              |
| RAG 检索              | page fault handler         |
| Token Budget          | address-space quota        |
| 不可变 Context Bundle | snapshot                   |
| 派生修改              | copy-on-write              |
| 裁剪与淘汰            | page eviction              |
| ContextManifest       | page table / mapping audit |

### 8.4 迁移约束

现有 ContextCompiler、MDP Slot、Prompt 模板和检索算法全部保留。初期只将现有数据源包装成 ContextRegion；待 Manifest 与预算稳定后，再引入懒物化、缓存和精细淘汰。

---

## 9. 统一事件与 IPC

### 9.1 Durable Event 与 Ephemeral Frame

**Durable Event** 表示必须可审计、可恢复或可解释的事实：

- 用户消息已提交；
- assistant 消息已提交；
- 工具调用被接受或拒绝；
- 审批已完成；
- 文件已修改；
- Task 状态已迁移；
- App 已启动或停止；
- Checkpoint 已创建；
- 文档修改已合并。

**Ephemeral Frame** 只服务实时体验：

- LLM token delta；
- thinking delta；
- 下载进度；
- 动画帧；
- 音频 chunk；
- hover；
- heartbeat。

Ephemeral Frame 可以丢弃或降频；Durable Event 不得只存在于前端内存。

### 9.2 Kernel Envelope

SSE、WebSocket、Electron IPC、MCP 与 HTTP 可以继续作为不同 Carrier，但上层共享统一信封：

```typescript
interface KernelEnvelope<T = unknown> {
  protocolVersion: number
  messageId: string
  correlationId?: string
  causationId?: string
  principalId: string
  processId?: string
  executionId?: string
  object?: KernelObjectRef
  operation: string
  capabilityHandleId?: string
  deadline?: string
  emittedAt: string
  durability: 'durable' | 'ephemeral'
  payload: T
}
```

### 9.3 统一不等于单一 Transport

- REST：查询和命令提交；
- SSE：单向 Execution/Surface 流；
- WebSocket：节点与双向交互；
- Electron IPC：壳层专属能力；
- MCP：外部工具互操作；
- 内存 EventBus：同进程低开销分发。

统一的是对象、因果、错误、取消和代次语义，而不是强迫所有通信走一个连接。

---

## 10. Surface Protocol 与 Compositor

### 10.1 目标

将当前“后端输出 raw delta、前端自行推断 UI”演进为语义 Surface 提交协议。Surface 是业务事实的可视投影，不是业务真相本身。

必须区分两套边界：

- **Internal Surface Protocol**：仅供 infOS 系统组件、Projection、Shell 与 Compositor 使用；Conversation 是第一个接入者。
- **External Presentation Protocol**：未来第三方应用只能请求通知、Toast、系统弹窗、审批、进度或受限声明式面板，不得直接提交内部 SurfaceNode、Vue 组件、HTML、JavaScript 或 DOM Patch。

Memory、Knowledge、Context Runtime、Projection、Compositor、Approval 和 Scheduler 都是系统组件，不定义为应用。应用专指类似传统 OS 应用程序的独立外部服务；首轮不修改 Social App，也不扩展 App ABI，待 Internal Compositor 稳定后再以 Social 的真实管理需求提炼 External Presentation Protocol。

```typescript
interface SurfaceNode {
  nodeId: string
  kind:
    | 'text'
    | 'markdown'
    | 'code'
    | 'tool-call'
    | 'tool-result'
    | 'status'
    | 'approval'
    | 'progress'
    | 'image'
    | 'chart'
    | 'document'
    | 'app'
  revision: number
  props: Record<string, unknown>
  children?: SurfaceNode[]
}
```

### 10.2 协议操作

```text
create_surface
attach_node
patch_node
replace_range
commit_surface
freeze_surface
resume_surface
destroy_surface
```

第一阶段覆盖 Desktop Conversation 的 Markdown、代码、KaTeX、Mermaid、工具调用、工具结果、状态、错误、附件与审批节点，不引入任意 HTML 执行。聊天中的 HTML 继续作为源码展示；未来可执行内容只能进入独立沙箱 Surface。

实时策略采用模型真实速度：网络 delta 只做帧合并，不人为拆词减速。流式 Frame 不进入持久日志；断线后以领域表中的最终消息和 Projection Snapshot 恢复。

权威边界采用混合模式：后端持有业务事实、Conversation Projection 和可恢复的最终 Surface Commit；客户端持有窗口级 Surface Tree、Stable Block、Active Tail、可见性、动画和输入焦点。

### 10.3 Compositor 职责

- 管理 Surface Tree、Revision 与稳定 Node ID；
- 将 Surface 安排到聊天、窗口、通知、桌宠或任务中心；
- 路由键盘、鼠标、触控和辅助功能输入；
- 处理浅色/暗色主题和统一视觉 Token；
- 根据可见性冻结动画、Canvas、视频和重型组件；
- 支持增量 commit、回放、重连和最终权威渲染；
- 将业务事件投影到 Vue Renderer Adapter；
- 阻止不可信内容越过安全 Surface 边界。

### 10.4 流式渲染器设计原则

应吸收：

- 稳定区与流式尾部；
- 已完成复杂子树的稳定身份；
- STREAM_FAST 与 FULL_RENDER 分离；
- 合帧、差异更新和可见性冻结；
- Mermaid、KaTeX、代码、工具卡等重型节点的独立生命周期；
- 最终 commit 后权威重渲染；
- 流初始化、Frame 与终态乱序时的幂等和代次校验；
- 非当前视图继续推进 Projection，但停止不必要的 DOM 更新。

不应照搬：

- 从混合文本中重新猜测本已结构化的工具事件；
- 让业务状态依赖 DOM；
- 让聊天 HTML 获得任意脚本执行权；
- 将外部宿主的全局状态带入 infOS。

infOS 的优势是后端已经知道 `tool_call`、`tool_result`、`status` 和 `done`，可以直接产生语义节点，而不是全部从 Markdown 反向解析。

---

## 11. Driver 与 Adapter 模型

### 11.1 目标

将 Web、Electron、移动端、终端、文档和原生设备统一为可协商能力、可校验目标身份的 Adapter，而不是继续增加特殊工具分支。

```typescript
interface RuntimeAdapter {
  getIdentity(): Promise<RuntimeIdentity>
  getCapabilities(): Promise<RuntimeCapability[]>
  inspect(target: KernelObjectRef): Promise<RuntimeSnapshot>
  execute(request: AdapterRequest): Promise<AdapterResult>
  cancel(callId: string): Promise<void>
}
```

### 11.2 Web Adapter设计原则

应吸收：

- 统一命令目录；
- Adapter Contract；
- Capability Negotiation；
- READ / INTERACT / ELEVATED / ROOT 风险等级；
- Runtime Instance、Document Generation 与 Snapshot ID；
- Stable Handle；
- 多后端选择与显式 fallback；
- 执行后验证、审计和敏感信息脱敏。

这些模式应推广到：

```text
WebAdapter
DesktopAdapter
DocumentAdapter
MobileAdapter
TerminalAdapter
DeviceAdapter
```

### 11.3 CapabilityBridge 演进

Provider 调用最终应携带：

- 协议版本；
- Principal / Process / Execution；
- Capability Handle；
- Target Object 与 Generation；
- Deadline / Cancellation；
- Idempotency Key；
- 风险等级与审批上下文；
- 结构化结果 Content Type；
- 审计链。

---

## 12. 用户空间运行时设计

用户空间运行时必须按infOS本体自主实现，不得直接移植外部组件形成第二套状态中心。

### 12.1 Web Runtime

Web应用能力应作为`runtime: web`的用户空间系统服务：

```text
Web Runtime Service
├─ Web App Manifest
├─ Persistent Session Partition
├─ Network / Permission Policy
├─ CSS / JS Injection Resource
├─ WebAdapter
├─ App Surface
└─ Lifecycle / Export
```

它依赖 Kernel Object、Capability、Surface、Adapter、Storage Namespace 和 Scheduler 成熟后再实现。

未来 App Runtime 类型可包括：

```text
runtime: agent
runtime: service
runtime: web
runtime: document
runtime: wasm
runtime: native
```

### 12.2 Document Runtime旗舰应用与架构验收

文档工作站不进入内核，而作为Document Runtime上的旗舰应用，用于验证：

- 文档是 Kernel Object；
- Revision、Generation 与事务写入；
- 人类视觉编辑与 Agent 源码编辑共享唯一真源；
- Agent 修改通过 PR、Diff 与 Approval；
- Surface 可渲染 Markdown、Scene 与可编程岛；
- Checkpoint、Snapshot、Export 和 Provenance 可协同工作。

应吸收：源码保持型编辑、字符区间事务、Revision 校验、最小补丁、双重 Diff、可编程岛生命周期和 Agent PR。禁止让渲染 DOM 成为文档权威存储。

### 12.3 Observer Service

人格与状态观测能力应成为异步Observer Service：

```text
assistant message committed
  → Observer queue
  → embedding / state projection
  → agent-state://{agentId}/affective
  → durable observation
```

约束：

- 默认只观察真实 assistant 输出；
- 不直接修改 Prompt；
- 不要求 Agent 输出特定控制标记；
- 不把用户表达误判为 Agent 状态；
- 是否将状态映射进 Context 由 ContextPolicy 决定；
- 状态数据是可授权、可订阅、可审计的 Resource。

---

## 13. 分阶段实施路线

每个阶段都必须可独立发布、可回滚，不依赖“大爆炸”切换。

### 阶段 0：架构冻结与基线测量

**目标**：先建立可比较基线，不改行为。

工作项：

- 评审并确认本架构宪法；
- 统一领域词汇表；
- 绘制现有聊天、任务、App、Capability 与 Provider 时序图；
- 记录交互首 Token、流式帧率、长消息 CPU、内存、任务恢复和 Provider 延迟；
- 建立关键数据迁移备份与恢复演练；
- 标记现有隐式全局状态和跨层直连。

验收：所有后续设计可以引用统一术语和可重复性能基线。

### 阶段 1：Kernel Object 与 Execution Identity

**目标**：统一对象引用、执行身份和因果链，不改变业务流程。

工作项：

- 在 `@infos/shared` 定义 `KernelObjectRef`、`ExecutionDescriptor`、`ExitStatus`；
- 给聊天 Turn、后台任务和 App Command 分配 `executionId`；
- ToolContext 显式携带 Execution；
- 为 Thread、Task、AppInstance、Provider Node 建 Object Adapter；
- 日志、审批和工具调用记录 Execution/Correlation；
- 禁止后台执行依赖全局活跃 Agent。

验收：任一工具副作用均可追溯到 Principal、Execution 和调用来源。

### 阶段 2：统一 Kernel Envelope

**目标**：统一高层消息语义，保留现有 Transport。

工作项：

- 定义 Durable Event / Ephemeral Frame；
- 让 SSE、Gateway、CapabilityBridge 和 App Event 通过 Adapter 生成统一 Envelope；
- 统一错误、取消、Deadline、Correlation 和 Generation；
- 增加事件契约测试与跨端兼容测试；
- 暂不强制事件溯源化全部数据库。

验收：同一 Execution 可跨 SSE、WebSocket 和 Provider 调用保持完整因果链。

### 阶段 3：聊天 Surface 垂直切片

**目标**：以现有聊天链路验证 Surface Protocol 和 Compositor。

首条切片：

```text
ConversationTurnService
→ ReAct Yield
→ Kernel Envelope
→ Surface Projection
→ Compositor Store
→ Vue Renderer Adapter
```

首批节点：

- markdown；
- thinking；
- tool-call；
- tool-result；
- status；
- approval；
- progress；
- image。

迁移方式：现有 `ChatRichText`、工具卡和审批组件作为 Adapter 消费 SurfaceNode。Desktop Conversation 不保留旧 `delta/tool/status` SSE 或旧 Markdown 显示回退；流式、非流式、历史恢复和编辑后重建必须归一到同一 `ConversationSurfaceProjector` 产物。

验收：

- UI 功能无回归；
- 工具卡和复杂节点在流式更新中不重建；
- 未收到 commit/done 的流可识别为截断；
- 重连可恢复已提交 Surface；
- 长消息渲染 CPU、DOM 变更量和掉帧不劣于基线。

### 阶段 4：Capability Handle 与 Port 化

**目标**：从工具名授权升级为对象能力，并切断新 App 对内核 Service 的直连。

工作项：

- 将现有 CapabilityGate 输出包装为根 Handle；
- 支持 Capability 委派、收窄、到期与撤销；
- 为 Context、Storage、Tool、Surface、Event、Checkpoint 定义 Port；
- 建立 Capability Definition、Offer、Requirement、Directory 与 Bound Port；
- Package Manifest V2 支持一个 MOD 声明多种 Contribution；
- 用两个最小原生 Package 验证无代码依赖的 Provider/Consumer 调用；
- 新 App 强制使用 Port；
- Social App 等现有 App 通过 Legacy Context Adapter 迁移；
- 审批授权结果可生成临时 Capability Handle。

验收：用户空间 App 无需持有 DB、ConfigRepo、GatewayHub 或 AppContext。

### 阶段 5：统一 Scheduler 与资源预算

**目标**：将不同执行类型纳入统一调度语义。

工作项：

- 统一 Execution 状态机；
- 将 RuntimeState、BackgroundTask、主动陪伴与 App 执行投影到 Scheduler；
- 建立模型、Token、工具 I/O 和 Provider 并发预算；
- 支持交互、前台、后台、驻留、维护与实时调度类；
- 增加 Backpressure、Deadline、暂停与公平性；
- 前端任务中心展示统一 WaitReason 与资源状态。

验收：高负载下交互任务不会被后台任务长期阻塞，取消和恢复语义一致。

### 阶段 6：ContextRegion 与懒物化

**目标**：将 ContextCompiler 演进为资源映射器。

工作项：

- 将 Identity、Memory、Thread、Capability、Skill、Workspace 与 FlowState 包装为 ContextRegion；
- ContextManifest 记录来源、版本、预算和裁剪；
- 引入懒物化与 Token 预算；
- 保持 MDP、现有 Prompt 和原生消息历史兼容；
- 评估不可变 Snapshot 与 Copy-on-Write 缓存。

验收：能够解释每段上下文为何进入 Prompt，且相同输入快照可复现。

### 阶段 7：Adapter/Driver Protocol 与 Web Runtime

**目标**：先建设通用驱动范式，再实现Web Runtime能力。

工作项：

- 定义 RuntimeAdapter、Snapshot、Handle 和风险等级；
- 升级 CapabilityBridge 信封；
- 实现 WebAdapter 的最小页面语义、截图、稳定句柄和操作闭环；
- 建设 `runtime: web`、持久 Session Partition 与权限策略；
- Web App 通过 Surface 暴露，不直接嵌入全局 DOM；
- 支持受审计的 CSS/JS 注入与应用导入导出。

验收：Agent 可在代次校验和能力约束下操作持久 Web App，旧页面句柄不会误操作新页面。

### 阶段 8：Document Runtime与文档工作站

**目标**：以原生文档工作站验证完整内核设计。

工作项：

- Document Object、Revision、Patch Transaction；
- Markdown 唯一真源与源码区间映射；
- Agent PR、源码 Diff、渲染 Diff 和 Approval；
- 文档/演示 Surface；
- 可编程岛沙箱与生命周期；
- Checkpoint、Export 和 Provenance。

验收：人类和 Agent 能在不丢失源码的前提下协作编辑，冲突和过期 Revision 可明确拒绝。

**当前状态（2026-08-19）**：Document Runtime 已实现通用 Inline AST、Markdown 源码区间映射、Revision/Patch Transaction、协作与 Review、内容寻址 Blob、HTML/Markdown/Presentation/PDF 导出和 Document Surface Projection。Programmable Island 采用 opaque-origin sandboxed iframe；源码经 SHA-256 校验，CSP 禁止网络、同源、导航、表单、弹窗、Worker 与外部资源，Host 通信绑定版本、Sandbox ID、来源窗口、权限和消息大小。

### 阶段 9：Observer Service 与 Agent State

**目标**：引入不污染生成链的人格、情绪和驱力观测。

工作项：

- 定义 Agent State Resource；
- 订阅 assistant committed 等 Durable Event；
- 实现异步投影、去重、持久化与可视化；
- 由 ContextPolicy 决定是否映射；
- 建立隐私、删除、导出和模型偏差评估。

验收：关闭 Observer 不影响 Agent 生成；启用后状态可审计且不会反向污染历史事实。

**当前状态（2026-08-19）**：Observer Service 已实现异步 Durable Event 订阅、Event ID 去重、SQLite 原子持久化、Agent State 聚合审计 Surface、策略 API、停用、导出和删除。Observer 默认不进入 Prompt；只有 Thread ContextPolicy 与 Observer Policy 双重启用时才生成 `trust=derived` Region。Observer 分析失败被隔离，不阻断 Outbox 发布或 Agent 生成。

### 阶段 10：隔离强化与多节点演进

**目标**：在协议稳定后按风险将逻辑边界升级为机制隔离。

候选路径：

- Worker Thread：CPU 密集但可信任务；
- Child Process：插件与 App 进程隔离；
- WASM：可移植、受限计算；
- Electron Sandbox：Web Surface；
- 远程 Node：设备与移动能力；
- 独立 Daemon Service：高可靠或高风险系统服务。

不以“拆进程数量”作为成功指标，以故障隔离、安全边界和性能收益为依据。

**当前状态（2026-08-19）**：N12 本轮只完成跨节点基础设施，不包含 Electron、Tauri 或其他客户端壳层建设与验收。已完成并通过本机故障注入的范围是版本化协议、Secure WebSocket Transport、TLS/mTLS、Node Trust、Session/Lease、Input Seat、取消与 Deadline、重复消息处理、流式 Transfer、合法前缀恢复和 Authority fail-closed。真实跨机器 LAN/WAN、物理断网、证书分发与异构设备联调仍未验收，不得标记为生产多节点完成。

---

## 14. 第一条工程切片的建议边界

尽管本文档暂不进入实施，后续启动时最合适的第一条切片已经确定：

```text
聊天 Execution → 统一事件 → Conversation Surface → Vue Renderer
```

原因：

1. 同时经过后端、协议和前端，可验证架构不是纸面抽象；
2. 现有事件天然包含 delta、tool、status、error、done；
3. 能立即改善流式稳定性、重连和复杂节点生命周期；
4. 不需要先迁移数据库或应用系统；
5. 可使用 Adapter 保留当前 UI；
6. 为 Web Runtime 和 Document Runtime 提供必要的 Surface 基础。

第一条切片明确不包含：

- 任意 HTML/JS 执行；
- 全量 AppManager Port 化；
- Scheduler 重写；
- 外部Web Runtime或文档工作站实现；
- 外部人格状态注入；
- 多进程拆分。

---

## 15. 性能与 UX 预算

每个阶段必须同时回答正确性、安全性和性能问题。

### 15.1 核心指标

- 用户提交到接收确认的延迟；
- 首 Token / 首 Surface 时间；
- 流式更新帧率与最长主线程阻塞；
- 单条长消息的 DOM 变更量；
- 不可见 Surface 的 CPU/GPU 占用；
- 每个 Execution 的内存、Token、LLM 与工具调用量；
- 前台任务受后台负载影响的 P95 延迟；
- Provider 调用超时、取消和 stale-handle 比率；
- 重启后任务与 Surface 恢复成功率；
- 数据迁移与回滚成功率。

### 15.2 UX 不变量

- 用户不因架构迁移失去历史、记忆、任务或应用数据；
- 切换 Agent、Thread、Tab 和窗口不串状态；
- 工具卡、审批卡和复杂内容在流式过程中不闪烁或丢失展开状态；
- 浅色/暗色和辅助功能由 Compositor/Renderer 一致处理；
- 后台执行的状态、等待原因和取消结果可理解；
- 错误必须说明发生在哪个 Execution、哪个资源和哪个阶段；
- 降级行为必须可解释，不伪装成功。

---

## 16. 安全模型

### 16.1 信任层级

```text
Kernel Core
  > Built-in System Service
  > Signed/Official App
  > User-installed App
  > External MCP/Provider
  > Model-generated Code / Web Content
```

不同层级必须拥有不同默认能力、隔离和审批要求。

### 16.2 Surface 安全

- Markdown Surface 默认不执行脚本；
- 可编程 Surface 必须进入独立沙箱；
- HTML、Web App 和文档可编程岛不能共享主前端全局对象；
- 输入事件必须路由到明确 Surface 和 Principal；
- 截图、剪贴板、Cookie、网络拦截和原生输入属于高风险能力；
- Renderer 不能因展示工具结果而获得工具本身的权限。

### 16.3 审计与隐私

- Audit 记录能力决策和副作用，不默认记录敏感明文；
- Web/设备 Snapshot 在进入模型前脱敏；
- Observer 数据支持删除、导出和停用；
- Capability Handle 不得出现在普通 Prompt 文本中；
- Durable Event 的保留周期和隐私擦除应按资源类型配置。

---

## 17. 测试与验证策略

### 17.1 协议契约测试

- shared 类型与序列化兼容；
- Envelope 版本协商；
- Generation / stale-handle；
- Correlation / Causation 链；
- Cancellation / Deadline；
- Capability 委派不可扩权。

### 17.2 状态机测试

对 Execution、Task、App、Surface 和 Capability 建立表驱动状态机测试，覆盖非法跃迁、重复请求和崩溃恢复。

### 17.3 双轨兼容测试

迁移期同一输入同时经过 Legacy Adapter 与新协议投影，比较：

- 持久消息；
- 工具调用顺序；
- 最终 Surface；
- 错误与取消结果；
- 权限决策。

不要求内部事件字节相同，但要求用户可见语义一致。

### 17.4 故障注入

应覆盖：

- SSE 中途断开；
- Provider 掉线；
- Tool 超时；
- Approval 跨重启；
- SQLite 提交后 Surface 未送达；
- TDB flush 中断；
- App 崩溃；
- 旧 Generation 操作；
- 重复 idempotency key；
- Surface Renderer 异常。

### 17.5 性能回归

所有 Surface、Scheduler 和 IPC 变更必须与阶段 0 基线对比，不接受只验证功能正确、不测高频路径的架构升级。

---

## 18. 风险与控制

| 风险                      | 表现                     | 控制措施                                        |
| ------------------------- | ------------------------ | ----------------------------------------------- |
| 过度抽象                  | 大量接口但没有真实调用者 | 每个协议先由聊天垂直切片验证                    |
| 双协议长期存在            | 维护成本翻倍             | 每个 Adapter 写明移除条件和截止阶段             |
| 内核膨胀                  | 所有策略都进入 Kernel    | 内核只保留对象、能力、调度、IPC、生命周期与审计 |
| 数据迁移损坏              | 历史、任务或记忆丢失     | 幂等迁移、备份、恢复演练、旧表保留期            |
| 性能下降                  | 包装层、事件层增加开销   | Envelope 批处理、Ephemeral 降频、基准门禁       |
| Surface 成为新全局状态    | UI 与事实再次耦合        | Surface 可重建，持久事实仍归领域存储            |
| Capability 形式化但无隔离 | App 仍可直接访问 Service | Port 化后逐步禁止直连，按风险引入进程/WASM 隔离 |
| 外部组件形成第二套内核    | 独立状态、协议与生命周期 | 所有能力服从infOS Kernel Object/Port/Surface    |
| Observer 污染人格         | 测量结果直接注入 Prompt  | Observer 与 ContextPolicy 强制分离              |
| OS 类比误导设计           | 为对应名词而制造复杂度   | 每个抽象必须解决可测试的边界问题                |

---

## 19. 架构决策门槛

任何新增“内核级”抽象必须回答：

1. 它保护或调度的资源是什么？
2. 权威状态由谁持有？
3. 生命周期和终态是什么？
4. Principal、Process 与 Execution 如何归属？
5. 访问需要什么 Capability？
6. 哪些是 Durable Event，哪些是 Ephemeral Frame？
7. 如何取消、超时、重试和防止重复副作用？
8. 如何检测过期对象或旧代次？
9. 崩溃后如何恢复或解释？
10. 如何测量性能与 UX 影响？
11. 是否可以作为用户空间策略，而不进入内核？
12. 它替代了什么旧胶水，移除条件是什么？

回答不完整时，不应仅因为“像 OS”而进入核心架构。

---

## 20. 完成定义

infOS 的操作系统化演进不是某个版本号，而是以下系统不变量逐步成立：

```text
所有执行都是 Execution
所有可寻址资源都可投影为 Kernel Object
所有跨边界访问都受 Capability 约束
所有重要副作用都有 Durable Event 与因果链
所有视觉输出都可投影为 Surface
所有应用都通过 Port 使用内核能力
所有设备与外部环境都通过 Adapter 暴露
所有上下文都来自可审计的 Resource Mapping
所有后台工作都受统一调度语义约束
```

当Web Runtime、Document Runtime、Social和未来自治应用不再要求向主Agent核心增加应用特殊分支，而能通过Application Realm及同一套Object、Execution、Capability、Event、Port、Adapter与Surface组合实现，同时Stronghold继续作为主应用内部模块复用这些Kernel机制时，infOS才真正具备“OS”之名。

---

## 21. 已确认的首轮架构决策

以下决策作为第一代架构基底的实施约束：

1. **进程内逻辑微内核**：Kernel 首先在现有 Daemon 进程内实现，通过 Port、类型和生命周期形成严格逻辑边界；协议稳定后再按风险、故障隔离与性能收益拆分进程。
2. **领域表 + 事务 Outbox**：SQLite 领域表和 TriviumDB 继续持有业务权威数据；与领域提交同一事务写入 Outbox，投影器和发布器从 Outbox 产生 Durable Event。首轮不采用全面事件溯源，也不允许仅靠实时消息表示持久事实。
3. **混合 Surface 权威**：后端持有业务事实、Execution 状态、语义节点意图和可恢复提交；客户端 Compositor 持有窗口级 Surface Tree、布局、可见性、动画与输入焦点。客户端不得反向成为业务事实源，后端也不持有窗口像素与局部交互状态。
4. **完整五件套基底**：第一轮先建立 Kernel Object、Execution、Capability、Event/Outbox 与 Lifecycle 五项基础框架，再接入聊天 Compositor；Scheduler、Web Runtime、Document Runtime 和 Observer 不进入首轮实现。
5. **异构自主实现**：外部项目仅用于验证设计规律与发现失败模式；infOS不复制其插件树、Session、Surface或运行时组件，所有实现从infOS的Principal、Resource、Execution与UX目标反推。

### 21.1 首轮边界

首轮允许新增进程内 Registry、类型化领域事件、Outbox Repository、LifecycleScope 和兼容 Adapter，但不得：

- 将所有现有 Service 改造成插件；
- 引入第二套 DI 容器或通用插件框架；
- 将所有领域表改造成事件溯源；
- 为追求形式统一建立万能 Kernel Object 数据表；
- 在 Compositor 完成前引入任意 HTML/JS Surface；
- 提前拆分多进程或改变现有用户功能。

### 21.2 MOD、Package 与用户空间贡献模型

旧 Extension 的 `tool | hook | service` 是迁移期分类，不作为目标 OS 的统一运行时本体。升级后：

```text
Package / MOD = 安装、签名、版本、升级与分发单元
Contribution  = Package 对用户空间的静态贡献声明
Runtime Object = Contribution 启动后产生的 App、Process、Provider、Adapter 等对象
```

一个 Package 可以同时贡献：

```text
Application
Resident Service
Capability Provider
Runtime Adapter
Tool ABI
Skill / Context Resource
Policy
Event Subscriber
Surface Presenter
Asset / Schema / Migration
```

`Tool` 只是面向 Agent 的调用 ABI，`Service` 是运行载体，`Hook` 必须按语义拆为 Policy、Event Subscriber、Projection 或 Adapter，`Skill` 是可映射的 Context Resource 与 Capability Requirement。任何 Contribution 都不得因安装或加载而隐式扩权。

Package 间不得通过代码导入、共享 `AppContext`、`ExtensionManager.getService()` 或全局状态直接调用。跨 Package 协作统一采用：

```text
Capability Definition
→ Provider Offer / Consumer Requirement
→ Capability Directory
→ Policy Binding
→ Capability Handle
→ Bound Port
→ Kernel Call
→ Provider
```

有效调用权限取 Consumer Handle、Provider 可实现范围、Provider 自身运行权限与当前 Policy 的交集；Provider 不能成为 Consumer 的权限来源，禁止 confused deputy 和权限洗钱。Package 可以消费已有能力、组合为高层能力并重新发布，但子调用的资源范围、操作、期限与风险只能逐层收窄。

历史扩展资产已按以下目标语义完成迁移：

```text
Tool Extension    → Tool ABI + Capability Provider
Service Extension → Package Service Process + Capability Provider
观察型 Hook       → Durable Event Subscriber
裁决型 Hook       → Policy Provider
转换型 Hook       → Projection / Presenter / Adapter
Skill             → Skill Resource + ContextRegion + Capability Requirement
```

旧运行时兼容层已删除。当前只在 PackageInstaller 安装边界保留历史 `manifest.json` 输入投影与 `@data/extensions` 目录一次性迁移；运行时仅接收 Manifest V2、Port 与 Capability Handle，不允许 `serviceId + method` 直连。

### 21.3 已完成：Package 与 Browser Runtime 基础闭环

截至 2026-08-18，以下里程碑已进入生产代码并通过真实 Chromium 验证：

```text
M1 Kernel Call Foundation                         已完成
M2 Capability Userspace Foundation                已完成
M2.5 Cross-Package Composition Probe              已完成
M3 Package Model V2                               已完成
M4 Runtime Driver Foundation                      已完成
M5 Browser Native Package                         已完成
M6 Browser Tool/Surface/Approval Composition       已完成
M7 Legacy Extension Retirement                    已完成
```

当前 Browser Runtime 已具备动态端口、持久 Profile、多 Target、DOM/Accessibility/Frame 观察、Grounded Snapshot、Native Input、条件等待、局部视觉、Network、Storage、Emulation、脚本分权、下载策略、Capability/Approval 与 Surface 闭环。

旧 ExtensionManager、ExtensionLoader、ServiceRunner、HookRegistry、旧 Shared 类型和旧源码目录已物理删除；历史清单与 `@data/extensions` 只在 PackageInstaller 安装边界执行一次性数据投影和目录迁移。

Browser 完成证明 Runtime/Driver 范式可用，但也暴露出下一阶段不应继续堆入 Driver 的通用资源需求：文件、传输、事件化对象状态和秘密凭据。

### 21.4 下一轮：Resource Transfer Foundation

下一轮优先建设四项可复用 OS 原语，不先实现 Browser 私有上传/下载旁路。

```text
Asset / File Handle
→ Transfer Object
→ Runtime Event Subscription
→ Scoped Credential
```

它们必须同时服务至少两个领域，预期复用方包括 Browser、Social 附件、Cloud Sync、模型资源、MCP 与 Document Runtime。

#### 21.4.1 Asset 与 File Handle

`AssetObject` 表示可寻址、可审计的内容元数据；`FileHandle` 表示对具体文件资源的限权引用。两者不得等同于绝对路径字符串。

```text
AssetObject
├─ assetId / objectRef / generation
├─ kind / mimeType / sizeBytes / sha256
├─ ownerPrincipalId / source / createdAt
├─ storageRef（不进入 Prompt）
└─ lifecycle / retention

FileHandle
├─ handleId
├─ subjectId / assetRef
├─ operations: read | upload | export
├─ expiresAt / maxUses
├─ pathScope / mimeScope / sizeLimit
└─ revokedAt
```

约束：

1. Agent、Tool、Package 和 Browser 不得接收任意绝对路径；2.物理路径只存在于受信任的 Asset Store/File Port 内；
2. Handle 必须可撤销、可到期、可限制次数并绑定 Principal/Execution；
3. Hash、MIME、大小在签发前验证，使用时重新检查 generation 与 containment；5.用户文件选择产生 Handle，不直接把路径写入 Prompt、Tool Result 或普通日志；
4. Browser 上传只能消费 `upload` Handle，并在调用后按 maxUses 衰减。

#### 21.4.2 Transfer Object

上传、下载、跨节点复制和导入导出统一投影为 `TransferObject`，但协议实现可以不同。

```text
TransferObject
├─ transferId / objectRef / generation
├─ direction: upload | download | copy | import | export
├─ sourceRef / destinationRef
├─ state: pending | running | paused | completed | failed | cancelled
├─ bytesTotal / bytesTransferred
├─ checksum / resultAssetRef
├─ principalId / executionId / correlationId
└─ error / startedAt / completedAt
```

状态迁移必须合法且幂等：

```text
pending → running → completed
                 ↘ failed
pending/running → cancelled
running ↔ paused（仅 Provider 声明支持时）
```

约束：

- Transfer 是 Kernel Object，不是 UI 进度条；-进度通过 Runtime Event/Outbox 投影到 Surface；-完成后返回 Asset Ref，不返回未经授权的绝对路径；-取消必须传播到 Provider；-重启恢复只恢复 Provider 可证明的合法前缀；-大文件不进入 Kernel Envelope、SSE 或数据库正文。

#### 21.4.3 Runtime Event Subscription

Runtime Adapter 需要事件化状态入口，避免 Browser Mutation、Download、Dialog、Target 与未来 Device Runtime 全部依赖轮询。

```text
RuntimeEvent
├─ runtimeRef / objectRef
├─ eventType
├─ generation / revision / sequence
├─ executionId / correlationId
├─ occurredAt
└─ payload（有界、可版本化）
```

首轮采用进程内类型化订阅，并通过现有 Kernel Event/Outbox 与 Surface Projection 连接；不新建第二套 Event Bus。

约束：

1.同一对象 `(generation, revision, sequence)` 单调递增；2. generation 变化使旧 Stable Handle 失效；3.事件 Payload 不包含文件正文、Cookie 明文、Credential 或 Capability Handle；4.订阅必须绑定 LifecycleScope，停用后自动释放；5. Durable Fact 仍由领域事务 + Outbox 产生，Runtime Event 不能替代权威持久状态；6.高频事件必须支持合并、节流和背压。

#### 21.4.4 Scoped Credential

Cookie、Authorization Header、API Token 和 Provider Secret 不应作为普通 Tool 参数在模型上下文中往返。

```text
CredentialObject
├─ credentialId / objectRef / generation
├─ kind
├─ ownerPrincipalId
├─ originScope / audience / operations
├─ expiresAt / maxUses
├─ secretRef（不透明存储引用）
└─ revokedAt
```

约束：

-秘密正文只存在于 Credential Vault

- Consumer 仅获得 Scoped Credential Handle -使用必须绑定目标 Origin/Audience、操作、期限与 Principal -日志、Event、Surface、Prompt 和 Tool Result 只显示脱敏元数据
- Provider 只能在已授权调用内解析秘密，不能导出明文
- Credential 不替代 Capability，必须同时满足能力授权和凭据授权

### 21.5 Resource Foundation 完成状态

截至 2026-08-18，R1–R7 已进入生产代码并通过单元、契约与真实 Chromium 测试：

```text
R1 Shared Contract                         已完成
R2 In-Memory Authority Probe               已完成
R3 Persistent Metadata                     已完成
R4 Event Projection                        已完成
R5 Browser Download Slice                  已完成
R6 Browser Upload Slice                    已完成
R7 Browser Runtime Completion              已完成
```

已完成能力包括 Asset/File Handle、Transfer Object、Runtime Event、Scoped Credential、下载 Asset 化、一次性上传、Dialog、Frame Context、Mutation Event 和受限动作恢复。

### 21.6 Agent Interaction World

Browser 的下一代差异化目标不是增加更多 DOM 命令，而是把 DOM、Accessibility、Layout、Network 与 Vision 作为证据，编译成 Agent 第一视角的交互世界。

```text
Raw Runtime Evidence
→ InteractionScene
→ Semantic Web Object
→ Affordance / Preconditions / Risk
→ Intent-first Policy
→ Action Receipt / Effect Verification
→ Site Model / Task Checkpoint
→ Temporary Capability Offer
```

#### 21.6.1 InteractionScene

Scene 必须提供 Region、Form、Field、Button、Dialog、List、Table 等语义对象，以及对象关系、可执行 Affordance、状态、前置条件、预期效果、风险、证据来源与置信度。

DOM/AX/Vision 是证据，不是 Agent 世界本身。Agent 不应以 Selector 为主要任务语言，Selector 只允许作为 Driver 内部定位提示。

#### 21.6.2 强 InteractionHandle 与 Rebind

Handle 由 Runtime、Page、Frame、BackendNode、Document Generation、Snapshot、语义指纹、AX 指纹和几何指纹构成。Rebind 顺序为：

```text
BackendNode 精确身份
→语义 + AX 指纹
→几何辅助
→置信度门槛
→歧义时 fail-closed
```

禁止跨 Document Generation 重绑定，禁止同分候选自动选择。

#### 21.6.3 ActionReceipt

每个高层动作必须记录 Intent、目标 Handle、前后 Snapshot、已派发输入、Observed Effects、Expected Effects、验证状态、证据引用与回滚提示。

```text
verified
partially_verified
unverified
failed
```

Site Model 只能从 `verified` 或 `partially_verified` Receipt 学习；未经验证的动作不得成为长期站点知识。

#### 21.6.4不可信网页内容

网页内容默认是站点数据，不是 Agent 指令。Scene 必须识别指令覆盖、秘密请求、不安全动作、隐藏内容和跨 Origin 内容，并标记 Trust 与风险。critical Finding 必须阻断自动计划与 Capability 编译。

#### 21.6.5 Web Object 与 Capability Compiler

高置信度业务对象可以投影为 `web-semantic-object` Kernel Object。经验证的 Affordance 可以编译为 Origin、Scene、Object、Operation 与 Risk 均固定的临时 Capability Offer。

Capability 编译不自动签发 Handle，不自动授予权限；Consumer 仍需 Requirement、Handle、Policy 与 Approval。

#### 21.6.6 Intent-first Approval

审批必须展示业务意图、Origin、副作用类别、资源摘要、可回滚性和预期效果。声明风险不得低于 Scene 推断风险，Origin 必须与当前页面一致。

#### 21.6.7 Browser Tool Planner

Planner 消费 Scene Object，不消费任意 Selector。首个标准闭环是表单任务：

```text
Observe Scene
→选择唯一 Form/Field
→验证 Preconditions
→填写字段
→生成字段 Receipt
→ Intent Approval
→提交
→观察 URL/DOM/Network/Dialog/Download/Object State
→生成提交 Receipt
→更新 Site Model
→保存 Task Checkpoint
```

施工纪律：

1.不允许网页文字覆盖用户目标、System Policy 或 Capability Scope 2.不允许 Site Model 静默扩权 3.不允许 Capability Compiler 创建万能脚本或自动签发 Handle 4.不允许未验证动作进入长期站点模型 5.不允许 Planner 自动重试不可逆动作 6.不允许跨 generation 重绑 Web Object 7.不允许用单一 Selector、文本或视觉证据直接执行高风险动作

验收：

-多表单页面的 Field/Submit 关系来自真实 DOM Form 归属 -强 Handle 包含 BackendNode，重绑歧义 fail-closed
-critical 网页注入阻断 Planner 和 Capability Compiler -字段与提交动作产生可验证 Receipt -审批理由包含 Intent、Origin、资源和可回滚性 -临时 Capability 在没有 Handle 时调用失败 -真实 Chromium 可构建多语言 Form Scene 与 BackendNode 身份

## 22. Node Foundation 与分布式执行路线

Resource Foundation 与 Agent Interaction World 完成后，下一优先级是把客户端、服务端、能力节点与资源权威提升为 Kernel 一等概念。

### 22.1 Node Host 本地闭环完成状态

截至 2026-08-18，以下基础已完成：

```text
N1 Node Contract                         已完成
N2 Node Registry / Lease / Input Seat    内存权威已完成
N3 Node-scoped Kernel Identity           第一阶段已完成
N4 Resource Authority Directory          内存权威已完成
N5 Placement Resolver                    基础约束已完成
N6 InMemory Transport                    已完成
N6 Loopback WebSocket 跨进程探针         已完成
N9 server.browser.chromium兼容实现      已完成（待迁移 Electron）
Node SDK / Node Host                     已完成首版
Echo / Asset Provider                    已完成
配对码 + Ed25519 Certificate Probe       已完成
NodeCapabilityBridge                     已完成
```

明确尚未完成：

```text
公网远程 Node Transport
生产 TLS / mTLS
持久 Node Trust / Certificate Repository
Gateway Node Session Adapter
流式 Cross-node Transfer
ComfyUI / TTS / Browser Node Provider
Authority 持久元数据与正式迁移
```

Loopback WebSocket 只绑定 `127.0.0.1`，用于验证独立 Node Host 进程、Hello、Invocation、Cancellation 和 Receipt 协议，不代表生产远程连接已经安全可用。

### 22.2实施路线

```text
N1 Node Contract
  NodeId / Identity / Facet / Trust / Platform / Protocol
  Placement / Presence / Input Seat / Lease

N2 Node Registry
  Node Descriptor / Session / Lease / Health / Reconnect Generation
  Session ID 与稳定 Node ID 分离

N3 Node-scoped Kernel Identity
  Object Authority Node
  Capability Provider Node
  Envelope Source/Target Node / Route / Hop Limit

N4 Resource Authority Directory
  Object Type + Object ID → Authority Node
  Authority Epoch / Generation / Replica Hint

N5 Placement Resolver
  Requirement × Offer × Trust × Lease × Presence × Residency × Cost
  本地优先不是硬编码，必须服从安全与资源约束

N6 Node Transport / Router
  InMemory Probe
  Loopback WebSocket 跨进程探针
  Gateway WS Adapter（后续）
  Electron IPC Adapter（后续）
  Remote Provider RPC（后续）

N7 Client Presence / Input Seat
  Surface Target
  Approval Target
  File Picker / Clipboard / Screen / Audio Output

N8 Cross-node Transfer
  Client File Handle → Transfer → Server Asset
  Server Audio Asset → Client Stream/Playback

N9 Electron Browser Capability
  server.browser.chromium 仅作为迁移期兼容实现
  目标 Provider 为 electron.browser.web-page
  非 Electron Client 默认不发布 web.page
  不自动回退服务器 Browser

N10 Capability Node Probe
  ComfyUI Provider Node
  Workflow Input Asset → GPU Execution → Result Asset

N11 Authority Failure
  Lease Expiry / Revocation Epoch / Retry / Idempotency
  Authority 不可达时写入 fail-closed

N12 Multi-node Acceptance
  Electron/Tauri Client + Docker Server + Capability Node
  断线、重连、取消、Deadline、重复消息和合法状态前缀
```

施工纪律：

1.不把 Gateway 连接 ID 当作 Node Identity 2.不把所有 Node 数据库做多主同步 3.不把绝对路径发送到其他 Node 4.不让 Client Facet 因用户在场而获得 Server 权限 5.不让 Server 伪装文件选择、桌面截图或 Input Seat 6.不在 Offer Lease 过期后创建新 Binding 7.不在 Authority 不可达时自动选择另一个 Server 写入 8.不让 Placement 决策绕过 Capability Handle、Policy 或 Approval 9.不在远程 Transport 完成前移除现有 InMemory/local Provider 10.先以 Electron Browser Capability 和 ComfyUI Probe 验证 Provider 协议，再迁移其他能力

首个跨节点验收切片：

```text
Windows Client File Picker
→ Client File Handle
→ Cross-node Transfer
→ Docker Server Asset
→ ComfyUI Capability Node
→ Result Asset
→ Server Authority
→ Windows Client Surface
```

该切片必须证明 Client Capability、Server Authority、Compute Provider、Transfer、Handle 衰减、Event、Surface 和失败恢复形成闭环。

---

## 23. Context Region 收敛状态

截至 2026-08-18，ContextCompiler 已完成小阶段收敛：

```text
ContextRegion Shared Contract              已完成
ContextRegionRegistry                      已完成
ContextRegionSelector                      已完成
Trust / Priority / Required / Budget       已完成
Deduplication / Expiry / Manifest          已完成
现有来源 Region Manifest 投影              已完成
Continuity Region Provider                 已完成
跨 Thread 单次权威查询                     已完成
Container 唯一 Registry 接入               已完成
```

架构结论：

- ContextCompiler 是唯一模型上下文编译权威；
- Continuity是optional Region，不是独立连续性Service；
- ThreadMessage 是唯一消息权威，不新增 Continuity 私有库；-跨 Thread 消息不写入当前 Thread，不修改原正文；
- Message ID、Revision、Thread、Channel 和时间戳作为结构化 Provenance；
- Continuity 引用来自 Server Authority，但正文按 `external` 低信任数据处理；
- required Region 超出预算时 fail-closed，optional Region 整体淘汰，不静默截断；
- Manifest 记录 selected、duplicate、expired、budget_exceeded 与来源对象；-现有 MDP Slot 行为保持兼容，后续来源可逐步迁移为独立 Provider。

本阶段明确不实现：

```text
独立Prompt Trigger
独立私有消息数据库
正文来源尾标
原生消息 Fuzzy 身份匹配
自动跨 Thread 写入
LLM 滚动摘要
精确模型 Tokenizer
```

下一主产品阶段转向 Document Runtime 与超级文坊工作站 Application。

---

## 24. 后续待决策议题

以下问题必须在对应阶段开始前单独形成 ADR：

1. Kernel Object Registry 的适配层索引与持久元数据范围；
2. Execution Journal 的持久化粒度与保留周期；
3. Kernel Envelope 的版本协商与 Schema 工具；
4. Surface Patch 采用 JSON Patch、自定义操作还是二进制协议；
5. Capability Handle 的签发、存储和撤销机制；
6. App Port 的进程内与跨进程一致 ABI；
7. Scheduler 的资源计量和 Provider 限流策略；
8. ContextRegion 的缓存、一致性与 Token 估算；
9. Web Runtime 的 Chromium/Electron 复用边界；
10. Programmable Surface 的 Worker、iframe、WASM 或独立进程方案；
11. Observer 状态是否以及如何参与人格生成闭环；
12. 多窗口、多节点下 Compositor 与 Input Seat 的归属；
13. Outbox 保留、重放、清理、死信和跨 TriviumDB 副作用的一致性策略。

---

## 23. 相关文档

- [AIOS 核心架构与演进边界](../A09_AIOS_ARCHITECTURE.md)
- [后端架构](../A02_BACKEND_ARCHITECTURE.md)
- [前端架构与性能优化](../A03_FRONTEND_ARCHITECTURE.md)
- [多目标部署架构](../A04_DEPLOYMENT.md)
- [记忆引擎架构](../A05_MEMORY_ENGINE.md)
- [扩展系统](../A06_EXTENSION_SYSTEM.md)
- [CapabilityGate](../M02_CAPABILITY_GATE.md)
- [任务中心](../M05_TASK_CENTER_TODO.md)
- [API 响应与流式规范](../S02_API_SPEC.md)
- [测试规范](../S04_TESTING_STANDARDS.md)
- [UI/UX 设计规范](../S06_UI_UX_DESIGN_SPEC.md)
