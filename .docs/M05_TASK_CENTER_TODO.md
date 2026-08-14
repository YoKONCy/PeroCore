# 统一任务中心实现待办

> **状态**：🟡 核心闭环已完成；陪伴调度独立实例尚无可枚举状态接口，任务中心暂不能完整只读展示
> **适用范围**：`packages/backend/`、`packages/frontend/`
> **最后更新**：2026-08-14
> **验证**：前后端 typecheck、后端/前端测试及受影响原生测试以本次执行结果为准

---

## 1. 目标

建立一个支持多角色并行协作的统一任务中心，使用户能够：

- 保持一个前台活跃角色用于聊天、立绘、语音和默认交互；
- 将后台任务显式派发给 Pero、Nana 或其他 Agent；
- 前台角色切换不影响已经创建或正在运行的后台任务；
- 在同一页面查看、暂停、恢复、取消和追踪所有角色的任务；
- 统一管理后台 Agent 任务、定时任务与普通提醒，但在数据层保持类型隔离。

核心原则：

```text
前台活跃角色 activeAgentId
└─ 只决定当前 UI 展示和默认交互角色

后台任务 BackgroundTask
├─ 每个任务显式保存 agentId
├─ 每个任务拥有独立 threadId
└─ 创建后不跟随 activeAgentId 变化
```

---

## 2. 产品结构

将当前“待办提醒”页面逐步升级为“任务中心”，包含三个主视图。

### 2.1 进行中

默认视图，用于展示系统当前正在执行和等待处理的任务。

需要包含：

- 各角色运行中、排队中和等待用户输入的任务数量；
- 任务执行角色头像和名称；
- 任务标题、当前阶段、进度和运行时间；
- 工具调用次数、关联 Thread；
- 暂停、恢复、取消和查看详情操作；
- `waiting_input` 任务的醒目提醒和快速决策入口。

### 2.2 历史记录

展示已完成、失败和取消的任务。

需要支持：

- 按 Agent 筛选；
- 按任务状态筛选；
- 按日期范围筛选；
- 任务标题搜索；
- 查看最终结果、错误信息和执行摘要；
- 基于历史任务重新创建任务。

### 2.3 定时与提醒

统一展示调度项，但普通提醒和 Agent 任务必须使用不同的数据类型。

```typescript
type ScheduledItem =
  | {
      type: 'reminder'
      message: string
    }
  | {
      type: 'agent_task'
      agentId: string
      instruction: string
    }
```

需要覆盖：

- 单次提醒；
- 重复提醒；
- 定时 Agent 任务；
- 陪伴模式调度；
- 系统维护任务。

---

## 3. 后端数据模型

### 3.1 BackgroundTask

建议新增 `background_tasks` 表。

```typescript
type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface BackgroundTask {
  id: string
  agentId: string
  threadId: string
  title: string
  instruction: string
  status: BackgroundTaskStatus
  progress: number | null
  currentStage: string | null
  workspace: string | null
  result: string | null
  errorMessage: string | null
  toolCallCount: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}
```

可选补充字段：

- `priority`：任务优先级；
- `parentTaskId`：子任务关系；
- `requestedBy`：任务来源；
- `completionAction`：完成后的通知行为；
- `metadataJson`：不适合独立建列的扩展数据。

### 3.2 Thread 用途

后台任务应使用独立 Thread，并与普通聊天历史隔离。

建议为 Thread 增加用途字段：

```typescript
type ThreadPurpose =
  | 'conversation'
  | 'background_task'
  | 'companion'
```

说明：

- 语音对话继续使用 `conversation`，因为它只是 desktop 对话的输入输出适配；
- 陪伴模式保留独立用途和 `companion` channel；
- App 对话页只查询 `conversation`；
- 任务中心只查询 `background_task`；
- 开发日志页默认可查看全部用途，并提供用途筛选。

---

## 4. 后端服务设计

### 4.1 BackgroundTaskRepository

负责：

- 创建和更新任务；
- 分页查询任务；
- 按 Agent、状态和时间筛选；
- 原子状态迁移；
- 获取指定 Agent 的队列；
- 服务重启后的未完成任务恢复查询。

### 4.2 BackgroundTaskService

