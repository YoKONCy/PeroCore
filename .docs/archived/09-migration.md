# 迁移策略

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 分阶段迁移，每阶段可独立验证，不需要一次性重写全部代码。

---

## 1. 迁移原则

- 每阶段只解决一个核心问题
- 旧数据可迁移，不丢失
- 旧接口可保留兼容期，但新接口优先
- 每阶段完成后可独立运行和验证

---

## 2. 阶段详解

### 第一阶段：后端权威状态 + Thread 模型

**目标**：解决多份状态源和历史重复注入。

**动作**：

```text
1. 新增数据表
   ├─ threads
   └─ thread_messages（含 status, pairId, revision）

   注：thread_summaries 表已废弃（见 03-context-runtime.md 第 0 节决策），
   超出窗口的早期消息由长记忆系统兜底。

2. 新增 ThreadService
   ├─ 创建/查询/列表 Thread
   ├─ 追加消息
   ├─ 软删除消息
   └─ 查询 active 消息

3. 新增 RuntimeStateService
   ├─ 维护正在进行的 LLM 调用（按 threadId 索引）
   ├─ 维护 Thread 持久状态
   └─ 不维护全局活跃 Agent（前端窗口级状态）

4. 数据迁移
   ├─ 从 conversation_logs 的唯一 sessionId 创建 Thread
   ├─ source 映射为 channel
   ├─ 为消息生成 pairId
   └─ 默认 status='active'

5. 改造聊天接口
   ├─ POST /api/chat 接受 { threadId, content }
   ├─ 后端从 Thread 加载历史
   └─ 不再接受前端 messages 数组

6. 前端改造
   ├─ useSessionStore → useThreadStore
   ├─ 发送时只提交当前消息
   └─ 历史通过 API 加载
```

**验证**：发送消息后，后端只收到 `{ threadId, content }`，不再收到 messages 数组。历史只从后端加载一次。

**复用现有**：SQLite、Hono Router、Drizzle、ConversationLog 数据。

---

### 第二阶段：Context Compiler 初版

**目标**：后端统一编译 LLM 输入，移除双重历史注入。

**动作**：

```text
1. 新增 ContextCompiler
   ├─ 从 Thread 加载 active 消息
   ├─ 从 Identity 读取人格
   ├─ 按 channel 读取人格补丁
   ├─ （可选）检索记忆
   └─ 编译为 LLM Messages

2. 移除 HistoryEnricher 的 XML 注入
   └─ 消息保留原生 user/assistant 角色

3. 移除前端全量历史提交
   └─ 已在第一阶段完成

4. 保留 MDP 作为渲染后端
   └─ Compiler 调用 MDP 渲染模板
   └─ MDP 不再承担上下文组织

5. 移除 PresetLoader
   └─ Channel 补丁直接由 Compiler 读取

6. 移除 extraVars 对核心变量的覆盖
   └─ 核心变量不可被客户端覆盖
```

**验证**：LLM 收到的消息中，历史只出现一次，且为原生 user/assistant 角色，不再有 XML 历史重复。

**复用现有**：MdpEngine 渲染能力、MemoryEnricher 检索逻辑、LLM Provider。

---

### 第三阶段：前端适配

**目标**：前端变为 Thread 视图订阅者。

**动作**：

```text
1. Transport 改造
   ├─ 连接 NodeEndpoint
   └─ 不再硬编码 localhost

2. useThreadStore
   ├─ 订阅 Thread 消息
   ├─ 不在本地维护权威状态
   └─ 只缓存显示数据

3. SSE 修复
   ├─ 统一事件类型（shared discriminated union）
   ├─ 工具调用按 callId 关联
   ├─ 流结束必须收到 done 事件
   └─ 未收到 done 时触发 STREAM_TRUNCATED

4. 删除/编辑
   ├─ 通过 API 操作
   ├─ 后端发布事件
   └─ 前端收到事件后更新显示

5. NEW CHAT 按钮
   ├─ 调用 POST /api/threads/new
   └─ 创建新 Thread，不清除记忆
```

