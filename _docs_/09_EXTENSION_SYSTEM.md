# 扩展系统（Mod/Plugin）架构规范

> **版本**：0.1.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 扩展系统设计
> **前身**：PeroCore v1 的 `ModManager` + `PluginManager` + `_external_plugins`

---

## 1. 设计目标

PeroCore v1 有 3 套割裂的扩展机制（Plugin、Mod、外部插件），v2 **合并为一套统一的扩展系统**。

| v1 问题 | v2 解决 |
|---|---|
| PluginManager + ModManager + _external_plugins 三套并行 | **统一 `ExtensionManager`** |
| Python `importlib` + `sys.modules` hack | TS `import()` 原生动态加载，零 hack |
| `asset.json` + `mod.toml` 两种清单格式 | **统一 `manifest.json`** |
| EventBus/Pipeline 设计了但落地不完整 | **Hook 系统严格类型化** |
| 外部插件塞进同一进程，一个挂全挂 | **Service 扩展独立进程运行** |
| 工具定义分散在各目录 | **`getAllToolDefinitions()` 统一输出** |

---

## 2. 扩展的 3 种类型

```
┌────────────────────────────────────────────────────────────┐
│                   PeroCore 扩展系统                         │
│                                                            │
│  Tool（工具）                                               │
│    Agent 可调用的能力（搜索文件、执行终端、查看屏幕...）       │
│    运行方式：同进程 import()                                 │
│    → 原 nit_core/tools/*                                    │
│                                                            │
│  Hook（钩子）                                               │
│    在特定事件节点注入逻辑（消息前处理、记忆后处理...）         │
│    运行方式：同进程 import()                                 │
│    → 原 Mod 的 EventBus + Pipeline                          │
│                                                            │
│  Service（独立服务）                                        │
│    提供独立 API 路由或独立进程的完整功能模块                  │
│    运行方式：子进程 (stdio JSON-RPC) 或网络服务              │
│    → 原 _external_plugins 和 social_adapter                 │
└────────────────────────────────────────────────────────────┘
```

---