负责：

- 创建任务并显式绑定 `agentId`；
- 创建 `background_task` Thread；
- 按 Agent 管理执行队列；
- 调用 `ConversationTurnService` 执行任务；
- 更新任务阶段、进度和工具调用统计；
- 暂停、恢复、取消；
- 处理 `waiting_input` 和用户回复；
- 保存最终结果或错误；
- 发送 Gateway 进度通知。

### 4.3 ConversationTurnService 接入

后台任务复用现有统一对话编排，但必须显式传入任务执行者：

```typescript
conversationTurnService.executeTurn({
  threadId: task.threadId,
  agentId: task.agentId,
  content: task.instruction,
})
```

禁止使用全局 `activeAgentId` 隐式决定后台任务执行者。

后续可为长任务扩展专用接口，使任务可以进行多轮执行、暂停检查和用户输入等待，而不是只执行单轮回复。

### 4.4 并发策略

初期建议：

- 每个 Agent 同时最多运行一个重型后台任务；
- 不同 Agent 可以并行；
- 同一 Agent 的后续任务进入队列；
- 前台聊天与后台任务可以并行；
- 每个任务使用独立 Thread 和独立工作上下文；
- 任务完成后再通过 Scorer/MemoryGate 处理长期记忆写入。

```text
Pero
├─ 前台聊天：允许
└─ 后台任务：1 个运行 + N 个排队

Nana
├─ 前台聊天：允许
└─ 后台任务：1 个运行 + N 个排队
```

---

## 5. API 草案

```text
POST   /api/background-tasks
GET    /api/background-tasks
GET    /api/background-tasks/:id
POST   /api/background-tasks/:id/pause
POST   /api/background-tasks/:id/resume
POST   /api/background-tasks/:id/cancel
POST   /api/background-tasks/:id/input
POST   /api/background-tasks/:id/retry
DELETE /api/background-tasks/:id
```

创建任务请求示例：

```typescript
interface CreateBackgroundTaskRequest {
  agentId: string
  title?: string
  instruction: string
  workspace?: string
  completionAction?: 'notify' | 'open_result' | 'send_to_chat'
}
```

列表查询参数建议：

```typescript
interface BackgroundTaskQuery {
  agentId?: string
  status?: BackgroundTaskStatus
  keyword?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}
```

---

## 5.1 附录：已确认设计决策（2026-08-12 调研）

> 以下决策由主人通过两轮问卷确认，作为任务中心 + 对话 tab 联动升级的开发对照表。
> 每项决策均已落实到具体组件与协议，实现时可直接对照。

### A 轮：核心机制决策

| # | 决策项 | 结论 | 实现要点 |
|---|---|---|---|
| A1 | Agent occupied 锁冲突 | **主界面实时同步工作状态**（角色工作徽章）＋ ReAct 进行中**双锁** | 前端：thread 切换/删除按钮禁用；后端：threadsApi 返回 409 |
| A2 | 中断恢复 | SubAgent 崩溃自闭处理；主 Agent 崩溃→ **ReAct 存档半程续跑** | 存档粒度= 每步 tool call 完成即 append checkpoint；恢复时重放已成功步骤 |
| A3 | 审批通道 | **任务卡片 + 独属 task 的全局 toast**（可附说明给 agent rationale） | toast 独立于现有通知体系；rationale 落到 Memory(Provenance) + BackgroundTask |
| A4 | MemoryRuntime 桥接 | **是"固定后台 task"语义**——桥接为初始化时注册的常驻任务 | MemoryRuntime 启动时注册 BackgroundTask（category='常驻'） |
| A5 | 任务完成后的「孵化」体验 | **task 专属 toast + 系统级 Electron Notification** | 完成时：新 toast + new Notification + 小红点累计 |
| A6 | 审批记录 | **写入 Memory(Provenance) + 状态存 BackgroundTask** | 批准/拒绝动作入记忆（含 Provenance 三要素），状态存 BackgroundTask |

### B 轮：任务中心反哺对话 tab 升级

