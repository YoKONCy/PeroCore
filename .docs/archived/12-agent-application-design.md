# 12. AgentApplication / SubAgent 架构设计（草案）

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 基于 AIOS 第七阶段完成后的架构延伸设计。
> 本文档整理设计讨论的先验信息、约束条件和初步构想，供后续深入细化使用。

---

## 0. 设计背景

### 0.1 当前架构状态（第七阶段已完成）

AIOS 七个阶段已全部完成，核心架构稳固：

- **PrincipalAgent**：六个一等资源（Identity / Memory / Workspace / ContextRuntime / Thread / ToolCapability）
- **Thread 模型**：替代 Session，channel 是 Thread 持久属性
- **ContextCompiler**：统一编译 LLM 输入，13 步拼装链路 + 12 个槽位
- **Daemon 独立**：纯 Node 进程，Electron 作为能力提供者
- **CapabilityGate**：(agentId, channel) 二维权限隔离，fail-closed
- **Memory 模块解耦**：MemoryProvider 接口 + MemoryGate 评价逻辑

### 0.2 现有架构的边界

根据 [01-principal-agent.md](01-principal-agent.md) 第 10 节，PrincipalAgent 内核**不包含**：

- SubAgent Instance
- Agent Application（Coding/Research/Office）
- 应用工作区
- 上下文委派
- 人格投影
- 任务检查点
- 跨 Agent 上下文传递

这些通过预留的插件扩展点在未来加入，内核不需要为此改动。

### 0.3 本文档的目标

设计 AgentApplication + SubAgent 的完整架构，包含：

- 接口定义
- 资源隔离边界
- 检查点机制
- 记忆交换
- 上下文持有模式
- 与现有 PrincipalAgent 内核的集成点

---

## 1. 设计决策（已确认）

主人确认的三个关键决策：

| 决策点       | 选择                     | 说明                                                                 |
| ------------ | ------------------------ | -------------------------------------------------------------------- |
| **首要目标** | 全部一起讨论             | 完整设计 AgentApplication + SubAgent 体系                            |
| **运行形态** | 同进程沙箱级             | 同进程但独立工作区 + 独立工具权限 + 独立上下文编译，通过消息队列通信 |
| **资源隔离** | 工作区 + 工具 + 记忆隔离 | SubAgent 有独立工作区、工具、记忆候选池，人格继承主 Agent            |

### 1.1 "上下文持有"架构

主人特别提到：**"实际上就是我们很久以前讨论的 AIOS 的'上下文持有'架构"**。

核心思想：SubAgent 持有自己的上下文（独立编译、独立历史、独立工具权限），而非由主 Agent 代为编译。主 Agent 只负责委派任务和接收结果。

与"上下文委派"的区别：

- **上下文委派**（被否决）：主 Agent 编译好上下文后传给 SubAgent，SubAgent 不持有上下文
- **上下文持有**（采用）：SubAgent 独立编译自己的上下文，主 Agent 只提供任务描述和资源访问权限

---

## 2. 领域模型构想

### 2.1 AgentApplication

```text
AgentApplication
├─ appId: string                    ← 应用标识，如 "coding"、"research"、"office"
├─ name: string                     ← 显示名称
├─ description: string              ← 简短描述
├─ hostAgentId: string              ← 宿主主 Agent ID（如 "pero"）
├─ status: 'registered' | 'running' | 'stopped'
│
├─ AppWorkspace                     ← 应用工作区（独立于主 Agent 的 Principal Workspace）
│  ├─ rootPath                      ← 应用工作区根目录
│  ├─ quota                         ← 配额
│  └─ policies                      ← 文件策略
│
├─ AppToolCapability                ← 应用工具能力（独立于主 Agent 的 ToolCapability）
│  ├─ allowedTools                  ← 工具白名单
│  ├─ resourceScope                 ← 资源范围（限制在 AppWorkspace 内）
│  └─ requiresApproval              ← 需要主 Agent 批准的工具
│
├─ AppMemoryStore                   ← 应用记忆存储（独立候选池）
│  ├─ candidates                    ← 记忆候选（待检查点交换到主 Agent）
│  └─ checkpoints                   ← 检查点（主 Agent 投影的任务上下文）
│
├─ SubAgentRunner                   ← SubAgent 运行器
│  ├─ maxConcurrent                 ← 最大并发 SubAgent 数
│  ├─ runningAgents                 ← 当前运行的 SubAgent 实例
│  └─ messageQueue                  ← 主 Agent ↔ SubAgent 通信队列
│
└─ AppContextCompiler               ← 应用上下文编译器（独立于主 ContextCompiler）
   ├─ appSpecificSlots              ← 应用特定槽位
   ├─ hostPersonaProjection         ← 主 Agent 人格投影（只读）
   └─ taskContext                   ← 当前任务上下文
```

