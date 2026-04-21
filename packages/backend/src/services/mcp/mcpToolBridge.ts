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

import type { McpClientManager, McpToolInfo } from './mcpClientManager'
import type { BuiltinTool } from '../../tools'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MCPToolBridge')

/**
 * 将 MCP 工具转换为 BuiltinTool 格式
 *
 * @param manager MCP Client Manager 引用
 * @param tools 要转换的 MCP 工具列表
 * @returns 可注册到 ToolRegistry 的工具数组
 */
export function bridgeMcpTools(manager: McpClientManager, tools: McpToolInfo[]): BuiltinTool[] {
  return tools.map((tool) => createBridgedTool(manager, tool))
}

/**
 * 创建单个桥接工具
 */
function createBridgedTool(manager: McpClientManager, tool: McpToolInfo): BuiltinTool {
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
        }

        // 拼接所有 text 类型的 content
        if (mcpResult.content && Array.isArray(mcpResult.content)) {
          const texts = mcpResult.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
          return texts.join('\n') || JSON.stringify(result)
        }

        return JSON.stringify(result)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error(`MCP 工具执行失败: ${qualifiedName} — ${errorMsg}`)
        return JSON.stringify({ error: errorMsg })
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
