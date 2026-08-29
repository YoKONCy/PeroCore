/**
 * MCP Client Manager — MCP 服务器连接管理
 *
 * 管理与外部 MCP Server 的连接生命周期:
 * - 根据 mcpConfigs 配置自动连接/断开
 * - 从 MCP Server 发现工具 → 桥接到 ToolRegistry
 * - 支持 stdio 和 Streamable HTTP 两种 transport (MCP 2025.03+ 标准)
 *
 * 使用官方 @modelcontextprotocol/sdk。
 *
 * @module packages/backend/src/services/mcp/mcpClientManager
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpConfigRepository } from '../../repositories/mcp.repo'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MCPClient')

// ── 类型 ──

/** MCP 连接信息 */
export interface McpConnection {
  /** 配置 ID */
  configId: number
  /** 配置名称 */
  name: string
  /** MCP Client 实例 */
  client: Client
  /** Transport 实例 */
  transport: StdioClientTransport | StreamableHTTPClientTransport
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'error'
  /** 发现的工具列表 */
  tools: McpToolInfo[]
  /** 错误信息 */
  error?: string
}

/** MCP 工具信息 (从 Server 发现) */
export interface McpToolInfo {
  /** 工具名 */
  name: string
  /** 描述 */
  description?: string
  /** JSON Schema 参数定义 */
  inputSchema: Record<string, unknown>
  /** 来源 MCP Server 名称 */
  serverName: string
}

/** MCP 管理器状态 */
export interface McpManagerStatus {
  totalServers: number
  connectedServers: number
  totalTools: number
  connections: Array<{
    name: string
    status: string
    toolCount: number
    error?: string
  }>
}

// ── Manager ──

export class McpClientManager {
  /** name → 连接信息 */
  private connections = new Map<string, McpConnection>()

  constructor(private mcpRepo: McpConfigRepository) {
    logger.info('MCP Client Manager 初始化完成')
  }

  /**
   * 启动所有已启用的 MCP Server 连接
   *
   * 读取 mcpConfigs 表，为每个 enabled 的配置建立连接。
   */
  async connectAll(): Promise<void> {
    const configs = await this.mcpRepo.findEnabled()
    const enabledNames = new Set(configs.map((config) => config.name))
    for (const name of [...this.connections.keys()]) {
      if (!enabledNames.has(name)) await this.disconnectOne(name)
    }

    if (configs.length === 0) {
      logger.info('无已启用的 MCP 服务器配置')
      return
    }

    logger.info(`正在连接 ${configs.length} 个 MCP 服务器...`)

    const results = await Promise.allSettled(configs.map((config) => this.connectOne(config)))

    let successCount = 0
    for (const result of results) {
      if (result.status === 'fulfilled') successCount++
    }

    logger.info(`MCP 连接完成: ${successCount}/${configs.length} 成功`)
  }

  /**
   * 连接单个 MCP Server
   */
  async connectOne(config: {
    id: number
    name: string
    type: string | null
    command: string | null
    args: string | null
    env: string | null
    url: string | null
  }): Promise<McpConnection> {
    const { id, name } = config

    // 如果已有连接，先断开
    if (this.connections.has(name)) {
      await this.disconnectOne(name)
    }

    logger.info(`正在连接 MCP 服务器: ${name} (type=${config.type})`)

    try {
      // 创建 Transport
      const transport = this.createTransport(config)

      // 创建 Client
      const client = new Client({ name: `infos-${name}`, version: '0.9.3-hotfix2' }, { capabilities: {} })

      // 连接
      await client.connect(transport)

      // 发现工具
      const toolsResult = await client.listTools()
      const tools: McpToolInfo[] = (toolsResult.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        serverName: name,
      }))

      const connection: McpConnection = {
        configId: id,
        name,
        client,
        transport,
        status: 'connected',
        tools,
      }

      this.connections.set(name, connection)
      logger.success(`MCP 服务器 "${name}" 已连接，发现 ${tools.length} 个工具`)

      return connection
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`MCP 服务器 "${name}" 连接失败: ${errorMsg}`)

      const failedConnection: McpConnection = {
        configId: id,
        name,
        client: null!,
        transport: null!,
        status: 'error',
        tools: [],
        error: errorMsg,
      }
      this.connections.set(name, failedConnection)
      return failedConnection
    }
  }

  /**
   * 断开单个 MCP Server
   */
  async disconnectOne(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return

    try {
      if (conn.transport) {
        await conn.transport.close()
      }
    } catch (err) {
      logger.warn(`MCP 服务器 "${name}" 断开时出错: ${err}`)
    }

    this.connections.delete(name)
    logger.info(`MCP 服务器 "${name}" 已断开`)
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.connections.keys()]
    await Promise.allSettled(names.map((name) => this.disconnectOne(name)))
    logger.info('所有 MCP 连接已断开')
  }

  /**
   * 重新连接单个 Server (热重载)
   */
  async reconnectOne(name: string): Promise<McpConnection | null> {
    const config = await this.mcpRepo.findByName(name)
    if (!config) {
      logger.warn(`未找到 MCP 配置: ${name}`)
      return null
    }
    return this.connectOne(config)
  }

  /**
   * 调用 MCP Server 的工具
   *
   * @param serverName MCP Server 名称
   * @param toolName 工具名
   * @param args 工具参数
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const conn = this.connections.get(serverName)
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP 服务器 "${serverName}" 未连接`)
    }

    logger.debug(`调用 MCP 工具: ${serverName}/${toolName}`)

    if (signal?.aborted) throw new Error('MCP工具调用已取消')
    const result = await conn.client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      { signal },
    )

    return result
  }

  /**
   * 根据工具名查找并调用 (自动路由到正确的 Server)
   */
  async callToolByName(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // 查找提供该工具的 Server
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue
      const tool = conn.tools.find((t) => t.name === toolName)
      if (tool) {
        return this.callTool(conn.name, toolName, args)
      }
    }
    throw new Error(`未找到 MCP 工具: ${toolName}`)
  }

  /**
   * 获取所有已发现的 MCP 工具
   */
  getAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools)
      }
    }
    return tools
  }

  /**
   * 获取管理器状态
   */
  getStatus(): McpManagerStatus {
    const connections = [...this.connections.values()]
    return {
      totalServers: connections.length,
      connectedServers: connections.filter((c) => c.status === 'connected').length,
      totalTools: this.getAllTools().length,
      connections: connections.map((c) => ({
        name: c.name,
        status: c.status,
        toolCount: c.tools.length,
        error: c.error,
      })),
    }
  }

  // ── 内部方法 ──

  /** 根据配置创建 Transport */
  private createTransport(config: {
    type: string | null
    command: string | null
    args: string | null
    env: string | null
    url: string | null
  }): StdioClientTransport | StreamableHTTPClientTransport {
    const type = config.type ?? 'stdio'

    if (type === 'sse' && config.url) {
      // MCP 2025.03+ 标准: Streamable HTTP 替代旧版 SSE
      return new StreamableHTTPClientTransport(new URL(config.url))
    }

    // stdio (默认)
    if (!config.command) {
      throw new Error('stdio 类型的 MCP 配置必须指定 command')
    }

    const args = config.args ? (JSON.parse(config.args) as string[]) : []
    const env = config.env ? (JSON.parse(config.env) as Record<string, string>) : {}

    return new StdioClientTransport({
      command: config.command,
      args,
      env: { ...process.env, ...env } as Record<string, string>,
    })
  }
}
