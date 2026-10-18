/**
 * 依赖注入容器
 *
 * 统一初始化所有基础设施和 Service 实例。
 * Router 通过 AppContext 接口访问 Service。
 *
 * B6-5: 完成全部接线，包括:
 * - Package Runtime → ToolRegistry / Capability Directory
 * - HookEmitter → ToolExecutor 注入
 * - ToolRegistry → AgentService 工具定义获取
 * - RuntimeStateService → AgentService 取消检测（替代旧 TaskManager）
 * - GatewayHub → RuntimeStateService 进度广播
 * - GatewayHub → AgentService 完成通知
 *
 * @module packages/backend/src/container
 */

import { createHash } from 'node:crypto'
import { isToolAllowedInInteractionMode } from './tools/interactionMode'
import { spokenReplyToolDefinition } from './tools/spokenReplyCapability'
import path from 'node:path'
import os from 'node:os'
import { arcaManifest } from '@infos/arca'
import { createDrizzleConnection, type DrizzleDb } from './database'
import { MigrationManager, dataMigrations } from './migrations'
import { PathResolver, AssetRegistry, PromptTemplateLoader, type RuntimeEnv } from './core'
import { getDataDir, getDatabasePath, getWorkshopDirs, SERVER_PORT } from './lib/env'
import { HtmlPreviewService } from './services/attachment/htmlPreviewService'
import { createLogger } from './lib/logger'
import {
  AgentStateRepository,
  AgentStateService,
  ObserverContextRegionProvider,
  ObserverService,
} from './observer'
import {
  KernelObjectRegistry,
  CapabilityHandleRegistry,
  CapabilityDirectory,
  KernelOutboxRepository,
  KernelOutboxDispatcher,
  KernelEventBus,
  KernelOutboxPublisher,
  OutboxLifecycleService,
  ExecutionRuntime,
  KernelScheduler,
  KernelAssetRepository,
  KernelTransferRepository,
  AssetFileAuthority,
  registerCoreKernelObjectAdapters,
  registerApplicationKernelObjectAdapters,
  NodeRegistry,
  FileNodeRegistryStore,
  PlacementResolver,
  LifecycleScope,
} from './kernel'

// ── Repository ──
import { ConfigRepository } from './repositories/config.repo'
import { MemoryStoreRegistry } from './repositories/storeRegistry'
import { FileSnapshotRepository } from './repositories/fileSnapshot.repo'
import { FlowStateRepository } from './repositories/flowState.repo'
import { TaskPlanRepository } from './repositories/taskPlan.repo'
import { TaskPlanService } from './services/task/taskPlanService'
import { setTaskPlanService } from './tools/updatePlan'
import { ThreadRepository } from './repositories/thread.repo'
import { BackgroundTaskRepository } from './repositories/backgroundTask.repo'
import { ToolApprovalRepository } from './repositories/toolApproval.repo'
import { DurableNotificationRepository } from './repositories/durableNotification.repo'
import { AgentInputRepository } from './repositories/agentInput.repo'
import { AttachmentRepository } from './repositories/attachment.repo'
import { EventNoteRepository } from './repositories/eventNote.repo'
import { FactsRepository } from './repositories/facts.repo'
import { KnowledgeRepository } from './repositories/knowledge.repo'
import { AutomaticApprovalService } from './services/execution/automaticApprovalService'
import { CompletionAlertService } from './services/conversation/completionAlertService'
import { KnowledgeService } from './services/knowledge/knowledgeService'
import { KnowledgeIndex } from './services/knowledge/knowledgeIndex'
import { setKnowledgeToolDeps } from './tools/knowledge'

// ── Service (Phase 2: Memory 域) ──
import { EmbeddingService, type EmbeddingConfig } from './services/embedding/embeddingService'
import { LlmService } from './services/llm/llmService'
import { TokenUsageRepository } from './repositories/tokenUsage.repo'
import { TokenUsageService } from './services/llm/tokenUsageService'
import { ModelRegistry } from './services/llm/modelRegistry'
import { ModelRepository } from './repositories/model.repo'
import { ModelService } from './services/model/modelService'
import { EventMemoryService } from './services/memory/eventMemoryService'
import { loadMemoryRuntimeConfig } from './services/memory/memoryRuntimeConfig'
import { ContextRnn } from './services/retrieval/contextRnn'
import { ContextRnnRuntime } from './services/retrieval/contextRnnRuntime'
import { forgetRetrievalState } from './services/maintenance/forgetRetrievalState'
import { EventNoteDraftCommitter } from './services/memory/eventNoteDraftCommitter'
import { EventMemoryFallbackService } from './services/memory/eventMemoryFallbackService'
import { MemoryBackgroundControl } from './services/memory/memoryBackgroundControl'
import { EMBEDDING_ENABLED_KEY, MEMORY_BACKGROUND_ENABLED_KEY } from '@infos/shared'
import { LlmBackgroundEventExtractor } from './services/memory/llmBackgroundEventExtractor'
import { EventReflectionService } from './services/memory/eventReflectionService'
import { LlmEventReflectionModel } from './services/memory/llmEventReflectionModel'
import { DailyNotesService } from './services/memory/dailyNotesService'
import { ResetService } from './services/maintenance/resetService'
import { PrivacyPolicy } from './services/maintenance/privacyPolicy'
import { PrivacyDeletionService } from './services/maintenance/privacyDeletionService'
// 注意：SocialScorerService 已迁移到 packages/apps/social/runtime/socialScorer.ts

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
import { PromptWorkspace } from './services/prompt/promptWorkspace'
import { ModelRoleResolver } from './services/llm/modelRoles'
import { GatewayHub } from './services/gateway/gatewayHub'
import { CompanionSchedulerService } from './services/companion/companionSchedulerService'

// ── Service (AIOS: Thread + Context 域) ──
import { ThreadService } from './services/thread/threadService'
import { BackgroundScheduler } from './services/task/backgroundTaskService'
import { TaskControlService } from './services/task/taskControlService'
import { TaskDeliveryService } from './services/task/taskDeliveryService'
import { setTaskToolRuntime } from './tools/taskControl/runtime'
import { ContextCompiler } from './services/context/contextCompiler'
import { ToolContextService } from './services/context/toolContextService'
import { ContextRegionRegistry } from './services/context/contextRegionRuntime'
import { ContinuityRegionProvider } from './services/context/continuityRegionProvider'
import { ConversationTurnService } from './services/conversation/conversationTurnService'
import { ConversationProjectionService } from './projections/conversationProjectionService'
import { BackgroundTaskProjectionService } from './projections/backgroundTaskProjectionService'
import { StrongholdProjectionService } from './projections/strongholdProjectionService'
import { AttachmentService } from './services/attachment/attachmentService'
import { ImageUnderstandingService } from './services/attachment/imageUnderstandingService'
import { SchedulerService } from './services/scheduler/schedulerService'
import { AppError } from './lib/appError'

// ── Capability Gate (D51) ──
import { CapabilityGate } from './capabilities/capabilityGate'
import { SkillLoader } from './capabilities/skillLoader'
import { ArcaApplicationController } from './capabilities/arcaApplicationController'
import { PictoriaIntegration } from './applications/pictoriaIntegration'
import { ArcaFederationConnector } from './capabilities/arcaFederationConnector'
import { CapabilityBridge } from './capabilities/capabilityBridge'
import { BrowserToolRuntime } from './capabilities/browserToolRuntime'
import { ArcaCapabilityRuntime } from './capabilities/arcaCapabilityRuntime'
import { ArcaCollaborationService } from './capabilities/arcaCollaborationService'
import { DesktopCapabilityRuntime } from './capabilities/desktopCapabilityRuntime'
import { RemoteShellCapabilityRuntime } from './capabilities/remoteShellCapabilityRuntime'
import {
  AUDIO_OUTPUT_CAPABILITY,
  COMPLETION_ALERT_CAPABILITY,
  AUDIO_TTS_GENERATE_CAPABILITY,
  DESKTOP_ENVIRONMENT_CAPABILITY,
  SYSTEM_SHELL_CAPABILITY,
  WEB_PAGE_CAPABILITY,
} from './capabilities/nativeCapabilityDefinitions'
import { InboundRouteRepository } from './repositories/inboundRoute.repo'

// AIOS: 旧版 Enricher 已由 ContextCompiler 替代，文件已备份为 .bak（ingress/egress/synthesis/enrichers）
// 仅保留 pipeline/types.ts（定义 ToolDefinition 等核心类型，被 agentService/toolRegistry 等引用）

// ── Shared ──
import { InboundRouteService } from './services/inboundRouteService'

// ── Package Runtime ──
import {
  PackageHookBus,
  PackageInstaller,
  PackageProcessSupervisor,
  PackageRegistry,
  PackageRuntime,
  PackageSecurityAuthority,
  registerStandardContributionActivators,
} from './packages'
import {
  registerBuiltinTools,
  setWorkspaceCheckpointService,
  setWorkspaceProductivityCheckpointService,
  setSharedWorkspaceService,
  setCapabilityGate,
  setFlowStateService,
  setAgentInputService,
  setSocialInteractionManager,
  setEventMemoryToolDeps,
  setFactsToolDeps,
  setRemoteShellCapabilityRuntime,
} from './tools'
import { setSchedulerService } from './tools/scheduler'
// AIOS(Phase4): WorkspaceService（Principal Workspace 文件操作 + containment 检查）
import { WorkspaceCheckpointService } from './services/workspace/workspaceCheckpointService'
import { WorkspaceBrowserService } from './services/workspace/workspaceBrowserService'
import { LocalWorkspaceService } from './services/workspace/workspaceService'
import { ExecutionSessionManager } from './services/execution/executionSession'
import { LocalPolicyRunner } from './services/execution/sandboxRunner'
import { TerminalManager } from './services/execution/terminalManager'
import { VirtualWorkspace } from './services/execution/virtualWorkspace'
import { ApprovalService } from './services/execution/approvalService'
import { AgentInputService } from './services/execution/agentInputService'
import { PolicyEngine } from './services/execution/policyEngine'
import {
  clearProductivityRuntime,
  setProductivityRuntime,
  type ProductivityRuntime,
} from './tools/productivityRuntimeHolder'
import { runCleanup } from './lifecycle/cron'
import { McpConfigService } from './services/mcpConfigService'
import { McpClientManager } from './services/mcp'
import { McpRegistrySynchronizer } from './services/mcp/mcpRegistrySynchronizer'
import { McpConfigRepository } from './repositories/mcp.repo'
import { StrongholdTurnService } from './services/stronghold/strongholdTurnService'
import { StrongholdService } from './services/stronghold/strongholdService'
import { ButlerService } from './services/stronghold/butlerService'
import { GroupChatService } from './services/stronghold/groupChatService'
import { GroupChatDispatcher } from './services/stronghold/groupChatDispatcher'
import { CompanionScheduler } from './services/companion/companionScheduler'
import { createEnvelope } from './services/gateway/types'
import { SqliteSocialStoragePort } from './applications/sqliteSocialStoragePort'
// 注意：社交系统（SocialBridge/ImageCacheManager/StickerService/NapcatAdapter/SocialMessageRepository）
// 已迁移到 packages/apps/social/，由 SocialAppRuntime 独立管理

