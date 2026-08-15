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
 * - RuntimeStateService → AgentService 取消检测（替代旧 TaskManager）
 * - GatewayHub → RuntimeStateService 进度广播
 * - GatewayHub → AgentService 完成通知
 *
 * @module packages/backend/src/container
 */

import path from 'node:path'
import os from 'node:os'
import { createDrizzleConnection, type DrizzleDb } from './database'
import { MigrationManager, dataMigrations } from './migrations'
import { PathResolver, AssetRegistry, PromptTemplateLoader, type RuntimeEnv } from './core'
import { getDataDir, getDatabasePath, getWorkshopDirs } from './lib/env'
import { createLogger } from './lib/logger'

// ── Repository ──
import { MemoryRepository } from './repositories/memory.repo'
import { VectorRepository } from './repositories/vector.repo'
import { VectorSyncRepository } from './repositories/vectorSync.repo'
// AIOS: ConversationLogRepository 已移除（废弃，Scorer 改用 ThreadRepository）
import { ConfigRepository } from './repositories/config.repo'
import { MemoryStoreRegistry } from './repositories/storeRegistry'
import { FileSnapshotRepository } from './repositories/fileSnapshot.repo'
import { FlowStateRepository } from './repositories/flowState.repo'
import { ThreadRepository } from './repositories/thread.repo'
import { BackgroundTaskRepository } from './repositories/backgroundTask.repo'
import { ToolApprovalRepository } from './repositories/toolApproval.repo'
import { AttachmentRepository } from './repositories/attachment.repo'
// 第五阶段长记忆 Repositories
import { CanonicalMemoryRepository } from './repositories/canonicalMemory.repo'
import { MemoryCandidateRepository } from './repositories/memoryCandidate.repo'

// ── Service (Phase 2: Memory 域) ──
import { EmbeddingService, type EmbeddingConfig } from './services/embedding/embeddingService'
import { LlmService } from './services/llm/llmService'
import { ModelRegistry } from './services/llm/modelRegistry'
import { ModelRepository } from './repositories/model.repo'
import { ModelService } from './services/model/modelService'
import { MemoryService } from './services/memory/memoryService'
import { MemorySearchService } from './services/memory/memorySearch'
// AIOS: ConversationLogService 已移除（废弃，Scorer 改用 ThreadRepository）
import { ScorerService } from './services/memory/scorerService'
import { loadMemoryRuntimeConfig } from './services/memory/memoryRuntimeConfig'
// 第五阶段长记忆 Provider/Gate/TaskRunner
import { MemoryGate } from './services/memory/memoryGate'
import { LocalMemoryProvider } from './services/memory/localMemoryProvider'
import { LocalMemoryTaskRunner } from './services/memory/localMemoryTaskRunner'
import type { MemoryProvider } from './services/memory/memoryProvider'
import type { MemoryTaskRunner } from './services/memory/memoryTaskRunner'
import { GraphGardener } from './services/memory/maintenance/graphGardener'
import { Tagger } from './services/memory/maintenance/tagger'
import { Consolidator } from './services/memory/maintenance/consolidator'
import { Auditor } from './services/memory/maintenance/auditor'
import { RetirementPolicy } from './services/memory/maintenance/retirementPolicy'
import { ReflectionOrchestrator } from './services/memory/maintenance/reflectionOrchestrator'
import { MaintenanceService } from './services/memory/maintenance/maintenanceService'
import { ResetService } from './services/maintenance/resetService'
// 注意：SocialScorerService 已迁移到 packages/apps/social/runtime/socialScorer.ts
import { WaifuTextUpdater } from './services/agent/waifuTextUpdater'

// ── Service (Phase 3: Agent 域) ──
import { FlowStateService } from './services/flow/flowStateService'
import { AgentManager } from './services/agent/agentManager'
import { AgentService } from './services/agent/agentService'
// AIOS: ChatResetService 已废弃，不再实例化（文件已备份为 .bak）
// AIOS: PromptService / PresetLoader 已废弃，不再实例化（文件已备份为 .bak）
import { ToolRegistry } from './services/agent/toolRegistry'
import { RegistryToolExecutor } from './services/agent/toolExecutor'
import { isSystemProtocolTool } from './tools/systemProtocolTools'
// AIOS: TaskManager 已移除（被 RuntimeStateService 替代，零调用方）
import { RuntimeStateService } from './services/runtime/runtimeStateService'
import { MdpEngine } from './services/prompt/mdpEngine'
import { ModelRoleResolver } from './services/llm/modelRoles'
import { GatewayHub } from './services/gateway/gatewayHub'
import { CompanionSchedulerService } from './services/companion/companionSchedulerService'

// ── Service (AIOS: Thread + Context 域) ──
import { ThreadService } from './services/thread/threadService'
import { BackgroundTaskService } from './services/task/backgroundTaskService'
import { ContextCompiler } from './services/context/contextCompiler'
import { ConversationTurnService } from './services/conversation/conversationTurnService'
import { AttachmentService } from './services/attachment/attachmentService'
import { ImageUnderstandingService } from './services/attachment/imageUnderstandingService'
import { DiaryEngine } from './services/memory/diaryEngine'
import { MemoryImporter } from './services/memory/importer'
import { DreamAssociator } from './services/memory/maintenance/dreamAssociator'
import { BackgroundScheduler } from './services/scheduler/backgroundScheduler'
import { SchedulerService } from './services/scheduler/schedulerService'

// ── Capability Gate (D51) ──
import { CapabilityGate } from './capabilities/capabilityGate'
import { SkillLoader } from './capabilities/skillLoader'
// 第七阶段：节点能力注册表（Daemon 独立）
import { CapabilityRegistry } from './capabilities/capabilityRegistry'
import { CapabilityBridge } from './capabilities/capabilityBridge'
import { NodeCapabilityRepository } from './repositories/nodeCapability.repo'
import { InboundRouteRepository } from './repositories/inboundRoute.repo'

// AIOS: 旧版 Enricher 已由 ContextCompiler 替代，文件已备份为 .bak（ingress/egress/synthesis/enrichers）
// 仅保留 pipeline/types.ts（定义 ToolDefinition 等核心类型，被 agentService/toolRegistry 等引用）

// ── Shared ──
import { VectorWriteHelper } from './shared/vectorWriteHelper'

// ── Extension System (B6) ──
import { ExtensionManager } from './extensions/extensionManager'
import {
  registerBuiltinTools,
  setWorkspaceService,
  setWorkspaceCheckpointService,
  setWorkspaceProductivityCheckpointService,
  setSharedWorkspaceService,
  setCapabilityGate,
  setFlowStateService,
  setAppInteractionManager,
} from './tools'
import { setSchedulerService } from './tools/scheduler'
import { setDiarySearchDeps } from './tools/diarySearch'
// AIOS(Phase4): WorkspaceService（Principal Workspace 文件操作 + containment 检查）
import { WorkspaceCheckpointService } from './services/workspace/workspaceCheckpointService'
import { LocalWorkspaceService } from './services/workspace/workspaceService'
import { ExecutionSessionManager } from './services/execution/executionSession'
import { LocalPolicyRunner } from './services/execution/sandboxRunner'
import { TerminalManager } from './services/execution/terminalManager'
import { VirtualWorkspace } from './services/execution/virtualWorkspace'
import { ApprovalService } from './services/execution/approvalService'
import { PolicyEngine } from './services/execution/policyEngine'
import { setProductivityRuntime } from './tools/productivityRuntimeHolder'
import { runCleanup, runLonelyScan } from './lifecycle/cron'
import { McpClientManager, bridgeMcpTools } from './services/mcp'
import { McpConfigRepository } from './repositories/mcp.repo'
import { StrongholdService } from './services/stronghold/strongholdService'
import { ButlerService } from './services/stronghold/butlerService'
import { GroupChatService } from './services/stronghold/groupChatService'
import { GroupChatDispatcher } from './services/stronghold/groupChatDispatcher'
import { CompanionScheduler } from './services/companion/companionScheduler'
import { createEnvelope } from './services/gateway/types'
// 注意：社交系统（SocialBridge/ImageCacheManager/StickerService/NapcatAdapter/SocialMessageRepository）
// 已迁移到 packages/apps/social/，由 SocialAppRuntime 独立管理

