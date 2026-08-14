/**
 * MCP Tool Bridge — MCP 工具 → ToolRegistry 桥接
 *
 * 将 MCP Server 发现的工具转换为内置 BuiltinTool 格式，
 * 注册到 ToolRegistry 中供 Agent 调用。
 *
 * 这使得 Agent 可以像调用本地工具一样调用 MCP 工具，
 * 无需关心工具是本地实现还是来自 MCP Server。
 *
 * @module packages/backend/src/services/mcp/mcpToolBridge
 */

import type { ToolDefinition } from '../pipeline/types'
import type { ToolExecutionResult } from '../agent/reactLoop'
import type { McpClientManager, McpToolInfo } from './mcpClientManager'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MCPToolBridge')

export interface BridgedMcpTool {
  definition: ToolDefinition
  execute(args: Record<string, unknown>): Promise<string | ToolExecutionResult>
}

/**
 * 将 MCP 工具转换为 ToolRegistry 可注册的格式
 *
 * @param manager MCP Client Manager 引用
 * @param tools 要转换的 MCP 工具列表
 * @returns 可注册到 ToolRegistry 的工具数组
 */
export function bridgeMcpTools(manager: McpClientManager, tools: McpToolInfo[]): BridgedMcpTool[] {
  return tools.map((tool) => createBridgedTool(manager, tool))
}

/**
 * 创建单个桥接工具
 */
function createBridgedTool(manager: McpClientManager, tool: McpToolInfo): BridgedMcpTool {
  // 为避免与内置工具冲突，MCP 工具名加前缀
  const qualifiedName = `mcp_${tool.serverName}_${tool.name}`

  return {
    definition: {
      name: qualifiedName,
      description: `[MCP: ${tool.serverName}] ${tool.description ?? tool.name}`,
      parameters: tool.inputSchema,
    },

    async execute(args) {
      logger.debug(`MCP 工具调用: ${qualifiedName}`, { args })

      try {
        const result = await manager.callTool(
          tool.serverName,
          tool.name,
          args as Record<string, unknown>,
        )

        // MCP 返回的是 CallToolResult，提取 content
        const mcpResult = result as {
          content?: Array<{ type: string; text?: string }>
          isError?: boolean
        }

        const texts = (mcpResult.content ?? [])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
        if (mcpResult.isError) {
          return {
            output: texts.join('\n') || 'MCP 工具返回业务失败',
            durationMs: 0,
            isError: true,
            shouldTerminate: false,
          }
        }

        if (texts.length > 0) return texts.join('\n')
        return JSON.stringify(result)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error(`MCP 工具执行失败: ${qualifiedName} — ${errorMsg}`)
        return {
          output: `MCP 工具执行失败: ${errorMsg}`,
          durationMs: 0,
          isError: true,
          shouldTerminate: false,
        }
      }
    },
  }
}

/**
 * 获取所有 MCP 工具的名称列表 (用于 CapabilityGate 白名单)
 */
export function getMcpToolNames(tools: McpToolInfo[]): string[] {
  return tools.map((t) => `mcp_${t.serverName}_${t.name}`)
}