## 3. 通信分层架构

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1: 同进程                                          │
│   Tool + Hook 扩展直接跑在主进程里                        │
│   → 零开销，import() 加载                                │
│   → 适用：大多数 Tool 和 Hook                             │
├──────────────────────────────────────────────────────────┤
│ Layer 2: 子进程 IPC                                      │
│   Service 扩展跑在独立子进程                              │
│   → 通信：stdio JSON-RPC（与 MCP 协议一致）              │
│   → 进程隔离，崩了不影响主服务                           │
│   → 适用：社交适配器、数据抓取器等                       │
├──────────────────────────────────────────────────────────┤
│ Layer 3: 网络服务（预留，v1 不实现）                      │
│   Service 扩展跑在独立容器 / 远程机器                     │
│   → 通信：HTTP / WebSocket / (未来 Zenoh)                │
│   → 适用：Docker 分布式部署场景                          │
└──────────────────────────────────────────────────────────┘
```

**v1 实现 Layer 1 + Layer 2，预留 Layer 3 接口。**

---

## 4. 目录结构

> **设计原则**：内置工具**平铺**，不按模式分子目录。
> 哪些工具在哪个模式可用，由 `capabilities.yaml` (CapabilityGate) 声明式管理。

```
packages/backend/
├── src/
│   ├── extensions/                  # 扩展系统核心框架
│   │   ├── extensionManager.ts      # 统一扩展管理器
│   │   ├── extensionLoader.ts       # 动态加载器（TS/JS 双支持）
│   │   ├── types.ts                 # 扩展接口定义
│   │   ├── hookRegistry.ts          # Hook 事件注册与触发
│   │   ├── serviceRunner.ts         # Service 子进程管理
│   │   └── transports/              # 通信层
│   │       ├── transport.ts         # 接口定义
│   │       └── stdioTransport.ts    # Layer 2: JSON-RPC over stdio
│   │
│   ├── tools/                       # 内置 Tool（平铺，静态注册）
│   │   ├── index.ts                 # registerBuiltinTools() 入口
│   │   ├── finishTask/              # ✅ 已实装
│   │   ├── loadSkill/               # ✅ 已实装
│   │   ├── fileOps/                 # ✅ 已实装 (read/write/info/list)
│   │   ├── fileSearch/              # ✅ 已实装 (Everything→fd→Node回退)
│   │   ├── terminalExecutor/        # ✅ 已实装
│   │   ├── codeSearcher/            # ✅ 已实装 (ripgrep)
│   │   ├── screenVision/            # 🔜 需 native addon
│   │   ├── systemOps/               # 🔜 跨平台化后的 WindowsOps
│   │   ├── desktopAutomation/       # 🔜 需 GUI + nut-js
│   │   ├── browserOps/              # 🔜 需 playwright
│   │   └── scheduler/               # 🔜 定时任务
│   └── ...
│
├── $PERO_DATA_DIR/extensions/       # 用户扩展目录（运行时）
│   ├── my-custom-tool/
│   │   ├── manifest.json
│   │   └── index.js                 # 推荐已打包的 JS
│   ├── bilibili-fetch/
│   │   ├── manifest.json
│   │   └── index.js
│   └── social-adapter/
│       ├── manifest.json
│       └── index.ts                 # Service 类型，独立进程
```

---

## 5. 清单文件 (manifest.json)

统一取代 v1 的 `mod.toml` 和 `asset.json`：

```jsonc
{
  // --- 基本信息 ---
  "id": "file-search",
  "name": "文件搜索",
  "version": "1.0.0",
  "author": "PeroCore Team",
  "description": "在工作区中搜索文件和代码",

  // --- 扩展类型 ---
  "type": "tool",                    // "tool" | "hook" | "service"

  // --- 入口 ---
  "entry": "index.ts",              // 支持 .ts 和 .js

  // --- 分类 ---
  "category": "core",               // "core" | "work" | "group" | "community"

  // --- 平台兼容（可选） ---
  "platforms": ["windows", "linux", "darwin", "docker"],

  // --- 权限声明（可选） ---
  "permissions": [
    "filesystem:read",
    "filesystem:write",
    "network:local",
    "process:spawn"
  ],

  // --- Tool 专属字段 ---
  "toolDefinition": {
    "name": "file_search",
    "description": "在工作区中搜索文件",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "搜索关键词" },
        "path": { "type": "string", "description": "搜索路径" }
      },
      "required": ["query"]
    }
  },

  // --- Service 专属字段 ---
  "service": {
    "transport": "stdio",            // "stdio" | "http"
    "port": 9200,                    // 仅 http 时使用
    "healthCheck": "/health"         // 健康检查端点
  },

  // --- 依赖管理 (v2 新增) ---
  "bundled": true,                   // 是否已预打包 (推荐)
  "dependencies": {                  // npm 依赖 (仅 bundled=false 时)
    "axios": "^1.7.0"
  },
  "binaries": {                      // 外部二进制依赖
    "rg": {
      "purpose": "代码搜索",
      "required": false,             // false = 有降级方案
      "installHint": "https://github.com/BurntSushi/ripgrep/releases"
    }
  }
}
```

---

## 6. 扩展接口定义

### 6.1 Tool 扩展

```typescript
// extensions/types.ts

interface ToolExtension {
  /** 工具定义（给 LLM 的 function calling schema） */
  definition: ToolDefinition

  /** 执行函数 */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>

  /** 可选：初始化 */
  onLoad?(): Promise<void>

  /** 可选：清理 */
  dispose?(): Promise<void>
}

interface ToolContext {
  /** 当前 Agent ID */
  agentId: string
  /** 当前会话 ID */
  sessionId: string
  /** 日志器 */
  logger: Logger
  /** 配置访问 */
  config: ConfigAccessor
}

interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}
```

**使用示例**：

```typescript
// tools/core/fileSearch/index.ts
import type { ToolExtension } from '../../../extensions/types'

const fileSearchTool: ToolExtension = {
  definition: {
    name: 'file_search',
    description: '在工作区中搜索文件',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  },

  async execute(args, ctx) {
    const { query } = args as { query: string }
    ctx.logger.info('执行文件搜索', { query })
    const results = await searchFiles(query)
    return { success: true, data: results }
  },
}

export default fileSearchTool
```

### 6.2 Hook 扩展

```typescript
interface HookExtension {
  /** 要监听的事件及处理函数 */
  hooks: {
    [event in HookEvent]?: HookHandler
  }

  /** 可选：初始化 */
  onLoad?(): Promise<void>

  /** 可选：清理 */
  dispose?(): Promise<void>
}

/** Hook 处理函数：接收数据，返回修改后的数据（或 undefined 表示不修改） */
type HookHandler<T = unknown> = (
  data: T,
  ctx: HookContext,
) => Promise<T | undefined | void>