### 2.2 SubAgent

```text
SubAgent
├─ subAgentId: string               ← SubAgent 标识（如 "coding-task-001"）
├─ appId: string                    ← 所属应用
├─ hostAgentId: string              ← 宿主主 Agent
├─ status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
│
├─ TaskContext                      ← 任务上下文（由主 Agent 委派时提供）
│  ├─ taskDescription               ← 任务描述
│  ├─ taskInputs                    ← 任务输入（文件路径、数据等）
│  ├─ successCriteria               ← 完成标准
│  └─ deadline                      ← 截止时间
│
├─ SubAgentContext                  ← SubAgent 独立上下文（自己持有）
│  ├─ compiledMessages              ← 编译后的 LLM Messages
│  ├─ history                       ← 独立历史（不写入主 Agent 的 Thread）
│  └─ manifest                      ← 编译清单
│
├─ SubAgentWorkspace                ← 工作区（AppWorkspace 下的子目录）
│  ├─ workDir                       ← 工作目录
│  └─ outputDir                     ← 产出目录
│
├─ SubAgentTools                    ← 工具权限（受 AppToolCapability 约束）
│  ├─ allowedTools                  ← 允许的工具
│  └─ resourceScope                 ← 资源范围（限制在 SubAgentWorkspace 内）
│
└─ Checkpoint                       ← 检查点（任务完成或中断时生成）
   ├─ summary                       ← 任务摘要
   ├─ outputs                       ← 产出物列表
   ├─ memoryCandidates              ← 记忆候选（待主 Agent 审核并入主记忆）
   └─ handoverContext               ← 交接上下文（如未完成，供接续）
```

---

## 3. 资源隔离边界

### 3.1 隔离矩阵

| 资源                 | 主 Agent                       | AgentApplication             | SubAgent                                 | 隔离方式                               |
| -------------------- | ------------------------------ | ---------------------------- | ---------------------------------------- | -------------------------------------- |
| **Identity（人格）** | 持有完整人格                   | 只读投影                     | 只读投影                                 | SubAgent 继承主 Agent 人格，但不可修改 |
| **Workspace**        | Principal Workspace            | AppWorkspace                 | SubAgentWorkspace（AppWorkspace 子目录） | 物理目录隔离                           |
| **Tools**            | ToolCapability（channel 矩阵） | AppToolCapability            | 受 AppToolCapability 约束的子集          | 白名单交集                             |
| **Memory**           | CanonicalMemory + Candidates   | AppMemoryStore（独立候选池） | Checkpoint.memoryCandidates              | 候选池隔离，检查点交换                 |
| **Context**          | ContextCompiler（13步+12槽位） | AppContextCompiler           | SubAgentContext（独立编译）              | 独立编译，不共享上下文                 |
| **Thread**           | 持有多个 Thread                | 无 Thread（任务驱动）        | 无 Thread（任务驱动）                    | SubAgent 不写入主 Agent 的 Thread      |

### 3.2 关键隔离规则

1. **SubAgent 不写入主 Agent 的 Thread** — SubAgent 的对话历史是独立的，不污染主 Agent 的对话流
2. **SubAgent 的工具调用受双重约束** — AppToolCapability 的白名单 ∩ SubAgent 的 resourceScope
3. **SubAgent 的记忆不直接写入主 Agent 的 CanonicalMemory** — 先写入 Checkpoint.memoryCandidates，由主 Agent 的 MemoryGate 审核后并入
4. **SubAgent 的人格是只读投影** — 继承主 Agent 的 basePersona，但不能修改
5. **SubAgent 的工作区是 AppWorkspace 的子目录** — 物理隔离，不越界访问

