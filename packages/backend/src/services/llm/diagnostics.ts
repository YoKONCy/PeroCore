/** 诊断只保留必要文字，图片正文、令牌和认证参数不进入控制台或日志。 */
export function safeModelDiagnostic(value: string, limit = 800): string {
  return value
    .replace(/(?:base64:)?data:[\w.+/-]+;base64,[A-Za-z0-9+/=]+/gi, '[媒体数据已省略]')
    .replace(/base64:\/\/[A-Za-z0-9+/=]+/gi, '[媒体数据已省略]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:key|api_key|token|access_token|auth)=)[^\s&#"']+/gi, '$1[已隐藏]')
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|token|authorization|secret)["']?\s*[:=]\s*["']?)[^"',\s}\]]+/gi,
      '$1[已隐藏]',
    )
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[密钥已隐藏]')
    .slice(0, limit)
}

/** fetch 的失败原因经常藏在 cause 或聚合错误中，不能只记录 fetch failed。 */
export function modelNetworkDetails(error: unknown): string[] {
  const visited = new Set<unknown>()
  const details: string[] = []
  const walk = (value: unknown, depth: number) => {
    if (
      !value ||
      typeof value !== 'object' ||
      visited.has(value) ||
      depth > 4 ||
      details.length >= 8
    )
      return
    visited.add(value)
    const item = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }
    const detail = [
      typeof item.code === 'string' ? item.code : '',
      typeof item.message === 'string' ? item.message : '',
    ]
      .filter(Boolean)
      .join(': ')
    if (detail) details.push(safeModelDiagnostic(detail, 300))
    walk(item.cause, depth + 1)
    if (Array.isArray(item.errors))
      for (const child of item.errors.slice(0, 4)) walk(child, depth + 1)
  }
  walk(error, 0)
  return [...new Set(details)]
}

/** 中转站偶尔把确定的图片参数错误包装为 500，重试相同输入无法恢复。 */
export function unsupportedModelMedia(message: string): boolean {
  return /(?:mime|media)\s*type.{0,50}(?:not supported|unsupported|invalid)|unsupported.{0,30}(?:mime|media|image)\s*(?:type|format)|invalid.{0,25}(?:mime|media)\s*type/i.test(
    message,
  )
}
