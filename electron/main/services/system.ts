import { paths } from '../utils/env'
import fs from 'fs-extra'
import path from 'path'
import axios from 'axios'

export const DESKTOP_API_KEY_HEADER = 'x-pero-desktop-api-key'

/**
 * systeminformation 延迟加载。
 * 该模块含有 native 绑定，如果在 ASAR 打包后加载失败，
 * 不应影响整个应用启动。因此改为在第一次使用时才 require()。
 */
let _si: typeof import('systeminformation') | null = null
let _siLoadFailed = false

function getSI(): typeof import('systeminformation') | null {
  if (_si) return _si
  if (_siLoadFailed) return null
  try {
    _si = require('systeminformation')
    return _si
  } catch (e) {
    _siLoadFailed = true
    console.error('[System] systeminformation 模块加载失败，系统监控功能将不可用:', e)
    return null
  }
}

export interface SystemStats {
  cpu_usage: number
  memory_used: number
  memory_total: number
}

export interface BackendConnectionConfig {
  mode: 'local' | 'remote'
  baseUrl: string
  apiBase: string
  wsBase: string
  configured: boolean
}

// 缓存 CPU 负载 (定期更新以降低开销)
let lastCpuLoad = 0
let cpuMonitorStarted = false

function ensureCpuMonitor() {
  if (cpuMonitorStarted) return
  cpuMonitorStarted = true
  const si = getSI()
  if (!si) return
  setInterval(async () => {
    try {
      const load = await si.currentLoad()
      lastCpuLoad = load.currentLoad
    } catch {
      // 忽略
    }
  }, 5000)
}

export async function getSystemStats(): Promise<SystemStats> {
  ensureCpuMonitor()
  try {
    const si = getSI()
    if (!si) return { cpu_usage: 0, memory_used: 0, memory_total: 0 }
    const mem = await si.mem()
    return {
      cpu_usage: parseFloat(lastCpuLoad.toFixed(1)),
      memory_used: mem.active,
      memory_total: mem.total
    }
  } catch {
    return { cpu_usage: 0, memory_used: 0, memory_total: 0 }
  }
}

function normalizeRemoteBackendUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/, '')
}

function normalizeRemoteBackendApiKey(rawApiKey: string): string {
  return (rawApiKey || '').trim()
}

