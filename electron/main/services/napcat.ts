/**
 * NapCat QQ 机器人进程管理 (v2)
 *
 * 启动/停止/监控 NapCat 进程，管理日志和命令转发。
 *
 * - 多入口点自动检测 (Shell.exe > napcat.mjs > bat > index.js)
 * - QQ 路径从注册表/默认路径自动查找
 * - 安装功能实现 (GitHub Release 自动下载解压)
 * - GatewayHub 通知替代 window.webContents
 * - OpenTelemetry 冲突修复
 *
 * @platform ELECTRON
 * @module electron/main/services/napcat
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import { BrowserWindow } from 'electron'
import AdmZip from 'adm-zip'
import { logger } from '../utils/logger'
import { paths } from '../utils/env'

let napCatProcess: ChildProcess | null = null
let napCatLogs: string[] = []
const MAX_LOG_LINES = 500

// ─────────────────────────────────────────────
// 日志广播
// ─────────────────────────────────────────────

/** 向所有窗口推送 NapCat 日志 */
function broadcastNapCatLog(line: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('napcat-log', line)
    }
  })
}

/** 向所有窗口推送下载进度 */
function broadcastDownloadProgress(data: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('napcat-download-progress', data)
    }
  })
}

// ─────────────────────────────────────────────
// 路径查找
// ─────────────────────────────────────────────

/** 后端 WS 端口 */
const BACKEND_PORT = Number(process.env.PERO_PORT ?? 9120)

/** 后端反向 WS 端点 (NapCat 连入后端的地址) */
const REVERSE_WS_URL = `ws://127.0.0.1:${BACKEND_PORT}/api/social/ws`

/** 我们在 NapCat 配置中使用的连接名称 (用于标识是我们自动注入的) */
const WS_CLIENT_NAME = 'PeroCore'

/** 获取 NapCat 安装目录 */
function getNapCatDir(): string {
  return path.join(paths.data, 'tools', 'NapCat')
}

/** 获取 NapCat 配置目录 */
function getNapCatConfigDir(): string {
  return path.join(getNapCatDir(), 'config')
}