| # | 决策项 | 结论 | 实现要点 |
|---|---|---|---|
| B1 | 对话 tab 实时同步工作状态 | **角色工作徽章**（chat 顶部） | 显示"后台任务进行中 ×N"，点击跳转任务中心 |
| B2 | 工作/ReAct 中的会话切换/删除锁 | **前后端双锁** | 前端禁用切换/删除按钮；后端 threadsApi 删除/归档返回 409 |
| B3 | 审批附言反哺对话 tab | **实现对话 tab 的审批机制与前端组件，也能加附言** | ConfirmOverlay 重构为统一审批卡（chat + task 共用） |
| B4 | Toast 体系升级 | **新 TaskToast + 对话 tab 错误提示迁移统一** | 新建独立 TaskToast 组件（与现有通知 toast 分离样式/队列） |
| B5 | 工具轨迹滚动体验 | **智能跟随 + 浮动按钮**，对话 tab 一并升级 | ChatContainer 增加智能跟随：上翻时不自动跳底，新 tool call 到达时显示"新动态 ↓"浮动按钮 |
| B6 | 任务中心时间线粒度 | **按 ReAct 轮次分组** | 时间线单元 = 每次 LLM 往返（thinking→tool call→tool result 为一组） |

---

## 6. Gateway 事件草案

```text
background_task_created
background_task_started
background_task_progress
background_task_waiting_input
background_task_paused
background_task_completed
background_task_failed
background_task_cancelled
```

进度事件示例：

```typescript
interface BackgroundTaskProgressPayload {
  taskId: string
  agentId: string
  status: BackgroundTaskStatus
  progress: number | null
  currentStage: string | null
  toolCallCount: number
  updatedAt: string
}
```

前端收到事件后只更新对应任务，不应切换当前前台角色。

---

## 7. 前端页面设计

### 7.1 页面布局

```text
┌─ 任务中心 ──────────────────────────────────────────────┐
│ [进行中] [历史记录] [定时与提醒]       [派发新任务]    │
├────────────────────────────────────────────────────────┤
│ [Pero：1 项进行中] [Nana：2 项进行中]                  │
├────────────────────────────────────────────────────────┤
│ 任务卡片                                                │
│ 任务卡片                                                │
└────────────────────────────────────────────────────────┘
```

### 7.2 任务卡片

展示：

- Agent 真实头像；
- Agent 名称；
- 状态标签；
- 任务标题；
- 当前阶段；
- 进度条；
- 运行时间；
- 工具调用次数；
- 查看、暂停、恢复、取消操作。

状态视觉建议：

- `queued`：灰蓝；
- `running`：天蓝或主题色，并使用轻量脉冲；
- `paused`：琥珀色；
- `waiting_input`：粉色或橙色高亮；
- `completed`：绿色；
- `failed`：红色；
- `cancelled`：中性灰。

### 7.3 派发任务弹窗

包含：

- 执行 Agent 选择；
- 任务标题；
- 任务指令；
- 工作目录；
- 完成后行为；
- 明确显示提交按钮文案，例如“交给 Nana”。

派发任务不要求用户先切换前台角色。

### 7.4 任务详情

建议使用侧边抽屉或独立详情区域，包含：

- 基本信息；
- 状态时间线；
- 当前可见输出；
- 工具调用摘要；
- 中间产物；
- 最终结果；
- 错误详情；
- 用户输入请求。

禁止直接展示模型隐藏思维链；原始模型文本只保留在开发调试日志。

---

## 8. 与现有功能的关系

### 8.1 前台活跃角色

后端 `activeAgentId` 继续作为前台 UI 的唯一权威状态，只负责：

- 当前角色展示；
- 默认聊天角色；
- 立绘、状态与语音；
- 新建任务未指定 Agent 时的可选默认值。

后台任务必须始终保存显式 `agentId`，不能在执行过程中读取全局角色决定执行者。

### 8.2 当前任务与提醒页

实施时先调查并复用现有：

- `TasksTab.vue`；
- Scheduler API；
- `RuntimeStateService` 任务控制；
- Gateway 进度广播；
- 暂停、恢复、取消接口。

不要直接将运行时 LLM TaskState 当作持久化后台任务。两者职责不同：

- `BackgroundTask`：持久业务实体；
- `RuntimeStateService TaskState`：当前执行过程的短生命周期控制状态。

### 8.3 对话历史

