/**
 * Router 模块导出
 *
 * @module packages/backend/src/routers
 */

export { createArcaRouter } from './arca.router'
export { createArcaCollaborationRouter } from './arcaCollaboration.router'
export { createArcaUiRouter } from './arcaUi.router'
export { createApplicationsRouter } from './applications.router'
export { createChatRouter } from './chat.router'
export { createAttachmentRouter } from './attachment.router'
export { createMemoryRouter } from './memory.router'
export { createKnowledgeRouter } from './knowledge.router'
export { createConfigRouter } from './config.router'
export { createModelRouter } from './model.router'
export { createSystemRouter } from './system.router'
export { createDistributedRouter } from './distributed.router'
export { createAgentRouter } from './agent.router'
export { createRuntimeRouter } from './runtime.router'
export { createApprovalRouter } from './approval.router'
export { createAgentInputRouter } from './agentInput.router'
export { createSurfaceRouter } from './surface.router'
export { createWorkspaceRouter } from './workspace.router'
export { createTerminalRouter } from './terminal.router'
export { createSchedulerRouter } from './scheduler.router'
export { createAssetRouter } from './asset.router'
export { createGatewayRouter } from './gateway.router'
export { createMaintenanceRouter } from './maintenance.router'
export { createResetRouter } from './reset.router'
export { createVoiceRouter } from './voice.router'
export { createMcpRouter } from './mcp.router'
export { createMetricsRouter } from './metrics.router'
export { createStrongholdRouter } from './stronghold.router'
// 注意：createSocialRouter 已迁移到 packages/apps/social/runtime/social.router.ts
export { createInboundRouteRouter } from './inboundRoute.router'
export { createHealthRouter } from './health.router'
// M05: 统一任务中心 API
export { createBackgroundTaskRouter } from './backgroundTask.router'