/** 从注册表/默认路径查找 QQ.exe */
async function getQQPath(): Promise<string> {
  if (process.platform !== 'win32') return ''

  // 尝试注册表查找 (非阻塞, 兼容非 Windows 环境)
  try {
    // 动态导入 winreg (可能未安装)
    const winreg = await import('winreg').catch(() => null)
    if (winreg) {
      const regKeys = [
        '\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
        '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
      ]

      for (const keyPath of regKeys) {
        try {
          const key = new winreg.default({
            hive: winreg.default.HKLM,
            key: keyPath,
          })

          const item = await new Promise<{ value: string } | null>((resolve) => {
            key.get('UninstallString', (err: Error | null, item: { value: string } | null) => {
              if (err) resolve(null)
              else resolve(item)
            })
          })

          if (item) {
            const uninstallPath = item.value.replace(/"/g, '')
            const binDir = path.dirname(uninstallPath)
            const qqInBin = path.join(binDir, 'QQ.exe')
            const qqInRoot = path.join(binDir, '..', 'QQ.exe')

            if (fs.existsSync(qqInBin)) return qqInBin
            if (fs.existsSync(qqInRoot)) return path.normalize(qqInRoot)
          }
        } catch {
          // 忽略单个注册表键错误
        }
      }
    }
  } catch {
    // winreg 不可用
  }

  // 默认路径后备
  const possiblePaths = [
    'C:\\Program Files (x86)\\Tencent\\QQ\\Bin\\QQ.exe',
    'C:\\Program Files\\Tencent\\QQ\\Bin\\QQ.exe',
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }

  return ''
}

// ─────────────────────────────────────────────
// 入口点检测
// ─────────────────────────────────────────────

/** 检查 NapCat 是否已安装 */
export function checkNapCat(): boolean {
  const dir = getNapCatDir()
  const entryPoints = [
    path.join(dir, 'NapCat.Shell.exe'),
    path.join(dir, 'napcat.mjs'),
    path.join(dir, 'index.js'),
  ]
  return entryPoints.some((p) => fs.existsSync(p))
}

/** 解析启动命令和参数 */
async function resolveEntryPoint(napCatDir: string): Promise<{
  cmd: string
  args: string[]
  env: Record<string, string | undefined>
}> {
  const shellExe = path.join(napCatDir, 'NapCat.Shell.exe')
  const napcatMjs = path.join(napCatDir, 'napcat.mjs')
  const napcatBat = path.join(napCatDir, 'napcat.bat')
  const indexJs = path.join(napCatDir, 'index.js')

  const env: Record<string, string | undefined> = {
    ...process.env,
    // [修复] 禁用 OpenTelemetry 以防止 libprotobuf UTF-8 错误
    OTEL_SDK_DISABLED: 'true',
    OTEL_TRACES_EXPORTER: 'none',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    NAPCAT_PATH: napCatDir,
  }

  const qqPath = await getQQPath()

  if (fs.existsSync(shellExe)) {
    const args = qqPath ? ['-q', qqPath] : []
    return { cmd: shellExe, args, env }
  }

  if (fs.existsSync(napcatMjs)) {
    // NapCat 环境变量
    env.NAPCAT_WRAPPER_PATH = path.join(napCatDir, 'wrapper.node')
    env.NAPCAT_QQ_PACKAGE_INFO_PATH = path.join(napCatDir, 'package.json')
    env.NAPCAT_QQ_VERSION_CONFIG_PATH = path.join(napCatDir, 'config.json')
    env.NAPCAT_DISABLE_PIPE = '1'
    return { cmd: 'node', args: ['napcat.mjs'], env }
  }

  if (fs.existsSync(napcatBat) && qqPath) {
    return { cmd: 'cmd.exe', args: ['/c', 'napcat.bat', '-q', qqPath], env }
  }

  if (fs.existsSync(indexJs)) {
    return { cmd: 'node', args: ['index.js'], env }
  }

  throw new Error('未找到有效的 NapCat 入口点')
}

// ─────────────────────────────────────────────
// 反向 WS 自动配置
// ─────────────────────────────────────────────

/**
 * 扫描 NapCat 已登录的 QQ 号配置文件，
 * 自动注入指向后端 /api/social/ws 的反向 WS 连接。
 *
 * 配置文件格式: config/onebot11_<QQ号>.json
 * 目标字段:     network.websocketClients[]
 *
 * 逻辑:
 * - 扫描 config/ 目录下所有 onebot11_*.json
 * - 如果已有 name='PeroCore' 的连接 → 确保 url 和 enable 正确
 * - 如果没有 → 追加一条新连接
 * - 如果 config/ 目录不存在或没有配置文件 → 跳过 (等用户扫码登录后再说)
 *
 * @returns 已配置的 QQ 号列表
 */
export function ensureNapCatConfig(): string[] {
  const configDir = getNapCatConfigDir()
  const configuredAccounts: string[] = []

  if (!fs.existsSync(configDir)) {
    logger.info('NapCat', '配置目录不存在，跳过自动配置 (等待首次登录)')
    return configuredAccounts
  }

  // 扫描所有 onebot11_<QQ号>.json
  let entries: string[]
  try {
    entries = fs.readdirSync(configDir).filter((f) => /^onebot11_\d+\.json$/.test(f))
  } catch {
    logger.warn('NapCat', '读取配置目录失败')
    return configuredAccounts
  }

  if (entries.length === 0) {
    logger.info('NapCat', '未发现已登录账号配置文件，跳过自动配置')
    return configuredAccounts
  }

  for (const filename of entries) {
    const filePath = path.join(configDir, filename)
    const qqNumber = filename.replace('onebot11_', '').replace('.json', '')

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const config = JSON.parse(raw) as Record<string, unknown>

      // 确保 network 对象存在
      if (!config.network || typeof config.network !== 'object') {
        config.network = {}
      }
      const network = config.network as Record<string, unknown>

      // 确保 websocketClients 数组存在
      if (!Array.isArray(network.websocketClients)) {
        network.websocketClients = []
      }
      const clients = network.websocketClients as Array<Record<string, unknown>>

      // 查找是否已有 PeroCore 连接
      const existing = clients.find((c) => c.name === WS_CLIENT_NAME)

      if (existing) {
        // 已有 → 确保 url 和 enable 正确
        let changed = false
        if (existing.url !== REVERSE_WS_URL) {
          existing.url = REVERSE_WS_URL
          changed = true
        }
        if (existing.enable !== true) {
          existing.enable = true
          changed = true
        }
        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
          logger.info('NapCat', `已更新 QQ ${qqNumber} 的反向 WS 配置 → ${REVERSE_WS_URL}`)
        } else {
          logger.info('NapCat', `QQ ${qqNumber} 反向 WS 配置已是最新`)
        }
      } else {
        // 没有 → 追加新连接
        clients.push({
          name: WS_CLIENT_NAME,
          enable: true,
          url: REVERSE_WS_URL,
          messagePostFormat: 'array',
          reportSelfMessage: false,
          token: '',
        })
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
        logger.info('NapCat', `已为 QQ ${qqNumber} 注入反向 WS 配置 → ${REVERSE_WS_URL}`)
      }

      configuredAccounts.push(qqNumber)
    } catch (err) {
      logger.warn('NapCat', `处理配置文件 ${filename} 失败: ${err}`)
    }
  }

  broadcastNapCatLog(`[系统] 已自动配置 ${configuredAccounts.length} 个账号的反向 WS 连接`)
  return configuredAccounts
}

