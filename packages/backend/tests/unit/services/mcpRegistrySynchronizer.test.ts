import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../../../src/services/agent/toolRegistry'
import { McpRegistrySynchronizer } from '../../../src/services/mcp/mcpRegistrySynchronizer'
import type { McpClientManager } from '../../../src/services/mcp/mcpClientManager'

function managerWith(tools: Array<{ serverName: string; name: string }>) {
  return {
    getAllTools: vi.fn(() =>
      tools.map((tool) => ({
        ...tool,
        description: `${tool.name}描述`,
        inputSchema: { type: 'object', properties: {} },
      })),
    ),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '完成' }] }),
  } as unknown as McpClientManager
}

describe('McpRegistrySynchronizer', () => {
  it('应注册、更新并移除运行期MCP工具', async () => {
    const registry = new ToolRegistry()
    const manager = managerWith([{ serverName: 'Demo Server', name: 'Read File' }])
    const synchronizer = new McpRegistrySynchronizer(manager, registry)

    synchronizer.sync()
    expect(registry.has('mcp_demo_server_read_file')).toBe(true)

    vi.mocked(manager.getAllTools).mockReturnValue([])
    const result = synchronizer.sync()
    expect(result.removed).toEqual(['mcp_demo_server_read_file'])
    expect(registry.has('mcp_demo_server_read_file')).toBe(false)
  })

  it('应将AbortSignal透传到MCP Manager', async () => {
    const registry = new ToolRegistry()
    const manager = managerWith([{ serverName: 'demo', name: 'read' }])
    new McpRegistrySynchronizer(manager, registry).sync()
    const signal = new AbortController().signal

    await registry.getHandler('mcp_demo_read')?.(
      {},
      {
        agentId: 'pero',
        sessionId: 's1',
        source: 'desktop',
        threadId: 's1',
        channel: 'desktop',
        signal,
      },
    )

    expect(manager.callTool).toHaveBeenCalledWith('demo', 'read', {}, signal)
  })
})