import { setSkillResourceLoader } from './tools/skillResources'
import { setScreenshotProvider } from './tools/screenVision'
import { setApplicationProvider, setWindowProvider } from './tools/systemInfo'
import { setDesktopAutomationProvider } from './tools/desktopAutomation'
import { setButlerService, setStrongholdService } from './tools/strongholdOps'
import { setFinishTaskDeps } from './tools/finishTask'
import { PetStateService } from './services/agent/petStateService'

// ── Service (Voice 域) ──
import { TtsService } from './services/voice/ttsService'
import { AudioDeliveryService } from './services/voice/audioDeliveryService'
import { AsrService } from './services/voice/asrService'
import { RealtimeSessionManager } from './services/voice/realtimeSessionManager'

// ── Service (System 域) ──
import { LogQueryService } from './services/system/logQueryService'
import { DatabaseSnapshotService } from './services/system/databaseSnapshotService'
import { DistributedSyncService } from './services/distributed/distributedSyncService'
import { SystemService } from './services/system/systemService'
import { WeatherService } from './services/weather/weatherService'
import { ResourceService } from './services/attachment/resourceService'
import { setResourceService } from './tools/sendFile'
import { setImageReadResourceService } from './tools/fileOps'
import { IntegrationService } from './services/integrations/integrationService'
import { PdfParserService } from './services/integrations/pdfParserService'
import { ChatBackgroundService } from './services/system/chatBackgroundService'
import { tokenCounter } from './services/tokenizer/tokenCounter'