// ─────────────────────────────────────────────
// 启动 / 停止
// ─────────────────────────────────────────────

/** 启动 NapCat */
export async function startNapCat(): Promise<void> {
  if (napCatProcess) {
    logger.warn('NapCat', 'NapCat 进程已在运行')
    return
  }

  const napCatDir = getNapCatDir()
  if (!checkNapCat()) {
    throw new Error('NapCat 未安装，请先执行安装')
  }

  // 启动前自动配置反向 WS (零配置体验)
  const configured = ensureNapCatConfig()
  if (configured.length > 0) {
    broadcastNapCatLog(`[系统] 已预配置 ${configured.length} 个账号: ${configured.join(', ')}`)
  }

  const { cmd, args, env } = await resolveEntryPoint(napCatDir)
  logger.info('NapCat', `启动: ${cmd} ${args.join(' ')} (cwd: ${napCatDir})`)
  broadcastNapCatLog('[系统] 正在启动 NapCat...')

  napCatProcess = spawn(cmd, args, {
    cwd: napCatDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  napCatProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      napCatLogs.push(line)
      if (napCatLogs.length > MAX_LOG_LINES) napCatLogs.shift()
      broadcastNapCatLog(line)
    }
  })

  napCatProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      napCatLogs.push(`[ERROR] ${line}`)
      if (napCatLogs.length > MAX_LOG_LINES) napCatLogs.shift()
      broadcastNapCatLog(`[ERROR] ${line}`)
    }
  })

  napCatProcess.on('exit', (code) => {
    logger.info('NapCat', `NapCat 进程退出: code=${code}`)
    broadcastNapCatLog(`[系统] NapCat 已退出 (code=${code})`)
    napCatProcess = null
  })

  napCatProcess.on('error', (err) => {
    logger.error('NapCat', `NapCat 启动失败: ${err.message}`)
    broadcastNapCatLog(`[错误] NapCat 启动失败: ${err.message}`)
    napCatProcess = null
  })
}

/** 停止 NapCat (带超时保护) */
export function stopNapCat(): Promise<void> {
  return new Promise((resolve) => {
    if (!napCatProcess) {
      resolve()
      return
    }

    logger.info('NapCat', '正在停止 NapCat...')

    napCatProcess.on('close', () => {
      napCatProcess = null
      resolve()
    })

    napCatProcess.kill('SIGTERM')

    // 超时强杀
    setTimeout(() => {
      if (napCatProcess) {
        napCatProcess.kill('SIGKILL')
        napCatProcess = null
        resolve()
      }
    }, 3000)
  })
}

