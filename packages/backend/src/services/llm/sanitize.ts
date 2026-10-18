/**
 * LLM 消息内容净化工具
 *
 * Provider 层的通用防御：工具返回 (role:'tool') 里若混入超长 base64 data URI
 * (如截图、音频)，会爆 token 且污染上下文，模型也只会看到一堆乱码。
 * 此处统一把 base64 data URI 替换为简短占位符。
 *
 * 注意：合法的多模态图片是以 image_url / inlineData 的「数组内容块」形式传递的
 * (非字符串)，本工具只处理字符串，不会影响正常的图片注入。
 *
 * @module packages/backend/src/services/llm/sanitize
 */

import type { ChatMessage, ContentPart } from './types'

/** 严格兼容接口只允许开头的一条 system；保留系统指令顺序及完整工具响应链。 */
export function normalizeSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === 'system')
  if (!systemMessages.length || (systemMessages.length === 1 && messages[0]?.role === 'system'))
    return messages

  const parts: ContentPart[] = []
  for (const message of systemMessages) {
    const content: ContentPart[] = Array.isArray(message.content)
      ? message.content
      : typeof message.content === 'string' && message.content
        ? [{ type: 'text', text: message.content }]
        : []
    if (!content.length) continue
    if (parts.length) parts.push({ type: 'text', text: '\n\n' })
    parts.push(...content)
  }
  const content = parts.every((part) => part.type === 'text')
    ? parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : parts
  return [
    { ...systemMessages[0]!, content },
    ...messages.filter((message) => message.role !== 'system'),
  ]
}

/** Gemini Function Declaration 与部分OpenAI中转不接受的JSON Schema关键字。 */
const UNSUPPORTED_TOOL_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'const',
  'patternProperties',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties',
  'dependentSchemas',
  'dependentRequired',
  'prefixItems',
  'contains',
  'minContains',
  'maxContains',
])

/**
 * 将工具参数Schema收敛为OpenAI与Gemini中转共同支持的子集。
 *
 * 动态应用工具和MCP工具同样经过此出口，避免单个非法Schema导致整次对话被拒绝。
 */
export function sanitizeToolParameters(input: Record<string, unknown>): Record<string, unknown> {
  const sanitizeNode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitizeNode)
    if (!value || typeof value !== 'object') return value

    const source = value as Record<string, unknown>
    const union = Array.isArray(source.oneOf)
      ? source.oneOf
      : Array.isArray(source.anyOf)
        ? source.anyOf
        : null
    let preferred =
      union?.find(
        (branch) =>
          branch &&
          typeof branch === 'object' &&
          (branch as Record<string, unknown>).type === 'array',
      ) ?? union?.[0]
    // 多操作工具的对象分支必须保留所有字段，不能只留下第一个空参数结构。
    // 传输层合并可选字段；具体 action 的必填项仍由业务执行器独立验证。
    if (
      union?.length &&
      union.every(
        (branch) =>
          branch &&
          typeof branch === 'object' &&
          (branch as Record<string, unknown>).type === 'object',
      )
    ) {
      const branches = union as Array<Record<string, unknown>>
      const properties: Record<string, unknown> = Object.create(null)
      for (const branch of branches) {
        for (const [name, child] of Object.entries(
          (branch.properties ?? {}) as Record<string, unknown>,
        )) {
          if (!Object.hasOwn(properties, name)) properties[name] = child
          else if (
            child &&
            typeof child === 'object' &&
            properties[name] &&
            typeof properties[name] === 'object'
          ) {
            const previous = properties[name] as Record<string, unknown>
            const next = child as Record<string, unknown>
            const combined = { ...previous }
            if (Array.isArray(previous.enum) && Array.isArray(next.enum))
              combined.enum = [...new Set([...previous.enum, ...next.enum])]
            else delete combined.enum
            for (const key of ['minimum', 'minLength', 'minItems']) {
              if (typeof previous[key] === 'number' && typeof next[key] === 'number')
                combined[key] = Math.min(previous[key], next[key])
              else delete combined[key]
            }
            for (const key of ['maximum', 'maxLength', 'maxItems']) {
              if (typeof previous[key] === 'number' && typeof next[key] === 'number')
                combined[key] = Math.max(previous[key], next[key])
              else delete combined[key]
            }
            if (previous.pattern !== next.pattern) delete combined.pattern
            properties[name] = combined
          }
        }
      }
      const required = ((branches[0]?.required ?? []) as string[]).filter((name) =>
        branches.every(
          (branch) => Array.isArray(branch.required) && branch.required.includes(name),
        ),
      )
      preferred = {
        type: 'object',
        properties,
        required,
        description: branches
          .map(
            (branch) =>
              `${String(branch.description ?? '参数结构')}：${((branch.required ?? []) as string[]).join('、') || '无必填项'}`,
          )
          .join('\n'),
      }
    }
    const merged =
      preferred && typeof preferred === 'object'
        ? { ...source, ...(preferred as Record<string, unknown>) }
        : source
    const result: Record<string, unknown> = {}

    for (const [key, child] of Object.entries(merged)) {
      if (UNSUPPORTED_TOOL_SCHEMA_KEYS.has(key)) continue
      result[key] = sanitizeNode(child)
    }

    if (result.items && !result.type) result.type = 'array'
    if (result.properties && !result.type) result.type = 'object'
    if (!result.type && result.enum) {
      const first = (result.enum as unknown[])[0]
      if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') {
        result.type = typeof first
      }
    }
    return result
  }

  const sanitized = sanitizeNode(input) as Record<string, unknown>
  return {
    ...sanitized,
    type: sanitized.type ?? 'object',
    properties: sanitized.properties ?? {},
  }
}

/** 匹配 base64 data URI，如 data:image/png;base64,iVBORw0... */
const RE_BASE64_DATA_URI = /data:([^;,\s]+);base64,[A-Za-z0-9+/=\s]+/g

/**
 * 剥离文本中的 base64 data URI，替换为占位符
 *
 * @param text - 原始文本 (可能内嵌 base64 data URI)
 * @returns 净化后的文本；若无匹配则原样返回
 */
export function stripBase64DataUris(text: string): string {
  if (!text.includes(';base64,')) return text
  return text.replace(RE_BASE64_DATA_URI, (_m, mime: string) => `[已省略 ${mime} base64 数据]`)
}
