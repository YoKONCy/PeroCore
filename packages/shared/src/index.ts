/**
 * @infos/shared 包入口
 *
 * 共享类型、常量和工具函数的统一导出。
 *
 * @module packages/shared/src
 */

export {
  PerformanceBaselineRegistry,
  type PerformanceSummary,
  type PerformanceGate,
} from './performanceBaseline'

export {
  KERNEL_PROTOCOL_VERSIONS,
  negotiateKernelProtocol,
  validateKernelEnvelope,
  validateKernelEventEnvelope,
  validateSurfaceFrame,
  validateVersionedMessage,
  type KernelProtocolVersion,
  type KernelProtocolHello,
  type KernelProtocolAgreement,
} from './kernelProtocol'

// 类型导出 — 逻辑微内核协议
export type {
  KernelId,
  KernelObjectId,
  KernelExecutionId,
  KernelProcessId,
  KernelEventId,
  KernelCapabilityId,
  KernelObjectRef,
  KernelExecutionClass,
  KernelExecutionState,
  KernelExecutionWaitReason,
  KernelExecutionUsage,
  KernelExecutionSnapshot,
  KernelExecutionBudget,
  KernelExecutionDescriptor,
  KernelExitStatus,
  KernelCapabilityRisk,
  KernelCapabilityOperationDefinition,
  KernelCapabilityDefinition,
  KernelCapabilityOffer,
  KernelCapabilityRequirement,
  KernelCapabilityHandle,
  KernelEventDurability,
  KernelCarrier,
  DeliveryAudience,
  DurableStreamCursor,
  DurableStreamSnapshot,
  DurableStreamDescriptor,
  KernelCallContext,
  KernelError,
  KernelEnvelope,
  KernelEventEnvelope,
  KernelExecutionEvent,
  ConversationKernelEvent,
  KernelEvent,
  KernelOutboxEventInput,
} from './types'

export type {
  ApplicationEndpointKind,
  ApplicationLifecycleState,
  ApplicationAddress,
  ApplicationEndpointDescriptor,
  ApplicationIntegrationDescriptor,
  ApplicationEnvelope,
  ApplicationTaskState,
  ApplicationTaskAccepted,
  ApplicationTaskSnapshot,
  ApplicationDiscoveryRecord,
  ApplicationCapabilityRequirement,
  ApplicationCapabilityOffer,
  ApplicationToolProjection,
  ApplicationAdapterManifest,
  ApplicationSurfaceSlot,
  ApplicationSurfaceDeclaration,
  PersonaProjection,
  ApplicationKnowledgeHit,
  ApplicationModelRequest,
  ApplicationModelResult,
} from './types'

export type {
  EventNoteStatus,
  EventNoteOriginMode,
  EventNoteWriteScope,
  EventNoteRelation,
  EventNoteAffect,
  EventNoteOrigin,
  EventNote,
  EventNoteDraftInput,
  EventNoteRelationView,
  EventNoteDetail,
  ConversationCoverage,
  EventNoteQuery,
  EventNoteQueryDirection,
  EventNoteQueryPathEdge,
  EventNoteQueryPath,
  EventNoteQueryEntity,
  EventNoteQueryResult,
  EventNoteArchiveFilter,
  EventNoteFacetValue,
  EventNoteArchiveFacets,
  EventNoteArchiveStats,
  EventNoteArchiveResult,
  EventMemoryGraphSnapshot,
  KnowledgeQuery,
  KnowledgeRecord,
  KnowledgeStorePort,
  FactRecord,
  FactArchiveRecord,
  FactArchiveObject,
  FactArchiveResult,
  FactObjectCandidate,
  FactQueryPathEdge,
  FactQueryPath,
  FactQueryResult,
} from './types'

// 类型导出 — Internal Surface Protocol
export type {
  SurfaceId,
  SurfaceNodeId,
  SurfaceNodeKind,
  SurfaceNodeLifecycle,
  SurfaceNode,
  MarkdownSurfaceProps,
  NativeReasoningSurfaceProps,
  ThinkingSurfaceProps,
  ToolCallSurfaceProps,
  ToolResultSurfaceProps,
  StatusSurfaceProps,
  ErrorSurfaceProps,
  AttachmentSurfaceProps,
  ProgressSurfaceProps,
  InputSurfaceProps,
  ApprovalSurfaceProps,
  SurfaceDescriptor,
  SurfaceProjectionSnapshot,
  PanelSurfaceProps,
  TableSurfaceProps,
  NotificationSurfaceProps,
  DocumentSurfaceProps,
  ProgrammableIslandSurfaceProps,
  ConversationSurfaceDescriptor,
  SurfaceOperation,
  SurfaceFrame,
  ConversationContentBlock,
  ConversationMessageProjection,
  ConversationProjectionSnapshot,
  SurfaceInput,
  BackgroundTaskProjectionSnapshot,
  StrongholdMessageProjection,
  StrongholdProjectionSnapshot,
} from './types'