后台任务 Thread 不应默认出现在 App 普通历史会话中。任务完成后若用户选择“发送到当前对话”，应写入一条结果摘要或引用卡片，而不是直接合并任务 Thread。

---

## 9. 实施阶段

### 阶段一：数据与基础服务

- [x] 设计并创建 `background_tasks` 数据表；
- [x] 为 Thread 增加 `purpose` 字段与索引；
- [x] 实现 `BackgroundTaskRepository`；
- [x] 实现基础 `BackgroundTaskService`；
- [x] 实现任务状态迁移约束；
- [x] 添加创建、列表、详情、取消 API。

### 阶段二：任务执行与队列

- [x] 按 Agent 建立串行任务队列；
- [x] 接入 `ConversationTurnService`；
- [x] 接入暂停、恢复和取消；
- [x] 保存任务结果与错误；
- [x] 实现服务重启后的任务恢复策略；
- [x] 接入 Scorer/MemoryGate。

### 阶段三：前端任务中心

- [x] 将 `TasksTab.vue` 升级为三视图任务中心（进行中 / 历史记录 / 定时与提醒）
- [x] 实现角色任务概览（activeCountByAgent + activeCount badge）
- [x] 实现进行中任务卡片（TaskCard.vue）
- [x] 实现历史列表与筛选（refreshHistory 分页 + 状态筛选）
- [x] 实现派发任务弹窗（DispatchTaskModal.vue + F3 活动任务按钮）
- [x] 实现任务详情（TaskDetailModal.vue 基本信息/指令/时间统计/结果/错误）
- [x] 使用 Pero/Nana 真实头像（agentAvatarUrl by useAgentStore）
- [x] 完成响应式布局和轻量动效（发卡扫描线/过渡/ TaskToast/pulse dot）

### 阶段四：实时进度与用户输入

- [x] 定义并发送 Gateway 任务事件（`background_task_created/started/completed/failed/cancelled`，M05 §6）
- [x] 前端增量更新任务状态（taskCenterStore upsertActive）
- [x] 实现 `waiting_input` 状态（工具审批创建后持久化问题/上下文并原地等待）
- [x] 实现任务决策交互（任务详情附言通过 `/input` 统一提交）
- [x] 实现完成通知和失败通知（TaskToast + 系统级 Notification，M05-A6/B4）
- [x] 确保任务事件不会切换前台角色（M05 §6 验证）

### 阶段五：定时任务融合

- [x] 统一展示普通提醒和定时 Agent 任务；
- [x] 支持创建定时 Agent 任务；
- [x] 接入陪伴调度的只读状态（批量状态接口 + 任务中心角色状态卡）；
- [x] 系统维护任务只读状态沿用 Scheduler 列表；
- [x] 增加任务重试和从历史重新派发；
- [x] 完善权限、审计与测试。

---

## 10. 验收标准

- [ ] 当前前台角色为 Pero 时，可以派 Nana 执行后台任务；
- [ ] Nana 执行任务期间可以继续与 Pero 聊天；
- [ ] 切换前台角色不会改变任务执行者或中断任务；
- [ ] Pero 和 Nana 可以并行各执行一个后台任务；
- [ ] 同一 Agent 的多个任务按照队列顺序执行；
- [ ] 刷新前端后仍能恢复任务列表和状态；
- [ ] 后端重启后不会把运行中任务永久留在错误状态；
- [ ] 任务可暂停、恢复、取消并得到明确反馈；
- [ ] 任务完成后可查看结果和工具调用摘要；
- [ ] 普通聊天历史不会混入后台任务 Thread；
- [ ] 任务进度通知不会自动切换前台角色；
- [ ] 所有任务执行路径显式传递 `agentId`；
- [ ] 前后端类型检查、单元测试和生产构建通过。

---

## 11. 暂不纳入首版

为控制首版复杂度，以下能力延后：

- 一个任务由多个 Agent 自动协作或转交；
- 同一 Agent 并发执行多个重型任务；
- DAG 工作流和复杂任务依赖；
- 自动拆分任务并创建子任务；
- 跨设备任务同步；
- 可视化工作流编辑器；
- 对模型隐藏思维链的前端展示。
