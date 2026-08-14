/** 工具处理器可返回的结构化结果。 */
export interface StructuredToolResult {
  ok: boolean
  output: string
  error?: {
    code: string
    message: string
    retryable?: boolean
  }
  truncated?: boolean
  metadata?: Record<string, unknown>
}

/** 判断未知返回值是否符合结构化工具结果。 */
export function isStructuredToolResult(value: unknown): value is StructuredToolResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StructuredToolResult>
  return typeof candidate.ok === 'boolean' && typeof candidate.output === 'string'
}

/** 生成结构化成功结果。 */
export function toolSuccess(
  output: string,
  metadata?: Record<string, unknown>,
): StructuredToolResult {
  return { ok: true, output, metadata }
}

/** 生成结构化失败结果，确保 ReAct 能识别并参与错误熔断。 */
export function toolFailure(
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): StructuredToolResult {
  return {
    ok: false,
    output: message,
    error: { code, message },
    metadata,
  }
}
