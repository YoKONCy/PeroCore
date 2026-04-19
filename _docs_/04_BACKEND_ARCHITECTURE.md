# 后端架构规范

> **版本**：0.1.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：`packages/backend/` 全部代码
> **技术栈**：Hono + Drizzle + better-sqlite3 + TriviumDB

---

## 1. 三层架构

```
┌──────────────────────────────────────────────────────────┐
│  Router 层 (routers/)                                    │
│  职责：接收请求 → Zod 校验 → 调用 Service → 包装响应      │
│  禁止：直接操作 DB、包含业务逻辑、catch 后吞错误          │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│  Service 层 (services/)                                  │
│  职责：业务逻辑编排 → 调用 Repository → 调用外部服务       │
│  禁止：直接构造 HTTP 响应、import Hono 的 Context          │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│  Repository 层 (repositories/)                           │
│  职责：数据访问抽象（SQLite via Drizzle / TriviumDB）      │
│  禁止：包含业务逻辑、直接返回 HTTP 响应                    │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Router 层规范

### 2.1 标准模板

```typescript
// routers/memory.router.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createMemorySchema } from '../schemas/memory.schema'
import type { AppContext } from '../container'

export function createMemoryRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/memories - 列表
  router.get('/', async (c) => {
    const page = Number(c.req.query('page') ?? 1)
    const pageSize = Number(c.req.query('pageSize') ?? 20)
    const result = await ctx.memoryService.list({ page, pageSize })
    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  // POST /api/memories - 创建
  router.post('/', zValidator('json', createMemorySchema), async (c) => {
    const body = c.req.valid('json')
    const memory = await ctx.memoryService.create(body)
    return c.json({ code: 'CREATED', message: '记忆已创建', data: memory }, 201)
  })

  // DELETE /api/memories/:id - 删除
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    await ctx.memoryService.delete(id)
    return c.json({ code: 'OK', message: '记忆已删除' })
  })

  return router
}
```

### 2.2 Router 层禁止事项

```typescript
// ❌ 禁止在 Router 层直接操作数据库
router.post('/', async (c) => {
  const body = await c.req.json()
  const result = await db.insert(memories).values(body)  // 禁止！
})

// ❌ 禁止在 Router 层包含业务判断逻辑
router.post('/', async (c) => {
  const body = await c.req.json()
  if (body.importance > 5) {                             // 禁止！这是业务逻辑
    // ...
  }
})
```

---

## 3. Service 层规范

### 3.1 构造函数注入

```typescript
// services/memory/memoryService.ts
export class MemoryService {
  constructor(
    private memoryRepo: MemoryRepository,
    private vectorRepo: VectorRepository,
    private embeddingService: EmbeddingService,
    private scorerService: ScorerService,
  ) {}

  async create(data: CreateMemoryDto): Promise<MemoryDto> {
    // 1. 写入 SQLite
    const memory = await this.memoryRepo.create(data)

    // 2. 生成向量并写入 TriviumDB
    const vector = await this.embeddingService.embed(data.content)
    await this.vectorRepo.upsert(memory.id, vector, {
      agentId: data.agentId,
      importance: data.importance,
    })

    // 3. 建立时间顺序边
    const prevId = await this.memoryRepo.findPreviousId(memory.agentId)
    if (prevId) {
      await this.vectorRepo.link(memory.id, prevId, 'temporal')
    }

    return memory
  }
}
```

### 3.2 Service 层禁止事项

```typescript
// ❌ 禁止 import Hono 的类型
import { Context } from 'hono'  // 禁止！

// ❌ 禁止直接构造 HTTP 响应
return c.json({ ... })  // 禁止！Service 只返回业务数据
```

---

## 4. Repository 层规范

### 4.1 SQLite Repository (Drizzle)

```typescript
// repositories/memory.repo.ts
import { eq, desc } from 'drizzle-orm'
import { memoryNodes } from '../database/schema'
import type { DrizzleDb } from '../database/connection'

export class MemoryRepository {
  constructor(private db: DrizzleDb) {}

  async create(data: CreateMemoryDto) {
    const [memory] = await this.db
      .insert(memoryNodes)
      .values({
        content: data.content,
        agentId: data.agentId,
        importance: data.importance ?? 1,
        tags: data.tags ?? '',
      })
      .returning()
    return memory
  }

  async findById(id: number) {
    return this.db
      .select()
      .from(memoryNodes)
      .where(eq(memoryNodes.id, id))
      .get()
  }

