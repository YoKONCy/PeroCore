import { describe, expect, it } from 'vitest'
import { getBuiltinToolDefinitions } from '@infos/backend/tools'

describe('心流内置工具注册', () => {
  it('必须向 ToolRegistry 提供 update_flow_state 的 FC 定义', () => {
    const definition = getBuiltinToolDefinitions().find((tool) => tool.name === 'update_flow_state')
    expect(definition).toBeDefined()
    expect(definition?.description).toContain('心流')
    expect(definition?.parameters).toMatchObject({
      type: 'object',
      properties: {
        current_goal: { type: 'string' },
        private_facts: { type: 'string' },
      },
    })
  })
})