interface HookContext {
  logger: Logger
  config: ConfigAccessor
  /** 中断后续 Hook 执行 */
  abort(reason?: string): void
}
```

**使用示例**：

```typescript
// extensions/memory-tagger/index.ts
import type { HookExtension } from '@perocore/shared'

const memoryTagger: HookExtension = {
  hooks: {
    'memory:beforeCreate': async (data, ctx) => {
      // 在记忆创建前自动添加标签
      data.tags = await autoTag(data.content)
      return data  // 返回修改后的数据
    },

    'memory:afterCreate': async (memory, ctx) => {
      // 记忆创建后发送通知（不需要修改数据）
      ctx.logger.info('记忆已创建并标记', { id: memory.id, tags: memory.tags })
    },
  },
}

export default memoryTagger
```

### 6.3 Service 扩展

```typescript
interface ServiceExtension {
  /** 清单信息 */
  manifest: ExtensionManifest

  /** 接收 JSON-RPC 请求 */
  handleRequest(method: string, params: unknown): Promise<unknown>

  /** 启动时初始化 */
  onStart?(): Promise<void>

  /** 关闭时清理 */
  onStop?(): Promise<void>
}
```

**stdio JSON-RPC Service 示例**：

```typescript
// extensions/social-adapter/index.ts
import type { ServiceExtension } from '@perocore/shared'

const socialAdapter: ServiceExtension = {
  manifest: {
    id: 'social-adapter',
    name: '社交适配器',
    type: 'service',
    version: '1.0.0',
    entry: 'index.ts',
  },

  async onStart() {
    // 初始化 NapCat 连接
    await initNapCatConnection()
  },

  async handleRequest(method, params) {
    switch (method) {
      case 'sendMessage':
        return await sendQQMessage(params as SendMessageParams)
      case 'getContacts':
        return await getContactList()
      default:
        throw new Error(`未知方法: ${method}`)
    }
  },

  async onStop() {
    // 断开连接
    await disconnectNapCat()
  },
}

export default socialAdapter
```

### 6.4 Service 双向通信协议

Service 扩展与核心之间采用 **双向 JSON-RPC**，在同一条 stdio / WebSocket 通道上同时支持正向和反向调用。

```
┌──────────────────────┐                     ┌──────────────────────┐
│    PeroCore 核心       │  正向 (Core→Svc)    │   Service 扩展        │
│                      │ ──────────────────→ │                      │
│  callService(id,     │  sendMessage         │  handleRequest()     │
│    method, params)   │  getContacts         │                      │
│                      │  getStatus           │                      │
│                      │                     │                      │
│  handleNotification()│ ←────────────────── │  notifyCore()        │
│                      │  反向 (Svc→Core)     │                      │
│  agentService.chat() │  inbound:message     │  napcat 收到消息时    │
│  webhook 推送        │  inbound:event       │  平台事件推送         │
└──────────────────────┘                     └──────────────────────┘
```

**反向通知接口**（Service → Core）：

```typescript
/** Service 扩展可以主动推送给核心的通知类型 */
type ServiceNotification =
  | { method: 'inbound:message'; params: InboundMessage }
  | { method: 'inbound:event'; params: InboundEvent }

/** 统一入站消息格式 (平台无关) */
interface InboundMessage {
  /** 消息来源平台 */
  platform: string            // 'qq' | 'telegram' | 'discord' | ...
  /** 会话标识 (平台侧的唯一 ID) */
  channelId: string
  /** 会话类型 */
  channelType: 'private' | 'group'
  /** 发送者 ID */
  senderId: string
  /** 发送者显示名 */
  senderName: string
  /** 纯文本内容 (已由适配器清洗, 无平台特定标记) */
  content: string
  /** 附件 (图片/文件等) */
  attachments?: Array<{ type: string; url: string; name?: string }>
  /** 引用的消息 ID */
  replyTo?: string
  /** 关联的 Agent ID (适配器根据平台映射确定) */
  agentId: string
}