**验证**：关闭前端窗口再打开，Thread 状态不丢失。删除消息后刷新，消息不再出现。

**复用现有**：Vue 组件、Pinia、Vue Router、SSE 基础设施。

---

### 第四阶段：Workspace 做实

**目标**：主 Agent 拥有真实的个人文件空间。

**动作**：

```text
1. 创建 Agent 时自动创建 workspace 目录
2. PathResolver 增加 @principal 前缀
3. 实现真实的 workspace 文件工具
4. 文件工具加 containment 检查
5. 通用 read_file/write_file 默认限制在 workspace
6. terminal_execute 默认 cwd 为 workspace
```

**验证**：Agent 无法读写 workspace 以外的路径（除非用户显式授权）。

---

### 第五阶段：Memory 整理

**目标**：记忆加 Provenance，修复 Scorer 分批和社交记忆注入。

**动作**：

```text
1. 新增 memory_candidates 表
2. 新增 CanonicalMemory provenance 字段
3. Scorer 写入候选而非直接写入正式记忆
4. 简单 Gate：去重 + 新增
5. Scorer 按 agentId + threadId + channel 分批
6. 修复 Social Memory 注入
7. Diary Store 改为按 Agent 隔离
8. 语义检索按 agentId 过滤
```

**验证**：不同 Thread 的记忆不会混批提炼。社交记忆可按策略检索。

---

### 第六阶段：Identity 和 Tool 清理

**目标**：人格补丁改为 channel 属性，工具权限加 Resource Scope。

**动作**：

```text
1. 人格补丁从 preset 改为 channel 属性
2. work 模式移除
3. lightweight 变为 Context Policy 配置
4. 工具执行器接收 agentId + threadId + channel
5. 工具定义按 channel 过滤
6. 文件工具加 Resource Scope
7. run_script 统一经过执行器
8. 本机 API 加鉴权
```

**验证**：社交 Thread 不暴露文件工具。`run_script` 不能绕过权限。

---

## 3. 数据迁移

### 3.1 conversation_logs → thread_messages

```text
1. 创建 threads 表
2. 从 conversation_logs 的唯一 (sessionId, agentId, source) 创建 Thread
   ├─ threadId = 新生成 UUID
   ├─ channel = source 映射
   │   desktop/mobile/scheduler → desktop
   │   social → social
   │   group_chat/group → group
   └─ title = 首条消息截断
3. 将 conversation_logs 消息迁移到 thread_messages
   ├─ 保留原 id
   ├─ thread_id = 映射后的 threadId
   ├─ pairId = 为每对 user+assistant 生成
   ├─ status = 'active'
   └─ revision = 1
4. 旧 conversation_logs 表保留作为备份
```

### 3.2 session 配置迁移

```text
现有：configRepo 的 session.{agentId}.current
迁移：不再需要，Thread 列表查询替代
```

### 3.3 记忆数据迁移

```text
现有 memory_nodes 表新增字段：
  origin_thread_id TEXT
  origin_channel TEXT
  origin_platform TEXT

现有数据默认值：
  origin_thread_id = null
  origin_channel = 'desktop'
```

---

## 4. 旧接口兼容

| 旧接口                                 | 兼容期   | 替代接口                                  |
| -------------------------------------- | -------- | ----------------------------------------- |
| `POST /api/chat/session/new`           | 2 个版本 | `POST /api/threads/new`                   |
| `POST /api/chat/session/clear`         | 2 个版本 | `POST /api/threads/new`                   |
| `GET /api/chat/sessions`               | 2 个版本 | `GET /api/threads`                        |
| `GET /api/chat/sessions/:id`           | 2 个版本 | `GET /api/threads/:id`                    |
| `POST /api/chat`（含 messages）        | 1 个版本 | `POST /api/chat`（仅 threadId + content） |
| `POST /api/chat/stream`（含 messages） | 1 个版本 | `POST /api/chat`（SSE）                   |

兼容期内旧接口内部转换为新接口调用，返回新格式数据。

---

## 5. 现有代码保留/重构/移除

### 保留（直接复用或微调）

