import type { ToolRegistry } from '../agent/toolRegistry'
import type { McpClientManager } from './mcpClientManager'
import { bridgeMcpTools, getMcpToolNames } from './mcpToolBridge'
import { createLogger } from '../../lib/logger'

const logger = createLogger('McpRegistrySync')

/** 保持MCP Manager发现结果与ToolRegistry完全一致。 */
export class McpRegistrySynchronizer {
  private registered = new Set<string>()

  constructor(
    private readonly manager: McpClientManager,
    private readonly registry: ToolRegistry,
  ) {}

  sync(): { registered: string[]; removed: string[] } {
    const tools = this.manager.getAllTools()
    const next = new Set(getMcpToolNames(tools))
    const removed: string[] = []
    for (const name of this.registered) {
      if (!next.has(name) && this.registry.unregister(name)) removed.push(name)
    }
    const registered: string[] = []
    for (const tool of bridgeMcpTools(this.manager, tools)) {
      this.registry.register(tool.definition, (args, context) => tool.execute(args, context))
      registered.push(tool.definition.name)
    }
    this.registered = next
    logger.info(
      `MCP Registry已同步: 当前=${next.size}, 更新=${registered.length}, 移除=${removed.length}`,
    )
    return { registered, removed }
  }

  clear(): number {
    let count = 0
    for (const name of this.registered) if (this.registry.unregister(name)) count++
    this.registered.clear()
    return count
  }
}