---

## 4. 上下文持有模式

### 4.1 核心流程

```text
主 Agent 收到复杂任务
  ↓
判断需要 SubAgent 处理
  ↓
创建 AgentApplication 实例（如 Coding App）
  ↓
委派任务：生成 TaskContext
  ├─ taskDescription: "重构 auth 模块"
  ├─ taskInputs: ["@principal/projects/auth/"]
  ├─ successCriteria: "所有测试通过"
  └─ deadline: "2小时"
  ↓
SubAgent 启动
  ├─ 继承主 Agent 人格投影（只读）
  ├─ 获得独立工作区（@app/coding-task-001/）
  ├─ 获得工具权限（AppToolCapability 子集）
  └─ 独立编译上下文（AppContextCompiler）
  ↓
SubAgent 执行 ReAct 循环
  ├─ 独立的历史（不写入主 Thread）
  ├─ 工具调用受限在 SubAgentWorkspace 内
  └─ 记忆候选写入 AppMemoryStore
  ↓
任务完成 / 中断 / 超时
  ↓
生成 Checkpoint
  ├─ summary: "重构完成，修改了 5 个文件"
  ├─ outputs: ["@app/coding-task-001/output/"]
  ├─ memoryCandidates: [...]  ← 待主 Agent 审核
  └─ handoverContext: null     ← 如未完成，供接续
  ↓
主 Agent 接收 Checkpoint
  ├─ MemoryGate 审核 memoryCandidates → 并入 CanonicalMemory
  ├─ 产出物移入 Principal Workspace（可选）
  └─ 在主 Thread 中通知用户任务完成
```

### 4.2 与"上下文委派"的区别

| 维度       | 上下文委派（被否决）         | 上下文持有（采用） |
| ---------- | ---------------------------- | ------------------ |
| 上下文编译 | 主 Agent 编译后传给 SubAgent | SubAgent 独立编译  |
| 历史管理   | 共享主 Agent 历史            | 独立历史           |
| 工具权限   | 主 Agent 代为校验            | SubAgent 独立校验  |
| 隔离强度   | 弱（共享上下文）             | 强（独立上下文）   |
| 通信开销   | 低（直接传上下文）           | 中（通过消息队列） |
| 适用场景   | 简单任务委派                 | 复杂任务独立执行   |

---

## 5. 通信机制

### 5.1 主 Agent ↔ SubAgent 通信

采用**消息队列**模式（同进程沙箱级）：

```text
MessageQueue
├─ 主 Agent → SubAgent
│  ├─ TASK_ASSIGN: 任务委派
│  ├─ TASK_CANCEL: 任务取消
│  ├─ RESOURCE_GRANT: 资源授权（如临时开放某工具）
│  └─ QUERY_STATUS: 查询状态
│
└─ SubAgent → 主 Agent
   ├─ TASK_PROGRESS: 任务进度
   ├─ TASK_COMPLETE: 任务完成
   ├─ TASK_FAILED: 任务失败
   ├─ REQUEST_APPROVAL: 请求批准（如需要主 Agent 确认的操作）
   └─ REQUEST_RESOURCE: 请求额外资源
```

### 5.2 检查点交换

任务完成或中断时，SubAgent 生成 Checkpoint，主 Agent 通过 CheckpointExchange 机制接收：

```text
CheckpointExchange
├─ 接收 Checkpoint
├─ MemoryGate 审核 memoryCandidates
│  ├─ accept → 并入主 Agent CanonicalMemory
│  ├─ reject → 丢弃（重复或低质量）
│  └─ pending → 待主 Agent 手动审核
├─ 产出物处理
│  ├─ 移入 Principal Workspace（可选）
│  └─ 归档到 AppWorkspace（可选）
└─ 通知主 Thread
   └─ 在主 Agent 的 Thread 中生成系统消息
```

---

## 6. 与现有架构的集成点

### 6.1 不改动的内核模块