function buildApiBase(baseUrl: string): string {
  if (!baseUrl) return ''
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api`
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function buildRemoteDesktopAuthHeaders(rawApiKey?: string): Record<string, string> {
  const apiKey = normalizeRemoteBackendApiKey(rawApiKey || '')
  if (!apiKey) {
    return {}
  }

  return {
    [DESKTOP_API_KEY_HEADER]: apiKey
  }
}

function buildWsBase(baseUrl: string): string {
  if (!baseUrl) return ''
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

export function getBackendLogs(): string[] {
  // 目前返回空 (待办: 实现日志存储)
  return []
}

export function getConfig(): any {
  const configPath = path.join(paths.userData, 'data/config.json')
  let config: any = {}

  if (fs.existsSync(configPath)) {
    try {
      config = fs.readJsonSync(configPath)
    } catch {
      config = {}
    }
  }

  // [引导逻辑] 确保默认值存在喵~ 🌸
  // 引导状态：false (新用户) -> 'launcher_done' (Launcher引导结束) -> true (全部引导结束)
  if (config.onboarding_completed === undefined) {
    config.onboarding_completed = false
  }
  if (config.eula_accepted === undefined) {
    config.eula_accepted = false
  }
  if (config.backend_mode !== 'remote') {
    config.backend_mode = 'local'
  }
  if (typeof config.remote_backend_url !== 'string') {
    config.remote_backend_url = ''
  }
  if (typeof config.remote_backend_api_key !== 'string') {
    config.remote_backend_api_key = ''
  }

  return config
}

export function getBackendConnectionConfig(): BackendConnectionConfig {
  const config = getConfig()
  const mode: 'local' | 'remote' = config.backend_mode === 'remote' ? 'remote' : 'local'

  if (mode === 'remote') {
    const baseUrl = normalizeRemoteBackendUrl(config.remote_backend_url || '')
    return {
      mode,
      baseUrl,
      apiBase: buildApiBase(baseUrl),
      wsBase: buildWsBase(baseUrl),
      configured: !!baseUrl
    }
  }

  const baseUrl = 'http://localhost:9120'
  return {
    mode,
    baseUrl,
    apiBase: `${baseUrl}/api`,
    wsBase: 'ws://localhost:9120/ws',
    configured: true
  }
}

export function saveConfig(config: any) {
  // 将配置保存到文件
  const dataDir = path.join(paths.userData, 'data')
  fs.ensureDirSync(dataDir)
  fs.writeJsonSync(path.join(dataDir, 'config.json'), config, { spaces: 2 })
}

export async function checkRemoteBackendConnection(rawUrl?: string) {
  const config = getConfig()
  const normalizedUrl = normalizeRemoteBackendUrl(rawUrl ?? config.remote_backend_url ?? '')
  const apiKey = normalizeRemoteBackendApiKey(config.remote_backend_api_key ?? '')

  if (!normalizedUrl) {
    return {
      ok: false,
      message: '未配置远程后端地址',
      normalizedUrl: ''
    }
  }

  try {
    const apiBase = buildApiBase(normalizedUrl)
    const healthResponse = await axios.get(apiBase + '/system/health', {
      timeout: 5000
    })
    const authRequired = healthResponse.data?.desktop_auth_required === true
    const authHeader = healthResponse.data?.desktop_auth_header || DESKTOP_API_KEY_HEADER

    if (authRequired && !apiKey) {
      return {
        ok: false,
        message: `远程后端要求桌面访问密钥，请在启动器中填写 ${authHeader}`,
        normalizedUrl,
        authRequired,
        authHeader
      }
    }

    const tokenResponse = await axios.get(`${apiBase}/system/gateway/token`, {
      timeout: 5000,
      headers: buildRemoteDesktopAuthHeaders(apiKey)
    })

    if (!tokenResponse.data?.token) {
      return {
        ok: false,
        message: '远程后端未返回前端访问令牌',
        normalizedUrl,
        authRequired,
        authHeader
      }
    }

    return {
      ok: true,
      message: authRequired ? '远程后端连接正常，桌面访问密钥已验证' : '远程后端连接正常',
      normalizedUrl,
      authRequired,
      authHeader
    }
  } catch (error: any) {
    const status = error?.response?.status
    const detail = error?.response?.data?.detail

    if (status === 401 || status === 403) {
      return {
        ok: false,
        message: '远程后端桌面访问密钥无效',
        normalizedUrl,
        authRequired: true,
        authHeader: DESKTOP_API_KEY_HEADER
      }
    }

    return {
      ok: false,
      message: detail || error?.message || '远程后端连接失败',
      normalizedUrl
    }
  }
}

export function getGatewayToken(): string {
  const tokenPath = path.join(paths.data, 'gateway_token.json')

  // 首先检查 ENV (如果由 startGateway 在同一进程中设置)
  if (process.env.GATEWAY_TOKEN_PATH && fs.existsSync(process.env.GATEWAY_TOKEN_PATH)) {
    try {
      const data = fs.readJsonSync(process.env.GATEWAY_TOKEN_PATH)
      return data.token || ''
    } catch {
      // 忽略
    }
  }

  if (fs.existsSync(tokenPath)) {
    try {
      const data = fs.readJsonSync(tokenPath)
      return data.token || ''
    } catch {
      return ''
    }
  }
  return ''
}

export async function resolveGatewayToken(): Promise<string> {
  const connection = getBackendConnectionConfig()
  const config = getConfig()

  if (connection.mode !== 'remote') {
    return getGatewayToken()
  }

  if (!connection.apiBase) {
    return ''
  }

  const response = await axios.get(`${connection.apiBase}/system/gateway/token`, {
    timeout: 5000,
    headers: buildRemoteDesktopAuthHeaders(config.remote_backend_api_key ?? '')
  })
  return response.data?.token || ''
}
