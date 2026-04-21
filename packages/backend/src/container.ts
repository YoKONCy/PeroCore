/**
 * 依赖注入容器
 *
 * 统一初始化所有基础设施和 Service 实例。
 * Router 通过 AppContext 接口访问 Service。
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
import { PathResolver, AssetRegistry, PromptTemplateLoader, type RuntimeEnv } from './core'
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
import { ModelRepository } from './repositories/model.repo'
import { ModelService } from './services/model/modelService'
import { MemoryService } from './services/memory/memoryService'
import { MemorySearchService } from './services/memory/memorySearch'
import { ConversationLogService } from './services/memory/conversationLog'
import { ScorerService } from './services/memory/scorerService'
import { GraphGardener } from './services/memory/maintenance/graphGardener'
import { Tagger } from './services/memory/maintenance/tagger'
import { Consolidator } from './services/memory/maintenance/consolidator'
import { Auditor } from './services/memory/maintenance/auditor'
import { RetirementPolicy } from './services/memory/maintenance/retirementPolicy'
import { ReflectionOrchestrator } from './services/memory/maintenance/reflectionOrchestrator'
import { SocialScorerService } from './services/memory/socialScorer'
import { WaifuTextUpdater } from './services/agent/waifuTextUpdater'

// ── Service (Phase 3: Agent 域) ──
import { AgentManager } from './services/agent/agentManager'
import { AgentService } from './services/agent/agentService'
import { ToolRegistry } from './services/agent/toolRegistry'
import { RegistryToolExecutor } from './services/agent/toolExecutor'
import { TaskManager } from './services/agent/taskManager'
import { MdpEngine } from './services/prompt/mdpEngine'
import { PromptService } from './services/prompt/promptService'
import { PresetLoader } from './services/prompt/presetLoader'
import { ModelRoleResolver } from './services/llm/modelRoles'
import { GatewayHub } from './services/gateway/gatewayHub'
import { SessionService } from './services/session/sessionService'
import { DiaryEngine } from './services/memory/diaryEngine'
import { MemoryImporter } from './services/memory/importer'
import { DreamAssociator } from './services/memory/maintenance/dreamAssociator'
import { BackgroundScheduler } from './services/scheduler/backgroundScheduler'
import { SchedulerService } from './services/scheduler/schedulerService'

// ── Capability Gate (D51) ──
import { CapabilityGate } from './capabilities/capabilityGate'
import { SkillLoader } from './capabilities/skillLoader'

// ── Enrichers ──
import { HistoryEnricher } from './services/pipeline/enrichers/historyEnricher'
import { MemoryEnricher } from './services/pipeline/enrichers/memoryEnricher'
import { StateEnricher } from './services/pipeline/enrichers/stateEnricher'
import { SocialEnricher } from './services/pipeline/enrichers/socialEnricher'

// ── Shared ──
import { VectorWriteHelper } from './shared/vectorWriteHelper'

// ── Extension System (B6) ──
import { ExtensionManager } from './extensions/extensionManager'
import { registerBuiltinTools } from './tools'
import { injectSchedulerService } from './tools/scheduler'
import { runCleanup, runLonelyScan } from './lifecycle/cron'
import { McpClientManager, bridgeMcpTools } from './services/mcp'
import { McpConfigRepository } from './repositories/mcp.repo'
import { StrongholdService } from './services/stronghold/strongholdService'
import { GroupChatService } from './services/stronghold/groupChatService'
import { GroupChatDispatcher } from './services/stronghold/groupChatDispatcher'
import { CompanionScheduler } from './services/companion/companionScheduler'
import { createEnvelope } from './services/gateway/types'
import { SocialBridge } from './services/social/socialBridge'
import { NapcatAdapter } from './extensions/adapters/napcat'
import { SocialMessageRepository } from './repositories/socialMessage.repo'

// ── Platform Providers — 工具注入 (仅桌面环境) ──
import { createDesktopProviders } from './providers/platformProviders'
import { injectScreenshotProvider } from './tools/screenVision'
import { injectWindowProvider } from './tools/systemInfo'
import { injectDesktopAutomationProvider } from './tools/desktopAutomation'
import { injectSocialMessagingProvider } from './tools/socialOps'
import { injectStrongholdService } from './tools/strongholdOps'
import { injectFinishTaskDeps } from './tools/finishTask'
import { PetStateService } from './services/agent/petStateService'

// ── Service (Voice 域) ──
import { TtsService } from './services/voice/ttsService'
import { AsrService } from './services/voice/asrService'
import { RealtimeSessionManager } from './services/voice/realtimeSessionManager'

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
 * 禁止全局单例或函数内 import (避免循环依赖问题)。
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
  memoryImporter: MemoryImporter
  diaryEngine: DiaryEngine
  modelRegistry: ModelRegistry
  modelService: ModelService

  // ── Service (Agent 域) ──
  agentManager: AgentManager
  agentService: AgentService
  promptService: PromptService
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  sessionService: SessionService
  gatewayHub: GatewayHub
  scheduler: BackgroundScheduler
  schedulerService: SchedulerService

  // ── Capability Gate (D51) ──
  capabilityGate: CapabilityGate
  skillLoader: SkillLoader

  // ── Shared ──
  vectorWriteHelper: VectorWriteHelper

  // ── Extension System (B6) ──
  extensionManager: ExtensionManager

  // ── MCP ──
  mcpManager: McpClientManager
  mcpRepo: McpConfigRepository

  // ── 资产/提示词触达 ──
  promptTemplateLoader: PromptTemplateLoader

  // ── 据点/群聊 ──
  strongholdService: StrongholdService
  groupChatService: GroupChatService
  groupChatDispatcher: GroupChatDispatcher

  // ── 社交模式 ──
  socialBridge: SocialBridge

  // ── 语音服务 ──
  ttsService: TtsService
  asrService: AsrService
  realtimeSessionManager: RealtimeSessionManager
}

// ─────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────

/** 使用默认路径创建应用配置 */
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
      // Reranker (可选 — 无 apiKey 时自动降级)
      reranker: {
        apiBase: process.env.PERO_RERANKER_API_BASE ?? 'https://api.cohere.ai/v2',
        apiKey: process.env.PERO_RERANKER_API_KEY ?? '',
        model: process.env.PERO_RERANKER_MODEL ?? 'rerank-v3.5',
        defaultTopK: Number(process.env.PERO_RERANKER_TOP_K ?? '5'),
      },
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

  // ── 5. MDP 引擎 (后台任务和 Agent 域都依赖) ──
  const promptDir = pathResolver.resolve('@app/backend/src/services/mdp/prompts')
  const mdpEngine = new MdpEngine(promptDir)

  // ── 6. Service — Memory 域 ──
  const modelRegistry = new ModelRegistry(db)
  const modelRepo = new ModelRepository(db)
  const llmService = new LlmService()
  const modelService = new ModelService(modelRepo, llmService, modelRegistry)
  const modelRoles = new ModelRoleResolver(configRepo)
  const memoryService = new MemoryService(memoryRepo, vectorRepo, vectorWriteHelper)
  const memorySearchService = new MemorySearchService(vectorRepo, memoryRepo, embeddingService)
  const logService = new ConversationLogService(logRepo)
  const scorerService = new ScorerService(
    memoryService,
    logService,
    llmService,
    modelRoles.bind('secretary'),
    mdpEngine,
    vectorRepo,
    embeddingService,
  )
  const graphGardener = new GraphGardener({
    memoryRepo,
    vectorRepo,
    vectorWriteHelper,
    llmService,
    mdpEngine,
    getModelConfig: modelRoles.bind('reflection'),
  })
  const socialScorerService = new SocialScorerService(
    new SocialMessageRepository(db),
    storeRegistry,
    llmService,
    modelRoles.bind('reflection'),
    mdpEngine,
  )
  const memoryImporter = new MemoryImporter(
    memoryService,
    llmService,
    modelRoles.bind('secretary'),
    mdpEngine,
  )

  // ── 6.5 Reflection 子系统 ──
  const tagger = new Tagger(
    memoryRepo,
    vectorWriteHelper,
    llmService,
    modelRoles.bind('reflection'),
    mdpEngine,
  )
  const consolidator = new Consolidator({
    memoryRepo,
    vectorRepo,
    vectorWriteHelper,
    llmService,
    getModelConfig: modelRoles.bind('reflection'),
    mdpEngine,
  })
  const auditor = new Auditor({
    memoryRepo,
    vectorWriteHelper,
    llmService,
    getModelConfig: modelRoles.bind('reflection'),
    mdpEngine,
  })
  const retirementPolicy = new RetirementPolicy(memoryRepo, vectorWriteHelper)

  // ── 7. Service — Agent 域 ──
  const gatewayHub = new GatewayHub()
  const taskManager = new TaskManager()
  const sessionService = new SessionService(configRepo, logService)

  // Prompt
  const agentManager = new AgentManager(pathResolver, configRepo)
  const presetsDir = pathResolver.resolve('@app/backend/src/services/mdp/presets')
  const presetLoader = new PresetLoader(presetsDir)
  const promptService = new PromptService(mdpEngine, agentManager, presetLoader)

  // Tool Registry + Capability Gate
  const toolRegistry = new ToolRegistry()

  // SkillLoader: 扫描 builtin + custom skills 目录
  const builtinSkillsDir = pathResolver.resolve('@app/backend/src/skills/builtin')
  const customSkillsDir = pathResolver.resolve('@data/skills/custom')
  const skillLoader = new SkillLoader([builtinSkillsDir, customSkillsDir])

  // CapabilityGate: 扫描 agents/*/capabilities.yaml
  const agentBuiltinDir = pathResolver.resolve('@app/backend/src/services/mdp/agents')
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
  const socialMessageRepo = new SocialMessageRepository(db)
  const enrichers = [
    new HistoryEnricher(logService),
    new MemoryEnricher(memorySearchService, memoryService, embeddingService),
    new StateEnricher(configRepo),
    new SocialEnricher(socialMessageRepo, storeRegistry),
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

  // DiaryEngine (统一日记 → 主模型)
  const diaryEngine = new DiaryEngine(llmService, modelRoles.bind('main'), mdpEngine)

  // BackgroundScheduler (后台定时任务)
  const scheduler = new BackgroundScheduler()

  // 注册定时任务: Scorer 超时刷新 (30 分钟)
  scheduler.register('scorer-flush', 30 * 60 * 1000, async () => {
    const activeAgent = agentManager.activeAgentId
    await scorerService.processBatch(activeAgent)
  })

  // 注册定时任务: 日记生成 (每 4 小时检查, P2-8)
  scheduler.register('diary-generate', 4 * 60 * 60 * 1000, async () => {
    const activeAgent = agentManager.activeAgentId
    const agent = agentManager.getAgent(activeAgent)
    if (!agent) return

    // 收集当日 Scorer 已处理的记忆作为摘要输入
    const { data: recentMemories } = await memoryRepo.list({
      agentId: activeAgent,
      page: 1,
      pageSize: 50,
    })

    // 仅取今天的记忆
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()
    const todaySummaries = recentMemories
      .filter((m) => m.timestamp >= todayMs)
      .map((m) => m.content)

    if (todaySummaries.length === 0) {
      logger.debug('日记定时检查: 今日无新记忆，跳过')
      return
    }

    try {
      const entry = await diaryEngine.generate({
        summaries: todaySummaries,
        agentId: activeAgent,
        agentName: agent.name,
        profile: 'default',
      })
      if (entry) {
        logger.info(
          `日记生成完成: agent=${activeAgent}, mood=${entry.mood}, highlights=${entry.highlights.length}`,
        )
      }
    } catch (err) {
      logger.warn(`日记生成失败: ${err}`)
    }
  })

  // ── 用户提醒系统 ──
  const schedulerService = new SchedulerService(db, gatewayHub)

  // 注册定时任务: 提醒触发检查 (每 30 秒)
  scheduler.register('trigger-check', 30 * 1000, async () => {
    const activeAgent = agentManager.activeAgentId
    const results = await schedulerService.checkDueTasks(activeAgent)
    for (const result of results) {
      // 通过 Gateway 广播触发提醒 (前端收到后显示通知 + 播放 Agent 语音)
      await gatewayHub.pushNotification({
        title: `提醒触发 (${result.type})`,
        body: result.instruction,
      })
      logger.info(`到期任务已广播: ${result.type} (${result.tasks.length} 项)`)
    }
  })

  // 注册定时任务: 临时文件清理 (每小时)
  scheduler.register('cleanup', 60 * 60 * 1000, async () => {
    const tempDir = pathResolver.resolve('@temp')
    await runCleanup(tempDir)
  })

  // 注册定时任务: 梦境 + 图谱 + 标注 + 整合 + 审计 + 退役 (统一由 ReflectionOrchestrator 编排)
  const dreamAssociator = new DreamAssociator({
    memorySearch: memorySearchService,
    vectorRepo,
    memoryRepo,
    llmService,
    getModelConfig: modelRoles.bind('reflection'),
    mdpEngine,
  })
  const waifuTextUpdater = new WaifuTextUpdater({
    llmService,
    getModelConfig: modelRoles.bind('reflection'),
    mdpEngine,
    configRepo,
    agentManager,
    memoryRepo,
  })
  const reflectionOrchestrator = new ReflectionOrchestrator({
    tagger,
    consolidator,
    auditor,
    retirementPolicy,
    dreamAssociator,
    graphGardener,
    waifuTextUpdater,
    memoryRepo,
    gateway: gatewayHub,
  })

  // Reflection 统一定时任务 (6h 间隔, Orchestrator 内置频率限制 + 降本决策)
  scheduler.register('reflection', 6 * 60 * 60 * 1000, async () => {
    const agentId = agentManager.activeAgentId
    if (!agentId) return
    try {
      const result = await reflectionOrchestrator.run([agentId])
      if (result.agents.length > 0) {
        const a = result.agents[0]!
        logger.info(
          `Reflection 完成: 标${a.tagged} 合${a.consolidated} 审${a.audited} ` +
            `退${a.retired} 梦${a.dreamLinked} 图${a.graphEdges} 词${a.waifuTextsUpdated} (${result.totalDurationMs}ms)`,
        )
      }
    } catch (err) {
      logger.error(`Reflection 失败: ${err}`)
    }
  })

  // 注册定时任务: 孤独记忆扫描 (每小时, 低成本, 独立于 Reflection)
  scheduler.register('lonely-scan', 60 * 60 * 1000, async () => {
    await runLonelyScan({
      memoryRepo,
      activeAgentId: agentManager.activeAgentId,
    })
  })

  // 注册定时任务: 社交记忆炼化 (每 5 分钟检查动态门控)
  scheduler.register('social-scorer', 5 * 60 * 1000, async () => {
    const agentId = agentManager.activeAgentId
    if (!agentId) return
    try {
      await socialScorerService.checkAndProcess(agentId)
    } catch (err) {
      logger.error(`社交记忆炼化失败: ${err}`)
    }
  })

  // 注册定时任务: 社交日报 (每 6 小时, D56 DiaryEngine 统一化)
  scheduler.register('social-diary', 6 * 60 * 60 * 1000, async () => {
    const agentId = agentManager.activeAgentId
    if (!agentId) return
    const agent = agentManager.getAgent(agentId)
    if (!agent) return

    try {
      // 从 social.tdb 收集当日事件摘要
      const socialStore = storeRegistry.getAgentStore(agentId, 'social')
      if (socialStore.nodeCount() === 0) return

      const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
      const allIds = socialStore.allNodeIds()
      const todaySummaries: string[] = []

      for (const id of allIds) {
        const node = socialStore.get(id)
        if (!node) continue
        const payload = node.payload as Record<string, unknown>
        if (payload?.type !== 'event') continue
        const ts = (payload?.timestamp as number) ?? 0
        if (ts >= todayStart) {
          todaySummaries.push((payload?.content as string) ?? '')
        }
      }

      if (todaySummaries.length === 0) {
        logger.debug('社交日报: 今日无新事件，跳过')
        return
      }

      const entry = await diaryEngine.generate({
        summaries: todaySummaries,
        agentId,
        agentName: agent.name,
        profile: 'social',
      })

      if (entry) {
        logger.info(
          `社交日报生成完成: agent=${agentId}, events=${todaySummaries.length}, ` +
            `mood=${entry.mood}, highlights=${entry.highlights.length}`,
        )
        // TODO: 写入 diary.tdb (待 DiaryEngine 持久化层实装)
      }
    } catch (err) {
      logger.warn(`社交日报生成失败: ${err}`)
    }
  })

  // ── B6-5: 启动 GatewayHub 心跳循环 ──
  gatewayHub.startHeartbeat()

  // ── 语音服务 (单实例复用，供 RealtimeSessionManager 共享) ──
  const ttsService = new TtsService()
  const asrService = new AsrService()

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
    memoryImporter,
    diaryEngine,
    modelRegistry,
    modelService,
    agentManager,
    agentService,
    promptService,
    toolRegistry,
    taskManager,
    sessionService,
    gatewayHub,
    scheduler,
    schedulerService,
    capabilityGate,
    skillLoader,
    vectorWriteHelper,
    extensionManager,
    mcpManager: new McpClientManager(new McpConfigRepository(db)),
    mcpRepo: new McpConfigRepository(db),
    promptTemplateLoader: new PromptTemplateLoader(pathResolver),
    strongholdService: new StrongholdService(db),
    groupChatService: new GroupChatService(db),
    groupChatDispatcher: new GroupChatDispatcher(new GroupChatService(db)),

    // ── 社交桥接 ──
    socialBridge: new SocialBridge({
      agentService,
      gatewayHub,
      llmService,
      getThinkingModel: modelRoles.bind('secretary'),
      socialMessageRepo,
      mdpEngine,
    }),

    // ── 语音服务 ──
    ttsService,
    asrService,
    realtimeSessionManager: new RealtimeSessionManager({
      ttsService,
      asrService,
      agentService,
      gatewayHub,
      sessionService,
    }),
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

  // 1.1 绑定 run_script 工具的内部执行器 (需要在注册后绑定，因为要访问已注册的工具)
  const { runScriptTool } = await import('./tools/runScript')
  runScriptTool.bindToolExecutor!(async (name, args, source) => {
    const handler = ctx.toolRegistry.getHandler(name)
    if (!handler) return JSON.stringify({ error: `工具 ${name} 未注册` })
    return handler(args, {
      agentId: ctx.agentManager.activeAgentId ?? 'unknown',
      sessionId: 'nit-script',
      source,
    })
  })

  // 1.5 注入 SchedulerService 到 Scheduler 工具 (避免循环依赖)
  injectSchedulerService(ctx.schedulerService)

  // 1.5.1 注入 PetStateService 到 finishTask 工具 (角色状态更新)
  const petStateService = new PetStateService(ctx.db)
  injectFinishTaskDeps({
    petStateUpdater: petStateService,
    gatewayBroadcast: async (action, payload) => {
      ctx.gatewayHub.broadcast(createEnvelope('push', { action, ...payload }, 'broadcast'))
    },
  })
  logger.info('finishTask 角色状态更新已注入 (PetStateService + Gateway)')

  // 1.6 注入平台 Provider (仅桌面环境，Docker/无头跳过)
  if (!process.env.PERO_DOCKER) {
    const providers = await createDesktopProviders()
    if (providers) {
      injectScreenshotProvider(providers.screenshot)
      injectWindowProvider(providers.window)
      injectDesktopAutomationProvider(providers.automation)
      logger.info('桌面 Provider 已注入 (nut-js): 截图 + 窗口管理 + 桌面自动化')
    } else {
      logger.info('nut-js 不可用，桌面 GUI 工具已禁用 (截图/窗口/自动化)')
    }
  } else {
    logger.info('Docker 环境检测，跳过桌面 Provider 注入')
  }

  // 1.7 注入社交工具 Provider (当有适配器已注册时)
  if (ctx.socialBridge.hasActiveAdapter()) {
    const socialProvider = ctx.socialBridge.createMessagingProvider()
    if (socialProvider) {
      injectSocialMessagingProvider(socialProvider)
      logger.info(`社交工具 Provider 已注入 (平台: ${socialProvider.platform})`)
    }
  } else {
    logger.info('无活跃社交适配器，社交工具将返回「服务未初始化」错误')
  }

  // 1.8 注入据点服务到工具层 (始终可用，群聊模式由 CapabilityGate 门控)
  injectStrongholdService(ctx.strongholdService)
  logger.info('据点工具已注入 (StrongholdService)')

  // 2. 加载用户扩展 (动态扫描目录)
  const userExtDir = ctx.pathResolver.resolve('@data/extensions')
  const builtinToolsDir = ctx.pathResolver.resolve('@app/backend/src/tools')
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

  // 4.5 从 SQLite 加载 Agent 运行时覆盖值 (social.enabled / social.qq_id)
  try {
    await ctx.agentManager.applyAllOverrides()
  } catch (err) {
    logger.warn(`Agent 运行时覆盖加载出错 (非致命): ${err}`)
  }

  // 5. 连接 MCP 服务器 + 桥接工具到 ToolRegistry
  try {
    await ctx.mcpManager.connectAll()
    const mcpTools = ctx.mcpManager.getAllTools()
    if (mcpTools.length > 0) {
      const bridged = bridgeMcpTools(ctx.mcpManager, mcpTools)
      for (const tool of bridged) {
        ctx.toolRegistry.register(tool.definition, (args, _ctx) => tool.execute(args, _ctx))
      }
      logger.info(`MCP 工具桥接完成: ${mcpTools.length} 个工具已注册`)
    }
  } catch (err) {
    logger.warn(`MCP 连接出错 (非致命): ${err}`)
  }

  // 6. 注入陪伴调度器工厂到 SessionService
  ctx.sessionService.setCompanionSchedulerFactory((agentId: string) => {
    return new CompanionScheduler({
      agentId,
      onProactiveChat: async (params) => {
        // 通过 AgentService 生成主动对话
        const reply = await ctx.agentService.chat({
          agentId: params.agentId,
          source: 'desktop',
          sessionId: `companion_${params.agentId}`,
          messages: [
            { role: 'system', content: `触发指令: ${params.trigger}` },
            {
              role: 'user',
              content: `(系统触发: 当前时段=${params.timeSlot}，请根据触发指令主动发起对话)`,
            },
          ],
        })
        return reply || null
      },
      onPushMessage: async (params) => {
        // 通过 GatewayHub 推送到前端
        await ctx.gatewayHub.broadcast(
          createEnvelope('push', {
            action: 'proactive_message',
            content: params.content,
            agentId: params.agentId,
            timeSlot: params.timeSlot,
          }),
        )
      },
      onSummarize: async (_agentId) => {
        // 停止时通过 DiaryEngine 生成陪伴期间的日记总结
        logger.info(`陪伴模式结束，日记总结待实现: agent=${_agentId}`)
        // TODO: 调用 diaryEngine.generate() 收集陪伴期间的对话摘要
      },
    })
  })
  logger.info('陪伴调度器工厂已注入 SessionService')

  // 7. 据点系统初始化
  try {
    await ctx.strongholdService.ensureDefaults()
  } catch (err) {
    logger.warn(`据点初始化出错 (非致命): ${err}`)
  }

  // 8. 社交模式初始化
  try {
    // 从配置读取 QQ→Agent 映射
    const socialConfigRaw = await ctx.configRepo.get('social')
    const socialConfig = socialConfigRaw
      ? ((typeof socialConfigRaw === 'string'
          ? JSON.parse(socialConfigRaw)
          : socialConfigRaw) as Record<string, unknown>)
      : null
    const qqAgentMap: Record<string, string> = {}

    if (socialConfig && typeof socialConfig === 'object') {
      const bindings = socialConfig.bindings as Record<string, unknown>[] | undefined
      if (Array.isArray(bindings)) {
        for (const binding of bindings) {
          if (binding.adapter === 'napcat' && binding.accountId && binding.agentId) {
            qqAgentMap[String(binding.accountId)] = String(binding.agentId)
          }
        }
      }
    }

    // 创建并注册 NapCat 适配器
    const napcatAdapter = new NapcatAdapter({
      qqAgentMap,
      defaultAgentId: 'pero',
      autoAcceptFriend: true,
    })
    ctx.socialBridge.registerAdapter(napcatAdapter)

    // 启动桥接 (适配器等待反向 WS 连接)
    await ctx.socialBridge.start()
    logger.info('社交模式已初始化 (等待 NapCat 连接)')
  } catch (err) {
    logger.warn(`社交模式初始化出错 (非致命): ${err}`)
  }
}
