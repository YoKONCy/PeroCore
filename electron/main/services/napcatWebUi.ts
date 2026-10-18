import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

let announced: URL | undefined

/** 为管理标签启用 WebUI；保留已有端口、凭据与其他用户设置。 */
export function prepareNapCatWebUi(configDir: string): void {
  announced = undefined
  const file = path.join(configDir, 'webui.json')
  if (fs.existsSync(file)) {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('NapCat 管理页配置无法读取，请检查 webui.json')
    }
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('NapCat 管理页配置格式无效')
    let changed = false
    if (config.port === 0) {
      config.port = 6099
      changed = true
    }
    if (config.disableWebUI === true) {
      config.disableWebUI = false
      changed = true
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
    return
  }
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify(
      { host: '127.0.0.1', port: 6099, token: randomBytes(24).toString('hex'), loginRate: 3 },
      null,
      2,
    ),
    { encoding: 'utf8', flag: 'wx' },
  )
}

/** 在日志脱敏之前识别本次进程公布的实际端口，不扫描其他本机服务。 */
export function observeNapCatWebUi(line: string): void {
  // eslint-disable-next-line no-control-regex -- 去除日志中用于着色的 ANSI 转义序列。
  const clean = line.replace(/\u001b\[[0-9;]*m/g, '')
  if (!/WebUi.*(?:Panel|面板).*Url/i.test(clean)) return
  const match = clean.match(/https?:\/\/[^\s"'<>]+/i)
  if (!match) return
  try {
    const url = new URL(match[0])
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      !['127.0.0.1', 'localhost', '0.0.0.0', '[::]', '[::1]'].includes(url.hostname)
    )
      return
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    if (url.hostname === '[::]') url.hostname = '[::1]'
    if (!/^\/webui(?:\/|$)/.test(url.pathname)) return
    if (url.pathname === '/webui') url.pathname = '/webui/'
    announced = url
  } catch {
    /* 非法或日志中被遮蔽的地址不作为管理入口。 */
  }
}

/** 仅供主进程使用，禁止把返回的带凭据 URL 放入标签状态或 IPC。 */
export function getNapCatWebUiEndpoint(configDir: string): URL | undefined {
  let config: { port?: number; token?: string; disableWebUI?: boolean } = {}
  try {
    config = JSON.parse(
      fs.readFileSync(path.join(configDir, 'webui.json'), 'utf8').replace(/^\uFEFF/, ''),
    )
  } catch {
    /* 启动与改密时文件可能正在写入，优先使用本次启动日志。 */
  }
  if (config.port === 0 || config.disableWebUI === true)
    throw new Error('NapCat WebUI 已禁用，请在 webui.json 中启用管理页后重启')
  if (!announced) return undefined
  const url = new URL(announced)
  if (typeof config.token === 'string' && config.token) url.searchParams.set('token', config.token)
  if (url.searchParams.get('token') === '***') url.searchParams.delete('token')
  return url
}

export function redactNapCatWebUiLog(line: string): string {
  return line
    .replace(/([?&]token=)[^\s&#"'<>]+/gi, '$1***')
    .replace(/(WebUi\s+Token\s*[:：]\s*)\S+/gi, '$1***')
}

/** JSON 错误即使返回 200，也不代表 WebUI 文档已就绪。 */
export function isNapCatWebUiDocument(
  status: number | undefined,
  contentType: string | undefined,
  body: string,
): boolean {
  return (
    status === 200 &&
    /^text\/html(?:;|$)/i.test(contentType ?? '') &&
    /<html(?:\s|>)/i.test(body) &&
    /<title>\s*NapCat\s+WebUI\s*<\/title>/i.test(body)
  )
}