// ── Platform Providers — 工具注入 (仅桌面环境) ──
import { createDesktopProviders } from './providers/platformProviders'
import { setScreenshotProvider } from './tools/screenVision'
import { setWindowProvider } from './tools/systemInfo'
import { setDesktopAutomationProvider } from './tools/desktopAutomation'
import { setButlerService, setStrongholdService } from './tools/strongholdOps'
import { setFinishTaskDeps } from './tools/finishTask'
import { PetStateService } from './services/agent/petStateService'

// ── Service (Voice 域) ──
import { TtsService } from './services/voice/ttsService'
import { AsrService } from './services/voice/asrService'
import { RealtimeSessionManager } from './services/voice/realtimeSessionManager'

// ── Service (System 域) ──
import { SystemService } from './services/system/systemService'

// ── AIOS 第八阶段：Agent 应用层（系统 + 独立应用） ──
import { SqliteGrantRegistry, type GrantRegistry } from './applications/grantRegistry'
import { AppManagerImpl, type AppManager } from './applications/appManager'
// 内置社交应用 runtime factory 通过动态 import 延迟加载（避免 tsconfig 路径冲突）

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
  // AIOS: logRepo 已移除（ConversationLog 废弃，Scorer 改用 ThreadRepository）
  configRepo: ConfigRepository
  storeRegistry: MemoryStoreRegistry
  threadRepo: ThreadRepository
  attachmentRepo: AttachmentRepository
  /** M05: 后台任务 Repository（持久实体访问） */
  backgroundTaskRepo: BackgroundTaskRepository
  toolApprovalRepo: ToolApprovalRepository
  // 第五阶段长记忆 Repositories
  canonicalMemoryRepo: CanonicalMemoryRepository
  memoryCandidateRepo: MemoryCandidateRepository

  // ── Service (Memory 域) ──
  embeddingService: EmbeddingService
  llmService: LlmService
  memoryService: MemoryService
  memorySearchService: MemorySearchService
  // AIOS: logService 已移除（ConversationLogService 废弃，Scorer 改用 ThreadRepository）
  scorerService: ScorerService
  memoryImporter: MemoryImporter
  diaryEngine: DiaryEngine
  maintenanceService: MaintenanceService
  /** 危险区域重置服务（清空对话/记忆/恢复出厂）。 */
  resetService: ResetService
  modelRegistry: ModelRegistry
  modelService: ModelService
  // 第五阶段长记忆 Provider/Gate/TaskRunner
  memoryProvider: MemoryProvider
  memoryGate: MemoryGate
  memoryTaskRunner: MemoryTaskRunner

  // ── Service (Agent 域) ──
  agentManager: AgentManager
  petStateService: PetStateService
  agentService: AgentService
  // AIOS: promptService 已移除（死代码，零调用方）
  toolRegistry: ToolRegistry
  /**
   * 第六阶段 #7: 工具执行器（暴露给 run_script 内部闭包统一鉴权）
   *
   * 之前 run_script 的 _toolExecutor 闭包直接调用 ToolRegistry.getHandler，
   * 跳过了 CapabilityGate 鉴权与 ResourceScope 路径校验。
   * 第六阶段改为统一走 RegistryToolExecutor.execute，让 NIT 脚本内部
   * 调用的工具与 FC 工具走同一鉴权链。
   */
  toolExecutor: RegistryToolExecutor
  /** 工具参数策略与审批状态机。 */
  approvalService: ApprovalService
  policyEngine: PolicyEngine
  // AIOS: taskManager 已移除（被 RuntimeStateService 替代，零调用方）
  runtimeStateService: RuntimeStateService
  // AIOS: CompanionSchedulerService 替代 SessionService 的陪伴调度管理
  companionSchedulerService: CompanionSchedulerService
  gatewayHub: GatewayHub
  scheduler: BackgroundScheduler
  schedulerService: SchedulerService

  // ── Service (AIOS: Thread + Context 域) ──
  threadService: ThreadService
  flowStateService: FlowStateService
  contextCompiler: ContextCompiler
  conversationTurnService: ConversationTurnService
  attachmentService: AttachmentService
  /** M05: 统一任务中心（派发/队列/状态机/恢复） */
  backgroundTaskService: BackgroundTaskService

  // ── Capability Gate (D51) ──
  capabilityGate: CapabilityGate
  skillLoader: SkillLoader

  // ── Capability Registry（第七阶段：节点能力注册表） ──
  /** 节点能力注册表，Daemon 用于路由平台工具调用到提供者节点 */
  capabilityRegistry: CapabilityRegistry
  /** 节点能力注册表 Repository（暴露给 CapabilityBridge 直接操作） */
  nodeCapabilityRepo: NodeCapabilityRepository
  /** 能力调用桥接（Daemon 模式下启动 WS 服务端，转发工具调用到节点） */
  capabilityBridge: CapabilityBridge

  // ── Inbound Routing（第七阶段：入站路由表） ──
  /** 入站路由表 Repository，外部消息按 (source, identifier) 查询归属 Agent/Channel */
  inboundRouteRepo: InboundRouteRepository

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
  butlerService: ButlerService
  groupChatService: GroupChatService
  groupChatDispatcher: GroupChatDispatcher

  // 注意：社交模式（socialBridge）已迁移到 packages/apps/social/
  // 由 SocialAppRuntime 独立管理，不再通过主 AppContext 暴露

  // ── 语音服务 ──
  ttsService: TtsService
  asrService: AsrService
  realtimeSessionManager: RealtimeSessionManager

  // ── 系统信息 ──
  systemService: SystemService

  // ── AIOS 第八阶段：Agent 应用层（系统 + 独立应用） ──
  /** 资源授权注册表：管理主 Agent 对应用/会话的资源访问授权 */
  grantRegistry: GrantRegistry
  /** 应用生命周期管理：安装/启动/暂停/停止/卸载 Agent 应用 */
  appManager: AppManager

  // ── 热更新 ──
  /** 从 DB 重新加载 Embedding 配置并热更新 Provider */
  reloadEmbeddingConfig(): Promise<void>
  /** 从 DB 重新加载 TTS 配置并热更新 */
  reloadTtsConfig(): Promise<void>
  /** 从 DB 重新加载 ASR 配置并热更新 */
  reloadAsrConfig(): Promise<void>
}

// ─────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────

