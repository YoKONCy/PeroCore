import type { ToolDefinition } from '../services/pipeline/types'

/** 没有显示桌宠时，不向主模型暴露独立口语字段；不修改全局注册清单。 */
export function spokenReplyToolDefinition(tool: ToolDefinition, enabled: boolean): ToolDefinition {
  if (enabled || tool.name !== 'finish_task') return tool
  const schema = structuredClone(tool.parameters)
  const properties = schema.properties as Record<string, unknown> | undefined
  if (properties) delete properties.spoken_reply
  if (Array.isArray(schema.required))
    schema.required = schema.required.filter((key) => key !== 'spoken_reply')
  return { ...tool, parameters: schema }
}
