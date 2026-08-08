# PrincipalAgent 模型

> 主 Agent 是拥有完整人格、长期记忆和个人工作区的数字生命主体。

---

## 1. 定义

PrincipalAgent 是 PeroCore AIOS 的顶层身份实体。每个 PrincipalAgent（如 Pero、Nana）是一个独立的、长期存在的角色，拥有自己的人格、记忆和工作区。

PrincipalAgent **不是**：
- 不是一次会话（那是 Thread）
- 不是一次上下文编译（那是 Context Runtime 的产物）
- 不是一组工具权限（那是 Tool Capability）
- 不是次 Agent（次 Agent 是未来的插件扩展）

---

## 2. 领域模型

```text
PrincipalAgent
├─ id: string                    ← 唯一标识，如 "pero"、"nana"
├─ name: string                  ← 显示名称
├─ description: string           ← 简短描述
├─ avatarPath: string            ← 头像路径
├─ status: 'active' | 'inactive' ← 是否启用
├─ createdAt: string             ← 创建时间
├─ updatedAt: string             ← 更新时间
│
├─ Identity                      ← 人格（一等资源，详见 Identity 章节）
│  ├─ basePersona                ← 核心人格（常驻不变）
│  ├─ channelPatches             ← 按 channel 叠加的人格补丁
│  └─ behaviorBoundary           ← 行为边界与价值观
│
├─ Memory                        ← 长期记忆（一等资源，详见 Memory 文档）
│  ├─ CanonicalMemory            ← 已确认记忆
│  ├─ MemoryCandidate            ← 待确认候选
│  └─ MemoryGate                 ← 提炼与合并
│
├─ Workspace                     ← 个人工作区（一等资源，详见 Workspace 文档）
│  ├─ rootPath                   ← 工作区根目录
│  ├─ quota                      ← 配额
│  └─ policies                   ← 文件策略
│
├─ ContextRuntime                ← 上下文运行时（一等资源，详见 Context 文档）
│  ├─ Compiler                   ← 编译器
│  ├─ Bundle                     ← 当前上下文包
│  └─ Manifest                   ← 编译清单
│
├─ Threads                       ← 交互线程集合（一等资源，详见 Thread 文档）
│  ├─ Thread[]                   ← 可同时有多个活跃线程
│  └─ activeThreadId             ← 当前活跃线程（仅用于 UI 路由）
│
└─ ToolCapability                ← 工具权限（一等资源，详见 Tool 文档）
   ├─ toolRegistry               ← 工具注册
   ├─ resourceScope              ← 资源范围
   └─ approvalLayer              ← 审批层
```

---

## 3. 活跃 Agent

"活跃 Agent"是一个 **前端窗口级 UI 路由概念**，不是后端全局状态，也不是上下文概念。

```text
activeAgentId = 当前窗口默认由谁响应用户
```

它只回答："用户没有明确指定时，由哪个 Agent 响应？"

它**不**回答：
- 当前上下文属于谁（那是 Thread 的事）
- 当前窗口显示什么会话（那是前端的事）
- 哪个 Agent 在执行后台任务（那是 Scheduler 的事）
- 哪些记忆可以访问（那是 Memory Policy 的事）

### 3.1 关键规则

- **后端不维护"全局活跃 Agent"**——这不是后端状态。
- 后端可同时处理多个 Agent 的请求，互不干扰。
- 两个前端窗口可以分别和不同 Agent 交互。
- 切换 Agent 必须原子切换 Thread——不能出现 Nana 的 agentId 配 Pero 的 threadId。
- 后台任务（Scheduler）直接指定 agentId 操作，不需要"活跃 Agent"。

### 3.2 与现有实现的区别

| 现有 | 新架构 |
|---|---|
| `AgentManager.activeAgentId` 后端全局唯一 | 前端窗口级状态 |
| active Agent 影响整个后端状态 | 后端无此全局状态 |
| 切换 Agent 不保证原子切换 Thread | 切换 Agent 必须原子切换或创建 Thread |
| 后端只有一个活跃 Agent | 后端可同时处理多 Agent 请求 |

---

## 4. Identity（人格）

### 4.1 结构

```text
Identity
├─ basePersona
│  ├─ systemPrompt              ← 核心人格提示词
│  ├─ expressionStyle           ← 表达风格
│  ├─ values                    ← 价值观
│  └─ relationshipToOwner       ← 与主人的关系设定
│
├─ channelPatches
│  ├─ desktop: null             ← 桌面用完整人格
│  ├─ social: SocialPatch       ← 社交补丁（语气、表情）
│  ├─ group: GroupPatch         ← 群聊补丁（简洁、表情包）
│  └─ companion: CompanionPatch ← 陪伴补丁
│
└─ behaviorBoundary
   ├─ safetyRules               ← 安全规则
   ├─ privacyRules              ← 隐私规则
   └─ contentRules              ← 内容规则
```