  async list(params: { page: number; pageSize: number; agentId?: string }) {
    // ...
  }
}
```

### 4.2 TriviumDB Repository

```typescript
// repositories/vector.repo.ts
import type { TriviumStore } from 'triviumdb'

export class VectorRepository {
  constructor(private store: TriviumStore) {}

  async upsert(id: number, vector: number[], payload: Record<string, unknown>) {
    await this.store.insertWithId(id, vector, payload)
  }

  async link(sourceId: number, targetId: number, label: string, weight = 1.0) {
    await this.store.link(sourceId, targetId, label, weight)
  }

  async search(query: number[], topK: number, filter?: Record<string, unknown>) {
    return this.store.searchHybrid(query, topK, { payloadFilter: filter })
  }
}
```

### 4.3 为什么引入 Repo 层

| 优势 | 说明 |
|---|---|
| **双数据源隔离** | SQLite (Drizzle) 和 TriviumDB 的操作细节不泄露到 Service |
| **可测试性** | 可以 mock Repository 测试 Service |
| **未来可扩展** | 换 Postgres / Milvus / 分布式 DB，只需新增 Repo 实现 |
| **单一职责** | Service 只管业务编排，Repo 只管数据存取 |

---

## 5. 依赖注入容器

```typescript
// container.ts —— 统一初始化所有依赖
import { MemoryRepository } from './repositories/memory.repo'
import { VectorRepository } from './repositories/vector.repo'
import { VectorSyncRepository } from './repositories/vectorSync.repo'
import { ConversationLogRepository } from './repositories/conversationLog.repo'
import { ConfigRepository } from './repositories/config.repo'
import { MemoryStoreRegistry } from './repositories/storeRegistry'
import { EmbeddingService } from './services/embedding/embeddingService'
import { LlmService } from './services/llm/llmService'
import { MemoryService } from './services/memory/memoryService'
import { MemorySearchService } from './services/memory/memorySearch'
import { ConversationLogService } from './services/memory/conversationLog'
import { ScorerService } from './services/memory/scorerService'
import { VectorWriteHelper } from './shared/vectorWriteHelper'
// ...

export interface AppContext {
  db: DrizzleDb
  // Repository
  memoryRepo: MemoryRepository
  vectorRepo: VectorRepository
  vectorSyncRepo: VectorSyncRepository
  logRepo: ConversationLogRepository
  configRepo: ConfigRepository
  storeRegistry: MemoryStoreRegistry
  // Service
  embeddingService: EmbeddingService
  llmService: LlmService
  memoryService: MemoryService
  memorySearchService: MemorySearchService
  logService: ConversationLogService
  scorerService: ScorerService
  // Shared
  vectorWriteHelper: VectorWriteHelper
  // ... 未来的 AgentService, ChatService 等
}

export function createAppContext(config: AppConfig): AppContext {
  // 1. 基础设施
  const db = createDrizzleConnection(config.databasePath)
  const storeRegistry = new MemoryStoreRegistry(config.dataDir)

  // 2. Repository
  const memoryRepo = new MemoryRepository(db)
  const vectorSyncRepo = new VectorSyncRepository(db)
  const logRepo = new ConversationLogRepository(db)
  const configRepo = new ConfigRepository(db)
  const vectorRepo = new VectorRepository(storeRegistry)

  // 3. Service（按依赖顺序初始化）
  const embeddingService = new EmbeddingService(config.embedding)
  const vectorWriteHelper = new VectorWriteHelper(vectorRepo, vectorSyncRepo, embeddingService)
  const llmService = new LlmService()
  const memoryService = new MemoryService(memoryRepo, vectorRepo, vectorWriteHelper)
  const memorySearchService = new MemorySearchService(vectorRepo, memoryRepo, embeddingService)
  const logService = new ConversationLogService(logRepo)
  const scorerService = new ScorerService(memoryService, logService, llmService, configRepo)
  // ...

  return {
    db, memoryRepo, vectorRepo, vectorSyncRepo, logRepo, configRepo, storeRegistry,
    embeddingService, llmService, memoryService, memorySearchService, logService,
    scorerService, vectorWriteHelper,
  }
}
```

---

## 6. LLM Provider 模式

```typescript
// services/llm/providers/llmProvider.ts
export interface LlmProvider {
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatCompletion>
  chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatDelta>
  listModels(): Promise<string[]>
}