以下模块**不需要改动**，SubAgent 体系作为插件层叠加：

- PrincipalAgent 及其六个一等资源
- ContextCompiler（主 Agent 的编译器）
- Thread 模型
- CapabilityGate（主 Agent 的权限门控）
- MemoryProvider / MemoryGate（主 Agent 的记忆系统）
- Daemon 独立运行机制

### 6.2 需要新增的模块

| 模块                     | 位置                                                    | 职责                  |
| ------------------------ | ------------------------------------------------------- | --------------------- |
| AgentApplicationRegistry | packages/backend/src/applications/                      | 应用注册与管理        |
| SubAgentRunner           | packages/backend/src/applications/subAgentRunner.ts     | SubAgent 生命周期管理 |
| AppContextCompiler       | packages/backend/src/applications/appContextCompiler.ts | 应用上下文编译器      |
| AppMemoryStore           | packages/backend/src/applications/appMemoryStore.ts     | 应用记忆存储          |
| CheckpointExchange       | packages/backend/src/applications/checkpointExchange.ts | 检查点交换机制        |
| MessageQueue             | packages/backend/src/applications/messageQueue.ts       | 主↔Sub 通信           |

### 6.3 需要扩展的模块

| 模块             | 扩展内容                                                           |
| ---------------- | ------------------------------------------------------------------ |
| ToolExecutor     | 支持按 (appId, subAgentId) 路由工具调用，受 AppToolCapability 约束 |
| container.ts     | 注册 AgentApplication 相关服务                                     |
| WorkspaceService | 支持 AppWorkspace 和 SubAgentWorkspace 的创建与管理                |
| PathResolver     | 支持 `@app/{appId}/` 和 `@subagent/{subAgentId}/` 路径别名         |

---

## 7. 数据库设计（预留）

```sql
-- AgentApplication 注册表
agent_applications (
  id          TEXT PRIMARY KEY,       -- appId
  name        TEXT NOT NULL,
  host_agent  TEXT NOT NULL,          -- 宿主主 Agent ID
  status      TEXT DEFAULT 'registered',
  config      TEXT,                   -- JSON 配置
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
)

-- SubAgent 实例表
sub_agents (
  id          TEXT PRIMARY KEY,       -- subAgentId
  app_id      TEXT NOT NULL,          -- 所属应用
  host_agent  TEXT NOT NULL,          -- 宿主主 Agent
  status      TEXT DEFAULT 'pending', -- pending/running/completed/failed/cancelled
  task_context TEXT,                  -- JSON: 任务上下文
  checkpoint  TEXT,                   -- JSON: 检查点（完成时填充）
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES agent_applications(id)
)

-- 应用记忆候选表（独立于主 Agent 的 memory_candidates）
app_memory_candidates (
  id          INTEGER PRIMARY KEY,
  app_id      TEXT NOT NULL,
  sub_agent_id TEXT,
  content     TEXT NOT NULL,
  status      TEXT DEFAULT 'pending', -- pending/accepted/rejected
  created_at  TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES agent_applications(id)
)
```

---

## 8. 待深入设计的问题

以下问题需要在后续讨论中细化：

1. **SubAgent 的 ReAct 循环复用** — 能否复用现有 reactLoop.ts？需要哪些适配？
2. **AppContextCompiler 的槽位设计** — 应用特定槽位如何组织？与主 Agent 的 12 个槽位关系？
3. **并发控制** — 多个 SubAgent 同时运行时的资源竞争和调度
4. **中断与恢复** — SubAgent 被取消或进程重启后如何恢复
5. **安全边界** — SubAgent 的工具调用如何防止越界（如访问主 Agent 的 Workspace）
6. **Coding App 第一版范围** — 具体实现哪些功能（文件编辑/终端执行/测试运行）
7. **社交子 Agent 剥离** — social/group channel 如何从主 Agent 迁移到独立应用
8. **UI 展示** — SubAgent 的任务进度如何在 Dashboard 中展示
9. **ToolProviderPolicy 集成** — allowedAgents/requiresApproval/rateLimit 如何与 SubAgent 权限集成

---

