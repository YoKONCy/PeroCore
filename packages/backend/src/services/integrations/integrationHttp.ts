import { AppError } from '../../lib/appError'

/** 端点由用户配置，拒绝协议、凭据和查询参数混用。 */
export function integrationEndpoint(value: string): string {
  if (!value.trim()) return ''
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new AppError('INVALID_PARAMETER', { message: '请输入完整的服务地址' })
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError('INVALID_PARAMETER', {
      message: '服务地址须为 HTTP 或 HTTPS，不能含凭据、查询参数或片段',
    })
  return url.href.replace(/\/+$/, '')
}

export function apiUrl(base: string, route: string): string {
  return `${base.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`
}

export async function integrationFetch(
  url: string,
  options: RequestInit = {},
  maxBytes = 2 * 1024 * 1024,
): Promise<Buffer> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)])
    : AbortSignal.timeout(45_000)
  const response = await fetch(url, { ...options, signal, redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    throw new AppError('SERVICE_UNAVAILABLE', {
      message: `外部服务请求失败（HTTP ${response.status}）`,
    })
  }
  if (!response.body) {
    if (options.method === 'PUT') return Buffer.alloc(0)
    throw new AppError('SERVICE_UNAVAILABLE', { message: '外部服务没有返回内容' })
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new AppError('OUT_OF_RANGE', { message: '外部服务返回内容过大' })
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks)
}

export async function integrationJson(url: string, options: RequestInit = {}): Promise<unknown> {
  const bytes = await integrationFetch(url, options)
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', { message: '外部服务返回了无效的 JSON' })
  }
}

/** 签名上传与下载链接来自上游，禁止转向本机、内网或携带凭据。 */
export function publicArtifactUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', { message: '解析服务返回的文件地址无效' })
  }
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.includes(':') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    !['openxlab.org.cn', 'mineru.net', 'aliyuncs.com'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  )
    throw new AppError('SERVICE_UNAVAILABLE', { message: '解析服务返回了不允许访问的文件地址' })
  return url.href
}
