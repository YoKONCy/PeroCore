# Tool Capability 模型

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 工具权限从"工具名白名单"升级为"工具名 + Resource Scope + Approval"的多层模型。

---

## 1. 定义

Tool Capability 是 PrincipalAgent 的一个一等资源，负责：

- 工具注册与描述
- 资源级权限边界
- 审批层
- 执行与审计

---

## 2. 权限模型

```text
当前：
  (agentId, mode) → 允许的工具名列表

新架构：
  (agentId, channel) → 工具名 + Resource Scope + 参数策略 + 审批要求
```

### 2.1 Resource Scope

```text
ToolCapability
├─ agentId: string
├─ channel: ThreadChannel
├─ allowedTools: ToolPermission[]
│  └─ ToolPermission
│     ├─ toolName: string
│     ├─ resourceScope: ResourceScope
│     │  ├─ allowedRoots: string[]     ← 允许操作的根目录
│     │  ├─ deniedPaths: string[]      ← 禁止的路径
│     │  └─ scope: 'principal_workspace' | 'user_authorized' | 'system'
│     ├─ paramPolicy?: ParamPolicy     ← 参数级策略
│     │  ├─ maxContentLength?: number
│     │  ├─ allowedCommands?: string[] ← terminal 命令白名单
│     │  └─ deniedPatterns?: string[]
│     └─ requiresApproval: boolean     ← 是否需要用户审批
```

### 2.2 按 Channel 限制

| Channel   | 文件工具        | 终端          | 搜索 | 记忆 | 网络 |
| --------- | --------------- | ------------- | ---- | ---- | ---- |
| desktop   | workspace scope | workspace cwd | 允许 | 允许 | 允许 |
| social    | 禁止            | 禁止          | 禁止 | 禁止 | 禁止 |
| group     | 禁止            | 禁止          | 禁止 | 禁止 | 禁止 |
| companion | workspace scope | 禁止          | 允许 | 允许 | 允许 |

---

## 3. 现有问题修复

现有执行链存在三个 P0 级问题：

### 3.1 请求上下文丢失

共享 `ToolExecutor` 没有拿到当前请求的真实 `agentId/sessionId`，回退为 `pero/default`。

**修复**：执行器接收当前 Thread 的 `agentId + threadId + channel`。

### 3.2 工具定义未过滤

模型收到的工具定义没有经过 CapabilityGate 过滤。

**修复**：`getToolDefinitions()` 接入 channel 过滤。

### 3.3 run_script 绕过

`run_script` 直接调用 Tool Registry handler，绕过 CapabilityGate。

**修复**：所有工具调用统一经过执行器权限检查。

---

## 4. 审批层

```text
ApprovalRequest
├─ id: string
├─ toolName: string
├─ threadId: string
├─ agentId: string
├─ params: Record<string, unknown>
├─ risk: 'low' | 'medium' | 'high'
├─ status: 'pending' | 'approved' | 'denied'
├─ createdAt: string
└─ decidedAt?: string
```

高风险操作（删除文件、执行命令、网络请求）需要用户显式批准。

---

## 5. 第一版简化

```text
1. 工具执行器接收 agentId + threadId + channel
2. 工具定义按 channel 过滤
3. 文件工具加 workspace containment 检查
4. run_script 统一经过执行器
5. 暂不实现审批层和参数级策略
```