/** 平台事件 (好友请求/群变动等) */
interface InboundEvent {
  platform: string
  eventType: string           // 'friend_request' | 'member_join' | ...
  data: Record<string, unknown>
  agentId: string
}
```

> [!IMPORTANT]
> 核心侧收到 `inbound:message` 后，直接调 `agentService.chat({ source: 'social', ... })`，
> 和桌面模式走完全相同的 Pipeline Phase 1-5。
> 适配器的"攒批"逻辑（群聊不是每条都触发 AI）由适配器自行实现。

---

## 7. Hook 事件系统

### 7.1 已定义的 Hook 点

> [!NOTE]
> 以下为初始清单，后续深入代码逻辑时补充完善。

```typescript
type HookEvent =
  // === 聊天 ===
  | 'chat:beforeSend'           // 用户消息发送前（可拦截/修改）
  | 'chat:afterReply'           // AI 回复后（可追加处理）
  | 'chat:beforeToolCall'       // 工具调用前
  | 'chat:afterToolCall'        // 工具调用后

  // === 记忆 ===
  | 'memory:beforeCreate'       // 记忆创建前
  | 'memory:afterCreate'        // 记忆创建后
  | 'memory:beforeDelete'       // 记忆删除前
  | 'memory:afterRetrieve'      // 记忆检索后（可对结果排序/过滤）

  // === Agent ===
  | 'agent:onSwitch'            // Agent 切换时
  | 'agent:onMoodChange'        // 情绪变化时

  // === 生命周期 ===
  | 'app:onStart'               // 应用启动完成
  | 'app:onShutdown'            // 应用关闭前

  // === 待补充 ===
  // 后续深入代码逻辑时继续完善
```

### 7.2 Hook 执行规则

| 规则 | 说明 |
|---|---|
| **顺序执行** | 同一事件的多个 Hook 按注册顺序串行执行 |
| **可修改数据** | `before*` Hook 返回值会替换原始数据传给下一个 Hook |
| **可中断** | 调用 `ctx.abort()` 后跳过后续 Hook |
| **异常隔离** | 单个 Hook 抛异常不会阻断后续 Hook，但会记录日志 |
| **超时保护** | 每个 Hook 最长执行 5 秒，超时自动跳过 |

---

## 8. ExtensionManager 核心实现

```typescript
// extensions/extensionManager.ts

class ExtensionManager {
  private tools = new Map<string, ToolExtension>()
  private hookRegistry = new HookRegistry()
  private services = new Map<string, ServiceRunner>()
  private manifests = new Map<string, ExtensionManifest>()

  /** 扫描并加载所有扩展 */
  async loadAll(config: { builtinToolsDir: string; userExtensionsDir: string }) {
    // 1. 加载内置 Tool
    await this.scanAndLoad(config.builtinToolsDir)
    // 2. 加载用户扩展
    if (fs.existsSync(config.userExtensionsDir)) {
      await this.scanAndLoad(config.userExtensionsDir)
    }
    logger.info(`扩展加载完成: ${this.tools.size} Tool, ` +
      `${this.hookRegistry.count} Hook, ${this.services.size} Service`)
  }

  /** 获取 Tool */
  getTool(name: string): ToolExtension | undefined {
    return this.tools.get(name)
  }

  /** 获取所有 Tool 定义（供 LLM function calling） */
  getAllToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => t.definition)
  }

  /** 触发 Hook */
  async emitHook<T>(event: HookEvent, data: T, ctx: HookContext): Promise<T> {
    return this.hookRegistry.emit(event, data, ctx)
  }

  /** 调用 Service */
  async callService(serviceId: string, method: string, params: unknown): Promise<unknown> {
    const runner = this.services.get(serviceId)
    if (!runner) throw new Error(`Service "${serviceId}" 未找到`)
    return runner.call(method, params)
  }

  /** 热重载单个扩展 */
  async reloadExtension(extensionId: string) {
    const manifest = this.manifests.get(extensionId)
    if (!manifest) throw new Error(`扩展 "${extensionId}" 未找到`)

    // 1. 卸载旧扩展
    await this.unloadExtension(extensionId)

    // 2. 重新加载
    await this.loadSingleExtension(manifest.path!, manifest)

    logger.info(`扩展已热重载: ${extensionId}`)
  }

  /** 卸载扩展 */
  async unloadExtension(extensionId: string) {
    const manifest = this.manifests.get(extensionId)
    if (!manifest) return

    switch (manifest.type) {
      case 'tool': {
        const tool = this.tools.get(extensionId)
        await tool?.dispose?.()
        this.tools.delete(extensionId)
        break
      }
      case 'hook': {
        this.hookRegistry.removeByExtension(extensionId)
        break
      }
      case 'service': {
        const runner = this.services.get(extensionId)
        await runner?.stop()
        this.services.delete(extensionId)
        break
      }
    }
  }

  /** 列出所有已加载扩展 */
  listExtensions(): ExtensionInfo[] {
    return [...this.manifests.values()].map(m => ({
      id: m.id,
      name: m.name,
      type: m.type,
      version: m.version,
      status: this.getExtensionStatus(m.id),
    }))
  }
}
```

---

## 9. Service 子进程管理

```typescript
// extensions/serviceRunner.ts

