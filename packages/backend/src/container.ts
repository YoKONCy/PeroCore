/**
 * 依赖注入容器
 *
 * 统一初始化所有基础设施和 Service 实例。
 * Router 通过 AppContext 接口访问 Service (04_BACKEND_ARCHITECTURE.md §5)。
 *
 * B6-5: 完成全部接线，包括:
 * - ExtensionManager → ToolRegistry 桥接
 * - HookEmitter → ToolExecutor 注入
 * - ToolRegistry → AgentService 工具定义获取
 * - TaskManager → AgentService 取消检测
 * - GatewayHub → TaskManager 进度广播
 * - GatewayHub → AgentService 完成通知
 *
 * @module packages/backend/src/container
 */

import path from 'node:path'
import os from 'node:os'
import { createDrizzleConnection, type DrizzleDb } from './database'
import { PathResolver, AssetRegistry, type RuntimeEnv } from './core'
import { getDatabasePath } from './lib/env'
import { createLogger } from './lib/logger'

// ── Repository ──
import { MemoryRepository } from './repositories/memory.repo'
import { VectorRepository } from './repositories/vector.repo'
import { VectorSyncRepository } from './repositories/vectorSync.repo'
import { ConversationLogRepository } from './repositories/conversationLog.repo'
import { ConfigRepository } from './repositories/config.repo'
import { MemoryStoreRegistry } from './repositories/storeRegistry'

// ── Service (Phase 2: Memory 域) ──
import { EmbeddingService, type EmbeddingConfig } from './services/embedding/embeddingService'
import { LlmService } from './services/llm/llmService'
import { ModelRegistry } from './services/llm/modelRegistry'
import { MemoryService } from './services/memory/memoryService'
import { MemorySearchService } from './services/memory/memorySearch'
import { ConversationLogService } from './services/memory/conversationLog'
import { ScorerService } from './services/memory/scorerService'

// ── Service (Phase 3: Agent 域) ──
import { AgentManager } from './services/agent/agentManager'
import { AgentService } from './services/agent/agentService'
import { ToolRegistry } from './services/agent/toolRegistry'
import { RegistryToolExecutor } from './services/agent/toolExecutor'
import { TaskManager } from './services/agent/taskManager'
import { MdpEngine } from './services/prompt/mdpEngine'
import { PromptService } from './services/prompt/promptService'
import { GatewayHub } from './services/gateway/gatewayHub'
import { SessionService } from './services/session/sessionService'
import { DiaryEngine } from './services/memory/diaryEngine'
import { BackgroundScheduler } from './services/scheduler/backgroundScheduler'

// ── Capability Gate (D51) ──
import { CapabilityGate } from './capabilities/capabilityGate'
import { SkillLoader } from './capabilities/skillLoader'

// ── Enrichers ──
import { HistoryEnricher } from './services/pipeline/enrichers/historyEnricher'
import { MemoryEnricher } from './services/pipeline/enrichers/memoryEnricher'
import { StateEnricher } from './services/pipeline/enrichers/stateEnricher'

// ── Shared ──
import { VectorWriteHelper } from './shared/vectorWriteHelper'

// ── Extension System (B6) ──
import { ExtensionManager } from './extensions/extensionManager'
import { registerBuiltinTools } from './tools'

const logger = createLogger('Container')

// ─────────────────────────────────────────────
// 应用配置
// ─────────────────────────────────────────────

/** 应用配置 */
export interface AppConfig {
  /** 数据库文件路径 */
  databasePath: string
  /** 运行时环境 (PathResolver 需要) */
  runtimeEnv: RuntimeEnv
  /** 数据目录 (TriviumDB 存储等) */
  dataDir: string
  /** Embedding 配置 */
  embedding: EmbeddingConfig
}

// ─────────────────────────────────────────────
// 应用上下文 (DI 容器接口)
// ─────────────────────────────────────────────

/**
 * 应用上下文接口
 *
 * 所有 Router 和 Service 通过该接口获取依赖，
 * 禁止全局单例或函数内 import (避免 v1 的循环依赖问题)。
 */
export interface AppContext {
  // ── 基础设施 ──
  db: DrizzleDb
  pathResolver: PathResolver
  assetRegistry: AssetRegistry

  // ── Repository ──
  memoryRepo: MemoryRepository
  vectorRepo: VectorRepository
  vectorSyncRepo: VectorSyncRepository
  logRepo: ConversationLogRepository
  configRepo: ConfigRepository
  storeRegistry: MemoryStoreRegistry

  // ── Service (Memory 域) ──
  embeddingService: EmbeddingService
  llmService: LlmService
  memoryService: MemoryService
  memorySearchService: MemorySearchService
  logService: ConversationLogService
  scorerService: ScorerService
  diaryEngine: DiaryEngine
  modelRegistry: ModelRegistry

