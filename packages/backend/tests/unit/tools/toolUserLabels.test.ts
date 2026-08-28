import { ADVANCED_TOOL_NAMES } from '../../../src/tools/advancedTools'
import { getBuiltinToolDefinitions } from '../../../src/tools'
import { describe, expect, it } from 'vitest'
import { resolveToolUserDescription, resolveToolUserLabel } from '../../../src/tools/toolUserLabels'

describe('工具用户文案', () => {
  it('所有主内核内置工具都必须自行声明用户名称和说明', () => {
    const missing = getBuiltinToolDefinitions()
      .filter(
        (definition) =>
          !definition.display?.label?.trim() || !definition.display?.description?.trim(),
      )
      .map((definition) => definition.name)
    expect(missing).toEqual([])
  })

  it('所有主内核官方工具都必须拥有唯一的Tool Atelier视觉签名', () => {
    const definitions = getBuiltinToolDefinitions()
    const missing = definitions
      .filter(
        (definition) =>
          !definition.display?.signature?.archetype ||
          !definition.display.signature.variant ||
          !definition.display.signature.chain,
      )
      .map((definition) => definition.name)
    const variants = definitions.map((definition) => definition.display?.signature?.variant)

    expect(missing).toEqual([])
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('高级工具应按浏览器、Computer Use 和远程节点终端工具包维护', () => {
    expect([...ADVANCED_TOOL_NAMES]).toEqual(
      expect.arrayContaining([
        'browser_open_url',
        'browser_status',
        'automation_execute',
        'get_mouse_position',
        'remote_terminal_nodes',
        'remote_terminal_create',
        'remote_terminal_read',
        'remote_terminal_close',
      ]),
    )
    expect(ADVANCED_TOOL_NAMES.has('take_screenshot')).toBe(false)
    expect(ADVANCED_TOOL_NAMES.has('web_fetch')).toBe(false)
    expect(ADVANCED_TOOL_NAMES.has('open_application')).toBe(false)
    expect(ADVANCED_TOOL_NAMES.has('get_active_windows')).toBe(false)
  })

  it('应优先使用工具自身声明的用户文案', () => {
    expect(resolveToolUserLabel('finish_task', '扩展自定义名称')).toBe('扩展自定义名称')
    expect(resolveToolUserDescription('finish_task', '扩展自定义说明', '模型技术说明')).toBe(
      '扩展自定义说明',
    )
  })

  it('旧工具未声明用户文案时应使用中央映射回退', () => {
    expect(resolveToolUserLabel('finish_task')).toBe('完成任务')
    expect(resolveToolUserDescription('finish_task')).toBe('结束当前任务，并把最终结果回复给你。')
  })

  it('未知扩展未声明文案时不应暴露函数名和内部术语', () => {
    expect(resolveToolUserLabel('some_internal_command')).toBe('扩展工具')
    expect(
      resolveToolUserDescription(
        'some_internal_command',
        undefined,
        'AgentApplication SubAgent command API',
      ),
    ).toBe('为当前任务提供额外能力。关闭后，助手将无法使用这项功能。')
  })
})
