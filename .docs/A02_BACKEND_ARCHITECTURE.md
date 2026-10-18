# 后端架构

> **适用范围**：`packages/backend/` 全部代码
> **技术栈**：Hono + Drizzle + better-sqlite3 + TriviumDB
> **最后更新**：2026-10-17

---

## 1. 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  Router 层 (routers/)                                    │
│  职责：接收请求 → Zod 校验 → 调用 Service → 包装响应      │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Service 层 (services/)                                  │
│  职责：业务逻辑编排 → 调用 Repository → 调用外部服务       │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Repository 层 (repositories/)                           │
│  职责：数据访问 (SQLite via Drizzle / TriviumDB)          │
└─────────────────────────────────────────────────────────┘
```

层间禁止事项见 `S05_CODE_STANDARDS.md` §2。

---

## 2. Router 层

```typescript
// routers/memory.router.ts
export function createMemoryRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/', async (c) => {
    const page = Number(c.req.query('page') ?? 1)
    const pageSize = Number(c.req.query('pageSize') ?? 20)
    const result = await ctx.memoryService.list({ page, pageSize })
    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  router.post('/', validate('json', createMemorySchema), async (c) => {
    const body = c.req.valid('json')
    const memory = await ctx.memoryService.create(body)
    return c.json({ code: 'CREATED', message: '记忆已创建', data: memory }, 201)
  })

  return router
}
```

---

## 3. Service 层

### 3.1 构造函数注入

```typescript
export class MemoryService {
  constructor(
    private memoryRepo: MemoryRepository,
    private vectorRepo: VectorRepository,
    private vectorWriteHelper: VectorWriteHelper,
  ) {}

  async create(data: CreateMemoryDto): Promise<MemoryDto> {
    const memory = await this.memoryRepo.create(data)
    await this.vectorWriteHelper.upsertWithFallback({
      memoryId: memory.id,
      content: data.content,
      agentId: data.agentId,
      metadata: { importance: data.importance },
    })
    return memory
  }
}
```

---

## 4. Repository 层

### 4.1 SQLite Repository (Drizzle)

```typescript
export class MemoryRepository {
  constructor(private db: DrizzleDb) {}

  async create(data: CreateMemoryDto) {
    const [memory] = await this.db
      .insert(memoryNodes)
      .values({ content: data.content, agentId: data.agentId })
      .returning()
    return memory
  }

  async findById(id: number) {
    return this.db.select().from(memoryNodes).where(eq(memoryNodes.id, id)).get()
  }
}
```

### 4.2 TriviumDB Repository

```typescript
export class VectorRepository {
  constructor(private store: TriviumStore) {}

  async upsert(id: number, vector: number[], payload: Record<string, unknown>) {
    await this.store.insertWithId(id, vector, payload)
  }

  async search(query: number[], topK: number, filter?: Record<string, unknown>) {
    return this.store.searchHybrid(query, topK, { payloadFilter: filter })
  }
}
```

引入 Repo 层的理由：双数据源隔离、可测试性（mock Repository 测 Service）、未来可扩展。

---

## 5. DI 容器

```typescript
// container.ts
export interface AppContext {
  db: DrizzleDb
  memoryRepo: MemoryRepository
  vectorRepo: VectorRepository
  // ...
  memoryService: MemoryService
  memorySearchService: MemorySearchService
  scorerService: ScorerService
  // ...
}

export function createAppContext(config: AppConfig): AppContext {
  const db = createDrizzleConnection(config.databasePath)
  const storeRegistry = new MemoryStoreRegistry(config.dataDir)
  const memoryRepo = new MemoryRepository(db)
  const vectorRepo = new VectorRepository(storeRegistry)
  // ... 按依赖顺序初始化
  return { db, memoryRepo, vectorRepo /* ... */ }
}
```

---

## 6. LLM Provider 模式

```typescript
export interface LlmProvider {
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatCompletion>
  chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatDelta>
  listModels(): Promise<string[]>
}

// 内置 Provider：
// - OpenAiProvider   (OpenAI 兼容，覆盖绝大多数厂商)
// - GeminiProvider   (Gemini REST API)
// - AnthropicProvider (Anthropic Messages API)