## 9. 建议的实现路线图

### Phase 1: 基础架构（预计 2-3 个迭代）

- 实现 AgentApplicationRegistry
- 实现 SubAgentRunner（基础生命周期）
- 实现 MessageQueue
- 实现 AppWorkspace 和 SubAgentWorkspace
- 扩展 ToolExecutor 支持 SubAgent 路由

### Phase 2: 上下文与记忆

- 实现 AppContextCompiler
- 实现 AppMemoryStore
- 实现 CheckpointExchange
- 集成 MemoryGate 审核机制

### Phase 3: Coding App 第一版

- 实现具体 Coding 应用
- 文件编辑 + 终端执行 + 测试运行
- Dashboard 任务进度展示

### Phase 4: 社交子 Agent 剥离

- 将 social/group channel 迁移到独立 AgentApplication
- 主 Agent 不再处理社交场景
- 社交记忆独立管理

---

## 10. 相关文档索引

| 文档                                               | 内容                                       |
| -------------------------------------------------- | ------------------------------------------ |
| [00-overview.md](00-overview.md)                   | AIOS 架构总则（§3 Agent 分层模型）         |
| [01-principal-agent.md](01-principal-agent.md)     | PrincipalAgent 模型（§10 不包含 SubAgent） |
| [03-context-runtime.md](03-context-runtime.md)     | Context Runtime 模型                       |
| [06-tool-capability.md](06-tool-capability.md)     | Tool Capability 模型                       |
| [10-node-architecture.md](10-node-architecture.md) | 节点架构与能力提供者                       |
| [11-remediation-plan.md](11-remediation-plan.md)   | 第七阶段修复计划（已完成）                 |

---

## 附录 A: pet_state 槽位修复记录

**日期**：2026-08-08
**文件**：`packages/backend/src/services/mdp/prompts/slots/800_pet_state.md`
**问题**：当 `enableStateInjection=false`（social/group channel）时，所有状态变量为空，模板仍输出空壳 `<Current_Status>` XML
**修复**：用 `{% if current_time %}` 和 `{% if environment_info %}` 守卫两个 XML 块
**验证**：19 个 ContextCompiler 测试全部通过

---

## 附录 B: 上下文拼装链路分析（测试验证）

### 完整拼装流程（13 步）

`ContextCompiler.compile(threadId, agentId)` 的处理链路：

1. 获取 Thread + Channel 策略
2. 加载活跃消息（按 messageWindow 截断）
3. 提取最后一条 user 消息作为 RAG query
4. [可选] RAG 记忆检索 → `<memory_context>` XML
5. 能力门控解析 `capabilityGate.resolve(agentId, channel)`
6. [可选] 状态注入（current_time/mood/vibe 等）
7. 加载人格 `readFileSync(agent.promptPath)`
8. 渲染 system_core
9. 组装 vars + 渲染槽位（按 position 排序）
10. 过滤空内容
    11-12. 转换为 LLM Messages + 追加历史
11. 生成 manifest

### 槽位顺序（12 个）

| position | slotId         | 作用                             |
| -------- | -------------- | -------------------------------- |
| 100      | system_persona | system_core + persona_definition |
| 150      | cot_guidance   | 思维链引导                       |
| 200      | abilities      | 能力片段（vision/workspace 等）  |
| 250      | draft_flow     | 草稿心流（已禁用）               |
| 300      | tools          | 工具描述 + 技能菜单              |
| 400      | rules          | 硬规则/安全协议                  |
| 500      | knowledge      | 可用技能清单                     |
| 600      | channel_patch  | channel 特定人格补丁             |
| 700      | memory_context | RAG 检索记忆                     |
| 800      | pet_state      | 当前状态（时间/情绪/环境）       |
| 900      | user_persona   | 主人信息                         |
| 9100     | output_format  | 输出约束                         |
| 9500     | footer         | 尾部提醒                         |

### 测试覆盖

测试文件：`packages/backend/tests/unit/services/context/contextCompiler.test.ts`
19 个测试用例覆盖 9 个模拟情景，全部通过。

---

_本文档为设计草案，待后续讨论细化后更新。_
