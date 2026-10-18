import { describe, expect, it } from 'vitest'
import { initialReActTools } from '@infos/backend/services/agent/reactLoop'
import {
  isAdvancedTool,
  isSystemProtocolTool,
  isTaskCoordinationTool,
} from '@infos/backend/tools/systemProtocolTools'

describe('NIT 常驻系统入口', () => {
  it('首轮无需展开就提供定义，归为系统工具且仍计为实际业务编排', () => {
    expect(isSystemProtocolTool('run_script')).toBe(true)
    expect(isAdvancedTool('run_script')).toBe(false)
    expect(isTaskCoordinationTool('run_script')).toBe(false)
    const tools = ['run_script', 'expand_advanced_tools', 'browser_open_url'].map((name) => ({
      name,
      description: '工具',
      parameters: {},
    }))
    expect(initialReActTools(tools).map((tool) => tool.name)).toEqual([
      'run_script',
      'expand_advanced_tools',
    ])
  })
})