### 4.2 人格补丁规则

- 核心人格（basePersona）始终存在，不因 channel 变化。
- 补丁只叠加差异部分，不替换整个人格。
- 补丁由 Context Compiler 在编译时读取，不是 Identity 自己切换。
- 补丁不修改人格定义，只影响编译输出。

### 4.3 与现有实现的区别

| 现有 | 新架构 |
|---|---|
| `agent.json` + `personas/*.md` | 结构化为 Identity 领域对象 |
| `source` 触发 preset 切换 | `channel` 属性触发补丁读取 |
| preset 实际未生效（ID 不匹配） | 补丁直接由 Compiler 读取 |
| `extraVars` 可覆盖人格变量 | 人格变量不可被客户端覆盖 |

---

## 5. 一等资源关系

六个一等资源之间是**平级**关系，不存在包含。它们通过 PrincipalAgent 的 `id` 关联：

```text
PrincipalAgent (id="pero")
    │
    ├── Identity (agentId="pero")
    ├── Memory (agentId="pero")
    ├── Workspace (agentId="pero")
    ├── ContextRuntime (agentId="pero")
    ├── Threads (agentId="pero")
    └── ToolCapability (agentId="pero")
```

每个资源独立管理自己的：
- 存储
- 生命周期
- 配置
- 事件

---

## 6. Agent 实例 vs Agent 身份

未来分布式场景下需要区分：

```text
PrincipalAgent（逻辑身份）
  Pero 这个角色
  ├─ AgentInstance: pero@pc
  ├─ AgentInstance: pero@mobile
  └─ AgentInstance: pero@cloud
```

当前单机阶段不实现 AgentInstance，但模型预留这个概念。长期记忆归属于 PrincipalAgent（逻辑身份），不属于某个 AgentInstance。

---

## 7. 数据存储

### 7.1 SQLite

```sql
-- agents 表（复用现有，结构调整）
agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  avatar_path TEXT,
  status      TEXT DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
)
```

### 7.2 文件系统

```text
@data/agents/{agentId}/
├─ agent.json           ← Agent 配置
├─ system_prompt.md     ← 核心人格
├─ personas/
│  ├─ social.md         ← 社交人格补丁
│  ├─ group.md          ← 群聊人格补丁
│  └─ companion.md      ← 陪伴人格补丁
└─ workspace/           ← Principal Workspace（详见 Workspace 文档）
```

### 7.3 TriviumDB

```text
agent_{agentId}/main.tdb    ← 主记忆向量库（复用现有）
social.tdb                   ← 社交记忆向量库（复用现有）
shared/diary.tdb             ← 日记向量库（需改为按 agent 隔离）
```

---

## 8. 生命周期

```text
创建 Agent
  ├─ 写入 agents 表
  ├─ 创建文件目录
  ├─ 创建 workspace 目录
  ├─ 初始化 TriviumDB Store
  └─ 发布 AgentCreated 事件

删除 Agent
  ├─ 标记 status=inactive
  ├─ 归档 workspace
  ├─ 保留记忆数据（可恢复）
  └─ 发布 AgentDeleted 事件

导出 Agent
  ├─ 导出人格配置
  ├─ 导出记忆（可选）
  └─ 导出 workspace（可选）
```

---

## 9. 与现有代码的对应

| 现有模块 | 新架构角色 | 处理方式 |
|---|---|---|
| `AgentManager` | PrincipalAgent 管理 | 重构为 `PrincipalAgentService` |
| `AgentManager.activeAgentId` | 活跃 Agent 路由 | 移入 `RuntimeStateService` |
| `agent.json` + `system_prompt.md` | Identity | 结构化读取，不再散落 |
| `personas/*.md` | Identity.channelPatches | 由 Compiler 按 channel 读取 |
| `capabilities.yaml` | ToolCapability | 重构为 Resource Scope 模型 |
| `SessionService` | Thread | 整体替换 |
| `ConversationLogService` | Thread 消息存储 | 迁移为 Thread Message |

---

## 10. 不包含

PrincipalAgent 内核**不包含**以下内容，它们属于未来的插件层：

- SubAgent Instance
- Agent Application（Coding/Research/Office）
- 应用工作区
- 上下文委派
- 人格投影
- 任务检查点
- 跨 Agent 上下文传递

这些通过预留的插件扩展点在未来加入，内核不需要为此改动。