class ServiceRunner {
  private process: ChildProcess | null = null
  private transport: ServiceTransport | null = null

  constructor(
    private manifest: ExtensionManifest,
    private extensionPath: string,
  ) {}

  async start() {
    const entryFile = path.join(this.extensionPath, this.manifest.entry)
    const transport = this.manifest.service?.transport ?? 'stdio'

    if (transport === 'stdio') {
      // 用 Bun 或 Node 启动子进程
      const runtime = detectRuntime() // 'bun' 或 'node'
      this.process = spawn(runtime, [entryFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PERO_EXTENSION_MODE: 'service' },
      })

      this.transport = new StdioTransport(this.process.stdin!, this.process.stdout!)
    }

    // 调用 onStart
    await this.call('__lifecycle__', { action: 'start' })
    logger.info(`Service "${this.manifest.id}" 已启动 (PID: ${this.process?.pid})`)
  }

  async call(method: string, params: unknown): Promise<unknown> {
    if (!this.transport) throw new Error(`Service "${this.manifest.id}" 未启动`)
    return this.transport.call(method, params)
  }

  async stop() {
    await this.call('__lifecycle__', { action: 'stop' }).catch(() => {})
    this.process?.kill()
    this.process = null
    logger.info(`Service "${this.manifest.id}" 已停止`)
  }
}
```

---

## 10. Transport 接口（预留 Layer 3）

```typescript
// extensions/transports/transport.ts

/** 通信层抽象——未来可替换为 HTTP / Zenoh */
interface ServiceTransport {
  /** 调用远程方法 */
  call(method: string, params: unknown): Promise<unknown>
  /** 订阅事件（pub/sub，预留） */
  subscribe?(topic: string, handler: (data: unknown) => void): void
  /** 关闭连接 */
  dispose(): Promise<void>
}

// Layer 2 实现
class StdioTransport implements ServiceTransport { /* ... */ }

// Layer 3 实现（预留）
class HttpTransport implements ServiceTransport { /* ... */ }

// Layer 3 实现（未来，如需引入 Zenoh）
// class ZenohTransport implements ServiceTransport { /* ... */ }
```

---

## 11. 权限系统

### 11.1 原则

- **插件自治**：扩展自行声明所需权限
- **可选全局底线**：主服务可配置全局权限策略

### 11.2 权限层级

```typescript
type ExtensionPermission =
  | 'filesystem:read'      // 读取文件
  | 'filesystem:write'     // 写入文件
  | 'network:local'        // 本地网络请求
  | 'network:internet'     // 外部网络请求
  | 'process:spawn'        // 启动子进程
  | 'database:read'        // 读取数据库
  | 'database:write'       // 写入数据库
  | 'system:info'          // 读取系统信息
