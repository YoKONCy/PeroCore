import { describe, expect, it, vi } from 'vitest'
import { isToolAllowedInInteractionMode } from '../../../src/tools/interactionMode'

const registry = { isChatEnabled: vi.fn(() => true) } as never
describe('Thread 极简模式', () => {
  it('保留原陪伴工具，但系统协议、扩展元数据和 NIT 不能绕过极简集合', () => {
    for (const name of [
      'finish_task',
      'take_screenshot',
      'query_facts',
      'set_reminder',
      'suggest_next_step',
    ])
      expect(isToolAllowedInInteractionMode(name, 'minimal', registry)).toBe(true)
    for (const name of [
      'run_script',
      'expand_advanced_tools',
      'terminal_execute',
      'read_file',
      'edit_file',
      'custom_tool',
    ])
      expect(isToolAllowedInInteractionMode(name, 'minimal', registry)).toBe(false)
    expect(isToolAllowedInInteractionMode('terminal_execute', 'work', registry)).toBe(true)
  })
})