// ── AIOS 第八阶段：Agent 应用层（系统 + 独立应用） ──
import { ApplicationRealmManager } from './applications/applicationRealm'
import { SqliteGrantRegistry, type GrantRegistry } from './applications/grantRegistry'
import { AppManagerImpl, type AppManager } from './applications/appManager'
import { ApplicationResourceAccessService } from './applications/applicationResourceAccessService'
import { ApplicationIntegrationService } from './applications/applicationIntegrationService'
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
  assetFileAuthority: AssetFileAuthority
  /** 进程内逻辑微内核根生命周期。 */
  kernelLifecycle: LifecycleScope
  kernelObjects: KernelObjectRegistry
  capabilityHandles: CapabilityHandleRegistry
  capabilityDirectory: CapabilityDirectory
  kernelOutboxRepo: KernelOutboxRepository
  kernelEventBus: KernelEventBus
  kernelOutboxPublisher: KernelOutboxPublisher
  outboxLifecycle: OutboxLifecycleService
  agentStateRepository: AgentStateRepository
  agentStateService: AgentStateService
  observerService: ObserverService
  executionRuntime: ExecutionRuntime
  kernelScheduler: KernelScheduler

  // ── Repository ──
  configRepo: ConfigRepository
  storeRegistry: MemoryStoreRegistry
  threadRepo: ThreadRepository
  attachmentRepo: AttachmentRepository
  /** M05: 后台任务 Repository（持久实体访问） */
  backgroundTaskRepo: BackgroundTaskRepository
  toolApprovalRepo: ToolApprovalRepository
  eventNoteRepo: EventNoteRepository
  factsRepo: FactsRepository
  knowledgeService: KnowledgeService

  // ── Service (Memory 域) ──
  embeddingService: EmbeddingService
  llmService: LlmService
  promptWorkspace: PromptWorkspace
  tokenUsageService: TokenUsageService
  eventMemoryService: EventMemoryService
  /** 危险区域重置服务（清空对话/记忆/恢复出厂）。 */
  resetService: ResetService
  privacyDeletionService: PrivacyDeletionService
  modelRegistry: ModelRegistry
  modelService: ModelService

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
  agentInputService: AgentInputService
  policyEngine: PolicyEngine
  // AIOS: taskManager 已移除（被 RuntimeStateService 替代，零调用方）
  runtimeStateService: RuntimeStateService
  // AIOS: CompanionSchedulerService 替代 SessionService 的陪伴调度管理
  companionSchedulerService: CompanionSchedulerService
  gatewayHub: GatewayHub
  nodeRegistry: NodeRegistry
  scheduler: KernelScheduler
  schedulerService: SchedulerService

  // ── Service (AIOS: Thread + Context 域) ──
  threadService: ThreadService
  flowStateService: FlowStateService
  taskPlanService: TaskPlanService
  toolContextService: ToolContextService
  contextCompiler: ContextCompiler
  conversationTurnService: ConversationTurnService
  conversationProjection: ConversationProjectionService
  backgroundTaskProjection: BackgroundTaskProjectionService
  strongholdProjection: StrongholdProjectionService
  attachmentService: AttachmentService
  resourceService: ResourceService
  htmlPreviewService: HtmlPreviewService
  chatBackgroundService: ChatBackgroundService
  /** M05: 统一任务中心（派发/队列/状态机/恢复） */
  backgroundTaskService: BackgroundScheduler
  taskControlService: TaskControlService
  taskDeliveryService: TaskDeliveryService
  productivityRuntime: ProductivityRuntime
  workspaceBrowserService: WorkspaceBrowserService

  // ── Capability Gate (D51) ──
  capabilityGate: CapabilityGate
  skillLoader: SkillLoader

  // ── Node Capability Transport ──
  capabilityBridge: CapabilityBridge
  desktopCapabilities: DesktopCapabilityRuntime
  remoteShellCapabilities: RemoteShellCapabilityRuntime
  arcaApplication: ArcaApplicationController
  pictoria: PictoriaIntegration
  arcaCollaboration: ArcaCollaborationService

  // ── Inbound Routing（第七阶段：入站路由表） ──
  /** 入站路由表 Repository，外部消息按 (source, identifier) 查询归属 Agent/Channel */
  inboundRouteRepo: InboundRouteRepository
  inboundRouteService: InboundRouteService

  // ── Shared ──

  // ── Package Runtime ──
  packageRegistry: PackageRegistry
  packageInstaller: PackageInstaller
  packageRuntime: PackageRuntime

  // ── MCP ──
  mcpManager: McpClientManager
  mcpRegistrySynchronizer: McpRegistrySynchronizer
  mcpConfigService: McpConfigService
  mcpRepo: McpConfigRepository

  // ── 资产/提示词触达 ──
  promptTemplateLoader: PromptTemplateLoader

  // ── 据点/群聊 ──
  strongholdService: StrongholdService
  strongholdTurnService: StrongholdTurnService
  butlerService: ButlerService
  groupChatService: GroupChatService
  groupChatDispatcher: GroupChatDispatcher

  // 注意：社交模式（socialBridge）已迁移到 packages/apps/social/
  // 由 SocialAppRuntime 独立管理，不再通过主 AppContext 暴露

  // ── 语音服务 ──
  ttsService: TtsService
  audioDeliveryService: AudioDeliveryService
  asrService: AsrService
  realtimeSessionManager: RealtimeSessionManager

  // ── 系统信息 ──
  systemService: SystemService
  weatherService: WeatherService
  integrationService: IntegrationService
  pdfParserService: PdfParserService
  /** 后端统一 o200k_base Token 计数服务。 */
  tokenCounter: typeof tokenCounter
  databaseSnapshotService: DatabaseSnapshotService
  distributedSyncService: DistributedSyncService
  logQueryService: LogQueryService

  // ── AIOS 第八阶段：Agent 应用层（系统 + 独立应用） ──
  applicationRealms: ApplicationRealmManager
  /** 资源授权注册表：管理主 Agent 对应用/会话的资源访问授权 */
  grantRegistry: GrantRegistry
  /** 自治Application经Grant与Capability Handle访问内核资源的统一入口。 */
  applicationResourceAccess: ApplicationResourceAccessService
  /** 标准Adapter Manifest、运行实例、授权和能力调用的生产控制面。 */
  applicationIntegration: ApplicationIntegrationService
  /** 应用生命周期管理：安装/启动/暂停/停止/卸载 Agent 应用 */
  appManager: AppManager

  // ── 热更新 ──
  /** 从 DB 重新加载 Embedding 配置并热更新 Provider */
  reloadEmbeddingConfig(): Promise<void>
  reloadMemoryBackgroundConfig(): Promise<void>
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

  // WorkspaceService 仍供终端、脚本及搜索工具定位 Principal Workspace。
  // 文件操作工具与编辑器共同使用 ProductivityRuntime 的 VirtualWorkspace。
  const workspaceService = new LocalWorkspaceService(pathResolver)
  setSharedWorkspaceService(workspaceService)

  // 生产力执行运行时：会话、沙箱进程与多终端共享同一生命周期底座。
  const executionSessionManager = new ExecutionSessionManager()
  const sandboxRunner = new LocalPolicyRunner()
  const terminalManager = new TerminalManager(executionSessionManager, sandboxRunner)
  const virtualWorkspace = new VirtualWorkspace()

  // ── 2. 数据库 ──
  const db = createDrizzleConnection(config.databasePath)
  const kernelLifecycle = new LifecycleScope('kernel')
  const localNodeId = (process.env.INFOS_NODE_ID ??
    `infos-node-${createHash('sha256')
      .update(`${os.hostname()}|${config.runtimeEnv.dataDir}`)
      .digest('hex')
      .slice(0, 16)}`) as import('@infos/shared').KernelNodeId
  const nodeRegistry = new NodeRegistry(
    new FileNodeRegistryStore(path.join(config.dataDir, 'kernel', 'nodes.json')),
  )
  nodeRegistry.registerNode({
    nodeId: localNodeId,
    displayName: os.hostname(),
    facets: ['server', 'capability', 'storage', 'scheduler', 'gateway'],
    trust: 'local',
    platform: {
      os:
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'macos'
            : process.platform === 'linux'
              ? 'linux'
              : 'unknown',
      arch: process.arch,
      runtime: process.versions.bun ? 'bun' : 'node',
      version: process.version,
    },
    protocolVersion: 1,
    registeredAt: new Date().toISOString(),
  })
  nodeRegistry.connect({ nodeId: localNodeId, carrier: 'memory', leaseMs: 365 * 24 * 60 * 60_000 })
  const placementResolver = new PlacementResolver(nodeRegistry)
  const kernelObjects = new KernelObjectRegistry()
  const capabilityHandles = new CapabilityHandleRegistry()
  const capabilityDirectory = new CapabilityDirectory(
    capabilityHandles,
    placementResolver,
    localNodeId,
  )
  const kernelOutboxRepo = new KernelOutboxRepository(db)
  const agentStateRepository = new AgentStateRepository(db)
  const agentStateService = new AgentStateService(agentStateRepository)
  const observerService = new ObserverService(agentStateRepository)
  const kernelEventBus = new KernelEventBus()
  const kernelOutboxDispatcher = new KernelOutboxDispatcher(kernelOutboxRepo, (event) =>
    kernelEventBus.publish(event),
  )
  const kernelOutboxPublisher = new KernelOutboxPublisher(kernelOutboxDispatcher)
  const executionRuntime = new ExecutionRuntime(kernelOutboxRepo)
  const kernelScheduler = new KernelScheduler(executionRuntime)
  const sqlite = (db as unknown as { $client: import('better-sqlite3').Database }).$client
  await new MigrationManager(config.runtimeEnv.dataDir, sqlite, dataMigrations).runPending()
  const toolApprovalRepo = new ToolApprovalRepository(db)
  const durableNotificationRepo = new DurableNotificationRepository(db)
  const agentInputRepo = new AgentInputRepository(db)
  const approvalService = new ApprovalService(toolApprovalRepo)
  const agentInputService = new AgentInputService(agentInputRepo)
  kernelLifecycle.defer(() => approvalService.rejectAllPending())
  kernelLifecycle.defer(() => agentInputService.cancelAllPending())
  const policyEngine = new PolicyEngine()
  const productivityRuntime: ProductivityRuntime = {
    sessions: executionSessionManager,
    terminals: terminalManager,
    workspace: workspaceService,
    virtualWorkspace,
    approvalService,
  }
  setProductivityRuntime(productivityRuntime)
  kernelLifecycle.defer(() => clearProductivityRuntime())
  kernelLifecycle.defer(() => terminalManager.dispose())
  // 第六阶段 #7: CapabilityGate 共享持有器（run_script 用于 ResourceScope 校验）
  // capabilityGate 实例稍后创建，此处先占用变量名（在 CapabilityGate 区块实例化后注入）

  // ── 3. Repository ──
  const configRepo = new ConfigRepository(db)
  const memoryBackground = new MemoryBackgroundControl()
  memoryBackground.setEnabled((await configRepo.get(MEMORY_BACKGROUND_ENABLED_KEY)) !== 'false')
  const weatherService = new WeatherService(configRepo)
  kernelLifecycle.defer(() => weatherService.dispose())
  await weatherService.initialize()
  const outboxLifecycle = new OutboxLifecycleService(kernelOutboxRepo, kernelOutboxPublisher)
  // Embedding/Reranker配置必须早于向量Store构造，确保TriviumDB与模型维度一致。
  const dbEmbeddingApiBase = await configRepo.get('embedding.apiBase')
  const dbEmbeddingApiKey = await configRepo.get('embedding.apiKey')
  const dbEmbeddingModel = await configRepo.get('embedding.model')
  const dbEmbeddingDim = await configRepo.get('embedding.dimension')
  const dbRerankerApiBase = await configRepo.get('reranker.apiBase')
  const dbRerankerApiKey = await configRepo.get('reranker.apiKey')
  const dbRerankerModel = await configRepo.get('reranker.model')
  const embeddingConfig = {
    ...config.embedding,
    enabled: (await configRepo.get(EMBEDDING_ENABLED_KEY)) !== 'false',
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
  const storeRegistry = new MemoryStoreRegistry(pathResolver, embeddingConfig.dimension)
  storeRegistry.removeLegacyStores()
  const mcpRepo = new McpConfigRepository(db)
  const mcpManager = new McpClientManager(mcpRepo)
  const mcpConfigService = new McpConfigService(mcpRepo, mcpManager)
  // AIOS: Thread 仓储（替代旧 Session 持久层）
  const threadRepo = new ThreadRepository(db, kernelOutboxRepo)
  const flowStateRepo = new FlowStateRepository(db)
  const fileSnapshotRepo = new FileSnapshotRepository(db)
  const workspaceCheckpointService = new WorkspaceCheckpointService(
    fileSnapshotRepo,
    workspaceService,
  )
  setWorkspaceCheckpointService(workspaceCheckpointService)
  setWorkspaceProductivityCheckpointService(workspaceCheckpointService)
  const attachmentRepo = new AttachmentRepository(db)
  const eventNoteRepo = new EventNoteRepository(db)
  const factsRepo = new FactsRepository(db, storeRegistry)
  const privacyPolicy = new PrivacyPolicy(sqlite)
  factsRepo.setPrivacyPolicy(privacyPolicy, (id) => privacyDeletionService.deleteFact(id))
  eventNoteRepo.setPrivacyPolicy(privacyPolicy)
  setFactsToolDeps(factsRepo)
  await factsRepo.replayPending()

  // M05: 统一任务中心 Repository（background_tasks 持久实体）
  const backgroundTaskRepo = new BackgroundTaskRepository(db)
  const kernelAssetRepo = new KernelAssetRepository(db)
  const kernelTransferRepo = new KernelTransferRepository(db)
  const assetFileAuthority = new AssetFileAuthority()
  registerCoreKernelObjectAdapters({
    registry: kernelObjects,
    threads: threadRepo,
    tasks: backgroundTaskRepo,
    scheduler: kernelScheduler,
    nodes: nodeRegistry,
    assets: kernelAssetRepo,
    transfers: kernelTransferRepo,
  })

  // ── 4. Shared 工具 ──

  logger.info(
    `Embedding 配置: model=${embeddingConfig.model}, dim=${embeddingConfig.dimension} (来源: ${dbEmbeddingModel ? 'DB' : 'ENV'})`,
  )

  const embeddingService = new EmbeddingService(embeddingConfig)

  // ── 5. MDP 引擎 (后台任务和 Agent 域都依赖) ──
  const promptDir = pathResolver.resolve('@app/backend/src/services/mdp/prompts')
  const officialAgentsDir = pathResolver.resolve('@app/backend/src/assets/agents')
  const mdpEngine = new MdpEngine(promptDir, officialAgentsDir)
  // 提示词目录独立于账号连接加载，未启用 QQ 时也能管理社交框架。
  mdpEngine.addTemplateRoot(pathResolver.resolve('@app/apps/social/prompts'), 'apps/social')
  const promptWorkspace = new PromptWorkspace(configRepo, mdpEngine)
  await promptWorkspace.initialize()

  // ── 6. Service — Memory 域 ──
  const modelRegistry = new ModelRegistry(db)
  const modelRepo = new ModelRepository(db)
  const tokenUsageRepo = new TokenUsageRepository(db)
  const tokenUsageService = new TokenUsageService(tokenUsageRepo)
  const llmService = new LlmService((attempt) => tokenUsageRepo.record(attempt))
  llmService.setPromptPreparer((messages, opts) => promptWorkspace.prepareTask(messages, opts))
  const modelService = new ModelService(modelRepo, llmService, modelRegistry)
  const modelRoles = new ModelRoleResolver(configRepo, modelRepo)
  const knowledgeRepo = new KnowledgeRepository(db)
  const knowledgeIndex = new KnowledgeIndex(
    knowledgeRepo,
    storeRegistry,
    embeddingService,
    pathResolver.resolve('@data/knowledge/sources'),
  )
  const knowledgeService = new KnowledgeService(
    knowledgeRepo,
    knowledgeIndex,
    llmService,
    modelRoles.bind('knowledge'),
    embeddingService,
    kernelScheduler,
  )
  knowledgeService.setPrivacyPolicy(privacyPolicy, (id) =>
    privacyDeletionService.deleteKnowledge(id),
  )
  setKnowledgeToolDeps(knowledgeService)
  kernelLifecycle.defer(() => knowledgeService.dispose())
  await knowledgeService.initialize()
  const agentManager = new AgentManager(pathResolver, configRepo)

  // ── 7. Service — Agent 域 ──
  const gatewayHub = new GatewayHub(
    nodeRegistry,
    durableNotificationRepo,
    process.env.INFOS_API_TOKEN ?? '',
  )

  // AIOS: RuntimeStateService（新版运行时状态管理，整合 TaskManager + 窗口级活跃 Agent + Thread 运行时状态）
  // - 替代旧 TaskManager（按 threadId 索引，旧版按 sessionId）
  // - 替代旧 AgentManager.activeAgentId（窗口级，非全局）
  const runtimeStateService = new RuntimeStateService()
  // AIOS: CompanionSchedulerService 替代 SessionService 的陪伴调度管理
  const companionSchedulerService = new CompanionSchedulerService()

  // Prompt
  // PetStateService: 会话内角色状态与可撤回变更日志，注入 AgentManager
  // 以便 getWaifuTexts 合并 finish_task 写入的 click/idle/back 台词
  const petStateService = new PetStateService(db)
  petStateService.setPublisher((payload) => gatewayHub.pushStateUpdate(payload))
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
  const threadService = new ThreadService(threadRepo, attachmentRepo, workspaceCheckpointService, {
    invalidatePairs: (threadId, pairIds) =>
      eventNoteRepo.invalidateCoverageByPairIds(threadId, pairIds),
    invalidateThread: (threadId) => eventNoteRepo.invalidateThreadCoverage(threadId),
  })
  const workspaceBrowserService = new WorkspaceBrowserService(productivityRuntime, threadService)
  const flowStateService = new FlowStateService(flowStateRepo, threadService)
  const taskPlanService = new TaskPlanService(new TaskPlanRepository(db), (agentId, threadId) =>
    gatewayHub
      .pushBusiness(
        'plan_changed',
        { agentId, threadId },
        {
          type: 'all_principal_clients',
          principalId: agentId,
        },
      )
      .then(() => {}),
  )
  const toolContextService = new ToolContextService(workspaceService, () =>
    knowledgeRepo.generation(),
  )
  await taskPlanService.recoverInterruptedTurns()

  // Tool Registry + Capability Gate
  const toolRegistry = new ToolRegistry()
  const mcpRegistrySynchronizer = new McpRegistrySynchronizer(mcpManager, toolRegistry)

  // SkillLoader：官方 → Workshop → 用户，后扫描同 ID Skill 覆盖前者。
  const builtinSkillsDir = pathResolver.resolve('@app/backend/src/skills')
  const customSkillsDir = pathResolver.resolve('@data/skills')
  const workshopSkillDirs = pathResolver
    .getRoots('@workshop')
    .flatMap((root) => [path.join(root, 'skills'), path.join(root, 'assets', 'skills')])
  const standardUserSkillsDir = path.join(os.homedir(), '.agents', 'skills')
  const projectSkillDirs = pathResolver
    .getRoots('@workspace')
    .map((root) => path.join(root, '.agents', 'skills'))
  const skillLoader = new SkillLoader(
    [
      builtinSkillsDir,
      ...workshopSkillDirs,
      standardUserSkillsDir,
      customSkillsDir,
      ...projectSkillDirs,
    ],
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

  capabilityDirectory.registerDefinition(WEB_PAGE_CAPABILITY)
  capabilityDirectory.registerDefinition(DESKTOP_ENVIRONMENT_CAPABILITY)
  capabilityDirectory.registerDefinition(AUDIO_TTS_GENERATE_CAPABILITY)
  capabilityDirectory.registerDefinition(AUDIO_OUTPUT_CAPABILITY)
  capabilityDirectory.registerDefinition(COMPLETION_ALERT_CAPABILITY)
  capabilityDirectory.registerDefinition(SYSTEM_SHELL_CAPABILITY)
  const capabilityBridge = new CapabilityBridge(
    capabilityDirectory,
    capabilityHandles,
    nodeRegistry,
    process.env.INFOS_API_TOKEN ?? '',
    config.dataDir,
  )
  // 第七阶段 #7: 入站路由表 Repository（外部消息按来源+标识查询归属 Agent）
  const inboundRouteRepo = new InboundRouteRepository(db)
  const inboundRouteService = new InboundRouteService(inboundRouteRepo)

  const contextRegionRegistry = new ContextRegionRegistry()
  contextRegionRegistry.register(new ContinuityRegionProvider(threadRepo))
  contextRegionRegistry.register(new ObserverContextRegionProvider(agentStateRepository))
  const contextCompiler = new ContextCompiler(
    threadService,
    agentManager,
    configRepo,
    mdpEngine,
    capabilityGate,
    flowStateService,
    contextRegionRegistry,
  )
  contextCompiler.setToolContextService(toolContextService)
  contextCompiler.setPromptWorkspace(promptWorkspace)
  threadService.setPromptVariableCleanup((threadId) =>
    promptWorkspace.variableStore.removeThread(threadId),
  )
  contextCompiler.setWeatherService(weatherService)
  contextCompiler.setPetStateService(petStateService)
  contextCompiler.setPetVisibilityProvider((agentId) => gatewayHub.hasVisiblePet(agentId))
  threadService.setPlanLifecycle(taskPlanService)
  threadService.setCharacterStateLifecycle(petStateService)
  contextCompiler.setTaskPlanService(taskPlanService)

  // Package Runtime：用户 Package 在安装边界完成 Legacy 清单投影。
  const packageRegistry = new PackageRegistry()
  const packageSecurity = new PackageSecurityAuthority(
    path.join(config.dataDir, 'kernel', 'package-security.json'),
  )
  const packageInstaller = new PackageInstaller(packageRegistry, packageSecurity)
  const packageRuntime = new PackageRuntime(packageRegistry, packageSecurity)
  const integrationService = new IntegrationService(
    configRepo,
    toolRegistry,
    packageRegistry,
    packageRuntime,
  )
  await integrationService.initialize()
  const pdfParserService = new PdfParserService(integrationService)
  kernelLifecycle.defer(() => integrationService.dispose())
  packageRuntime.setRequirementResolver((requirement) =>
    capabilityDirectory
      .listOffers({
        requirementId: requirement.id,
        capabilityType: requirement.capabilityType,
        contractVersion: requirement.contractVersion,
        operations: requirement.operations,
        required: requirement.required,
        binding: requirement.binding ?? 'lazy',
        cardinality: requirement.cardinality ?? 'one',
      })
      .some((offer) => offer.health === 'available'),
  )
  const packageProcesses = new PackageProcessSupervisor(kernelScheduler)
  const packageHookBus = new PackageHookBus()
  registerStandardContributionActivators({
    runtime: packageRuntime,
    tools: toolRegistry,
    activateBuiltinTool: (context) =>
      integrationService.managedPackage(context.manifest.packageId)
        ? integrationService.activateBuiltinTool(context)
        : undefined,
    skills: skillLoader,
    events: kernelEventBus,
    processes: packageProcesses,
    hooks: packageHookBus,
    capabilities: capabilityDirectory,
  })
  kernelLifecycle.defer(() => packageRuntime.shutdown())

  const arcaDiscoveryPath =
    process.env.INFOS_ARCA_DISCOVERY_PATH ??
    path.join(config.dataDir, 'applications', 'arca', 'discovery.json')
  const arcaFederation = new ArcaFederationConnector(
    arcaDiscoveryPath,
    localNodeId,
    capabilityDirectory,
    nodeRegistry,
  )
  arcaFederation.start()
  const workspaceRoot = process.env.INFOS_WORKSPACE_ROOT
    ? path.resolve(process.env.INFOS_WORKSPACE_ROOT)
    : path.basename(config.runtimeEnv.appRoot) === 'packages'
      ? path.dirname(config.runtimeEnv.appRoot)
      : config.runtimeEnv.appRoot
  const isPackagedRuntime = Boolean(process.env.INFOS_RESOURCES_ROOT)
  const applicationsRoot =
    process.env.INFOS_APPLICATIONS_ROOT ??
    (process.env.INFOS_RESOURCES_ROOT
      ? path.join(process.env.INFOS_RESOURCES_ROOT, 'applications')
      : path.join(config.runtimeEnv.appRoot, 'dist-applications'))
  const arcaApplication = new ArcaApplicationController(arcaFederation, {
    appRoot: config.runtimeEnv.appRoot,
    workspaceRoot,
    applicationsRoot,
    dataPath: path.join(config.dataDir, 'applications', 'arca'),
    discoveryPath: arcaDiscoveryPath,
    uiUrl:
      process.env.INFOS_ARCA_UI_URL ??
      (isPackagedRuntime ? '/applications/arca/' : 'http://127.0.0.1:7362'),
    packaged: isPackagedRuntime,
  })
  kernelLifecycle.defer(() => arcaApplication.shutdown())
  kernelLifecycle.defer(() => arcaFederation.stop())

  const applicationRealms = new ApplicationRealmManager(toolRegistry)
  kernelLifecycle.defer(() => applicationRealms.shutdown())
  const arcaRealm = applicationRealms.register({
    realmId: 'infos.arca',
    appId: 'infos.arca',
    principalId: 'application:infos.arca',
    instanceId: 'managed',
  })

  const arcaCollaborationState: { current?: ArcaCollaborationService } = {}
  const arcaTools = new ArcaCapabilityRuntime(
    capabilityDirectory,
    capabilityHandles,
    arcaRealm,
    localNodeId,
    arcaManifest,
    {
      preferredNode: () => arcaFederation.status().discovery?.nodeId,
      prepareInput: (input) => arcaApplication.prepareInput(input),
      toolInvocation: (projection, args, context, invoke) =>
        arcaCollaborationState.current
          ? arcaCollaborationState.current.invokeTool(projection, args, context, invoke)
          : Promise.resolve(JSON.stringify({ error: 'Arca 协作适配尚未就绪' })),
    },
  )
  void arcaTools.start()
  kernelLifecycle.defer(() => arcaTools.stop())

  const browserTools = new BrowserToolRuntime(
    capabilityDirectory,
    capabilityHandles,
    toolRegistry,
    localNodeId,
  )
  void browserTools.start()
  kernelLifecycle.defer(() => browserTools.stop())
  const desktopCapabilities = new DesktopCapabilityRuntime(
    capabilityDirectory,
    capabilityHandles,
    localNodeId,
  )
  const remoteShellCapabilities = new RemoteShellCapabilityRuntime(
    capabilityDirectory,
    capabilityHandles,
    localNodeId,
  )
  void desktopCapabilities.start()
  kernelLifecycle.defer(() => desktopCapabilities.stop())

  const userPackagesDir = pathResolver.resolve('@data/packages')
  packageInstaller.migrateInstallDirectory(
    pathResolver.resolve('@data/extensions'),
    userPackagesDir,
  )
  packageInstaller.discover(userPackagesDir)

  const toolExecutor = new RegistryToolExecutor(
    toolRegistry,
    capabilityGate,
    skillLoader,
    packageHookBus,
  )
  // 第七阶段 #5: 延迟注入 CapabilityBridge 到 ToolExecutor
  // 因 CapabilityBridge 与 AppContext 存在循环依赖（bridge 依赖 ctx，
  // ctx 又包含 bridge），采用延迟注入：先创建无 bridge 的 toolExecutor，
  toolExecutor.setApplicationRealmManager(applicationRealms)
  toolExecutor.setThreadPolicyResolver((threadId) => threadService.getThread(threadId))
  toolExecutor.setDesktopCapabilities(desktopCapabilities)
  toolExecutor.setPathBoundaryChecker(
    (agentId, channel, inputPath) =>
      workspaceService.validatePath(agentId, inputPath, 'write', channel).allowed,
  )
  toolExecutor.setPolicyRuntime(policyEngine, approvalService)
  toolExecutor.setAutomaticApprovalService(
    new AutomaticApprovalService(llmService, modelRoles.bind('approval')),
  )

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
  const eventMemoryService = new EventMemoryService(eventNoteRepo, storeRegistry, embeddingService)
  eventMemoryService.setBackgroundPolicy(memoryBackground)
  eventMemoryService.setPrivacyPolicy(privacyPolicy)
  const contextRnn = new ContextRnnRuntime(
    () => new ContextRnn(pathResolver, { inputDim: storeRegistry.getDimension() }),
  )
  eventMemoryService.setAdvancedRetrieval(contextRnn, () => loadMemoryRuntimeConfig(configRepo))
  kernelLifecycle.defer(() => contextRnn.dispose())
  contextCompiler.setEventMemoryService(eventMemoryService)
  const eventNoteDraftCommitter = new EventNoteDraftCommitter(
    eventMemoryService,
    eventNoteRepo,
    threadRepo,
  )
  setEventMemoryToolDeps(eventMemoryService)
  await eventMemoryService.replayPending()
  const scorerModel = modelRoles.bind('scorer')
  const eventMemoryFallback = new EventMemoryFallbackService(
    eventNoteRepo,
    threadRepo,
    eventMemoryService,
    new LlmBackgroundEventExtractor(llmService, scorerModel),
    { getModelConfig: scorerModel, background: memoryBackground },
  )
  const eventReflection = new EventReflectionService(
    eventMemoryService,
    storeRegistry,
    new LlmEventReflectionModel(llmService, modelRoles.bind('reflection')),
    eventNoteRepo,
    { background: memoryBackground, canMaintain: () => !privacyPolicy.isBusy('memory') },
  )
  eventMemoryService.setCommitListener((note) => eventReflection.enqueue(note.agentId, note.id))
  const dailyNotes = new DailyNotesService(
    eventMemoryService,
    agentManager,
    workspaceService,
    pathResolver,
    llmService,
    modelRoles.bindAgent(),
    eventNoteRepo,
    threadRepo,
  )
  dailyNotes.setBackgroundPolicy(memoryBackground)
  const privacyDeletionService: PrivacyDeletionService = new PrivacyDeletionService({
    db: sqlite,
    policy: privacyPolicy,
    memory: eventMemoryService,
    facts: factsRepo,
    knowledge: knowledgeService,
    stores: storeRegistry,
    invalidateMemory: async () => {
      eventMemoryService.invalidateForDeletion()
      eventReflection.invalidateForDeletion()
      await dailyNotes.invalidateForDeletion()
      forgetRetrievalState(pathResolver)
    },
    removeDiary: (agentId, name) => dailyNotes.removeGeneratedFile(agentId, name),
    listAgentIds: () => agentManager.listAgents().map((agent) => agent.id),
    resetSqlite: () => new ResetService(db).resetMemories(),
    forgetSocial: (agentId) => socialStorage.forgetLongMemory(agentId),
    retractCharacterState: (threadId, pairIds) => petStateService.rollbackPairs(threadId, pairIds),
  })
  kernelLifecycle.defer(() => privacyDeletionService.stop())

  // AIOS: AgentService — 新版接线（仅依赖新服务）
  const agentService = new AgentService({
    llmService,
    configRepo,
    agentManager,
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
      realmId?: string,
      capabilitySessionId?: string,
      interactionMode: import('@infos/shared').InteractionMode = 'work',
    ) => {
      if (realmId) {
        return [
          ...toolRegistry
            .getDefinitions(channel)
            .filter((tool) => tool.name === 'finish_task')
            .map((tool) => spokenReplyToolDefinition(tool, false)),
          ...applicationRealms.toolDefinitions(realmId),
        ].filter((tool) => !disabledTools.includes(tool.name))
      }
      const registryTools = toolRegistry
        .getDefinitions(channel)
        .filter((tool) => !applicationRealms.isPrivateTool(tool.name))
        .filter((tool) => isToolAllowedInInteractionMode(tool.name, interactionMode, toolRegistry))
        .map((tool) =>
          spokenReplyToolDefinition(
            tool,
            channel === 'desktop' && gatewayHub.hasVisiblePet(agentId),
          ),
        )
      const disabled = new Set(disabledTools.filter((name) => !isSystemProtocolTool(name)))
      if (!capabilityGate.hasConfig(agentId)) {
        return registryTools.filter(
          (tool) =>
            (capabilityScope === 'default' || tool.name === 'finish_task') &&
            (isSystemProtocolTool(tool.name) || !disabled.has(tool.name)),
        )
      }
      const resolved = capabilityGate.resolve(
        agentId,
        channel,
        capabilitySessionId,
        capabilityScope,
      )
      return registryTools.filter(
        (tool) =>
          (tool.name === 'finish_task' ||
            (capabilityScope === 'default' && isSystemProtocolTool(tool.name)) ||
            resolved.allowedTools.has(tool.name)) &&
          !disabled.has(tool.name),
      )
    },
    resolveToolDefinitions: (definitions, agentId) =>
      toolRegistry.resolveDefinitions(definitions, agentId),
    clearDynamicCapabilities: (scopeId) => capabilityGate.clearSession(scopeId),
    // 取消检测 → RuntimeStateService
    cancelChecker: runtimeStateService,
    // 角色对话模型：角色专用配置优先，未指派时回退主模型。
    getAgentModelConfig: modelRoles.bindAgent(),
    getModelConfig: modelRoles.bind('main'),
    getModelConfigById: (id) => modelRoles.resolveById(id),
    isDesktopOperationAvailable: (operation) => desktopCapabilities.isOperationAvailable(operation),
  })

  // AIOS: chatResetService 已废弃（旧版清日志功能，新版可基于 ThreadService 重写）
  // 旧 ChatResetService 保留为 deprecated 文件，不再实例化

  const scheduler = kernelScheduler
  scheduler.registerPeriodic({
    name: 'context-rnn-checkpoint',
    displayName: 'ContextRNN 状态保存',
    description: '仅在 ContextRNN 已启用且存在变更时保存状态与在线学习权重',
    intervalMs: 60 * 1000,
    class: 'maintenance',
    priority: 0,
    resourceKey: 'context-rnn-checkpoint',
    shouldRun: () => memoryBackground.enabled && contextRnn.hasPendingChanges,
    handler: async () => {
      eventMemoryService.syncAdvancedRetrievalConfig(await loadMemoryRuntimeConfig(configRepo))
      if (memoryBackground.enabled) contextRnn.checkpoint()
    },
  })
  // 危险区域重置服务（复用主库连接，三个分级重置均在此执行）
  const resetService = new ResetService(db)

  scheduler.registerPeriodic({
    name: 'event-memory-fallback',
    displayName: '事件记忆兜底',
    description: '按有效运行时间、Thread休眠、容量和日界补记未覆盖对话',
    intervalMs: 60 * 1000,
    class: 'background',
    priority: 1,
    resourceKey: 'event-memory-fallback',
    shouldRun: () => memoryBackground.enabled,
    handler: async () => {
      if (!memoryBackground.enabled) return
      const agentIds = agentManager
        .listAgents()
        .filter((agent) => agent.isEnabled)
        .map((agent) => agent.id)
      await eventMemoryFallback.tick(agentIds)
    },
  })

  scheduler.registerPeriodic({
    name: 'event-memory-reflection',
    displayName: '事件关系维护',
    description: '增量补全事件关系、模型归档并验证TDB图完整性',
    intervalMs: 5 * 60 * 1000,
    class: 'maintenance',
    priority: 0,
    resourceKey: 'event-memory-reflection',
    shouldRun: () => memoryBackground.enabled,
    handler: async () => {
      if (!memoryBackground.enabled) return
      const now = new Date()
      if (now.getHours() === 21 && now.getMinutes() < 5) {
        await eventReflection.enqueueDailyBackfill()
      }
      await eventReflection.drain()
      for (const agent of agentManager.listAgents().filter((item) => item.isEnabled)) {
        if (!memoryBackground.enabled) break
        eventReflection.validateAndRepair(agent.id)
      }
    },
  })

  scheduler.registerPeriodic({
    name: 'event-memory-daily-notes',
    displayName: '每日人格日记',
    description: '21:00补记完成后把当天事件写入Agent Workspace Markdown日记',
    intervalMs: 60 * 1000,
    class: 'background',
    priority: 1,
    resourceKey: 'event-memory-daily-notes',
    shouldRun: () => memoryBackground.enabled,
    handler: async () => {
      if (!memoryBackground.enabled) return
      const now = new Date()
      if (now.getHours() !== 21) return
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const agents = agentManager.listAgents().filter((item) => item.isEnabled)
      let sourceIncomplete = false
      try {
        await eventMemoryFallback.tick(agents.map((agent) => agent.id))
        sourceIncomplete = eventMemoryFallback.hasPendingWork
      } catch {
        sourceIncomplete = true
      }
      for (const agent of agents) {
        try {
          await dailyNotes.generate(agent.id, date, sourceIncomplete)
        } catch {
          // 失败状态和下次重试时间已由日记任务账本持久化。
        }
      }
    },
  })

  // ── 用户提醒系统 ──
  const schedulerService = new SchedulerService(
    db,
    gatewayHub,
    agentManager,
    async (agentId, threadId) => {
      const thread = await threadService.getThread(threadId)
      if (!thread || thread.agentId !== agentId || thread.channel !== 'desktop') {
        throw new AppError('INVALID_PARAMETER', {
          message: '来源对话不存在或不属于当前角色的桌面通道',
        })
      }
    },
    taskPlanService,
  )

  // 注册定时任务: 提醒触发检查 (每 30 秒)
  scheduler.registerPeriodic({
    name: 'trigger-check',
    displayName: '定时提醒检查',
    description: '检查并触发已到期的提醒与计划',
    intervalMs: 30 * 1000,
    handler: async () => {
      await schedulerService.dispatchDueTasks()
    },
  })

  // 注册定时任务: 临时文件清理 (每小时)
  scheduler.registerPeriodic({
    name: 'cleanup',
    displayName: '临时文件清理',
    description: '清理过期缓存、上传文件与临时资源',
    intervalMs: 60 * 60 * 1000,
    handler: async () => {
      const tempDir = pathResolver.resolve('@temp')
      await runCleanup(tempDir)
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
  const unregisterTtsProvider = capabilityDirectory.registerProvider(
    {
      offerId: `audio.tts.generate@1.0:${localNodeId}`,
      provider: {
        objectType: 'capability-provider',
        objectId: 'audio.tts.generate/provider' as import('@infos/shared').KernelObjectId,
        generation: 1,
        ownerPrincipalId: 'system',
        authorityNodeId: localNodeId,
        authorityEpoch: 1,
      },
      capabilityType: 'audio.tts.generate',
      contractVersion: '1.0',
      operations: ['generate'],
      resourceKinds: ['audio', 'speech'],
      health: ttsService.isAvailable ? 'available' : 'unavailable',
      placement: {
        providerNodeId: localNodeId,
        providerFacet: 'capability',
        executionLocation: 'node-local',
        resourceAuthorityNodeId: localNodeId,
        supportsHeadless: true,
        dataResidency: 'node-only',
        latencyClass: 'local',
        costClass: 'free',
      },
    },
    async (envelope) => {
      if (envelope.payload.operation !== 'generate') {
        throw new Error(`CAPABILITY_OPERATION_UNSUPPORTED: ${envelope.payload.operation}`)
      }
      return ttsService.synthesize(
        envelope.payload.input as import('./services/voice/ttsService').TtsRequest,
      )
    },
  )
  kernelLifecycle.defer(() => unregisterTtsProvider())
  const audioDeliveryService = new AudioDeliveryService(
    path.join(config.dataDir, 'assets', 'audio'),
    assetFileAuthority,
    kernelAssetRepo,
    capabilityDirectory,
    capabilityHandles,
    localNodeId,
  )
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
  const applicationResourceAccess = new ApplicationResourceAccessService(
    localNodeId,
    capabilityDirectory,
    capabilityHandles,
    grantRegistry,
  )
  const applicationIntegration = new ApplicationIntegrationService(
    grantRegistry,
    applicationResourceAccess,
  )
  const unregisterArcaIntegration = applicationIntegration.register(arcaManifest, () => {
    const discovery = arcaFederation.status().discovery
    return discovery
      ? { instanceId: discovery.application.instanceId, nodeId: discovery.nodeId }
      : undefined
  })
  kernelLifecycle.defer(() => unregisterArcaIntegration())
  const socialStorage = new SqliteSocialStoragePort(
    sqlite,
    kernelOutboxRepo,
    (agentId) => privacyDeletionService.deleteSocialMemory(agentId),
    memoryBackground,
  )
  const socialEvents = {
    publish: async (action: string, data: Record<string, unknown>) => {
      await gatewayHub.broadcast(createEnvelope('push', { action, ...data }))
    },
  }
  // AppManager：应用生命周期管理（依赖 ToolRegistry + PathResolver + GrantRegistry + 独立编译依赖）
  const appManager = new AppManagerImpl(
    db,
    toolRegistry,
    pathResolver,
    applicationRealms,
    grantRegistry,
    llmService,
    mdpEngine,
    agentManager,
    // 社交回复跟随角色指派；社交记忆整理使用独立任务模型。
    modelRoles.bindAgent(),
    modelRoles.bind('social_scorer'),
    // 社交应用等需要的内核资源依赖
    storeRegistry,
    socialStorage,
    socialEvents,
    kernelScheduler,
    inboundRouteRepo,
    configRepo,
    {
      async list(agentId, limit) {
        const diaryStat = await workspaceService.stat(agentId, 'dailynotes', 'social')
        if (!diaryStat.exists || !diaryStat.isDirectory) return []
        const entries = await workspaceService.list(agentId, 'dailynotes', 'social')
        const dates = new Map<string, number>()
        for (const entry of entries) {
          if (entry.isDirectory) continue
          const match = /^(\d{4}-\d{2}-\d{2})(?:-part-(\d+))?\.md$/.exec(entry.name)
          if (!match?.[1]) continue
          dates.set(match[1], (dates.get(match[1]) ?? 0) + 1)
        }
        return [...dates.entries()]
          .sort(([left], [right]) => right.localeCompare(left))
          .slice(0, limit)
          .map(([date, parts]) => ({ date, parts }))
      },
      async read(agentId, requestedDate) {
        const available = await this.list(agentId, 60)
        const date = requestedDate ?? available[0]?.date
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
        const entries = await workspaceService.list(agentId, 'dailynotes', 'social')
        const files = entries
          .filter((entry) => {
            if (entry.isDirectory) return false
            const match = /^(\d{4}-\d{2}-\d{2})(?:-part-(\d+))?\.md$/.exec(entry.name)
            return match?.[1] === date
          })
          .sort((left, right) => {
            const part = (name: string) => Number(/-part-(\d+)\.md$/.exec(name)?.[1] ?? 0)
            return part(left.name) - part(right.name)
          })
        if (!files.length) return null
        const content = (
          await Promise.all(
            files.map((file) =>
              workspaceService.read(agentId, `dailynotes/${file.name}`, 'social'),
            ),
          )
        ).join('\n\n')
        const maxLength = 16_000
        return {
          date,
          parts: files.length,
          content: content.slice(0, maxLength),
          truncated: content.length > maxLength,
        }
      },
    },
  )
  appManager.setConversationStateServices(threadService, flowStateService)
  dailyNotes.setApplicationSummaryCollector((agentId, date) =>
    appManager.collectDailySummaries(agentId, date),
  )
  logger.info('Agent 应用层已初始化（GrantRegistry + AppManager，含独立编译依赖）')
  // 内置社交应用 runtime factory 在 initAppContext() 中通过动态 import 注册

  const attachmentService = new AttachmentService(
    attachmentRepo,
    threadRepo,
    pathResolver.resolve('@data/attachments'),
    pdfParserService,
  )
  const resourceService = new ResourceService(attachmentService, threadService)
  const htmlPreviewService = new HtmlPreviewService(
    resourceService,
    attachmentService,
    threadService,
  )
  browserTools.setPreviewResolver(async (source, context) => {
    const { path } = await htmlPreviewService.issueForTool(context, source)
    return new URL(path, `http://127.0.0.1:${SERVER_PORT}`).href
  })
  setResourceService(resourceService)
  setImageReadResourceService(resourceService)
  toolExecutor.setScreenshotResourceService(resourceService)
  appManager.setResourcePort(resourceService.socialPort())
  await attachmentService.initialize()
  privacyDeletionService.setAttachmentCleaner((id, storageKey) =>
    attachmentService.purgeDeleted(id, storageKey),
  )
  await privacyDeletionService.initialize()
  kernelLifecycle.defer(() => attachmentService.dispose())
  const chatBackgroundService = new ChatBackgroundService(pathResolver, configRepo)
  const conversationProjection = new ConversationProjectionService(
    threadService,
    attachmentService,
    approvalService,
    agentInputService,
  )
  const pictoriaRealm = applicationRealms.register({
    realmId: 'infos.pictoria',
    appId: 'infos.pictoria',
    principalId: 'application:infos.pictoria',
    instanceId: 'managed',
  })
  const pictoriaDataPath = path.join(config.dataDir, 'applications', 'pictoria')
  const pictoria = new PictoriaIntegration(
    {
      db,
      configRepo,
      threadService,
      resourceService,
      attachmentService,
      llmService,
      applicationIntegration,
      conversationProjection,
      gatewayHub,
      modelRoles,
      kernelOutboxRepo,
    },
    toolRegistry,
    {
      appRoot: config.runtimeEnv.appRoot,
      workspaceRoot,
      applicationsRoot,
      dataPath: pictoriaDataPath,
      discoveryPath: path.join(pictoriaDataPath, 'discovery.json'),
      uiUrl:
        process.env.INFOS_PICTORIA_UI_URL ??
        (isPackagedRuntime ? '/applications/pictoria/' : 'http://127.0.0.1:7363'),
      packaged: isPackagedRuntime,
    },
    capabilityDirectory,
    capabilityHandles,
    nodeRegistry,
    pictoriaRealm,
    localNodeId,
  )
  kernelLifecycle.defer(() => pictoria.shutdown())
  await pictoria.initialize()
  approvalService.onRequested((request) => {
    if (!request.taskId) conversationProjection.invalidate(request.threadId)
    void gatewayHub.pushBusiness(
      'tool_approval_requested',
      { request },
      { type: 'active_input_seat', principalId: request.agentId },
      `approval:${request.agentId}`,
    )
  })
  approvalService.setWaitGuard((threadId) => runtimeStateService.suspendTimeout(threadId))
  approvalService.onResolved((request) => {
    if (!request.taskId) conversationProjection.invalidate(request.threadId)
    void gatewayHub.pushBusiness(
      'tool_approval_resolved',
      { request },
      { type: 'all_principal_clients', principalId: request.agentId },
      `approval:${request.agentId}`,
    )
  })
  agentInputService.onRequested((request) => {
    if (!request.taskId) conversationProjection.invalidate(request.threadId)
    void gatewayHub.pushBusiness(
      'agent_input_requested',
      { request },
      { type: 'active_input_seat', principalId: request.agentId },
      `agent-input:${request.agentId}`,
    )
  })
  agentInputService.setWaitGuard((threadId) => runtimeStateService.suspendTimeout(threadId))
  agentInputService.onResolved((request) => {
    if (!request.taskId) conversationProjection.invalidate(request.threadId)
    void gatewayHub.pushBusiness(
      'agent_input_resolved',
      { request },
      { type: 'all_principal_clients', principalId: request.agentId },
      `agent-input:${request.agentId}`,
    )
  })
  kernelEventBus.subscribe((event) => conversationProjection.consume(event))
  observerService.start(kernelEventBus)
  kernelLifecycle.defer(() => observerService.stop())
  kernelOutboxPublisher.start(kernelLifecycle)
  const completionAlertService = new CompletionAlertService(
    capabilityDirectory,
    capabilityHandles,
    localNodeId,
  )
  kernelLifecycle.defer(() => completionAlertService.stop())
  const conversationTurnService = new ConversationTurnService({
    estimateInitialInputTokens: (input) => agentService.estimateInitialInputTokens(input),
    threadService,
    contextCompiler,
    agentService,
    attachmentService,
    imageUnderstandingService,
    executionRuntime,
    eventNoteDraftCommitter,
    eventMemoryFallback,
    flowStateService,
    toolContextService,
    taskPlanService,
    productivityRuntime,
    onReplyReady: async (reply) => {
      if (reply.completedSuccessfully) {
        // 完成提醒不依赖聊天窗口订阅，也不能阻塞回复持久化与任务结算。
        void threadService
          .getThread(reply.threadId)
          .then((thread) =>
            completionAlertService.notify({
              id: `conversation:${reply.threadId}:${reply.messageId}`,
              kind: 'conversation',
              agentId: reply.agentId,
              agentName: agentManager.getAgent(reply.agentId)?.name ?? reply.agentId,
              title: thread?.title || '本轮对话已完成',
              completedAt: new Date().toISOString(),
              threadId: reply.threadId,
              messageId: reply.messageId,
            }),
          )
          .catch((error) =>
            logger.warn('对话完成提醒失败，回复结果不受影响', { error: String(error) }),
          )
      }
      await gatewayHub.pushBusiness('conversation_reply_ready', reply, {
        type: 'all_principal_clients',
        principalId: reply.agentId,
      })
    },
    getAgentModelConfig: modelRoles.bindAgent(),
    getModelConfigById: (id) => modelRoles.resolveById(id),
    retrievalFeedback: eventMemoryService,
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
  const backgroundTaskService = new BackgroundScheduler(
    backgroundTaskRepo,
    threadService,
    conversationTurnService,
    kernelScheduler,
    approvalService,
    agentInputService,
  )
  backgroundTaskService.setPlanService(taskPlanService)
  const authorizeTaskOrigin = async (
    origin: import('@infos/shared').TaskOrigin,
  ): Promise<string | undefined> => {
    const social = await configRepo.getJson<{ ownerQq?: string; agentId?: string }>('social')
    if (
      origin.platform !== 'qq' ||
      origin.channelType !== 'private' ||
      !social?.ownerQq ||
      origin.senderId !== String(social.ownerQq) ||
      origin.channelId !== origin.senderId ||
      !social.agentId ||
      !agentManager.getAgent(social.agentId)
    )
      return undefined
    return social.agentId
  }
  const taskDeliveryService = new TaskDeliveryService(db, gatewayHub, authorizeTaskOrigin)
  appManager.setCreativePort(pictoria.socialPort(authorizeTaskOrigin, taskDeliveryService))
  const taskControlService = new TaskControlService(
    backgroundTaskService,
    agentInputService,
    approvalService,
    authorizeTaskOrigin,
    taskDeliveryService,
    async (task) => {
      await desktopCapabilities.invoke(
        'control',
        { action: 'resume', taskId: task.id },
        {
          principalId: 'system',
          correlationId: `desktop-task-resume:${task.id}:${task.revision}`,
        },
      )
    },
    taskPlanService,
  )
  const unsubscribeTaskDelivery = kernelEventBus.subscribe((event) =>
    taskDeliveryService.enqueue(event),
  )
  const unsubscribeCompletionAlerts = backgroundTaskService.onEvent(({ type, task }) => {
    if (
      type !== 'background_task_completed' ||
      task.status !== 'completed' ||
      task.category === 'resident'
    )
      return
    void completionAlertService
      .notify({
        id: `task:${task.id}:${task.revision}`,
        kind: 'task',
        agentId: task.agentId,
        agentName: agentManager.getAgent(task.agentId)?.name ?? task.agentId,
        title: task.title,
        completedAt: new Date().toISOString(),
        threadId: task.targetThreadId ?? task.threadId,
        taskId: task.id,
      })
      .catch((error) =>
        logger.warn('后台任务完成提醒失败，任务结果不受影响', { error: String(error) }),
      )
  })
  kernelLifecycle.defer(() => {
    unsubscribeTaskDelivery()
    unsubscribeCompletionAlerts()
  })
  taskDeliveryService.recover()
  appManager.setTaskPorts({
    control: { execute: (origin, input) => taskControlService.remote(origin, input) },
    registerDelivery: (port) => taskDeliveryService.register(port),
  })
  appManager.setStatusCardPort({
    render: async (agentId, design) => {
      const page = design.sections.includes('tasks')
        ? await backgroundTaskRepo.query({
            agentId,
            status: ['queued', 'running', 'paused', 'waiting', 'waiting_input', 'blocked'],
            pageSize: 20,
          })
        : { items: [] }
      return (await desktopCapabilities.invoke(
        'statusCard',
        {
          design,
          tasks: page.items
            .filter((t) => t.category !== 'resident')
            .slice(0, 5)
            .map((t) => ({ title: t.title, status: t.status })),
        },
        {
          principalId: 'system',
          correlationId: `social-status-card:${crypto.randomUUID()}`,
          deadline: new Date(Date.now() + 15_000).toISOString(),
        },
      )) as import('@infos/shared').StatusCardImage
    },
  })
  setTaskToolRuntime({
    control: (agentId, input, threadId) =>
      taskControlService.execute(agentId, input, undefined, false, threadId),
    submitSegment: (taskId, executionId, result) =>
      backgroundTaskService.submitSegment(taskId, executionId, result),
    beforeTool: (taskId, executionId, name, callId) =>
      backgroundTaskService.beforeTool(taskId, executionId, name, callId),
    afterTool: (taskId, executionId) => backgroundTaskService.afterTool(taskId, executionId),
  })
  kernelLifecycle.defer(() => setTaskToolRuntime(undefined))
  kernelLifecycle.defer(() => setTaskPlanService(undefined))
  scheduler.registerPeriodic({
    name: 'task-continuation',
    displayName: '任务续行与投递',
    description: '检查任务等待条件并投递待发送的结果',
    intervalMs: 5_000,
    handler: async () => {
      agentInputService.expireUnanswered()
      await backgroundTaskService.wakeWaitingTasks()
      await taskDeliveryService.flush()
    },
  })
  schedulerService.setTaskDispatcher((input) => backgroundTaskService.dispatch(input))
  for (const agent of agentManager.listAgents()) {
    const residentId = `resident_memory_${agent.id}`
    const existingResident = await backgroundTaskRepo.findById(residentId)
    const residentThreadId =
      existingResident?.threadId ??
      (
        await threadService.createThread({
          agentId: agent.id,
          channel: 'desktop',
          purpose: 'background_task',
          title: '[常驻] 记忆运行维护',
        })
      ).id
    await backgroundTaskRepo.ensureResident({
      id: residentId,
      agentId: agent.id,
      threadId: residentThreadId,
      title: '记忆运行维护',
      instruction: '常驻维护事件记忆提取、关系反思与每日人格日记运行状态',
      metadataJson: JSON.stringify({ runtime: 'memory', readOnly: true }),
    })
  }
  // M05-篇3-1：启动时保留中断任务的 checkpoint（供手动 resumeInterrupted 恢复），
  // 不自动重启：重启后任务标记 crashed（合并入 failed 语义），误判断决重启闭环在后续版本
  // 品质续跑依赖用户确认后用 resume-interrupted 接口手动接力
  backgroundTaskService.recoverInterruptedTasks().catch((err) => {
    logger.warn(`后台任务中断恢复失败: ${err}`)
  })
  const arcaCollaboration = new ArcaCollaborationService(
    backgroundTaskService,
    arcaTools,
    configRepo,
    () =>
      arcaFederation.status().state === 'connected'
        ? arcaFederation.status().discovery?.application
        : undefined,
    threadService,
  )
  arcaCollaborationState.current = arcaCollaboration
  arcaCollaboration.start()
  arcaApplication.setBeforeStop(() => arcaCollaboration.prepareStop())
  kernelLifecycle.defer(() => arcaCollaboration.stop())
  const isRegisteredAgent = (agentId: string) => Boolean(agentManager.getAgent(agentId))
  const isEnabledAgent = (agentId: string) =>
    Boolean(agentManager.getAgent(agentId)) && agentManager.enabledAgents.has(agentId.toLowerCase())
  const strongholdService = new StrongholdService(db, isRegisteredAgent)
  const groupChatService = new GroupChatService(db, isEnabledAgent, (roomId, pairId) =>
    petStateService.rollbackRoomPair(roomId, pairId),
  )
  const strongholdTurnService = new StrongholdTurnService(
    strongholdService,
    groupChatService,
    threadService,
    contextCompiler,
    agentService,
    configRepo,
    gatewayHub,
    agentManager,
  )
  const backgroundTaskProjection = new BackgroundTaskProjectionService(
    backgroundTaskService,
    conversationProjection,
    approvalService,
    agentInputService,
  )
  const strongholdProjection = new StrongholdProjectionService(groupChatService)
  registerApplicationKernelObjectAdapters({
    registry: kernelObjects,
    apps: appManager,
    models: modelRepo,
    conversations: conversationProjection,
    backgroundTasks: backgroundTaskProjection,
  })
  // 管家复用主模型 LLM + mdp 管家提示词；未配置模型时自动退化为规则引擎
  const butlerService = new ButlerService(strongholdService, groupChatService, agentManager, {
    mdpEngine,
    llmService,
    getModelConfig: modelRoles.bind('butler'),
  })

  const databaseSnapshotService = new DatabaseSnapshotService(db)
  const distributedSyncService = new DistributedSyncService(
    config.dataDir,
    db,
    localNodeId,
    storeRegistry,
  )
  const logQueryService = new LogQueryService()

  return {
    db,
    pathResolver,
    assetRegistry,
    assetFileAuthority,
    kernelLifecycle,
    kernelObjects,
    capabilityHandles,
    capabilityDirectory,
    kernelOutboxRepo,
    kernelEventBus,
    kernelOutboxPublisher,
    outboxLifecycle,
    agentStateRepository,
    agentStateService,
    observerService,
    executionRuntime,
    kernelScheduler,
    configRepo,
    storeRegistry,
    threadRepo,
    attachmentRepo,
    backgroundTaskRepo,
    toolApprovalRepo,
    eventNoteRepo,
    factsRepo,
    knowledgeService,
    embeddingService,
    llmService,
    promptWorkspace,
    eventMemoryService,
    tokenUsageService,
    resetService,
    privacyDeletionService,
    modelRegistry,
    modelService,
    agentManager,
    petStateService,
    agentService,
    // AIOS: promptService 已移除（死代码）
    toolRegistry,
    // 第六阶段 #7: 暴露 toolExecutor 给 run_script 内部闭包统一鉴权
    toolExecutor,
    approvalService,
    agentInputService,
    policyEngine,
    // AIOS: taskManager 已移除（被 RuntimeStateService 替代）
    runtimeStateService,
    // AIOS: sessionService 已移除（被 CompanionSchedulerService 替代）
    companionSchedulerService,
    gatewayHub,
    nodeRegistry,
    scheduler,
    schedulerService,
    // AIOS: Thread + Context 域
    threadService,
    flowStateService,
    toolContextService,
    contextCompiler,
    taskPlanService,
    conversationTurnService,
    conversationProjection,
    backgroundTaskProjection,
    strongholdProjection,
    attachmentService,
    resourceService,
    htmlPreviewService,
    chatBackgroundService,
    // M05: 统一任务中心
    backgroundTaskService,
    taskControlService,
    taskDeliveryService,
    productivityRuntime,
    workspaceBrowserService,
    capabilityGate,
    skillLoader,
    // Node Capability Transport
    capabilityBridge,
    desktopCapabilities,
    remoteShellCapabilities,
    arcaApplication,
    pictoria,
    arcaCollaboration,
    // 第七阶段 #7: 入站路由表 Repository
    inboundRouteRepo,
    inboundRouteService,
    packageRegistry,
    packageInstaller,
    packageRuntime,
    mcpManager,
    mcpRegistrySynchronizer,
    mcpConfigService,
    mcpRepo,
    promptTemplateLoader: new PromptTemplateLoader(pathResolver),
    strongholdService,
    strongholdTurnService,
    butlerService,
    groupChatService,
    groupChatDispatcher: new GroupChatDispatcher(groupChatService),

    // 注意：社交桥接（SocialBridge）已迁移到 packages/apps/social/runtime/socialBridge.ts
    // 由 SocialAppRuntime 独立管理，不再通过主 AppContext 暴露

    // ── 语音服务 ──
    ttsService,
    audioDeliveryService,
    asrService,
    realtimeSessionManager: new RealtimeSessionManager({
      ttsService,
      asrService,
      agentService,
      gatewayHub,
      threadService,
      conversationTurnService,
      kernelScheduler,
    }),

    // ── 系统信息 ──
    systemService: new SystemService(pathResolver),
    weatherService,
    integrationService,
    pdfParserService,
    tokenCounter,
    databaseSnapshotService,
    distributedSyncService,
    logQueryService,

    // ── AIOS第八阶段：Application Realm层 ──
    applicationRealms,
    grantRegistry,
    applicationResourceAccess,
    applicationIntegration,
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
        enabled: (await configRepo.get(EMBEDDING_ENABLED_KEY)) !== 'false',
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

      const previousDimension = storeRegistry.getDimension()
      eventMemoryService.invalidateForDeletion()
      embeddingService.reconfigure(newConfig)
      eventMemoryService.syncAdvancedRetrievalConfig(await loadMemoryRuntimeConfig(configRepo))
      if (previousDimension !== newConfig.dimension) {
        storeRegistry.resetAllForDimension(newConfig.dimension)
        for (const agent of agentManager.listAgents()) {
          await eventMemoryService.rebuildAgentStore(agent.id)
        }
        await factsRepo.rebuildStore()
      }
      knowledgeService.embeddingChanged()
    },

    async reloadMemoryBackgroundConfig(): Promise<void> {
      memoryBackground.setEnabled((await configRepo.get(MEMORY_BACKGROUND_ENABLED_KEY)) !== 'false')
      if (!memoryBackground.enabled) {
        await dailyNotes.pauseBackground()
      }
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
 * 2. 激活用户 Package
 * 3. Package Tool Contribution 注册到 ToolRegistry
 * 4. 扫描资产 (AssetRegistry)
 */
export async function initAppContext(ctx: AppContext): Promise<void> {
  // 0. 注册内置社交应用 runtime factory
  // AIOS: 内置Social通过受信任Runtime注册表创建
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
  setRemoteShellCapabilityRuntime(ctx.remoteShellCapabilities)
  setSkillResourceLoader(ctx.skillLoader)
  setFlowStateService(ctx.flowStateService)
  setTaskPlanService(ctx.taskPlanService)
  setAgentInputService(ctx.agentInputService)
  setSocialInteractionManager(ctx.appManager)

  // 1.1 绑定 run_script 工具的内部执行器 (需要在注册后绑定，因为要访问已注册的工具)
  const { runScriptTool } = await import('./tools/runScript')
  runScriptTool.bindToolExecutor!(async (name, args, source, runtimeContext) => {
    // 第六阶段 #7: 统一走 RegistryToolExecutor.execute，让 NIT 脚本内部调用的工具
    // 也走 CapabilityGate 鉴权 + ResourceScope 路径校验。
    // 之前直接调用 ToolRegistry.getHandler 会跳过所有鉴权，存在安全风险。
    const result = await ctx.toolExecutor.execute(name, args, source, {
      ...runtimeContext,
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

  //桌面工具保留原 Tool ABI与日志，执行统一委托 Electron Capability。
  setScreenshotProvider({
    capture: async () => {
      const result = (await ctx.desktopCapabilities.invoke(
        'screenCapture',
        {},
        {
          principalId: 'system',
          correlationId: `desktop-screenshot:${Date.now()}`,
        },
      )) as {
        screenshots?: Array<{
          dataUri?: string
          coordinateContext?: {
            displayId: string
            coordinateSpace: 'screenshot'
            screenshotWidth: number
            screenshotHeight: number
            bounds: { x: number; y: number; width: number; height: number }
            workArea: { x: number; y: number; width: number; height: number }
            scaleFactor: number
          }
        }>
      }
      const screenshot = result.screenshots?.[0]
      const base64 = screenshot?.dataUri?.replace(/^data:[^;]+;base64,/, '')
      return base64 ? { base64, coordinateContext: screenshot?.coordinateContext } : null
    },
  })
  setWindowProvider({
    getActiveWindows: async () =>
      (await ctx.desktopCapabilities.invoke(
        'listWindows',
        {},
        {
          principalId: 'system',
          correlationId: `desktop-windows:${Date.now()}`,
        },
      )) as Array<{ processName: string; title: string; handle?: number }>,
    activateWindow: async (target, context) =>
      String(
        await ctx.desktopCapabilities.invoke(
          'activateWindow',
          {
            target,
            __desktopCaller: {
              agentId: context?.agentId,
              threadId: context?.threadId,
              taskId: context?.taskId,
            },
          },
          {
            principalId: 'system',
            correlationId: context?.toolCallId ?? `desktop-window-activate:${Date.now()}`,
          },
          context?.signal,
        ),
      ),
  })
  setApplicationProvider({
    launch: async (appName, context) =>
      (await ctx.desktopCapabilities.invoke(
        'applicationLaunch',
        {
          appName,
          __desktopCaller: {
            agentId: context?.agentId,
            threadId: context?.threadId,
            taskId: context?.taskId,
          },
        },
        {
          principalId: 'system',
          correlationId: context?.toolCallId ?? `desktop-application-launch:${Date.now()}`,
        },
        context?.signal,
      )) as {
        application: string
        mode: 'activated' | 'launched'
        targetType: 'window' | 'path' | 'aumid'
      },
  })
  setDesktopAutomationProvider({
    execute: async (args, context) => {
      const keyboard = ['type', 'hotkey', 'key_down', 'key_up', 'notification'].includes(
        String(args.action),
      )
      return ctx.desktopCapabilities.invoke(
        keyboard ? 'keyboardAction' : 'mouseAction',
        {
          ...args,
          __desktopCaller: {
            agentId: context.agentId,
            threadId: context.threadId,
            taskId: context.taskId,
          },
        },
        {
          principalId: 'system',
          correlationId: context.toolCallId ?? `desktop-action:${Date.now()}`,
          executionId: context.executionId,
          processId: context.processId,
          deadline: context.deadline,
        },
        context.signal,
      )
    },
    getMousePosition: async () =>
      (await ctx.desktopCapabilities.invoke(
        'mousePosition',
        {},
        {
          principalId: 'system',
          correlationId: `desktop-mouse-position:${Date.now()}`,
        },
      )) as { x: number; y: number },
  })
  logger.info('桌面工具已绑定 Electron desktop.environment Capability')

  // 注意：社交工具 Provider 注入已迁移到 SocialAppRuntime.initialize()
  // （由 SocialAppRuntime 在创建 SocialBridge 后自动注入）

  // 1.8 注入据点服务到工具层 (始终可用，群聊模式由 CapabilityGate 门控)
  setStrongholdService(ctx.strongholdService)
  setButlerService(ctx.butlerService)
  logger.info('据点工具已注入 (StrongholdService)')

  // 2. 激活用户 Package；失败包保持 failed 状态，不阻断内核启动。
  for (const installed of ctx.packageRegistry.list()) {
    if (ctx.integrationService.managedPackage(installed.manifest.packageId)) continue
    try {
      await ctx.packageRuntime.activate(installed.manifest.packageId)
    } catch (err) {
      logger.warn(`激活 Package ${installed.manifest.packageId} 失败: ${err}`)
    }
  }

  await ctx.integrationService.reconcile()
  // 3. Package Tool Contribution 已在激活时直接注册到 ToolRegistry。

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
    const synced = ctx.mcpRegistrySynchronizer.sync()
    logger.info(`MCP 工具桥接完成: ${synced.registered.length} 个工具已同步`)
  } catch (err) {
    logger.warn(`MCP 连接出错 (非致命): ${err}`)
  }

  // 6. 注入陪伴调度器工厂到 CompanionSchedulerService（AIOS: 从 SessionService 解耦）
  ctx.companionSchedulerService.setSchedulerFactory((agentId: string) => {
    return new CompanionScheduler({
      agentId,
      kernelScheduler: ctx.kernelScheduler,
      // 用户称呼：读取对应 Agent 的 agent.json owner_appellation（兜底"主人"），替换触发语中的"主人"占位
      getOwnerAppellation: async () => ctx.agentManager.getOwnerAppellation(agentId),
      onProactiveChat: async (params) => {
        // 主动行为复用 Agent 最新 Desktop Thread，保持 App 与桌宠对话连续。
        const thread = await ctx.threadService.getOrCreateLatest(
          params.agentId,
          'desktop',
          'conversation',
        )

        const triggerContent = `(系统触发: 当前时段=${params.timeSlot}，陪伴参考=${params.trigger}。请判断是否适合主动陪伴，没有值得说的内容可安静结束本轮，不必为了触发而发言。若有实际观察支持的帮助机会，可用 suggest_next_step 保存建议；需要稍后重新检查可用 schedule_follow_up，避免持续等待或反复打扰。)`

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
        logger.info(`陪伴模式结束: agent=${_agentId}`)
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
