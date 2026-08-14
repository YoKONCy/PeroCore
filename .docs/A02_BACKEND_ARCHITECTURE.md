# 后端架构

> **适用范围**：`packages/backend/` 全部代码
> **技术栈**：Hono + Drizzle + better-sqlite3 + TriviumDB
> **最后更新**：2026-06-11

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

  router.post('/', zValidator('json', createMemorySchema), async (c) => {
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
  return { db, memoryRepo, vectorRepo, /* ... */ }
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
      case 'gemini':    return new GeminiProvider(config)
      case 'anthropic': return new AnthropicProvider(config)
      default:          return new OpenAiProvider(config)
    }
  }
}
```

---

## 7. Gateway 层

### 7.1 架构

- **端口**：与 HTTP 共用 `:9120`
- **协议**：WebSocket + Protobuf Envelope
- **鉴权**：Hello 消息携带 JWT（Docker 模式验证，Electron 模式跳过）

### 7.2 文件组织

```
gateway/
├── gatewayHub.ts           # WS Hub，管理连接和消息路由
├── gatewayClient.ts        # 后端 Service 调用的薄代理
├── gatewayRouter.ts        # Hono WS 升级路由 (/ws/gateway)
├── envelopeHandler.ts      # Protobuf Envelope 解码/分发
└── types.ts                # GatewayNode, GatewayEvent
```

### 7.3 Service 集成

后端 Service 通过 DI 注入 `GatewayHub`，直接调用广播方法（零 WS 开销）：

```typescript
export class AgentService {
  constructor(private gatewayHub: GatewayHub) {}

  async onLlmResponse(response: string) {
    await this.gatewayHub.broadcastTextResponse(response)
  }
}
```

---

## 8. 错误处理

全局错误中间件：

```typescript
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { code: err.code, message: err.message, data: err.data },
      err.httpStatus,
    )
  }
  logger.error('未捕获异常', { error: err.message, stack: err.stack })
  return c.json(
    { code: 'INTERNAL_ERROR', message: '服务内部错误，请稍后再试' },
    500,
  )
})
```

## 9. AIOS 领域架构约束

后端以 [A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md) 为资源边界基线。三层架构之上，所有领域模块必须遵守以下分工：

| 领域 | 后端权威对象 | 不承担的职责 |
|---|---|---|
| PrincipalAgent | 身份、人格定义、长期资源关联 | 不维护窗口级活跃 Agent |
| Thread | 对话边界、消息事实、channel 与 policy | 不持有长期记忆或工具权限 |
| Context Runtime | 只读编译 LLM 输入与 Manifest | 不写消息、记忆、人格或文件 |
| Memory | Candidate、Gate、CanonicalMemory、Provenance | 不将原始 Thread 当作长期记忆 |
| Workspace | Agent 私有文件根与 containment | 不写安装/Workshop 只读资产 |
| Tool Capability | `(agentId, channel)` 权限与资源范围 | 不允许默认 Agent 或 channel 回退 |

### 9.1 请求上下文

进入 Service/Tool 执行链的运行时上下文必须明确包含 `agentId`、`threadId` 和 `channel`。后端不允许根据“当前活跃角色”推断这些值；外部入站消息由 `InboundRoute` 决定归属，后台任务由任务本身的 `agentId` 决定。

### 9.2 Context Compiler

聊天入口只接收当前输入与 `threadId`。后端从 Thread 读取 active 消息、策略与 Agent，并由 Compiler 只读组装原生 `user/assistant` 消息；禁止客户端上传完整历史，禁止 XML 形式的历史重复注入。

### 9.3 Daemon 与能力提供者

`packages/backend` 保持纯 Node 运行时，不 import Electron。平台能力通过 Capability Provider 委托给 Electron、移动端等节点；无 Provider 时返回可解释的不可用结果。Provider 调用也必须先经过 CapabilityGate。

---

*本文档由 Carola 整理，适用于 infOS-TS 后端架构规范。*
