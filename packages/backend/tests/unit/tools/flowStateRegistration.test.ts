import { describe, expect, it } from 'vitest'
import { getBuiltinToolDefinitions } from '@infos/backend/tools'
import { sanitizeToolParameters } from '@infos/backend/services/llm/sanitize'

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

  it('必须注册不可禁用的工作上下文维护工具', () => {
    const definition = getBuiltinToolDefinitions().find(
      (tool) => tool.name === 'manage_work_context',
    )
    expect(definition?.parameters).toMatchObject({
      type: 'object',
      properties: { action: { enum: ['update', 'clear'] }, content: { type: 'string' } },
    })
  })

  it('必须为Gemini兼容链路提供明确的角色台词数组Schema', () => {
    const definitions = getBuiltinToolDefinitions()
    for (const name of ['finish_task', 'update_state']) {
      const definition = definitions.find((tool) => tool.name === name)
      const properties = definition?.parameters.properties as
        | Record<string, { type?: string; items?: { type?: string }; oneOf?: unknown }>
        | undefined

      expect(properties).toBeDefined()
      for (const field of [
        'click_head_msgs',
        'click_arm_msgs',
        'click_body_msgs',
        'click_leg_msgs',
        'idle_msgs',
        'back_msgs',
      ]) {
        expect(properties?.[field]).toMatchObject({
          type: 'array',
          items: { type: 'string' },
        })
        expect(properties?.[field]?.oneOf).toBeUndefined()
      }
    }
  })

  it('必须将全部内置工具Schema净化为Gemini兼容子集', () => {
    const unsupported = new Set([
      'oneOf',
      'anyOf',
      'allOf',
      '$ref',
      '$defs',
      'definitions',
      'additionalProperties',
      'patternProperties',
      'prefixItems',
      'contains',
    ])
    const inspect = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => inspect(item, `${path}[${index}]`))
        return
      }
      if (!value || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      if ('items' in node) expect(node.type, `${path}.type`).toBe('array')
      if ('properties' in node) expect(node.type, `${path}.type`).toBe('object')
      for (const [key, child] of Object.entries(node)) {
        expect(unsupported.has(key), `${path}.${key}`).toBe(false)
        inspect(child, `${path}.${key}`)
      }
    }

    for (const tool of getBuiltinToolDefinitions()) {
      inspect(sanitizeToolParameters(tool.parameters), tool.name)
    }
  })

  it('必须为动态工具组合Schema选择明确类型并移除不兼容关键字', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        additionalProperties: false,
        properties: {
          messages: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        messages: { type: 'array', items: { type: 'string' } },
      },
    })
  })

  it('必须注册全部EventNote与Facts工具定义', () => {
    const names = new Set(getBuiltinToolDefinitions().map((tool) => tool.name))
    for (const name of [
      'write_event_note',
      'revise_event_note',
      'query_event_notes',
      'query_facts',
      'write_fact',
      'supersede_fact',
      'delete_fact',
      'add_fact_object_alias',
      'remove_fact_object_alias',
    ]) {
      expect(names.has(name), `${name} 未注册`).toBe(true)
    }
  })
})
