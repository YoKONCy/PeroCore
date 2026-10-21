/** 完整 API 根路径原样保留；只有纯域名才补协议的默认版本前缀。 */
export function providerApiUrl(base: string, endpoint: string, version = 'v1'): string {
  const normalized = base.trim().replace(/\/+$/, '')
  const root = new URL(normalized)
  const prefix =
    root.pathname === '/' || root.pathname === '' ? `${normalized}/${version}` : normalized
  return `${prefix}/${endpoint.replace(/^\/+/, '')}`
}
