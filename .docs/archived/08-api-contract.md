# API 契约草案

> 后端成为 LLM 输入的唯一组装者，前端只提交当前输入。

---

## 1. 设计原则

- 前端只提交当前用户输入，不组装上下文
- 后端从 Thread 加载历史、编译上下文、调用 LLM
- 所有 DTO 放入 `@perocore/shared`，前后端共享同一份类型
- SSE 事件类型统一为 discriminated union

---

## 2. Thread API

### 2.1 创建 Thread

```text
POST /api/threads
Body: {
  agentId: string
  channel: 'desktop' | 'social' | 'group' | 'companion'
  platform?: string
  title?: string
}
Response: { threadId: string }
```

### 2.2 查询 Thread 列表

```text
GET /api/threads?agentId=pero&channel=desktop&page=1&pageSize=20
Response: {
  items: ThreadSummary[]
  total: number
  page: number
  pageSize: number
}

ThreadSummary {
  threadId: string
  agentId: string
  channel: string
  platform?: string
  title: string
  pairCount: number
  lastMessageAt: string
  preview: string
}
```

### 2.3 查询 Thread 详情

```text
GET /api/threads/{threadId}?limit=50
Response: {
  threadId: string
  agentId: string
  channel: string
  title: string
  messages: ThreadMessageDto[]
}

ThreadMessageDto {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  pairId: string
  status: 'active' | 'deleted'
  metadata: MessageMetadata
  createdAt: string
}
```

### 2.4 删除消息（软删除）

```text
DELETE /api/threads/{threadId}/messages/{pairId}
Response: { success: boolean }
```

### 2.5 编辑消息

```text
PUT /api/threads/{threadId}/messages/{messageId}
Body: { content: string }
Response: { revision: number }
```

---

## 3. Chat API

### 3.1 发送消息

```text
POST /api/chat
Body: {
  threadId: string
  content: string
  agentId?: string                   ← 可选，覆盖 Thread 默认 Agent（如群聊指定回复者）
  extraVars?: Record<string, string>  ← 仅允许非核心变量
}
Response: SSE 流
```

**关键变化**：
- 不再接受 `messages` 数组，不再接受 `sessionId`。
- 后端从 `threadId` 解析 channel、policies 和历史。
- `agentId` 可选：未传时用 Thread 的默认 Agent；传了则覆盖（如群聊中指定 Nana 回复）。
- channel 始终从 Thread 读取，不受 agentId 影响。

### 3.2 流式回复

统一 SSE 事件类型（discriminated union）：

```text
event: delta
data: { content: string }

event: tool_call
data: { callId: string, toolName: string, args: unknown }

event: tool_result
data: { callId: string, result: unknown, success: boolean }

event: thinking
data: { content: string }

event: status
data: { status: 'compiling' | 'calling' | 'tool_executing' | 'done' | 'error' }

event: error
data: { message: string, code?: string }

event: done
data: { messageId: string, pairId: string, tokenUsage: TokenUsage }
```

**关键修复**：
- 统一使用 `callId` 关联工具调用与结果
- 工具参数字段统一为 `args`
- 工具结果字段统一为 `result`
- 状态统一为 `compiling/calling/tool_executing/done/error`
- 流正常结束必须发 `done`，前端不再靠 EOF 判断

### 3.3 中断生成

```text
POST /api/chat/abort
Body: { threadId: string }
Response: { success: boolean }
```

---

## 4. Agent API

### 4.1 查询 Agent 列表

```text
GET /api/agents
Response: { items: AgentSummary[] }

AgentSummary {
  id: string
  name: string
  description: string
  avatarPath: string
  status: 'active' | 'inactive'
}
```

### 4.2 活跃 Agent（前端 UI 配置）

**关键变化**：后端不再维护"全局活跃 Agent"。活跃 Agent 是前端窗口级状态。

```text
GET /api/agents
Response: { items: AgentSummary[] }

前端自行持久化：
  UIConfig.defaultAgentId   ← 默认显示谁
  UIConfig.lastActiveThreadId ← 上次打开的 Thread
```

后端无 `PUT /api/agents/active` 接口。前端切换 Agent 时直接加载该 Agent 的 Thread 列表。

### 4.3 创建新会话（快捷接口）

```text
POST /api/threads/new
Body: { agentId: string, channel?: string }
Response: { threadId: string }
```

---

## 5. Memory API（后续阶段）