/** 使用默认路径创建应用配置 */
export function createDefaultConfig(): AppConfig {
  const dataDir = getDataDir()

  return {
    databasePath: getDatabasePath(),
    dataDir,
    runtimeEnv: {
      appRoot: process.env.PERO_APP_ROOT ?? path.resolve(import.meta.dirname, '..', '..'),
      dataDir,
      tempDir: process.env.PERO_TEMP_DIR ?? path.join(os.tmpdir(), 'infOS'),
      workshopDirs: getWorkshopDirs(),
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
export async function createAppContext(config: AppConfig): Promise<AppContext> {
  logger.info('正在初始化依赖注入容器...')

  // ── 1. 核心基础设施 ──
  const pathResolver = new PathResolver(config.runtimeEnv)
  const assetRegistry = new AssetRegistry(pathResolver)

  // AIOS(Phase4): WorkspaceService — Principal Workspace 文件操作 + containment 检查
  // 注入到 fileOps（setWorkspaceService）和 terminalExecutor/runScript/fileSearch/codeSearcher
  // （setSharedWorkspaceService，共享持有器）
  const workspaceService = new LocalWorkspaceService(pathResolver)
  setWorkspaceService(workspaceService)
  setSharedWorkspaceService(workspaceService)

  // 生产力执行运行时：会话、沙箱进程与多终端共享同一生命周期底座。
  const executionSessionManager = new ExecutionSessionManager()
  const sandboxRunner = new LocalPolicyRunner()
  const terminalManager = new TerminalManager(executionSessionManager, sandboxRunner)
  const virtualWorkspace = new VirtualWorkspace()

  // ── 2. 数据库 ──
  const db = createDrizzleConnection(config.databasePath)
  const sqlite = (db as unknown as { $client: import('better-sqlite3').Database }).$client
  await new MigrationManager(config.runtimeEnv.dataDir, sqlite, dataMigrations).runPending()
  const toolApprovalRepo = new ToolApprovalRepository(db)
  const approvalService = new ApprovalService(toolApprovalRepo)
  const policyEngine = new PolicyEngine()
  setProductivityRuntime({
    sessions: executionSessionManager,
    terminals: terminalManager,
    workspace: workspaceService,
    virtualWorkspace,
    approvalService,
  })
  // 第六阶段 #7: CapabilityGate 共享持有器（run_script 用于 ResourceScope 校验）
  // capabilityGate 实例稍后创建，此处先占用变量名（在 CapabilityGate 区块实例化后注入）

  // ── 3. Repository ──
  const memoryRepo = new MemoryRepository(db)
  const vectorSyncRepo = new VectorSyncRepository(db)
  // AIOS: logRepo 实例化已移除（ConversationLogRepository 废弃）
  const configRepo = new ConfigRepository(db)

  // Embedding/Reranker: 优先从 DB (Dashboard 配置) 读取, fallback 到环境变量默认值
  // 必须在 StoreRegistry 之前解析：向量库维度需与 embedding 配置联动，
  // 否则更换 embedding 模型（维度≠默认 1536）会导致向量写入/检索维度不匹配。
  const dbEmbeddingApiBase = await configRepo.get('embedding.apiBase')
  const dbEmbeddingApiKey = await configRepo.get('embedding.apiKey')
  const dbEmbeddingModel = await configRepo.get('embedding.model')
  const dbEmbeddingDim = await configRepo.get('embedding.dimension')
  const dbRerankerApiBase = await configRepo.get('reranker.apiBase')
  const dbRerankerApiKey = await configRepo.get('reranker.apiKey')
  const dbRerankerModel = await configRepo.get('reranker.model')

  const embeddingConfig = {
    ...config.embedding,
    apiBase: dbEmbeddingApiBase || config.embedding.apiBase,
    apiKey: dbEmbeddingApiKey || config.embedding.apiKey,
    model: dbEmbeddingModel || config.embedding.model,
    dimension: dbEmbeddingDim ? Number(dbEmbeddingDim) : config.embedding.dimension,
    reranker: {
      ...config.embedding.reranker!,
      apiBase: dbRerankerApiBase || config.embedding.reranker!.apiBase,
      apiKey: dbRerankerApiKey || config.embedding.reranker!.apiKey,
      model: dbRerankerModel || config.embedding.reranker!.model,
    },
  }
  logger.info(
    `Embedding 配置: model=${embeddingConfig.model}, dim=${embeddingConfig.dimension} (来源: ${dbEmbeddingModel ? 'DB' : 'ENV'})`,
  )

  const storeRegistry = new MemoryStoreRegistry(pathResolver, embeddingConfig.dimension)
  const vectorRepo = new VectorRepository(storeRegistry)
  const mcpRepo = new McpConfigRepository(db)
  // AIOS: Thread 仓储（替代旧 Session 持久层）
  const threadRepo = new ThreadRepository(db)
  const flowStateRepo = new FlowStateRepository(db)
  const fileSnapshotRepo = new FileSnapshotRepository(db)
  const workspaceCheckpointService = new WorkspaceCheckpointService(
    fileSnapshotRepo,
    workspaceService,
  )
  setWorkspaceCheckpointService(workspaceCheckpointService)
  setWorkspaceProductivityCheckpointService(workspaceCheckpointService)
  const attachmentRepo = new AttachmentRepository(db)
  // 第五阶段长记忆 Repositories（canonical_memories + memory_candidates 表）
  const canonicalMemoryRepo = new CanonicalMemoryRepository(db)
  const memoryCandidateRepo = new MemoryCandidateRepository(db)

  // M05: 统一任务中心 Repository（background_tasks 持久实体）
  const backgroundTaskRepo = new BackgroundTaskRepository(db)

  // ── 4. Shared 工具 ──

  const embeddingService = new EmbeddingService(embeddingConfig)
  const vectorWriteHelper = new VectorWriteHelper(vectorRepo, vectorSyncRepo, embeddingService)

  // ── 5. MDP 引擎 (后台任务和 Agent 域都依赖) ──
  const promptDir = pathResolver.resolve('@app/backend/src/services/mdp/prompts')
  const officialAgentsDir = pathResolver.resolve('@app/backend/src/assets/agents')
  const mdpEngine = new MdpEngine(promptDir, officialAgentsDir)

  // ── 6. Service — Memory 域 ──
  const modelRegistry = new ModelRegistry(db)
  const modelRepo = new ModelRepository(db)
  const llmService = new LlmService()
  const modelService = new ModelService(modelRepo, llmService, modelRegistry)
  const modelRoles = new ModelRoleResolver(configRepo, modelRepo)
  const memoryService = new MemoryService(memoryRepo, vectorRepo, vectorWriteHelper)
  const memorySearchService = new MemorySearchService(vectorRepo, memoryRepo, embeddingService)
  // Agent 管理器（多 Agent 配置/称呼读取），ScorerService 等依赖它按 agentId 取称呼
  const agentManager = new AgentManager(pathResolver, configRepo)
  // AIOS: ConversationLogService 已移除（Scorer 改用 ThreadRepository）
  // AIOS: ScorerService 数据源从 ConversationLogService 改为 ThreadRepository
  // 第五阶段：注入 memoryCandidateRepo，Scorer 写候选而非直接写 memory_nodes
  const initialMemoryRuntimeConfig = await loadMemoryRuntimeConfig(configRepo)
  const scorerService = new ScorerService(
    threadRepo,
    llmService,
    modelRoles.bind('scorer'),
    mdpEngine,
    memoryCandidateRepo,
    vectorRepo,
    embeddingService,
    { batchSize: initialMemoryRuntimeConfig.scorerBatchSize },
    configRepo,
    agentManager,
  )
  const graphGardener = new GraphGardener({
    memoryRepo,
    vectorRepo,
    vectorWriteHelper,
    llmService,
    mdpEngine,
    getModelConfig: modelRoles.bind('reflection'),
  })
  // 注意：socialScorerService 已迁移到 packages/apps/social/runtime/socialScorer.ts
  const memoryImporter = new MemoryImporter(
    memoryService,
    llmService,
    modelRoles.bind('scorer'),
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

  // AIOS: RuntimeStateService（新版运行时状态管理，整合 TaskManager + 窗口级活跃 Agent + Thread 运行时状态）
  // - 替代旧 TaskManager（按 threadId 索引，旧版按 sessionId）
  // - 替代旧 AgentManager.activeAgentId（窗口级，非全局）
  const runtimeStateService = new RuntimeStateService()
  // AIOS: CompanionSchedulerService 替代 SessionService 的陪伴调度管理
  const companionSchedulerService = new CompanionSchedulerService()

  // Prompt
  // PetStateService: pet_states 表 CRUD (mood/vibe/mind + 动态台词)，注入 AgentManager
  // 以便 getWaifuTexts 合并 finish_task 写入的 click/idle/back 台词
  const petStateService = new PetStateService(db)
  agentManager.setPetStateService(petStateService)
  // AIOS(Phase4): 确保所有 Agent 的 Principal Workspace 目录骨架存在
  // （AgentManager 构造时已懒创建，此处通过 WorkspaceService 幂等再保证一次，
  //   后续 WorkspaceService.read/write/list 等操作依赖目录存在）
  try {
    await Promise.all(
      agentManager.listAgents().map((agent) => workspaceService.ensureWorkspace(agent.id)),
    )
  } catch (err) {
    logger.warn(`Workspace 目录初始化出错 (非致命): ${err}`)
  }
  // AIOS: PromptService / PresetLoader 实例化已移除（死代码，零调用方）

  // AIOS: Thread + Context Compiler（新版对话编排，替代旧 Session + Enrichment 流程）
  // - ThreadService 依赖 ThreadRepository（已在 Repository 区块实例化）
  const threadService = new ThreadService(threadRepo, attachmentRepo, workspaceCheckpointService)
  const flowStateService = new FlowStateService(flowStateRepo, threadService)

  // Tool Registry + Capability Gate
  const toolRegistry = new ToolRegistry()

  // SkillLoader：官方 → Workshop → 用户，后扫描同 ID Skill 覆盖前者。
  const builtinSkillsDir = pathResolver.resolve('@app/backend/src/skills')
  const customSkillsDir = pathResolver.resolve('@data/skills')
  const workshopSkillDirs = pathResolver
    .getRoots('@workshop')
    .flatMap((root) => [path.join(root, 'skills'), path.join(root, 'assets', 'skills')])
  const skillLoader = new SkillLoader(
    [builtinSkillsDir, ...workshopSkillDirs, customSkillsDir],
    customSkillsDir,
  )

  // CapabilityGate 与 Agent 联邦使用相同优先级：官方 → Workshop → 用户。
  const agentBuiltinDir = pathResolver.resolve('@app/backend/src/assets/agents')
  const agentUserDir = pathResolver.resolve('@data/agents')
  const workshopAgentDirs = pathResolver
    .getRoots('@workshop')
    .flatMap((root) => [path.join(root, 'agents'), path.join(root, 'assets', 'agents')])
  const capabilityGate = new CapabilityGate(
    [agentBuiltinDir, ...workshopAgentDirs, agentUserDir],
    skillLoader,
    toolRegistry,
  )
  // 第六阶段 #7: 注入 CapabilityGate 到共享持有器（run_script 用于 ResourceScope 校验）
  setCapabilityGate(capabilityGate)

  // 第七阶段：节点能力注册表（Daemon 独立）
  // - NodeCapabilityRepository：node_capability_registrations 表的数据访问层
  // - CapabilityRegistry：业务服务，封装节点注册/查询/心跳/离线检测
  //   CapabilityBridge（任务3）通过此服务路由平台工具调用到提供者节点
  const nodeCapabilityRepo = new NodeCapabilityRepository(db)
  const capabilityRegistry = new CapabilityRegistry(nodeCapabilityRepo)
  // 第七阶段 #5: CapabilityBridge — 能力调用 WS 服务端
  // 构造函数仅依赖 capabilityRegistry（避免与 AppContext 循环依赖）。
  // WS 服务端的 start() 由 Daemon 包触发；非 Daemon 模式下实例仍可被
  // ToolExecutor 用于路由判断（invokeTool 在无节点时返回友好错误）。
  // 第七阶段修复（批次 E3）：传入 authToken 用于 WS 鉴权握手
  const capabilityBridge = new CapabilityBridge(
    capabilityRegistry,
    process.env.INFOS_API_TOKEN ?? '',
  )
  // 第七阶段 #7: 入站路由表 Repository（外部消息按来源+标识查询归属 Agent）
  const inboundRouteRepo = new InboundRouteRepository(db)

  // 第五阶段：MemoryGate + LocalMemoryProvider（在 ContextCompiler 之前实例化）
  // - MemoryGate：候选审核门控（简化版去重+新增）
  // - LocalMemoryProvider：实现 MemoryProvider 接口，封装 memory_nodes + canonical_memories + 向量检索
  const memoryGate = new MemoryGate()
  const localMemoryProvider = new LocalMemoryProvider(
    canonicalMemoryRepo,
    memoryCandidateRepo,
    memorySearchService,
    memoryService,
    vectorRepo,
    vectorWriteHelper,
  )

  // AIOS: ContextCompiler（在 CapabilityGate 之后实例化，接入全部依赖）
  // - 依赖 ThreadService + AgentManager（只读消费）
  // - 接入 ConfigRepo（状态注入：mood/vibe/时间）
  // - 接入 MemoryProvider（RAG 记忆检索，第五阶段抽象接口）
  // - 接入 MdpEngine（slots 模板渲染，替代硬编码拼装）
  // - 接入 CapabilityGate（能力门控：按 (Agent, Channel) 解析工具白名单/Skills/prompt_fragments）
  // 注：ToolRegistry 已由 CapabilityGate 替代工具描述生成，不再直接注入
  const contextCompiler = new ContextCompiler(
    threadService,
    agentManager,
    configRepo,
    localMemoryProvider,
    mdpEngine,
    capabilityGate,
    flowStateService,
  )

  // ── ExtensionManager: 加载扩展 → 发现 Extension skills → 注入 SkillLoader ──
  const extensionManager = new ExtensionManager()
  const builtinToolsDir = pathResolver.resolve('@app/backend/src/tools')
  const userExtensionsDir = pathResolver.resolve('@data/extensions')
  await extensionManager.loadAll({ builtinToolsDir, userExtensionsDir })

  // Extension 中发现的 skills/ 目录，追加注入到 SkillLoader
  const discoveredSkillDirs = extensionManager.getDiscoveredSkillDirs()
  if (discoveredSkillDirs.length > 0) {
    skillLoader.addDirs(discoveredSkillDirs)
  }

  // ── B6-5: ToolExecutor 接入 hookEmitter (ExtensionManager) ──
  const toolExecutor = new RegistryToolExecutor(
    toolRegistry,
    capabilityGate,
    skillLoader,
    extensionManager, // hookEmitter — ExtensionManager 实现了 emitHook
  )
  // 第七阶段 #5: 延迟注入 CapabilityBridge 到 ToolExecutor
  // 因 CapabilityBridge 与 AppContext 存在循环依赖（bridge 依赖 ctx，
  // ctx 又包含 bridge），采用延迟注入：先创建无 bridge 的 toolExecutor，
  // 待 capabilityBridge 实例化后再注入。platform 工具调用靠此桥接转发到节点。
  toolExecutor.setCapabilityBridge(capabilityBridge)
  toolExecutor.setPolicyRuntime(policyEngine, approvalService)
  approvalService.onRequested((request) =>
    gatewayHub.broadcast(createEnvelope('push', { action: 'tool_approval_requested', request })),
  )
  approvalService.onResolved(async (request) => {
    await gatewayHub.broadcast(
      createEnvelope('push', { action: 'tool_approval_resolved', request }),
    )
    const decisionText = request.status === 'approved' ? '批准' : '拒绝'
    await localMemoryProvider
      .add({
        agentId: request.agentId,
        content: `用户${decisionText}了工具 ${request.toolName} 的执行请求${request.resolutionMessage ? `，附言：${request.resolutionMessage}` : ''}。来源任务=${request.taskId ?? '无'}，Thread=${request.threadId}，Channel=${request.channel}，Origin=tool_approval。`,
        type: 'event',
        importance: 2,
        confidence: 1,
        tags: [
          'approval',
          request.taskId ? `task:${request.taskId}` : 'chat',
          `channel:${request.channel}`,
        ],
        provenance: {
          originThreadId: request.threadId,
          originMessageIds: [request.id],
          originChannel: request.channel,
          createdFrom: 'manual',
          createdAt: request.resolvedAt ?? new Date().toISOString(),
        },
      })
      .catch((error) => logger.warn(`审批决策写入长期记忆失败: ${error}`))
  })

  // 注意：socialMessageRepo 已迁移到 packages/apps/social/runtime/socialMessage.repo.ts

  // AIOS: RuntimeStateService → GatewayHub 进度广播
  runtimeStateService.setBroadcaster(async (params) => {
    await gatewayHub.pushTaskProgress({
      sessionId: params.threadId, // 兼容旧 Gateway 签名
      turn: params.turn,
      state: params.state,
      message: params.message,
    })
  })

  const imageUnderstandingService = new ImageUnderstandingService(configRepo, modelRepo, llmService)

  // AIOS: AgentService — 新版接线（仅依赖新服务）
  const agentService = new AgentService({
    llmService,
    configRepo,
    agentManager,
    scorerService,
    imageUnderstandingService,
    threadService,
    toolExecutor,
    /**
     * AIOS: 按 channel 获取工具定义（双过滤）
     *
     * 1. ToolRegistry.allowedSources 粗过滤（工具自身声明的适用通道）
     * 2. CapabilityGate.allowedTools 细过滤（Agent + Channel 维度的能力矩阵）
     *
     * 这解决了 06-tool-capability.md P0-2 "工具定义未过滤" 问题：
     * 之前 LLM 会看到所有已注册工具，即使 CapabilityGate 不允许调用，
     * 现在工具定义与运行时权限校验使用同一白名单。
     *
     * @param channel 对话通道（desktop/social/group）
     */
    getToolDefinitions: (
      agentId: string,
      channel: string,
      disabledTools: string[] = [],
      capabilityScope = 'default',
    ) => {
      const registryTools = toolRegistry.getDefinitions(channel)
      const disabled = new Set(disabledTools.filter((name) => !isSystemProtocolTool(name)))
      if (!capabilityGate.hasConfig(agentId)) {
        return registryTools.filter(
          (tool) =>
            (capabilityScope === 'default' || tool.name === 'finish_task') &&
            (isSystemProtocolTool(tool.name) || !disabled.has(tool.name)),
        )
      }
      const resolved = capabilityGate.resolve(agentId, channel, undefined, capabilityScope)
      return registryTools.filter(
        (tool) =>
          (tool.name === 'finish_task' ||
            (capabilityScope === 'default' && isSystemProtocolTool(tool.name)) ||
            resolved.allowedTools.has(tool.name)) &&
          !disabled.has(tool.name),
      )
    },
    // 取消检测 → RuntimeStateService
    cancelChecker: runtimeStateService,
    // Gateway 广播
    gatewayBroadcast: async (action: string, payload: Record<string, unknown>) => {
      switch (action) {
        case 'stream_end':
          await gatewayHub.pushStreamEnd(payload.sessionId as string)
          break
        default:
          await gatewayHub.pushNotification({ title: action, body: JSON.stringify(payload) })
      }
    },
    // 主模型配置: 统一通过 ModelRoleResolver 获取
    getModelConfig: modelRoles.bind('main'),
  })

  // AIOS: chatResetService 已废弃（旧版清日志功能，新版可基于 ThreadService 重写）
  // 旧 ChatResetService 保留为 deprecated 文件，不再实例化

  // DiaryEngine (统一日记 → 主模型 + 持久化到 diary.tdb)
  const diaryEngine = new DiaryEngine(
    llmService,
    modelRoles.bind('main'),
    mdpEngine,
    vectorRepo,
    embeddingService,
  )

  // BackgroundScheduler (后台定时任务)
  const scheduler = new BackgroundScheduler()
  const maintenanceService = new MaintenanceService({
    scheduler,
    memoryService,
    vectorSyncRepo,
  })
  // 危险区域重置服务（复用主库连接，三个分级重置均在此执行）
  const resetService = new ResetService(db)

  // 第五阶段：LocalMemoryTaskRunner（统一管辖长记忆后台任务）
  // 依赖 ScorerService + MemoryGate + Repos + LocalMemoryProvider + MaintenanceService
  // 供 ChatRouter/Scheduler 通过 MemoryTaskRunner 接口触发 Scorer/Gate/Maintenance
  const localMemoryTaskRunner = new LocalMemoryTaskRunner(
    scorerService,
    memoryGate,
    canonicalMemoryRepo,
    memoryCandidateRepo,
    localMemoryProvider,
    maintenanceService,
    threadRepo,
  )

  // 注册定时任务: Scorer 超时刷新 (30 分钟)
  scheduler.register({
    name: 'scorer-flush',
    displayName: '对话记忆整理',
    description: '将待处理对话提炼并整理为长期记忆',
    intervalMs: 30 * 60 * 1000,
    handler: async () => {
      const activeAgent = agentManager.defaultAgentId
      await scorerService.flushPendingByThread(activeAgent)
      // Gate 审核：将 pending 记忆候选写入长期记忆（canonical_memories + memory_nodes）。
      // 此前 runGate 无任何调度/业务触发，候选永远停留在 pending，长记忆功能实际失效。
      await localMemoryTaskRunner.runGate(activeAgent)
    },
  })

  // 注册定时任务: 综合日记生成 (每 30 分钟检查, 23:00 后当日仅触发一次)
  let lastDiaryDate = '' // 记录上次生成日期，防止重复生成
  scheduler.register({
    name: 'diary-generate',
    displayName: '每日记忆日记',
    description: '每 30 分钟检查一次，23:00 后每日最多生成一次',
    intervalMs: 30 * 60 * 1000,
    handler: async () => {
      // 仅在 23:00~23:59 触发
      const now = new Date()
      if (now.getHours() !== 23) return

      const todayStr = now.toISOString().slice(0, 10)
      if (lastDiaryDate === todayStr) return // 今日已生成

      const activeAgent = agentManager.defaultAgentId
      const agent = agentManager.getAgent(activeAgent)
      if (!agent) return

      const todaySummaries: string[] = []

      // 来源 1: memoryNodes (桌面对话记忆)
      const { data: recentMemories } = await memoryRepo.list({
        agentId: activeAgent,
        page: 1,
        pageSize: 50,
      })
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayMs = todayStart.getTime()
      for (const m of recentMemories) {
        if (m.timestamp >= todayMs) {
          todaySummaries.push(m.content)
        }
      }

      // 来源 2: subagent 应用当日记忆摘要（AIOS 记忆回流通道）
      // 通过 AppManager.collectDailySummaries 统一收集所有运行中应用的当日记忆，
      // 不再直接读取 social.tdb（解耦：主 Agent 不感知 subagent 的存储细节）
      try {
        const appSummaries = await appManager.collectDailySummaries(activeAgent, todayStr)
        todaySummaries.push(...appSummaries)
      } catch (err) {
        logger.warn(`收集应用记忆摘要失败: ${err}`)
      }

      if (todaySummaries.length === 0) {
        logger.debug('日记定时检查: 今日无新记忆，跳过')
        return
      }

      try {
        const ownerName = (await configRepo.get('owner.name')) ?? '用户'
        // 称呼：取该 Agent 的 agent.json owner_appellation（兜底"主人"），各角色独立
        const ownerAppellation = agent.ownerAppellation
        const entry = await diaryEngine.generate({
          summaries: todaySummaries,
          agentId: activeAgent,
          agentName: agent.name,
          ownerName,
          ownerAppellation,
        })
        if (entry) {
          lastDiaryDate = todayStr
          logger.info(
            `综合日记生成完成: agent=${activeAgent}, sources=${todaySummaries.length}, ` +
              `mood=${entry.mood}, highlights=${entry.highlights.length}`,
          )
        }
      } catch (err) {
        logger.warn(`日记生成失败: ${err}`)
      }
    },
  })

  // ── 用户提醒系统 ──
  const schedulerService = new SchedulerService(db, gatewayHub, agentManager)

  // 注册定时任务: 提醒触发检查 (每 30 秒)
  scheduler.register({
    name: 'trigger-check',
    displayName: '定时提醒检查',
    description: '检查并触发已到期的提醒与计划',
    intervalMs: 30 * 1000,
    handler: async () => {
      const activeAgent = agentManager.defaultAgentId
      const results = await schedulerService.checkDueTasks(activeAgent)
      for (const result of results) {
        if (result.type === 'agent_task') {
          for (const item of result.tasks) {
            if (!dispatchScheduledAgentTask) throw new Error('后台任务服务尚未初始化')
            await dispatchScheduledAgentTask(item.agentId, item.content)
          }
          continue
        }
        // 通过 Gateway 广播触发提醒 (前端收到后显示通知 + 播放 Agent 语音)
        await gatewayHub.pushNotification({
          title: `提醒触发 (${result.type})`,
          body: result.instruction,
        })
        logger.info(`到期任务已广播: ${result.type} (${result.tasks.length} 项)`)
      }
    },
  })

  // 注册定时任务: 临时文件清理 (每小时)
  scheduler.register({
    name: 'cleanup',
    displayName: '临时文件清理',
    description: '清理过期缓存、上传文件与临时资源',
    intervalMs: 60 * 60 * 1000,
    handler: async () => {
      const tempDir = pathResolver.resolve('@temp')
      await runCleanup(tempDir)
    },
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
  scheduler.register({
    name: 'reflection',
    displayName: '深度记忆维护',
    description: '整合、审计并维护长期记忆系统',
    intervalMs: 6 * 60 * 60 * 1000,
    handler: async () => {
      const agentId = agentManager.defaultAgentId
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
    },
  })

  // 注册定时任务: 孤独记忆扫描 (每小时, 低成本, 独立于 Reflection)
  scheduler.register({
    name: 'lonely-scan',
    displayName: '冷门记忆扫描',
    description: '识别长期未被检索和使用的记忆',
    intervalMs: 60 * 60 * 1000,
    handler: async () => {
      await runLonelyScan({
        memoryRepo,
        defaultAgentId: agentManager.defaultAgentId,
      })
    },
  })

  // 注意：social-scorer 定时任务已迁移到 SocialAppRuntime 内部管理

  // ── B6-5: 启动 GatewayHub 心跳循环 ──
  gatewayHub.startHeartbeat()

  // ── 语音服务 (单实例复用，供 RealtimeSessionManager 共享) ──
  // TTS: 优先从 DB (Dashboard VoiceTab) 读取, fallback 到默认值
  const dbTtsProvider = await configRepo.get('tts.provider')
  const dbTtsVoice = await configRepo.get('tts.voice')
  const dbTtsRate = await configRepo.get('tts.rate')
  const dbTtsEdgePitch = await configRepo.get('tts.edgePitch')
  const dbTtsSpeed = await configRepo.get('tts.speed')
  const dbTtsApiBase = await configRepo.get('tts.apiBase')
  const dbTtsApiKey = await configRepo.get('tts.apiKey')
  const ttsService = new TtsService({
    ...(dbTtsProvider && { provider: dbTtsProvider as 'edge_tts' | 'openai' }),
    ...(dbTtsVoice && { voice: dbTtsVoice }),
    ...(dbTtsRate && { rate: dbTtsRate }),
    ...(dbTtsEdgePitch && { pitch: dbTtsEdgePitch }),
    ...(dbTtsSpeed && { speed: Number(dbTtsSpeed) }),
    ...(dbTtsApiBase && { apiBase: dbTtsApiBase }),
    ...(dbTtsApiKey && { apiKey: dbTtsApiKey }),
  })
  logger.info(
    `TTS 配置: provider=${dbTtsProvider || 'edge_tts'} (来源: ${dbTtsProvider ? 'DB' : 'DEFAULT'})`,
  )

  // ASR: 优先从 DB (Dashboard VoiceTab) 读取, fallback 到默认值
  const dbAsrEnabled = await configRepo.get('asr.enabled')
  const dbAsrApiBase = await configRepo.get('asr.apiBase')
  const dbAsrApiKey = await configRepo.get('asr.apiKey')
  const dbAsrModel = await configRepo.get('asr.model')
  const dbAsrLanguage = await configRepo.get('asr.language')
  const asrService = new AsrService({
    enabled: dbAsrEnabled === 'true',
    ...(dbAsrApiBase && { apiBase: dbAsrApiBase }),
    ...(dbAsrApiKey && { apiKey: dbAsrApiKey }),
    ...(dbAsrModel && { model: dbAsrModel }),
    ...(dbAsrLanguage && { language: dbAsrLanguage }),
  })
  logger.info(
    `ASR 配置: model=${dbAsrModel || 'whisper-1'} (来源: ${dbAsrModel ? 'DB' : 'DEFAULT'})`,
  )

  // ── AIOS 第八阶段：Agent 应用层（系统 + 独立应用） ──
  // GrantRegistry：资源授权注册表（轻量授权声明，不存储资源内容）
  const grantRegistry = new SqliteGrantRegistry(db)
  // AppManager：应用生命周期管理（依赖 ToolRegistry + PathResolver + GrantRegistry + 独立编译依赖）
  const appManager = new AppManagerImpl(
    db,
    toolRegistry,
    pathResolver,
    grantRegistry,
    llmService,
    mdpEngine,
    localMemoryProvider,
    agentManager,
    // 主模型 + 社交任务槽模型获取器
    // ⚠️ 特例：社交应用任务槽统一在主配置页配置，其他 subagent 应用不能这样做
    modelRoles.bind('main'),
    modelRoles.bind('social_scheduler'),
    modelRoles.bind('social_scorer'),
    // 社交应用等需要的内核资源依赖
    storeRegistry,
    gatewayHub,
    inboundRouteRepo,
    configRepo,
  )
  appManager.setConversationStateServices(threadService, flowStateService)
  logger.info('Agent 应用层已初始化（GrantRegistry + AppManager，含独立编译依赖）')
  // 内置社交应用 runtime factory 在 initAppContext() 中通过动态 import 注册

  const attachmentService = new AttachmentService(
    attachmentRepo,
    threadRepo,
    pathResolver.resolve('@data/attachments'),
  )
  const conversationTurnService = new ConversationTurnService({
    threadService,
    contextCompiler,
    agentService,
    attachmentService,
    imageUnderstandingService,
  })
  appManager.setHostCommunicator(async (request) => {
    const thread = await threadService.getOrCreateLatest(
      request.hostAgentId,
      'desktop',
      'conversation',
    )
    const result = await conversationTurnService.executeTurn({
      threadId: thread.id,
      agentId: request.hostAgentId,
      content:
        `【AgentApplication 临时通信】\n应用：${request.appId}\n模式：${request.mode}\n请求：${request.summary}\n` +
        `辅助上下文：${JSON.stringify(request.context ?? {})}\n请判断后给出简洁、可执行的结构化建议。`,
      inputPersistence: 'ephemeral',
      outputPersistence: 'ephemeral',
    })
    return { decision: 'responded', content: result.reply, correlationId: request.correlationId }
  })
  // M05: 统一任务中心 Service（派发 → 队列 → ConversationTurn 执行）
  const backgroundTaskService = new BackgroundTaskService(
    backgroundTaskRepo,
    threadService,
    conversationTurnService,
    approvalService,
  )
  const dispatchScheduledAgentTask = async (agentId: string, instruction: string) => {
    await backgroundTaskService.dispatch({
      agentId,
      instruction,
      title: `定时任务：${instruction.slice(0, 24)}`,
      requestedBy: 'scheduler',
    })
  }
  for (const agent of agentManager.listAgents()) {
    const residentId = `resident_memory_${agent.id}`
    if (!(await backgroundTaskRepo.findById(residentId))) {
      const residentThread = await threadService.createThread({
        agentId: agent.id,
        channel: 'desktop',
        purpose: 'background_task',
        title: '[常驻] 记忆运行维护',
      })
      await backgroundTaskRepo.ensureResident({
        id: residentId,
        agentId: agent.id,
        threadId: residentThread.id,
        title: '记忆运行维护',
        instruction: '常驻维护 Scorer、MemoryGate 与记忆维护运行状态',
        metadataJson: JSON.stringify({ runtime: 'memory', readOnly: true }),
      })
    }
  }
  // M05-篇3-1：启动时保留中断任务的 checkpoint（供手动 resumeInterrupted 恢复），
  // 不自动重启：重启后任务标记 crashed（合并入 failed 语义），误判断决重启闭环在后续版本
  // 品质续跑依赖用户确认后用 resume-interrupted 接口手动接力
  backgroundTaskService.recoverInterruptedTasks().catch((err) => {
    logger.warn(`后台任务中断恢复失败: ${err}`)
  })
  const strongholdService = new StrongholdService(db)
  const groupChatService = new GroupChatService(db)
  // 管家复用主模型 LLM + mdp 管家提示词；未配置模型时自动退化为规则引擎
  const butlerService = new ButlerService(strongholdService, groupChatService, agentManager, {
    mdpEngine,
    llmService,
    getModelConfig: modelRoles.bind('main'),
  })

  return {
    db,
    pathResolver,
    assetRegistry,
    memoryRepo,
    vectorRepo,
    vectorSyncRepo,
    // AIOS: logRepo 已移除（ConversationLog 废弃）
    configRepo,
    storeRegistry,
    threadRepo,
    attachmentRepo,
    backgroundTaskRepo,
    toolApprovalRepo,
    canonicalMemoryRepo,
    memoryCandidateRepo,
    embeddingService,
    llmService,
    memoryService,
    memorySearchService,
    // AIOS: logService 已移除（ConversationLogService 废弃）
    scorerService,
    memoryImporter,
    diaryEngine,
    maintenanceService,
    resetService,
    modelRegistry,
    modelService,
    // 第五阶段长记忆 Provider/Gate/TaskRunner
    memoryProvider: localMemoryProvider,
    memoryGate,
    memoryTaskRunner: localMemoryTaskRunner,
    agentManager,
    petStateService,
    agentService,
    // AIOS: promptService 已移除（死代码）
    toolRegistry,
    // 第六阶段 #7: 暴露 toolExecutor 给 run_script 内部闭包统一鉴权
    toolExecutor,
    approvalService,
    policyEngine,
    // AIOS: taskManager 已移除（被 RuntimeStateService 替代）
    runtimeStateService,
    // AIOS: sessionService 已移除（被 CompanionSchedulerService 替代）
    companionSchedulerService,
    gatewayHub,
    scheduler,
    schedulerService,
    // AIOS: Thread + Context 域
    threadService,
    flowStateService,
    contextCompiler,
    conversationTurnService,
    attachmentService,
    // M05: 统一任务中心
    backgroundTaskService,
    capabilityGate,
    skillLoader,
    // 第七阶段：节点能力注册表
    capabilityRegistry,
    nodeCapabilityRepo,
    // 第七阶段 #5: 能力调用桥接（Daemon 模式下由 Daemon 包 start WS 服务端）
    capabilityBridge,
    // 第七阶段 #7: 入站路由表 Repository
    inboundRouteRepo,
    vectorWriteHelper,
    extensionManager,
    mcpManager: new McpClientManager(mcpRepo),
    mcpRepo,
    promptTemplateLoader: new PromptTemplateLoader(pathResolver),
    strongholdService,
    butlerService,
    groupChatService,
    groupChatDispatcher: new GroupChatDispatcher(groupChatService),

    // 注意：社交桥接（SocialBridge）已迁移到 packages/apps/social/runtime/socialBridge.ts
    // 由 SocialAppRuntime 独立管理，不再通过主 AppContext 暴露

    // ── 语音服务 ──
    ttsService,
    asrService,
    realtimeSessionManager: new RealtimeSessionManager({
      ttsService,
      asrService,
      agentService,
      gatewayHub,
      threadService,
      conversationTurnService,
    }),

    // ── 系统信息 ──
    systemService: new SystemService(pathResolver),

    // ── AIOS 第八阶段：Agent 应用层 ──
    grantRegistry,
    appManager,

    // ── 热更新 ──
    async reloadEmbeddingConfig(): Promise<void> {
      const dbApiBase = await configRepo.get('embedding.apiBase')
      const dbApiKey = await configRepo.get('embedding.apiKey')
      const dbModel = await configRepo.get('embedding.model')
      const dbDim = await configRepo.get('embedding.dimension')
      const dbRerankerApiBase = await configRepo.get('reranker.apiBase')
      const dbRerankerApiKey = await configRepo.get('reranker.apiKey')
      const dbRerankerModel = await configRepo.get('reranker.model')

      const newConfig: EmbeddingConfig = {
        ...config.embedding,
        apiBase: dbApiBase || config.embedding.apiBase,
        apiKey: dbApiKey || config.embedding.apiKey,
        model: dbModel || config.embedding.model,
        dimension: dbDim ? Number(dbDim) : config.embedding.dimension,
        reranker: {
          ...config.embedding.reranker!,
          apiBase: dbRerankerApiBase || config.embedding.reranker!.apiBase,
          apiKey: dbRerankerApiKey || config.embedding.reranker!.apiKey,
          model: dbRerankerModel || config.embedding.reranker!.model,
        },
      }

      embeddingService.reconfigure(newConfig)
    },

    async reloadTtsConfig(): Promise<void> {
      const provider = await configRepo.get('tts.provider')
      const voice = await configRepo.get('tts.voice')
      const rate = await configRepo.get('tts.rate')
      const pitch = await configRepo.get('tts.edgePitch')
      const speed = await configRepo.get('tts.speed')
      const apiBase = await configRepo.get('tts.apiBase')
      const apiKey = await configRepo.get('tts.apiKey')

      ttsService.updateConfig({
        ...(provider && { provider: provider as 'edge_tts' | 'openai' }),
        ...(voice && { voice }),
        ...(rate && { rate }),
        ...(pitch && { pitch }),
        ...(speed && { speed: Number(speed) }),
        ...(apiBase && { apiBase }),
        ...(apiKey && { apiKey }),
      })
      logger.info('TTS 配置已热更新')
    },

    async reloadAsrConfig(): Promise<void> {
      const apiBase = await configRepo.get('asr.apiBase')
      const apiKey = await configRepo.get('asr.apiKey')
      const model = await configRepo.get('asr.model')
      const language = await configRepo.get('asr.language')

      asrService.updateConfig({
        ...(apiBase && { apiBase }),
        ...(apiKey && { apiKey }),
        ...(model && { model }),
        ...(language && { language }),
      })
      logger.info('ASR 配置已热更新')
    },
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
  // 0. 注册内置社交应用 runtime factory
  // AIOS: 内置应用不走动态 import runtimeEntry，直接注册 factory
  // 用动态 import 延迟加载 social runtime（避免 tsconfig 路径冲突）
  // 注意：social app 文件不在 backend tsconfig include 范围内，
  // typecheck 会报错，用 Function 构造动态 require 绕过静态分析
  try {
    // 便携/打包环境通过 PERO_APP_ROOT 定位内置应用编译产物（bundle 后 import.meta 失效）；
    // 开发环境回退到源码树相对定位。
    const appRoot = process.env.PERO_APP_ROOT
    const moduleUrl = appRoot
      ? // Windows 绝对路径需 file:/// 三斜杠前缀
        new URL(
          `file:///${path.resolve(appRoot, 'apps', 'social', 'runtime', 'index.js').replace(/\\/g, '/')}`,
        )
      : new URL('../../apps/social/runtime/index.ts', import.meta.url)
    const socialModule: any = await import(moduleUrl.href)
    const createSocialRuntime = socialModule.default ?? socialModule.createRuntime
    if (typeof createSocialRuntime === 'function') {
      ctx.appManager.registerBuiltinRuntime('social', createSocialRuntime)
    } else {
      logger.warn('内置社交应用 runtime factory 未找到（default/createRuntime 导出缺失）')
    }
  } catch (err) {
    logger.warn(`内置社交应用 runtime 注册失败: ${err}`)
  }

  // 1. 注册内置工具 (静态 import, 编译时确定)
  await registerBuiltinTools(ctx.toolRegistry)
  setFlowStateService(ctx.flowStateService)
  setAppInteractionManager(ctx.appManager)

  // 1.1 绑定 run_script 工具的内部执行器 (需要在注册后绑定，因为要访问已注册的工具)
  const { runScriptTool } = await import('./tools/runScript')
  runScriptTool.bindToolExecutor!(async (name, args, source, runtimeContext) => {
    // 第六阶段 #7: 统一走 RegistryToolExecutor.execute，让 NIT 脚本内部调用的工具
    // 也走 CapabilityGate 鉴权 + ResourceScope 路径校验。
    // 之前直接调用 ToolRegistry.getHandler 会跳过所有鉴权，存在安全风险。
    const result = await ctx.toolExecutor.execute(name, args, source, {
      agentId: runtimeContext?.agentId,
      sessionId: runtimeContext?.sessionId,
      threadId: runtimeContext?.threadId ?? 'nit-script',
      channel: runtimeContext?.channel ?? source,
    })
    // 保留结构化失败结果，供 run_script 将内部工具错误正确升级为自身失败。
    return result
  })

  // 1.5 注入 SchedulerService 到 Scheduler 工具 (避免循环依赖)
  setSchedulerService(ctx.schedulerService)

  // 1.5.1 注入 PetStateService 到 finishTask 工具 (角色状态更新)
  // 复用容器已创建并注入 AgentManager 的同一实例，保证写入与读取走同一份数据
  setFinishTaskDeps({
    petStateUpdater: ctx.petStateService,
    gatewayBroadcast: async (action: string, payload: Record<string, unknown>) => {
      ctx.gatewayHub.broadcast(createEnvelope('push', { action, ...payload }, 'broadcast'))
    },
  })
  logger.info('finishTask 角色状态更新已注入 (PetStateService + Gateway)')

  // 1.6 注入平台 Provider (仅桌面环境，Docker/无头跳过)
  if (!process.env.PERO_DOCKER) {
    const providers = await createDesktopProviders()
    if (providers) {
      setScreenshotProvider(providers.screenshot)
      setWindowProvider(providers.window)
      setDesktopAutomationProvider(providers.automation)
      logger.info('桌面 Provider 已注入 (nut-js): 截图 + 窗口管理 + 桌面自动化')
    } else {
      logger.info('nut-js 不可用，桌面 GUI 工具已禁用 (截图/窗口/自动化)')
    }
  } else {
    logger.info('Docker 环境检测，跳过桌面 Provider 注入')
  }

  // 注意：社交工具 Provider 注入已迁移到 SocialAppRuntime.initialize()
  // （由 SocialAppRuntime 在创建 SocialBridge 后自动注入）

  // 1.8 注入据点服务到工具层 (始终可用，群聊模式由 CapabilityGate 门控)
  setStrongholdService(ctx.strongholdService)
  setButlerService(ctx.butlerService)
  logger.info('据点工具已注入 (StrongholdService)')

  // 1.9 注入日记查找工具依赖 (VectorRepo + EmbeddingService + StoreRegistry)
  setDiarySearchDeps({
    vectorRepo: ctx.vectorRepo,
    embeddingService: ctx.embeddingService,
    storeRegistry: ctx.storeRegistry,
  })
  logger.info('日记查找工具已注入')

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
        ctx.toolRegistry.register(tool.definition, (args, _ctx) => tool.execute(args))
      }
      logger.info(`MCP 工具桥接完成: ${mcpTools.length} 个工具已注册`)
    }
  } catch (err) {
    logger.warn(`MCP 连接出错 (非致命): ${err}`)
  }

  // 6. 注入陪伴调度器工厂到 CompanionSchedulerService（AIOS: 从 SessionService 解耦）
  ctx.companionSchedulerService.setSchedulerFactory((agentId: string) => {
    return new CompanionScheduler({
      agentId,
      // 用户称呼：读取对应 Agent 的 agent.json owner_appellation（兜底"主人"），替换触发语中的"主人"占位
      getOwnerAppellation: async () => ctx.agentManager.getOwnerAppellation(agentId),
      onProactiveChat: async (params) => {
        // 主动行为复用 Agent 最新 Desktop Thread，保持 App 与桌宠对话连续。
        const thread = await ctx.threadService.getOrCreateLatest(
          params.agentId,
          'desktop',
          'conversation',
        )

        const triggerContent = `(系统触发: 当前时段=${params.timeSlot}，触发指令=${params.trigger}，请主动发起对话)`

        const result = await ctx.conversationTurnService.executeTurn({
          threadId: thread.id,
          agentId: params.agentId,
          content: triggerContent,
          capabilityScope: 'ambient',
          inputPersistence: 'ephemeral',
        })
        return result.reply || null
      },
      onPushMessage: async (params) => {
        const thread = await ctx.threadService.getOrCreateLatest(
          params.agentId,
          'desktop',
          'conversation',
        )
        // 通过 GatewayHub 推送到前端
        await ctx.gatewayHub.broadcast(
          createEnvelope('push', {
            action: 'proactive_message',
            content: params.content,
            agentId: params.agentId,
            timeSlot: params.timeSlot,
            threadId: thread.id,
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
  logger.info('陪伴调度器工厂已注入 CompanionSchedulerService')

  // 7. 据点系统初始化
  try {
    const enabledAgentIds = ctx.agentManager
      .listAgents()
      .filter((agent) => agent.isEnabled)
      .map((agent) => agent.id)
    await ctx.strongholdService.ensureDefaults(enabledAgentIds)
  } catch (err) {
    logger.warn(`据点初始化出错 (非致命): ${err}`)
  }

  // 注意：社交模式初始化（section 8）已迁移到 SocialAppRuntime.initialize()
  // 由 AppManager.launch 启动社交应用时自动完成（创建 SocialBridge + NapcatAdapter + 启动调度器）
}