// 类型导出 — Runtime Adapter
export type {
  RuntimeIdentity,
  RuntimeStableHandle,
  RuntimeSnapshot,
  RuntimeAdapterRequest,
  RuntimeAdapterResult,
  RuntimeAdapter,
} from './types'

// 类型导出 — API
export type {
  SocialContactImpressionRecord,
  SocialEventPort,
  SocialExecutionPort,
  SocialMessageRecord,
  SocialStoragePort,
  SocialSyncCursorRecord,
} from './types'

export type {
  ApiResponse,
  PaginatedData,
  PaginationParams,
  SseEventType,
  ThreadChannel,
} from './types'
export type { SseDoneEvent, SseErrorEvent, SseEvent } from './types'

// 类型导出 — 记忆
export type { MemoryType, MemorySource, Sentiment, MemoryDto, CreateMemoryDto } from './types'

// 类型导出 — Agent
export type {
  AgentRole,
  ModeCapability,
  SkillManifest,
  ResolvedCapability,
  AgentPublicProfile,
  AgentProfileDto,
  PetStateDto,
  UpdatePetStateDto,
} from './types'

// 类型导出 — 聊天
export type { ChatRole, ConversationLogDto, AnalysisStatus, AiModelConfigDto } from './types'

export { WEB_PAGE_OPERATIONS, webPageCapabilityName } from './types'
export type {
  WebPageOperation,
  DaemonToNodeMessage,
  NodeToDaemonMessage,
  CapabilityTransportMessage,
  ScreenCaptureResult,
  ClipboardReadResult,
  ClipboardWriteResult,
  ActiveWindowResult,
} from './types'

// 类型导出 — Package
export type {
  PackagePermission,
  PackageTrustLevel,
  PackageContributionKind,
  PackageContribution,
  PackageCapabilityRequirement,
  PackageSignature,
  PackageManifest,
  ToolDisplayMeta,
  ToolVisualSignatureMeta,
  PlatformId,
} from './types'

export type {
  ContextRegionKind,
  ContextRegionTrust,
  ContextRegionDelivery,
  ContextTokenizer,
  ContextRegionMaterializer,
  ContextRegion,
  ContextRegionRequest,
  ContextRegionProvider,
  ContextRegionManifestEntry,
  ContextRegionCompilation,
} from './types'

export type {
  KernelNodeId,
  KernelNodeSessionId,
  KernelInputSeatId,
  KernelNodeFacet,
  KernelNodeTrust,
  KernelNodeHealth,
  KernelExecutionPlacement,
  KernelDataResidency,
  KernelNodePlatform,
  KernelNodeDescriptor,
  NodeDescriptor,
  KernelNodeSession,
  NodeSession,
  KernelNodePlacement,
  KernelPlacementRequirement,
  KernelInputSeat,
  InputSeatLease,
  KernelResourceAuthority,
  KernelNodeRoute,
} from './types'

export type {
  WebEvidenceKind,
  WebTrustLevel,
  WebSideEffectClass,
  WebInteractionHandle,
  WebSceneEvidence,
  WebSceneAffordance,
  WebSceneObject,
  WebInjectionFinding,
  WebInteractionScene,
  WebExpectedEffect,
  WebObservedEffect,
  WebActionIntent,
  WebActionReceipt,
  WebSiteModel,
  WebTaskCheckpoint,
} from './types'

export type {
  KernelAssetId,
  KernelFileHandleId,
  KernelTransferId,
  KernelCredentialId,
  KernelCredentialHandleId,
  KernelAssetObject,
  KernelFileOperation,
  KernelFileHandle,
  KernelTransferDirection,
  KernelTransferState,
  KernelTransferObject,
  KernelRuntimeEvent,
  KernelCredentialObject,
  KernelCredentialHandle,
} from './types'
export { createResourceObjectRef } from './types'

// 常量导出（值）
export {
  SUCCESS_CODES,
  CLIENT_ERROR_CODES,
  SERVER_ERROR_CODES,
  CODE_MESSAGES,
  CODE_TO_HTTP,
} from './constants'

// 常量导出（类型）
export type { ResponseCode } from './constants'

// 类型导出 — Gateway WS 协议
export type {
  GatewayMessageType,
  GatewayEnvelope,
  GatewayPayload,
  StateUpdatePayload,
  TaskProgressPayload,
  NotificationPayload,
  SystemErrorPayload,
  HelloPayload,
  HelloAckPayload,
  HeartbeatPayload,
  ChatRequestPayload,
  GenericPayload,
  PushAction,
  RequestAction,
  CataloguedGatewayAction,
} from './types'
export { GATEWAY_ACTION_CATALOG, gatewayActionPolicy } from './types'