```text
GET  /api/agents/{agentId}/memories?limit=20
GET  /api/agents/{agentId}/memories/{memoryId}
DELETE /api/agents/{agentId}/memories/{memoryId}
```

---

## 6. Workspace API（后续阶段）

```text
GET  /api/agents/{agentId}/workspace/files?path=
POST /api/agents/{agentId}/workspace/files
GET  /api/agents/{agentId}/workspace/files/{path}
PUT  /api/agents/{agentId}/workspace/files/{path}
DELETE /api/agents/{agentId}/workspace/files/{path}
```

---

## 7. SSE 契约修复要点

现有三套不兼容的 SSE 类型必须统一：

| 问题 | 现有 | 统一为 |
|---|---|---|
| 工具参数 | 后端 `args` / 前端 `arguments` | `args` |
| 工具结果 | 后端 `result` / 前端 `output` | `result` |
| 调用关联 | 按工具名 | 按 `callId` |
| 工具状态 | 后端 `calling` / shared `tool_executing` | `tool_executing` |
| 错误标记 | 后端 `isError` / shared `success` | `success: boolean` |
| 流结束 | 前端靠 EOF | 必须发 `done` 事件 |

所有 SSE 事件类型放入 `@perocore/shared`，前后端导入同一份类型定义。

---

## 8. Transport 改造

### 8.1 现有问题

前端硬编码 `http://localhost:9120`。

### 8.2 新设计

```text
NodeEndpoint {
  nodeId: string
  url: string
  authToken?: string
  capabilities: string[]
}
```

前端连接一个 NodeEndpoint，而不是判断"是否 Electron"后固定 localhost。

Electron 启动时生成随机 bearer token 并注入前端；后端校验 token 和 Origin。

---

## 9. 安全边界

### 9.1 本机 API 鉴权

```text
当前：无鉴权，开放 CORS
新增：
  ├─ Electron 启动时生成随机 bearer token
  ├─ 通过受控 preload 注入前端
  ├─ 后端校验 token 和 Origin
  ├─ 禁止通配 CORS
  └─ 敏感系统接口增加 CSRF 校验
```

### 9.2 extraVars 限制

```text
当前：extraVars 可覆盖 agent_name、owner_name、memory_context 等核心变量
新增：extraVars 只允许非核心变量，核心变量不可被客户端覆盖
```

---

## 10. 入站路由 API

入站路由表替代"全局活跃 Agent"，外部消息进来时查路由表找到归属 Agent。

### 10.1 查询路由列表

```text
GET /api/routes?source=qq_private
Response: {
  items: InboundRoute[]
  total: number
}

InboundRoute {
  id: string
  source: 'qq_private' | 'qq_group' | 'discord' | 'webhook' | 'monitor'
  identifier: string
  agentId: string
  channel: ThreadChannel
  threadId?: string
  config?: Record<string, unknown>
}
```

### 10.2 创建/更新路由

```text
POST /api/routes
Body: {
  source: string
  identifier: string
  agentId: string
  channel: ThreadChannel
  threadId?: string
  config?: Record<string, unknown>
}
Response: { routeId: string }
```

### 10.3 删除路由

```text
DELETE /api/routes/{routeId}
Response: { success: boolean }
```

---

## 11. 能力调用 API

Daemon 通过此机制向有能力的节点转发平台工具调用。

### 11.1 节点注册能力

```text
POST /api/capabilities/register
Body: {
  nodeId: string
  nodeType: 'electron' | 'mobile' | 'cli' | 'remote-daemon'
  capabilities: string[]
}
Response: { registered: boolean }
```

### 11.2 查询可用能力

```text
GET /api/capabilities
Response: {
  items: CapabilityInfo[]
}

CapabilityInfo {
  name: string
  providerNodeId: string
  status: 'available' | 'unavailable'
}
```

### 11.3 能力调用（内部接口）

Daemon 内部调用，不暴露为 HTTP API。通过 IPC/WS 通道转发给提供者节点：

```text
IPC Tool Channel:
  Daemon → Provider Node
  { toolName: string, params: unknown, callId: string }

  Provider Node → Daemon
  { callId: string, result: unknown, success: boolean }
```

### 11.4 能力心跳

```text
POST /api/capabilities/heartbeat
Body: { nodeId: string }
Response: { success: boolean }
```

节点定期心跳，超时标记为 offline，能力变为 unavailable。