  // ── Service (Agent 域) ──
  agentManager: AgentManager
  agentService: AgentService
  promptService: PromptService
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  sessionService: SessionService
  gatewayHub: GatewayHub
  scheduler: BackgroundScheduler

  // ── Capability Gate (D51) ──
  capabilityGate: CapabilityGate
  skillLoader: SkillLoader

  // ── Shared ──
  vectorWriteHelper: VectorWriteHelper

  // ── Extension System (B6) ──
  extensionManager: ExtensionManager
}

// ─────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────

/** 使用默认路径创建应用配置 (11_CROSS_PLATFORM.md §1.4) */
export function createDefaultConfig(): AppConfig {
  const dataDir = process.env.PERO_DATA_DIR ?? path.join(os.homedir(), '.perocore')

  return {
    databasePath: getDatabasePath(),
    dataDir,
    runtimeEnv: {
      appRoot: process.env.PERO_APP_ROOT ?? path.resolve(import.meta.dirname, '..', '..'),
      dataDir,
      tempDir: process.env.PERO_TEMP_DIR ?? path.join(os.tmpdir(), 'PeroCore'),
      workshopDir: process.env.PERO_WORKSHOP_DIR ?? '',
    },
    embedding: {
      apiBase: process.env.PERO_EMBEDDING_API_BASE ?? 'https://api.openai.com/v1',
      apiKey: process.env.PERO_EMBEDDING_API_KEY ?? '',
      model: process.env.PERO_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      dimension: Number(process.env.PERO_EMBEDDING_DIM ?? '1536'),
    },
  }
}

/**
 * 创建应用上下文（DI 容器工厂）
 *
 * 按依赖顺序初始化所有组件：
 * 基础设施 → Repository → Service (Memory) → Service (Agent)
 */
