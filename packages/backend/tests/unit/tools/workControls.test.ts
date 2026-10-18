import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry, type ToolContext } from '@infos/backend/services/agent/toolRegistry'
import { RegistryToolExecutor } from '@infos/backend/services/agent/toolExecutor'
import { isToolAllowedInInteractionMode } from '@infos/backend/tools/interactionMode'
import {
  isSystemProtocolTool,
  isTaskCoordinationTool,
} from '@infos/backend/tools/systemProtocolTools'
import {
  availableToolDefinitions,
  type AdvancedToolAccess,
} from '@infos/backend/tools/advancedTools'
import { expandAdvancedToolsTool } from '@infos/backend/tools/expandAdvancedTools'

const controls = ['expand_advanced_tools', 'update_plan', 'manage_task']
const context: ToolContext = {
  source: 'desktop',
  channel: 'desktop',
  agentId: 'test',
  threadId: 'thread',
  sessionId: 'session',
  interactionMode: 'work',
}

describe('工作协调工具的分类和权限', () => {
  it.each(controls)('%s 可关闭、聊天不可用，且不作为业务成果', async (name) => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('执行成功')
    registry.register({ name, description: '协调工具', parameters: {} }, handler, ['desktop'], {
      chatEnabled: true,
    })
    expect(isSystemProtocolTool(name)).toBe(false)
    expect(isTaskCoordinationTool(name)).toBe(true)
    expect(isTaskCoordinationTool('read_file')).toBe(false)
    expect(isToolAllowedInInteractionMode(name, 'chat', registry)).toBe(false)
    expect(isToolAllowedInInteractionMode(name, 'work', registry)).toBe(true)

    const executor = new RegistryToolExecutor(registry)
    executor.setThreadPolicyResolver(async () => ({ interactionMode: 'chat', disabledTools: [] }))
    await expect(
      executor.execute(name, { action: 'list' }, 'desktop', context),
    ).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('聊天模式未开放'),
    })
    executor.setThreadPolicyResolver(async () => ({
      interactionMode: 'work',
      disabledTools: [name],
    }))
    await expect(executor.execute(name, {}, 'desktop', context)).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('本会话中禁用'),
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('高级工具包在入口缺失时不进入本次执行', () => {
    const definitions = ['read_file', 'browser_get_content', 'remote_terminal_list'].map(
      (name) => ({ name }),
    )
    expect(availableToolDefinitions(definitions)).toEqual([{ name: 'read_file' }])
    expect(
      availableToolDefinitions([...definitions, { name: 'expand_advanced_tools' }]),
    ).toHaveLength(4)
  })

  it('展开结果只包含本次获准的工具包和实际数量', async () => {
    const result = await expandAdvancedToolsTool.execute(
      {},
      {
        ...context,
        advancedToolAccess: {
          expanded: false,
          names: new Set(['browser_get_content', 'remote_terminal_list']),
        },
      },
    )
    expect(result).toMatchObject({
      ok: true,
      output: expect.stringContaining('工具名单仍按当前权限重新过滤'),
      metadata: {
        packages: [
          { id: 'browser', count: 1, tools: ['browser_get_content'] },
          { id: 'remoteTerminal', count: 1, tools: ['remote_terminal_list'] },
        ],
      },
    })
  })

  it('没有可用工具或没有执行上下文时，不虚报展开成功', async () => {
    await expect(
      expandAdvancedToolsTool.execute(
        {},
        {
          ...context,
          advancedToolAccess: { expanded: false, names: new Set() },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NO_ADVANCED_TOOLS' } })
    await expect(expandAdvancedToolsTool.execute({}, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ADVANCED_CONTEXT_REQUIRED' },
    })
  })

  it('执行器独立校验展开状态，入口关闭也阻止包内工具', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('网页内容')
    registry.register(
      { name: 'browser_get_content', description: '读取网页', parameters: {} },
      handler,
    )
    const executor = new RegistryToolExecutor(registry)
    const access: AdvancedToolAccess = { names: new Set(['browser_get_content']), expanded: false }
    const runtime = { ...context, advancedToolAccess: access }
    await expect(
      executor.execute('browser_get_content', {}, 'desktop', runtime),
    ).resolves.toMatchObject({ isError: true })
    expect(handler).not.toHaveBeenCalled()
    access.expanded = true
    await expect(
      executor.execute('browser_get_content', {}, 'desktop', runtime),
    ).resolves.toMatchObject({ isError: false })
    executor.setThreadPolicyResolver(async () => ({
      interactionMode: 'work',
      disabledTools: ['expand_advanced_tools'],
    }))
    await expect(
      executor.execute('browser_get_content', {}, 'desktop', runtime),
    ).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('已关闭高级工具'),
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
