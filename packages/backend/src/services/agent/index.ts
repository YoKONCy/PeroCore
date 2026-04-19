/**
 * Agent 模块导出
 *
 * @module packages/backend/src/services/agent
 */

export { AgentManager, type AgentProfile } from './agentManager'
export { AgentService, type AgentServiceDeps } from './agentService'
export {
  runReActLoop,
  type ReActConfig,
  type ToolExecutor,
  type ToolExecutionResult,
} from './reactLoop'
export { RegistryToolExecutor } from './toolExecutor'
export { ToolRegistry, type ToolHandler, type ToolContext } from './toolRegistry'
export { TaskManager } from './taskManager'
