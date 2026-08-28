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
    const preferred =
      union?.find(
        (branch) =>
          branch &&
          typeof branch === 'object' &&
          (branch as Record<string, unknown>).type === 'array',
      ) ?? union?.[0]
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