/** 获取 NapCat 日志 */
export function getNapCatLogs(): string[] {
  return [...napCatLogs]
}

/** 清空日志 */
export function clearNapCatLogs(): void {
  napCatLogs = []
}

/** 发送命令到 NapCat 进程 stdin */
export function sendNapCatCommand(command: string): void {
  if (!napCatProcess?.stdin) {
    logger.warn('NapCat', '无法发送命令: NapCat 未运行')
    return
  }
  napCatProcess.stdin.write(command + '\n')
}

/** 获取 NapCat 运行状态 */
export function getNapCatStatus(): {
  running: boolean
  pid: number | null
  logCount: number
} {
  return {
    running: napCatProcess !== null,
    pid: napCatProcess?.pid ?? null,
    logCount: napCatLogs.length,
  }
}

// ─────────────────────────────────────────────
// 安装
// ─────────────────────────────────────────────

/** 下载文件到 Buffer (简易实现) */
function downloadToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 60000 }, (res) => {
      // 处理重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadToBuffer(res.headers.location).then(resolve).catch(reject)
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      let totalSize = 0
      const contentLength = parseInt(res.headers['content-length'] ?? '0', 10)

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        totalSize += chunk.length
        if (contentLength > 0) {
          const percent = Math.round((totalSize / contentLength) * 100)
          broadcastDownloadProgress({ percent, status: `下载中... ${percent}%` })
        }
      })

      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })

    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('下载超时'))
    })
  })
}

/** 安装 NapCat (从 GitHub Release 下载) */
export async function installNapCat(): Promise<boolean> {
  const dir = getNapCatDir()
  const emit = (msg: string) => {
    logger.info('NapCat', msg)
    broadcastNapCatLog(`[安装] ${msg}`)
  }

  if (checkNapCat()) {
    emit('NapCat 已安装')
    return true
  }

  emit('开始安装 NapCat...')
  fs.mkdirSync(dir, { recursive: true })

  const version = 'v4.12.8'
  const assetName = 'NapCat.Shell.Windows.Node.zip'

  // GitHub 镜像列表
  const mirrors = [
    `https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
    `https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
    `https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
  ]

  let zipBuffer: Buffer | null = null

  for (const url of mirrors) {
    try {
      emit(`尝试下载: ${url}`)
      broadcastDownloadProgress({ percent: 0, status: '连接中...' })
      zipBuffer = await downloadToBuffer(url)
      if (zipBuffer && zipBuffer.length > 0) break
    } catch (err) {
      emit(`下载失败: ${err}`)
      continue
    }
  }

  if (!zipBuffer) {
    emit('所有镜像下载失败')
    broadcastDownloadProgress({ percent: 0, status: '下载失败', error: true })
    return false
  }

  emit('下载完成，正在解压...')
  broadcastDownloadProgress({ percent: 100, status: '解压中...', processing: true })

  try {
    const zip = new AdmZip(zipBuffer)
    zip.extractAllTo(dir, true)

    // 处理嵌套文件夹 (某些版本解压后有一层目录)
    if (!checkNapCat()) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const nested = path.join(dir, entry.name)
          const nestedShell = path.join(nested, 'NapCat.Shell.exe')
          const nestedMjs = path.join(nested, 'napcat.mjs')
          if (fs.existsSync(nestedShell) || fs.existsSync(nestedMjs)) {
            // 将内容上移
            fs.cpSync(nested, dir, { recursive: true, force: true })
            fs.rmSync(nested, { recursive: true, force: true })
            break
          }
        }
      }
    }

    emit('安装完成')
    broadcastDownloadProgress({ percent: 100, status: '安装完成', completed: true })
    return true
  } catch (err) {
    emit(`解压失败: ${err}`)
    broadcastDownloadProgress({ percent: 0, status: '安装失败', error: true })
    return false
  }
}