- SQLite + Drizzle
- TriviumDB
- Hono + @hono/node-server
- LLM Provider（OpenAI/Anthropic/Gemini）
- ReAct Loop
- MdpEngine 渲染能力
- Tool Registry 基础架构
- Extension/MCP 框架
- Electron 窗口管理
- Vue 前端组件库
- NapCat 适配器
- Scheduler 基础架构

### 重构（保留核心，调整结构）

- `AgentManager` → `PrincipalAgentService`
- `SessionService` → `ThreadService`
- `ConversationLogService` → `ThreadMessageService`
- `PromptService` → `ContextCompiler` 的一部分
- `MemoryService` → 加 Provenance + Candidate
- `MemoryScorer` → `MemoryGate` 的一部分
- `CapabilityGate` → 加 Resource Scope
- `ToolExecutor` → 接收 Thread 上下文
- `EnrichmentRunner` → 简化为 Compiler 流程
- `useSessionStore` → `useThreadStore`
- `useChat` → 只提交当前消息
- `transport.ts` → 连接 NodeEndpoint
- `Electron Main` → 不再 spawn 后端，改为连接 Daemon + 注册能力

### 移除

- `SessionService.activeSessions`（内存指针）
- `configRepo session.{agentId}.current`
- `HistoryEnricher`（XML 注入）
- `PresetLoader`（ID 不匹配且 position 错误）
- `extraVars` 对核心变量的覆盖
- `work` 模式
- `lightweight` 作为模式
- 前端全量 messages 提交
- 三套手写 SSE 类型
- Electron spawn 后端进程的依赖关系
- `PUT /api/agents/active`（后端不再维护全局活跃 Agent）

---

## 6. 风险与对策

| 风险                      | 对策                                   |
| ------------------------- | -------------------------------------- |
| 数据迁移丢失              | 旧表保留备份，迁移脚本可回滚           |
| 前端改动范围大            | 第三阶段集中改前端，前后端可并行开发   |
| SSE 契约变更              | shared 类型一次性统一，加契约测试      |
| 现有用户配置不兼容        | Agent 配置格式保持不变，只改运行时行为 |
| Scorer 停机期间记忆不提炼 | 安排在低峰期执行第五阶段               |

---

## 7. 优先级判断

第一阶段和第二阶段是**最高优先级**，因为它们直接解决当前最严重的两个问题：

1. 历史重复注入
2. 前后端多份状态源

这两个阶段完成后，系统已经可以正常运行，且上下文不再混乱。后续阶段可以逐步迭代，不影响核心功能。

---

## 8. 第七阶段：Daemon 独立 + 前后端解耦

**目标**：后端 Daemon 可独立运行，Electron 壳变为能力提供者。

**动作**：

```text
1. Daemon 独立启动
   ├─ 不依赖 Electron spawn
   ├─ 可作为系统服务或 pm2 进程运行
   └─ Electron 关闭后继续运行

2. Electron 壳改造
   ├─ 不再 spawn 后端
   ├─ 启动时连接 Daemon
   ├─ 向 Daemon 注册平台能力（screen_capture、desktop_notify 等）
   └─ 通过 IPC Tool Channel 接收能力调用请求

3. 能力注册表
   ├─ Daemon 维护 NodeCapabilityRegistration
   ├─ Electron 启动时注册，关闭时注销
   ├─ 工具调用时查注册表，委托给提供者
   └─ 能力不可用时降级处理

4. 入站路由表
   ├─ 新增 InboundRoute 表
   ├─ 外部消息（QQ/Discord/Webhook）查路由表找 Agent
   └─ 替代"全局活跃 Agent"对外部消息的决定作用

5. 移除后端全局活跃 Agent
   ├─ 删除 AgentManager.activeAgentId
   ├─ 删除 PUT /api/agents/active
   └─ 前端自行持久化 UIConfig.defaultAgentId
```

**验证**：关掉 Electron 窗口后，QQ 消息和后台任务不受影响。截图等能力在 Electron 打开时可用，关闭时降级。

**复用现有**：Hono、SQLite、NapCat 适配器、Scheduler、Tool Registry。