// services/llm/providers/openaiProvider.ts
export class OpenAiProvider implements LlmProvider { /* ... */ }

// services/llm/providers/geminiProvider.ts
export class GeminiProvider implements LlmProvider { /* ... */ }

// services/llm/providers/anthropicProvider.ts
export class AnthropicProvider implements LlmProvider { /* ... */ }

// services/llm/llmService.ts
export class LlmService {
  private createProvider(config: ModelConfig): LlmProvider {
    switch (config.provider) {
      case 'gemini':    return new GeminiProvider(config)
      case 'anthropic': return new AnthropicProvider(config)
      default:          return new OpenAiProvider(config)  // OpenAI 兼容
    }
  }
}
```

---

## 7. Service 目录组织

Service 内部按功能域分目录。超过 500 行的 Service 必须拆分子模块。

```
services/
├── memory/
│   ├── index.ts                    # 桶导出
│   ├── memoryService.ts            # 核心 CRUD + 时间链编排 (~170 行)
│   ├── memorySearch.ts             # 语义检索 + 逻辑闪回 (~220 行)
│   ├── conversationLog.ts          # 对话日志 Service
│   ├── scorerService.ts            # 记忆提炼 (攒批 LLM 分析)
│   └── maintenance/                # Reflection 子系统
│       ├── index.ts
│       ├── reflectionOrchestrator.ts
│       ├── tagger.ts               # 批量标注
│       ├── consolidator.ts         # 相似合并
│       ├── auditor.ts              # 一致性审计
│       ├── retirementPolicy.ts     # 低价值退役
│       ├── dreamAssociator.ts      # 梦境关联
│       └── graphGardener.ts        # 图谱边维护
├── embedding/
│   ├── index.ts
│   └── embeddingService.ts         # Embedding 门面 + API Provider
├── llm/
│   ├── index.ts
│   ├── llmService.ts               # LLM 门面 + Provider 工厂
│   ├── types.ts                    # ChatMessage / ChatCompletion 等
│   └── providers/
│       ├── openaiProvider.ts       # OpenAI 兼容 (绝大多数厂商)
│       ├── geminiProvider.ts       # Gemini REST API
│       └── anthropicProvider.ts    # Anthropic Messages API
├── agent/
│   ├── index.ts
│   ├── agentService.ts
│   ├── reactLoop.ts
│   ├── toolExecutor.ts
│   ├── toolPolicy.ts
│   ├── companionService.ts
│   └── schedulerService.ts
├── chat/
│   ├── chatService.ts
│   └── sessionService.ts
└── voice/
    ├── ttsService.ts
    └── realtimeSessionManager.ts
```

---

## 8. Gateway 层规范 (D32/D33)

### 8.1 架构决策

| 决策 | 结果 | 理由 |
|---|---|---|
| 端口策略 | **耦合同端口 :9120** | 部署最简（Electron/Docker 只暴露一个端口）；Hono 原生支持 WS 升级；v1 已验证可行；单用户场景无需流量隔离 |
| 实现语言 | **TypeScript (Hono)** | 消息路由是 IO-bound 不需要 Rust；需深度集成 Service 层（broadcast 直接调后端）；一套技术栈易维护 |
| 协议 | **WebSocket + Protobuf (Envelope)** | 继承 v1 D10 决策，音频二进制传输优势明显 |
| 鉴权 | **Hello 消息携带 Token** | 继承 v1 握手流程 |

### 8.2 文件组织

```
packages/backend/src/
├── gateway/
│   ├── index.ts                # 桶导出
│   ├── gatewayHub.ts           # WebSocket Hub，管理所有连接和消息路由
│   ├── gatewayClient.ts        # 后端 Service 调用的薄代理（零 WS 开销）
│   ├── gatewayRouter.ts        # Hono WS 升级路由 (/ws/gateway)
│   ├── envelopeHandler.ts      # Protobuf Envelope 解码 + 分发逻辑
│   └── types.ts                # GatewayNode, GatewayEvent 等接口
├── proto/
│   └── perolink.ts             # Protobuf 生成的 TS 类型 (Envelope, Hello, etc.)
```

### 8.3 GatewayHub 骨架

```typescript
// gateway/gatewayHub.ts

interface GatewayNode {
  id: string
  ws: WSContext
  deviceName: string
  capabilities: string[]
  connectedAt: number
}

