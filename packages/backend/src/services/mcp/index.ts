/**
 * MCP 模块导出
 *
 * @module packages/backend/src/services/mcp
 */

export { McpClientManager } from './mcpClientManager'
export type { McpConnection, McpToolInfo, McpManagerStatus } from './mcpClientManager'
export { bridgeMcpTools, getMcpToolNames } from './mcpToolBridge'