export class LlmService {
  private createProvider(config: ModelConfig): LlmProvider {
    switch (config.provider) {
      case 'gemini':
        return new GeminiProvider(config)
      case 'anthropic':
        return new AnthropicProvider(config)
      default:
        return new OpenAiProvider(config)
    }
  }
}
```

---

## 7. Gateway 层

模型请求的临时 HTTP、网络和超时故障使用统一、可取消的有限退避；ReAct 每轮最多重试 5 次，所有尝试共用请求总预算。鉴权、参数、额度耗尽、主动停止及明确不可重试故障不会自动重发。流式 EOF 缺少完成标记按中断处理；已收到部分响应时，受控 ReAct 冻结旧展示片段、丢弃未执行的工具草稿，再重新请求当前轮，前面完成的工具不重放。后台普通调用默认只在未交付部分输出时重试。

每次重试产生独立 `model_retry` 时间线块和 `model-retry` Surface 节点，固定在中断位置；记录原始原因、重试序号、上限与退避时长。回连、失败或取消只更新内部活动状态并停止动画，不替换原始文案或覆盖前次计数。时间线随消息 metadata 保存，实时展示、会话刷新和失败持久化共用同一投影。

每轮 ReAct 在文件版本投影和容量裁剪后，通过 `context_budget` 报告实际待发送消息与工具定义的输入估算；上游上报有效输入用量后替换本轮统计。聊天和陪伴入口将其写入当前 Surface 的状态节点，后续阶段切换保留该值。该统计表示当前模型请求的上下文占用，不累计多轮 API 消费，也不进入模型消息或重试时间线。

草稿 Token 预算预览以 `disableMemoryRetrieval` 关闭远程记忆检索，仅编译本地提示词、历史及工作上下文，不调用 Embedding 或 Reranker。返回 `memoryRetrievalDeferred` 标识估算不含待检索记忆；真正发送时仍按通道和 Thread 配置执行自动 RAG，ReAct 实时统计使用实际请求内容。

Embedding Provider 区分配置启用状态与服务健康状态：验证页、鉴权和无效向量响应冷却 5 分钟；网络和其他服务故障默认冷却 30 秒，429 默认 60 秒，有效 `Retry-After` 优先（限制在 1 秒至 30 分钟）。冷却期间明确抛出错误，不返回占位零向量，也不把服务标记为关闭。到期后的下一次调用只放行一个恢复探测；成功解除冷却，失败重新计时。主动取消不触发冷却，配置变更会取消旧请求并重建 Provider，迟到响应不能覆盖较新请求的健康状态。

OpenAI 兼容模型列表请求仅在 `/models` 返回 404/405 且不是验证页时探测兼容列表端点；403、鉴权、限流、网络故障及损坏响应直接报告错误，不返回成功空列表。真正的空列表保持空数组。Embedding、Reranker 和 OpenAI 兼容接口统一识别 `cf-mitigated: challenge` 与 HTML 验证页，错误提示服务商放行 API 或检查基址，日志不输出验证页原文。上游安全规则仍由服务商调整。

### 7.1 架构

- **端口**：与 HTTP 共用 `:9120`
- **协议**：WebSocket + 版本化 JSON Envelope；消息进入路由前必须通过 Shared Schema 校验与协议版本协商
- **鉴权**：Hello 消息携带 Token；远程 Node 使用 TLS/mTLS 与持久 Trust，未配置凭据时仅允许受限本机部署

### 7.2 文件组织

```
services/gateway/
├── gatewayHub.ts           # WS Hub，管理连接、心跳和版本协商
├── durableGatewayStream.ts # 可持久化的 Gateway 事件流
├── index.ts                # Gateway公开入口
├── types.ts                # GatewayEnvelope与连接事件
└── wsUpgrade.ts            # Hono WebSocket升级与JSON消息入口
```

### 7.3 Service 集成

后端 Service 通过 DI 注入受限 Event/Surface Port，不直接把 `GatewayHub` 传播给 Application、Router 或 Repository。Gateway 只负责连接与消息路由，不访问数据库。

```typescript
export class AgentService {
  constructor(private events: ConversationEventPort) {}

  async onLlmResponse(response: string) {
    await this.events.publish('conversation.response', { response })
  }
}
```

---

## 8. 错误处理

全局错误中间件：

```typescript
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ code: err.code, message: err.message, data: err.data }, err.httpStatus)
  }
  logger.error('未捕获异常', { error: err.message, stack: err.stack })
  return c.json({ code: 'INTERNAL_ERROR', message: '服务内部错误，请稍后再试' }, 500)
})
```

## 9. AIOS 领域架构约束

后端以 [A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md) 为资源边界基线。三层架构之上，所有领域模块必须遵守以下分工：

| 领域            | 后端权威对象                                 | 不承担的职责                     |
| --------------- | -------------------------------------------- | -------------------------------- |
| PrincipalAgent  | 身份、人格定义、长期资源关联                 | 不维护窗口级活跃 Agent           |
| Thread          | 对话边界、消息事实、channel 与 policy        | 不持有长期记忆或工具权限         |
| Context Runtime | 只读编译 LLM 输入与 Manifest                 | 不写消息、记忆、人格或文件       |
| Memory          | EventNote 事件记事、ConversationCoverage、Provenance | 不将原始 Thread 当作长期记忆     |
| Workspace       | Agent 私有文件根与 containment               | 不写安装/Workshop 只读资产       |
| Tool Capability | `(agentId, channel)` 权限与资源范围          | 不允许默认 Agent 或 channel 回退 |
| Application Integration | Application协议、Adapter、Endpoint与Capability Port | 不注入AppContext、Repository或目标应用内部实例 |

### 9.1 请求上下文

进入 Service/Tool 执行链的运行时上下文必须明确包含 `agentId`、`threadId` 和 `channel`。后端不允许根据“当前活跃角色”推断这些值；外部入站消息由 `InboundRoute` 决定归属，后台任务由任务本身的 `agentId` 决定。

### 9.2 Context Compiler

聊天入口只接收当前输入与 `threadId`。后端从 Thread 读取 active 消息、策略与 Agent，并由 Compiler 只读组装原生 `user/assistant` 消息；禁止客户端上传完整历史，禁止 XML 形式的历史重复注入。

### 9.3 Daemon 与能力提供者

`packages/backend` 保持纯 Node 运行时，不 import Electron。平台能力通过 Capability Provider 委托给 Electron、移动端等节点；无 Provider 时返回可解释的不可用结果。Provider 调用也必须先经过 CapabilityGate。

### 9.4 第三方 Application

第三方 Application 不以内置 `AgentAppRuntime` 方式加载到 Backend。Backend 只承载通用 Application Integration Foundation 和贡献者的隔离 Backend Adapter；目标应用通过独立进程、Node Host、远程 Node 或应用内部 Plugin 连接。Adapter 使用公开 Port 和 Kernel Envelope，不得接触主数据库、Repository、DI Container、主 Agent Thread 或 Credential 明文。协议与 Arca 参考实现见 [A10_APPLICATION_INTEGRATION](./A10_APPLICATION_INTEGRATION.md)。

---

_本文档由 Carola 整理，适用于 infOS-TS 后端架构规范。_