export class GatewayHub {
  private nodes: Map<string, GatewayNode> = new Map()
  private listeners: Map<string, ((...args: any[]) => void)[]> = new Map()
  authToken: string = ''

  /** 前端 WS 连接建立时调用 */
  handleConnection(ws: WSContext): void { /* ... */ }

  /** 收到 WS 消息时调用（Protobuf 解码 + 分发） */
  handleMessage(ws: WSContext, data: Uint8Array): void {
    const envelope = Envelope.decode(data)

    // Hello 握手 → 注册节点
    if (envelope.hello) { this.handleHello(ws, envelope); return }

    // Heartbeat → 回 pong
    if (envelope.heartbeat) { return }

    // ActionRequest / Stream → 触发事件监听器
    if (envelope.request) {
      this.emit(`action:${envelope.request.actionName}`, envelope.request)
    }
    if (envelope.stream) {
      this.emit('stream', envelope.stream)
    }

    // 转发到目标节点
    if (envelope.targetId && envelope.targetId !== 'master') {
      this.unicast(envelope.targetId, envelope)
    }
  }

  /** 断连时调用 */
  handleDisconnect(ws: WSContext): void { /* 移除节点 */ }

  // --- 后端 Service 直接调用的广播方法（不走 WS，零延迟）---

  /** 广播 Protobuf Envelope 到所有连接的前端 */
  async broadcast(envelope: Envelope): Promise<void> {
    const data = Envelope.encode(envelope).finish()
    for (const node of this.nodes.values()) {
      node.ws.send(data)
    }
  }

  /** 广播宠物状态更新（PetState → Envelope → 所有前端） */
  async broadcastPetState(state: PetState): Promise<void> { /* ... */ }

  /** 广播文本响应（LLM 回复 → 所有前端） */
  async broadcastTextResponse(content: string, target?: string): Promise<void> { /* ... */ }

  /** 广播错误通知 */
  async broadcastError(message: string, title?: string): Promise<void> { /* ... */ }

  /** 定向发送到指定设备 */
  async unicast(targetId: string, envelope: Envelope): Promise<void> { /* ... */ }

  /** 注册事件监听器（供 RealtimeSessionManager 等使用） */
  on(event: string, callback: (...args: any[]) => void): void { /* ... */ }
}
```

### 8.4 GatewayRouter（Hono WS 升级）

```typescript
// gateway/gatewayRouter.ts
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import type { AppContext } from '../container'

export function createGatewayRouter(ctx: AppContext) {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.get(
    '/ws/gateway',
    upgradeWebSocket((c) => ({
      onOpen(_event, ws) {
        ctx.gatewayHub.handleConnection(ws)
      },
      onMessage(event, ws) {
        const data = new Uint8Array(event.data as ArrayBuffer)
        ctx.gatewayHub.handleMessage(ws, data)
      },
      onClose(_event, ws) {
        ctx.gatewayHub.handleDisconnect(ws)
      },
    }))
  )

  return { router: app, injectWebSocket }
}
```

### 8.5 Service 层集成

后端 Service 通过 DI 注入 `GatewayHub`，直接调用广播方法：

```typescript
// services/agent/agentService.ts
export class AgentService {
  constructor(
    private agentRepo: AgentRepository,
    private gatewayHub: GatewayHub,  // 构造函数注入
  ) {}

  async onLlmResponse(response: string) {
    // 直接调用 Hub 方法，不走 WS，零延迟
    await this.gatewayHub.broadcastTextResponse(response)
  }
}
```

### 8.6 Gateway 层禁止事项

```typescript
// ❌ 禁止：Gateway 直接操作数据库
hub.handleMessage = (ws, data) => {
  await db.insert(messages).values(...)  // 禁止！应调用 Service
}

// ❌ 禁止：Service 通过 WS 连接自己来广播
const clientWs = new WebSocket('ws://localhost:9120/ws/gateway')
clientWs.send(data)  // 禁止！应直接调用 gatewayHub.broadcast()

// ❌ 禁止：Gateway 用 Rust 单独写（D33）
// 消息路由是 IO-bound，不需要 Rust 的 CPU 性能优势
// 且需要深度调用 TS Service 层，跨语言通信得不偿失

// ✅ 正确：Hub 直接调用注入的 Service
hub.on('action:send_message', async (req) => {
  await ctx.chatService.handleMessage(req.params)
})
```

---

*本文档由 Carola 整理，适用于 PeroCore-TS 后端架构规范。*