export function createAppContext(config: AppConfig): AppContext {
  logger.info('正在初始化依赖注入容器...')

  // ── 1. 核心基础设施 ──
  const pathResolver = new PathResolver(config.runtimeEnv)
  const assetRegistry = new AssetRegistry(pathResolver)

  // ── 2. 数据库 ──
  const db = createDrizzleConnection(config.databasePath)

  // ── 3. Repository ──
  const memoryRepo = new MemoryRepository(db)
  const vectorSyncRepo = new VectorSyncRepository(db)
  const logRepo = new ConversationLogRepository(db)
  const configRepo = new ConfigRepository(db)
  const storeRegistry = new MemoryStoreRegistry(pathResolver)
  const vectorRepo = new VectorRepository(storeRegistry)

  // ── 4. Shared 工具 ──
  const embeddingService = new EmbeddingService(config.embedding)
  const vectorWriteHelper = new VectorWriteHelper(vectorRepo, vectorSyncRepo, embeddingService)

  // ── 5. Service — Memory 域 ──
  const modelRegistry = new ModelRegistry(db)
  const llmService = new LlmService()
  const memoryService = new MemoryService(memoryRepo, vectorRepo, vectorWriteHelper)
  const memorySearchService = new MemorySearchService(vectorRepo, memoryRepo, embeddingService)
  const logService = new ConversationLogService(logRepo)
  const scorerService = new ScorerService(memoryService, logService, llmService, configRepo, vectorRepo, embeddingService)

  // ── 6. Service — Agent 域 ──
  const gatewayHub = new GatewayHub()
  const taskManager = new TaskManager()
  const sessionService = new SessionService(configRepo, logService)

  // MDP + Prompt
  const agentManager = new AgentManager(pathResolver)
  const promptDir = pathResolver.resolve('@app/packages/backend/src/services/mdp/prompts')
  const mdpEngine = new MdpEngine(promptDir)
  const promptService = new PromptService(mdpEngine, agentManager)

  // Tool Registry + Capability Gate
  const toolRegistry = new ToolRegistry()

  // SkillLoader: 扫描 builtin + custom skills 目录
  const builtinSkillsDir = pathResolver.resolve('@app/packages/backend/src/skills/builtin')
  const customSkillsDir = pathResolver.resolve('@data/skills/custom')
  const skillLoader = new SkillLoader([builtinSkillsDir, customSkillsDir])

  // CapabilityGate: 扫描 agents/*/capabilities.yaml
  const agentBuiltinDir = pathResolver.resolve('@app/packages/backend/src/services/mdp/agents')
  const agentUserDir = pathResolver.resolve('@data/agents')
  const capabilityGate = new CapabilityGate(
    [agentBuiltinDir, agentUserDir],
    skillLoader,
    toolRegistry,
  )

  // ── B6-5: ExtensionManager (hookEmitter 需要后注入) ──
  const extensionManager = new ExtensionManager()

  // ── B6-5: ToolExecutor 接入 hookEmitter (ExtensionManager) ──
  const toolExecutor = new RegistryToolExecutor(
    toolRegistry,
    capabilityGate,
    skillLoader,
    extensionManager, // hookEmitter — ExtensionManager 实现了 emitHook
  )

  // Enrichers
  const enrichers = [
    new HistoryEnricher(logService),
    new MemoryEnricher(memorySearchService),
    new StateEnricher(configRepo),
  ]

  // ── B6-5: TaskManager → GatewayHub 进度广播 ──
  taskManager.setBroadcaster(async (params) => {
    await gatewayHub.pushTaskProgress(params)
  })

  // ── B6-5: AgentService — 完整接线 ──
  const agentService = new AgentService({
    promptService,
    llmService,
    logService,
    configRepo,
    agentManager,
    scorerService,
    enrichers,
    toolExecutor,
    // B6-5: 从 ToolRegistry 获取工具定义 (受 CapabilityGate 过滤)
    getToolDefinitions: (source: string) => {
      return toolRegistry.getDefinitions(source)
    },
    // B6-5: 取消检测 → TaskManager
    cancelChecker: taskManager,
    // B6-5: Gateway 广播
    gatewayBroadcast: async (action: string, payload: Record<string, unknown>) => {
      switch (action) {
        case 'stream_end':
          await gatewayHub.pushStreamEnd(payload.sessionId as string)
          break
        default:
          await gatewayHub.pushNotification({ title: action, body: JSON.stringify(payload) })
      }
    },
  })

  // DiaryEngine (统一日记)
  const diaryEngine = new DiaryEngine(llmService, configRepo)

  // BackgroundScheduler (后台定时任务)
  const scheduler = new BackgroundScheduler()

  // 注册定时任务: Scorer 超时刷新 (30 分钟)
  scheduler.register('scorer-flush', 30 * 60 * 1000, async () => {
    const activeAgent = agentManager.activeAgentId
    await scorerService.processBatch(activeAgent)
  })

  // 注册定时任务: 日记生成 (每 4 小时检查)
  scheduler.register('diary-generate', 4 * 60 * 60 * 1000, async () => {
    // TODO: 实装日记触发逻辑 (收集当日 Scorer 产出 → DiaryEngine.generate)
    logger.debug('日记定时检查 (待实装)')
  })

  // ── B6-5: 启动 GatewayHub 心跳循环 ──
  gatewayHub.startHeartbeat()

  logger.success('依赖注入容器初始化完成 (含 Agent 域 + Scheduler + Extension + Gateway 心跳)')

  return {
    db,
    pathResolver,
    assetRegistry,
    memoryRepo,
    vectorRepo,
    vectorSyncRepo,
    logRepo,
    configRepo,
    storeRegistry,
    embeddingService,
    llmService,
    memoryService,
    memorySearchService,
    logService,
    scorerService,
    diaryEngine,
    modelRegistry,
    agentManager,
    agentService,
    promptService,
    toolRegistry,
    taskManager,
    sessionService,
    gatewayHub,
    scheduler,
    capabilityGate,
    skillLoader,
    vectorWriteHelper,
    extensionManager,
  }
}

/**
 * 异步初始化 (在 createAppContext 返回后调用)
 *
 * 执行需要 await 的初始化操作:
 * 1. 注册内置工具到 ToolRegistry
 * 2. 加载用户扩展 (ExtensionManager.loadAll)
 * 3. 同步 ExtensionManager Tool → ToolRegistry
 * 4. 扫描资产 (AssetRegistry)
 */
export async function initAppContext(ctx: AppContext): Promise<void> {
  // 1. 注册内置工具 (静态 import, 编译时确定)
  await registerBuiltinTools(ctx.toolRegistry)

  // 2. 加载用户扩展 (动态扫描目录)
  const userExtDir = ctx.pathResolver.resolve('@data/extensions')
  const builtinToolsDir = ctx.pathResolver.resolve('@app/packages/backend/src/tools')
  try {
    await ctx.extensionManager.loadAll({
      builtinToolsDir,
      userExtensionsDir: userExtDir,
    })
  } catch (err) {
    logger.warn(`加载扩展时出现非致命错误: ${err}`)
  }

  // 3. 同步 ExtensionManager 中用户扩展 Tool → ToolRegistry
  ctx.toolRegistry.syncFromExtensionManager(ctx.extensionManager)

  // 4. 扫描资产目录 (B6-5)
  try {
    await ctx.assetRegistry.scanAll()
  } catch (err) {
    logger.warn(`资产扫描出错 (非致命): ${err}`)
  }

  logger.info(`工具系统初始化完成: ${ctx.toolRegistry.size} 个工具已注册`)
}