```

### 11.3 全局配置（可选）

```jsonc
// config/extensions.json
{
  "permissions": {
    "globalDeny": ["process:spawn"],          // 全局禁止所有扩展启动子进程
    "overrides": {
      "social-adapter": {
        "allow": ["process:spawn", "network:internet"]  // 社交适配器例外
      }
    }
  }
}
```

---

## 12. 热重载

### 12.1 开发模式

```typescript
// 开发模式下自动监听扩展目录变化
if (env.PERO_DEV_MODE) {
  const watcher = fs.watch(userExtensionsDir, { recursive: true })
  watcher.on('change', async (eventType, filename) => {
    const extId = extractExtensionId(filename)
    if (extId) {
      await extensionManager.reloadExtension(extId)
    }
  })
}
```

### 12.2 生产模式

通过 API 手动触发：

```
POST /api/extensions/{extensionId}/reload
POST /api/extensions/reload-all
```

### 12.3 Dashboard UI

前端 Dashboard 提供扩展管理界面：

- 查看已加载的扩展列表
- 单个扩展的启用/禁用/重载
- 查看扩展运行状态和日志

---

## 13. 与现有系统的迁移映射

| v1 模块 | v1 位置 | v2 工具名 | 状态 | 说明 |
|---|---|---|---|---|
| FileSearch | `tools/core/FileSearch` | `search_files` | ✅ 已迁移 | Everything→fd→Node 三级降级 |
| FileOps | `tools/work/FileOps` | `read_file`, `write_file`, `get_file_info`, `list_directory` | ✅ 已迁移 | node:fs 原生 |
| TerminalExecutor | `tools/work/TerminalExecutor` | `terminal_execute` | ✅ 已迁移 | PowerShell/sh 自动选择 |
| CodeSearcher | `tools/work/CodeSearcher` | `code_search` | ✅ 已迁移 | ripgrep JSON 模式 |
| TaskLifecycle | `tools/core/TaskLifecycle` | `finish_task` | ✅ 已迁移 | 纯逻辑 |
| WindowsOps | `tools/core/WindowsOps` | `system_ops` + `desktop_automation` | 🔜 待拆分 | 跨平台化 |
| ScreenVision | `tools/core/ScreenVision` | `take_screenshot` | 🔜 | 需 native addon |
| BrowserOps | `tools/core/BrowserOps` | `browser_*` | 🔜 | 需 playwright |
| Scheduler | `tools/core/Scheduler` | `scheduler` | 🔜 | |
| WorkspaceOps | `tools/work/WorkspaceOps` | `workspace_*` | 🔜 | |
| StrongholdOps | `tools/group/StrongholdOps` | `stronghold_*` | 🔜 | |
| AnimeFinder | `plugins/AnimeFinder` | 用户扩展 | 🔜 | 移至 extensions/ |
| BilibiliFetch | `plugins/BilibiliFetch` | 用户扩展 | 🔜 | 移至 extensions/ |
| social_adapter | `plugins/social_adapter` | **Service** | 🔜 | extensions/social-adapter/ |
| memory_tagger | `mods/memory_tagger` | **Hook** | 🔜 | extensions/memory-tagger/ |

---

## 14. 扩展依赖管理

### 14.1 内置工具

内置工具在 `src/tools/` 中静态导入，通过 `registerBuiltinTools()` 注册到 `ToolRegistry`。
无依赖安装问题。

### 14.2 用户扩展依赖策略

| 策略 | 适用场景 | manifest 字段 |
|---|---|---|
| **预打包 (推荐)** | 成熟扩展、官方发布 | `bundled: true` |
| **声明依赖** | 开发中扩展 | `dependencies: { "axios": "^1" }` |

**预打包**：开发者用 esbuild/rollup 编译为单个 JS 文件。用户下载即用，零依赖安装。

**声明依赖**：ExtensionLoader 发现 `bundled: false` + `dependencies` 不为空时，
自动在扩展目录执行 `npm install --production`，安装完成后才 `import()`。

### 14.3 外部二进制

部分工具依赖外部二进制（ripgrep, Everything, fd 等），通过 `binaries` 字段声明。
`required: false` 表示有降级方案（如 fileSearch 在无 Everything 时回退到 fd 或 Node 搜索）。

---

## 15. 跨平台策略

### 15.1 平台兼容性声明

每个工具通过 `manifest.json` 的 `platforms` 字段声明支持的平台。
ExtensionLoader 在加载时自动检查当前平台，不兼容的工具自动跳过。

### 15.2 WindowsOps 拆分

| 新工具 | 跨平台 | 内容 |
|---|---|---|
| `systemOps` | ✅ 全平台 | 系统信息、打开应用、发送通知 |
| `desktopAutomation` | ⚠️ 需 GUI | 点击/输入/拖拽/窗口管理 |

### 15.3 降级策略

```
完整实现 (Windows + Electron) → 降级 (Linux/macOS) → 最小 (Docker/Server: 返回不支持)
```

---

## 16. 待定事项

- [x] ~~Hook 事件清单~~ → 已定义 12 个
- [x] ~~Tool 的目录组织~~ → 平铺，CapabilityGate 管权限
- [x] ~~扩展依赖管理~~ → bundled + dependencies 双策略
- [ ] Service 的健康检查和自动重启策略 (已有基础实现)
- [ ] 扩展市场 / Workshop 分发机制
- [ ] 扩展之间的依赖关系管理

---

*本文档由 Carola 整理，适用于 PeroCore-TS 扩展系统规范。*
