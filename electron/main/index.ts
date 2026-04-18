import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  screen,
  Notification,
  protocol,
  dialog
} from 'electron'
import { release } from 'os'
import { join } from 'path'
import { logger } from './utils/logger'

// 捕获未处理的异常以防止静默崩溃
process.on('uncaughtException', (error) => {
  const errorMsg = `未捕获的异常 (Uncaught Exception): ${error.message}\n${error.stack}`
  logger.error('Main', errorMsg)
  try {
    dialog.showErrorBox('应用启动错误 (Main Process Crash)', errorMsg)
  } catch {
    // 忽略
  }
})

process.on('unhandledRejection', (reason) => {
  const reasonMsg = `未处理的 Promise 拒绝 (Unhandled Rejection): ${reason}`
  logger.error('Main', reasonMsg)
})

import {
  getSteamUser,
  initSteam,
  getSubscribedItems,
  getItemState,
  subscribeToItem,
  unsubscribeFromItem,
  downloadItem,
  getItemInstallInfo
} from './services/steam.js'

import { startBackend, stopBackend, getBackendLogs } from './services/python.js'
import { startGateway, stopGateway } from './services/gateway.js'
import { appEvents } from './events'
import { getDiagnostics } from './services/diagnostics.js'
import {
  getSystemStats,
  getConfig,
  saveConfig,
  getBackendConnectionConfig,
  resolveGatewayToken,
  checkRemoteBackendConnection
} from './services/system.js'
import {
  scanLocalAgents,
  getPlugins,
  saveAgentLaunchConfig,
  saveGlobalLaunchConfig
} from './services/agents.js'
import {
  startNapCat,
  stopNapCat,
  getNapCatLogs,
  sendNapCatCommand,
  installNapCat
} from './services/napcat.js'
import { checkEsInstalled, installEs } from './services/everything.js'
import { scanLocalModels } from './services/models.js'
import { scan3DModels, getModelLoadPath, AssetInfo } from './services/assets.js'
import { SyncResult } from './services/cloudSync.js'
import { setupUpdater } from './services/updater.js'
import { windowManager } from './windows/manager.js'
import { createTray } from './services/tray.js'
import { registerShortcuts } from './services/shortcuts.js'
import axios from 'axios'
import { spawn } from 'child_process'
import path from 'path'
import { isDev, paths } from './utils/env'
import fs from 'fs-extra'

// 加载 Native 渲染核心 (懒加载策略)
// 关键安全改动：不在模块顶层同步 require .node 文件！
// 原生 .node 模块的 segfault 无法被 try/catch 捕获，会直接杀死主进程导致"静默失败"
// 改为在第一次实际调用时才加载，任何崩溃只影响 IPC 调用，不影响 Electron 窗口的显示
let native: any = null
let nativeLoadAttempted = false

function sanitizeValueForLog(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValueForLog(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        const lowered = key.toLowerCase()
        if (lowered.includes('token') || lowered.endsWith('_api_key') || lowered.includes('secret')) {
          return [key, nestedValue ? '***' : '']
        }
        return [key, sanitizeValueForLog(nestedValue)]
      })
    )
  }

  return value
}

function loadNativeModule(): any {
  if (nativeLoadAttempted) return native
  nativeLoadAttempted = true

  try {
    if (isDev) {
      // @ts-ignore
      native = require('../../src/components/avatar/native')
      logger.info('Main', 'Native 核心加载成功 (开发环境)')
    } else {
      const nativePath = path.join(process.resourcesPath, 'native')
      const nativeFile = path.join(nativePath, 'pero-render-core.win32-x64-msvc.node')
      const fallbackPath = path.join(app.getAppPath(), '..', 'native')
      const fallbackFile = path.join(fallbackPath, 'pero-render-core.win32-x64-msvc.node')

      const candidates = [nativeFile, nativePath, fallbackFile, fallbackPath]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          native = require(candidate)
          logger.info('Main', `Native 核心加载成功: ${candidate}`)
          break
        }
      }
      if (!native) {
        logger.warn('Main', 'Native 核心在所有候选路径中均未找到，3D 渲染功能不可用')
      }
    }
  } catch (e: any) {
    logger.error('Main', `Native 核心加载失败: ${e.message}`)
    native = null
  }
  return native
}

import { registerAssetProtocol } from './services/assets.js'

// 注册自定义协议的特权方案 (必须在 app ready 之前)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

// GUI 模式（原始逻辑）

// 禁用 Windows 7 的 GPU 加速
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// 透明支持的标准标志
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// 移除了导致 AMD 显卡不透明问题的激进 GPU 禁用标志
// app.commandLine.appendSwitch('disable-software-rasterizer')
// app.commandLine.appendSwitch('disable-gpu-compositing')

// 禁用自动填充和原生窗口遗掘计算（两个功能必须在同一条 disable-features 里逗号分隔，否则后者会覆盖前者）
app.commandLine.appendSwitch('disable-features', 'Autofill,CalculateNativeWinOcclusion')

// 为 Windows 10+ 通知设置应用程序名称
if (process.platform === 'win32') {
  app.setName('萌动链接：PeroperoChat！')
  app.setAppUserModelId(app.getName())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

// 尝试初始化 Steam
// 如果是通过直接运行 exe 启动的，initSteam 会检测是否需要重启并通过 Steam 启动
try {
  const steamStatus = initSteam()
  if (steamStatus === 'restarting') {
    logger.info('Main', '正在通过 Steam 重启应用，当前进程将退出...')
    app.quit()
    // 注意: 不使用 process.exit(0)，让 Electron 优雅退出
  } else {
    logger.info('Main', `Steam 初始化结果: ${steamStatus}`)
  }
} catch (e) {
  logger.error('Main', `Steam 初始化发生异常 (已跳过): ${e}`)
  // 异常不阻塞应用启动
}

const createWindow = async () => {
  try {
    const win = windowManager.createLauncherWindow()

    // 设置自动更新
    setupUpdater()

    // 创建系统托盘
    createTray()

    // 注册全局快捷键
    registerShortcuts()

    // 测试主动向渲染进程推送消息
    win.webContents.on('did-finish-load', () => {
      try {
        if (!win.isDestroyed())
          win.webContents.send('main-process-message', new Date().toLocaleString())
      } catch {
        // 忽略
      }
    })
  } catch (e) {
    logger.error('Main', `创建窗口失败: ${e}`)
  }
}

// 注册全局 IPC 处理程序
ipcMain.handle('steam-get-user', () => {
  return getSteamUser()
})

ipcMain.handle('steam-workshop-get-subscribed', () => {
  return getSubscribedItems()
})

ipcMain.handle('steam-workshop-get-state', (_, itemId) => {
  return getItemState(itemId)
})

ipcMain.handle('steam-workshop-subscribe', (_, itemId) => {
  subscribeToItem(itemId)
})

ipcMain.handle('steam-workshop-unsubscribe', (_, itemId) => {
  unsubscribeFromItem(itemId)
})

ipcMain.handle('steam-workshop-download', (_, { itemId, highPriority }) => {
  downloadItem(itemId, highPriority)
})

ipcMain.handle('steam-workshop-install-info', (_, itemId) => {
  return getItemInstallInfo(itemId)
})

// Steam Cloud 云同步
ipcMain.handle('steam-cloud-get-status', () => {
  const { cloudSyncService } = require('./services/cloudSync.js')
  return cloudSyncService.getStatus()
})

ipcMain.handle('steam-cloud-upload', async () => {
  const { cloudSyncService } = require('./services/cloudSync.js')
  return await cloudSyncService.uploadToCloud()
})

ipcMain.handle('steam-cloud-download', async () => {
  const { cloudSyncService } = require('./services/cloudSync.js')
  return await cloudSyncService.downloadFromCloud()
})

ipcMain.handle('steam-cloud-sync', async () => {
  const { cloudSyncService } = require('./services/cloudSync.js')
  return await cloudSyncService.sync()
})

ipcMain.handle('steam-cloud-clear', async () => {
  const { cloudSyncService } = require('./services/cloudSync.js')
  return await cloudSyncService.clearCloudData()
})

ipcMain.handle('scan-local-models', async () => {
  return await scanLocalModels()
})


// 3D 模型资产扫描 (包括 Workshop)
ipcMain.handle('scan-3d-models', async () => {
  return await scan3DModels()
})

ipcMain.handle('get-model-load-path', async (_, model: AssetInfo) => {
  return getModelLoadPath(model)
})

// 注册 Native 模块处理程序
ipcMain.handle('native-load-pero-model', async (_, buffer: Buffer, filterPatterns?: string[]) => {
  try {
    if (!buffer || buffer.byteLength < 16) {
      throw new Error(`[native-load-pero-model] Buffer (${buffer?.byteLength} bytes) is too small.`)
    }
    const nativeMod = loadNativeModule()
    if (!nativeMod) throw new Error('Native 渲染核心不可用 (加载失败或文件缺失)')
    return nativeMod.loadPeroModel(buffer, filterPatterns)
  } catch (e) {
    logger.error('Native', `Failed to load pero model: ${e}`)
    throw e
  }
})

ipcMain.handle(
  'native-load-standard-model',
  async (_, buffer: Buffer, filterPatterns?: string[]) => {
    try {
      if (!buffer || buffer.byteLength < 16) {
        throw new Error(`[native-load-standard-model] Buffer (${buffer?.byteLength} bytes) is too small.`)
      }
      const nativeMod = loadNativeModule()
      if (!nativeMod) throw new Error('Native 渲染核心不可用 (加载失败或文件缺失)')
      return nativeMod.loadStandardModel(buffer, filterPatterns)
    } catch (e) {
      logger.error('Native', `Failed to load standard model: ${e}`)
      throw e
    }
  }
)

// 加载 .pero 容器（tar 格式打包的文件夹）
ipcMain.handle('native-load-pero-container', async (_, buffer: Buffer) => {
  try {
    if (!buffer || buffer.byteLength < 16) {
      throw new Error(`传入的 Buffer 小于 16 字节或为空 (${buffer?.byteLength} 字节)，拒绝进行原生加载防止内存崩溃`)
    }
    const nativeMod = loadNativeModule()
    if (!nativeMod) throw new Error('Native 渲染核心不可用 (加载失败或文件缺失)')
    const hex = Buffer.from(buffer).subarray(0, 16).toString('hex')
    const ascii = Buffer.from(buffer).subarray(0, 4).toString('ascii')
    logger.info(
      'Native',
      `pero-container 收到数据: ${buffer.length} 字节, hex前缀: ${hex}, magic: "${ascii}"`
    )
    if (typeof nativeMod.loadPeroContainer !== 'function') {
      throw new Error('渲染核心功能不完整: 缺少 loadPeroContainer')
    }
    return nativeMod.loadPeroContainer(buffer)
  } catch (e: any) {
    logger.error('Native', `Failed to load pero container: ${e.message || e}`)
    throw e
  }
})

app.whenReady().then(async () => {
  try {
    registerAssetProtocol()
    createWindow()

    // 启动时自动从云端同步数据
    try {
      const { cloudSyncService } = require('./services/cloudSync.js')
      const status = cloudSyncService.getStatus()
      if (status.enabled) {
        logger.info('Main', 'Steam 云同步已启用，正在检查云端数据...')
        // 异步下载，不阻塞启动
        cloudSyncService.downloadFromCloud().then((result: SyncResult) => {
          if (result.success) {
            logger.info('Main', `云同步完成: 下载 ${result.downloaded.length} 个文件`)
          } else {
            logger.warn('Main', `云同步部分失败: ${result.errors.join(', ')}`)
          }
        })
      }
    } catch (e) {
      logger.warn('Main', `云同步检查失败: ${e}`)
    }
  } catch (e) {
    logger.error('Main', `App whenReady 执行失败: ${e}`)
  }
})

// 监听服务崩溃事件并进行联动停止
appEvents.on('gateway-crashed', async () => {
  logger.error('Main', 'Gateway 崩溃，正在停止 Backend...')
  await stopBackend()
})

appEvents.on('backend-crashed', async () => {
  logger.error('Main', 'Backend 崩溃，正在停止 Gateway...')
  await stopGateway()
})

let isQuitting = false

app.on('window-all-closed', () => {
  // 什么都不做，保持应用在托盘中运行
  if (process.platform === 'darwin') return
})

app.on('before-quit', async (event) => {
  if (isQuitting) return

  event.preventDefault()
  isQuitting = true

  logger.info('Main', '正在执行退出前清理...')
  try {
    // 1. 先关闭所有窗口
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.destroy() // 强制销毁所有窗口
      }
    })

    // 2. 停止所有后台服务
    await Promise.all([stopBackend(), stopGateway(), stopNapCat()])
    logger.info('Main', '后台服务已成功停止')

    // 3. 退出前上传数据到云端
    try {
      const { cloudSyncService } = require('./services/cloudSync.js')
      const status = cloudSyncService.getStatus()
      if (status.enabled) {
        logger.info('Main', '正在上传数据到 Steam 云...')
        const result: SyncResult = await cloudSyncService.uploadToCloud()
        if (result.success) {
          logger.info('Main', `云同步上传完成: ${result.uploaded.length} 个文件`)
        } else {
          logger.warn('Main', `云同步上传部分失败: ${result.errors.join(', ')}`)
        }
      }
    } catch (e) {
      logger.warn('Main', `退出时云同步失败: ${e}`)
    }
  } catch (e) {
    logger.error('Main', `停止后台服务时出错: ${e}`)
  }

  app.quit()
})

app.on('second-instance', () => {
  logger.info('Main', '收到第二个实例启动请求，正在激活现有窗口...')
  const win = windowManager.launcherWin || windowManager.strongholdWin || windowManager.petWin
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    if (!win.isVisible()) win.show()
  } else {
    logger.info('Main', '未发现现有窗口，尝试重新创建 Launcher 窗口...')
    createWindow()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// IPC 处理程序 - 来自渲染进程的日志
ipcMain.on('log-from-renderer', (_, message) => {
  logger.info('Renderer', message)
})

ipcMain.on('show-notification', (_, { title, body }) => {
  new Notification({ title, body }).show()
})

ipcMain.handle('resize-pet-window', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    logger.info('Main', `IPC: 调整大小至 ${width}x${height}`)
    try {
      // 临时允许调整大小以确保操作系统接受更改 (特别是在具有透明窗口的 Windows 上)
      win.setResizable(true)
      win.setMinimumSize(200, 200) // 重置限制

      // 使用 setBounds 进行更好的原子更新
      const bounds = win.getBounds()
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: Math.round(width),
        height: Math.round(height)
      })

      // 恢复可调整大小状态
      win.setResizable(false)
      return true
    } catch (e) {
      logger.error('Main', `IPC: 调整大小失败: ${e}`)
      return false
    }
  }
  return false
})

ipcMain.handle('emit_event', (_, { event, payload }) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  })
})

ipcMain.handle('chat-message', async (_, args) => {
  try {
    const token = await resolveGatewayToken()
    const connection = getBackendConnectionConfig()
    const { message } = args

    logger.info('Main', `IPC: 正在发送聊天消息到后端: ${message}`)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    await axios.post(
      `${connection.apiBase}/ide/chat`,
      {
        messages: [{ role: 'user', content: message }],
        source: 'desktop',
        session_id: 'default'
      },
      {
        headers
      }
    )
    return { status: 'ok' }
  } catch (error: any) {
    logger.error('Main', `IPC: chat-message 失败: ${error.message}`)
    throw error
  }
})

ipcMain.on('get_backend_connection_config_sync', (event) => {
  event.returnValue = getBackendConnectionConfig()
})

ipcMain.handle('get_backend_connection_config', () => {
  return getBackendConnectionConfig()
})

ipcMain.handle('start_backend', async (_, args) => {
  const connection = getBackendConnectionConfig()

  if (connection.mode === 'remote') {
    if (!connection.configured) {
      throw new Error('远程后端地址未配置')
    }

    try {
      const remoteCheck = await checkRemoteBackendConnection(connection.baseUrl)
      if (!remoteCheck.ok) {
        throw new Error(remoteCheck.message)
      }
      logger.info('Main', `远程后端连接成功: ${connection.baseUrl}`)
      return null
    } catch (error: any) {
      logger.error('Main', `远程后端连接失败: ${error.message}`)
      throw new Error(`远程后端不可用: ${error.message}`)
    }
  }

  // Tauri invoke 将 args 作为对象传递 { enableSocialMode: true }
  const win = windowManager.launcherWin
  if (!win) return
  try {
    // 首先启动网关
    await startGateway()
    // 然后启动后端
    await startBackend(win, args?.enableSocialMode ?? false)
    return null // Ok(())
  } catch (e: any) {
    throw e.message
  }
})

ipcMain.handle('start_gateway', async (event) => {
  const connection = getBackendConnectionConfig()
  if (connection.mode === 'remote') {
    return
  }

  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) await startGateway()
})

ipcMain.handle('stop_backend', async () => {
  const connection = getBackendConnectionConfig()
  if (connection.mode === 'remote') {
    return
  }

  await stopBackend()
  await stopGateway()
})

ipcMain.handle('get_system_stats', async () => {
  return await getSystemStats()
})

ipcMain.handle('get_config', () => {
  const config = getConfig()
  logger.info('Main', `IPC: get_config 返回配置: ${JSON.stringify(sanitizeValueForLog(config))}`)
  return config
})

ipcMain.handle('get_gateway_token', async () => {
  return await resolveGatewayToken()
})

ipcMain.handle('quit_app', () => {
  isQuitting = true
  app.quit()
})

ipcMain.handle('save_config', (_, args) => {
  logger.info('Main', `IPC: save_config 收到数据: ${JSON.stringify(sanitizeValueForLog(args))}`)
  // 前端发送 { config: ... } 以匹配 Tauri 签名
  let config = args.config || args

  // 健壮的解包/清理逻辑
  if (config && typeof config === 'object' && 'config' in config) {
    const keys = Object.keys(config)
    // 如果 config 有其他键，'config' 属性可能是垃圾数据
    if (keys.length > 1) {
      delete config.config
    } else {
      // 如果 config 只有 'config' 属性，它可能是一个包装器
      config = config.config
    }
  }

  logger.info('Main', `IPC: 正在保存处理后的配置: ${JSON.stringify(sanitizeValueForLog(config))}`)
  saveConfig(config)
  return null
})

// 缺失处理程序的模拟，以防止错误
ipcMain.handle('get_plugins', async () => {
  return await getPlugins()
})
ipcMain.handle('check_es', () => checkEsInstalled())
ipcMain.handle('get_backend_logs', () => getBackendLogs())
ipcMain.handle('scan_local_agents', async () => {
  return await scanLocalAgents()
})

// 接收渲染进程的系统级错误日志
ipcMain.handle('system_error_log', (_, errMsg) => {
  logger.error('Renderer', errMsg)
})

// 根据角色 ID 获取该角色的交互台词
ipcMain.handle('get_agent_waifu_texts', async (_, agentId: string) => {
  const root = isDev ? path.resolve(__dirname, '../..') : paths.resources
  const waifuPath = path.join(root, 'backend/services/mdp/agents', agentId, 'waifu_texts.json')
  if (await fs.pathExists(waifuPath)) {
    return await fs.readJson(waifuPath)
  }
  // 找不到角色台词时返回空对象，前端会使用默认台词
  logger.warn('Main', `[Agents] 未找到角色 ${agentId} 的 waifu_texts.json: ${waifuPath}`)
  return {}
})
ipcMain.handle('check_napcat', async () => {
  const diag = await getDiagnostics()
  return diag.napcat_installed
})

ipcMain.handle('save_agent_launch_config', async (_, args) => {
  // 检查参数是否匹配全局配置签名: { enabledAgents, activeAgent }
  if (args && Array.isArray(args.enabledAgents) && typeof args.activeAgent === 'string') {
    return await saveGlobalLaunchConfig(args.enabledAgents, args.activeAgent)
  }

  // 后备或特定代理配置: { agentId, config }
  if (args && args.agentId && args.config) {
    return await saveAgentLaunchConfig(args.agentId, args.config)
  }

  throw new Error('save_agent_launch_config 参数无效')
})

// [修复] 添加 LauncherView 调用的 save_global_launch_config 的缺失处理程序
ipcMain.handle('save_global_launch_config', async (_, args) => {
  if (args && Array.isArray(args.enabledAgents) && typeof args.activeAgent === 'string') {
    return await saveGlobalLaunchConfig(args.enabledAgents, args.activeAgent)
  }
  throw new Error('save_global_launch_config 参数无效')
})

ipcMain.handle('install_es', async () => {
  const win = windowManager.launcherWin
  if (!win) return false
  return await installEs(win)
})

// 下载模型 IPC
ipcMain.handle('download_models', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false

  try {
    const diag = await getDiagnostics()
    const pythonPath = diag.python_path
    if (!diag.python_exists) {
      throw new Error('Python environment not found')
    }

    const workspaceRoot = isDev ? path.resolve(__dirname, '../..') : paths.resources

    let cliScript = path.join(workspaceRoot, 'backend/utils/model_cli.py')
    // 生产环境资源目录逻辑
    const resourceDir = isDev ? workspaceRoot : paths.resources
    if (!(await fs.pathExists(cliScript))) {
      cliScript = path.join(resourceDir, 'backend/utils/model_cli.py')
    }
    if (!(await fs.pathExists(cliScript))) {
      cliScript = path.join(path.dirname(diag.script_path), 'utils/model_cli.py')
    }

    // [修复] 增加对 CWD 的回退检查，解决开发环境下路径解析错误的问题
    if (!(await fs.pathExists(cliScript))) {
      const cwdPath = path.join(process.cwd(), 'backend/utils/model_cli.py')
      if (await fs.pathExists(cwdPath)) {
        cliScript = cwdPath
        logger.info('Main', `Found model_cli.py in CWD: ${cliScript}`)
      }
    }

    if (!(await fs.pathExists(cliScript))) {
      throw new Error(
        `model_cli.py not found. Searched in workspaceRoot, resourceDir, script_path, and CWD.`
      )
    }

    logger.info('Main', `Starting model download with ${pythonPath} ${cliScript}`)

    // 构造环境变量
    const env = { ...process.env }

    // [环境隔离] 移除可能污染我们嵌入式 Python 实例的系统或用户环境变量
    Object.keys(env).forEach((key) => {
      if (key.startsWith('PYTHON') && key !== 'PATH' && key !== 'PYTHONPATH') {
        delete env[key]
      }
    })

    env['HF_ENDPOINT'] = 'https://hf-mirror.com' // 强制使用 HF 镜像
    env['PYTHONUNBUFFERED'] = '1' // 强制 Python 输出不缓冲，防止下载大文件时日志卡住

    const pythonDir = path.dirname(pythonPath)
    const isEmbeddedPython =
      pythonPath.includes(path.join('resources', 'python')) ||
      pythonPath.includes(path.join('resources\\python'))

    if (isDev) {
      if (!pythonPath.toLowerCase().includes('.venv') && !pythonPath.toLowerCase().includes('venv')) {
        env['PYTHONHOME'] = pythonDir
      } else {
        delete env['PYTHONHOME']
      }
      env['PYTHONPATH'] = workspaceRoot
    } else if (isEmbeddedPython) {
      delete env['PYTHONHOME']
      // 同时包含 resources 和 resources/backend，以支持两种导入风格
      env['PYTHONPATH'] = `${resourceDir}${path.delimiter}${path.join(resourceDir, 'backend')}`
    } else {
      env['PYTHONHOME'] = pythonDir
      env['PYTHONPATH'] = `${resourceDir}${path.delimiter}${path.join(resourceDir, 'backend')}`
    }
    env['PYTHONNOUSERSITE'] = '1'
    env['PYTHONUTF8'] = '1'

    return new Promise((resolve, reject) => {
      const child = spawn(pythonPath, [cliScript, 'download', '--model', 'default'], {
        env: env
      })

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) {
            logger.info('ModelDownload', line.trim())
            // 发送进度到前端
            win.webContents.send('download-progress', {
              percent: -1, // 不确定进度
              status: line.trim()
            })
          }
        }
      })

      child.stderr.on('data', (data) => {
        const str = data.toString()
        // 仅当包含明确的错误关键词时才记录为 ERROR
        if (
          (str.includes('Error') || str.includes('Exception') || str.includes('Traceback')) &&
          !str.includes('UserWarning') // 忽略警告
        ) {
          logger.error('ModelDownload', str)
        } else {
          logger.info('ModelDownload', str)

          // 尝试更智能地解析进度条
          // 匹配 huggingface_hub 的 tqdm 进度条格式:
          // Fetching 6 files:  17%|#6        | 1/6 [00:01<00:07,  1.42s/it]
          // model.bin:  25%|##5       | 100M/400M [00:05<00:15, 20.0MB/s]

          let percent = -1
          const status = str.trim()

          // 尝试提取百分比
          const percentMatch = str.match(/(\d+)%/)
          if (percentMatch) {
            percent = parseInt(percentMatch[1])
          }

          // 如果是 "Fetching X files" 这种总体进度，权重更高
          if (str.includes('Fetching') && str.includes('files')) {
            // 这是一个总体进度，可以直接使用
          } else if (percent === 100) {
            // 单个文件下载完成，不应该让整体进度条直接跳到 100%
            // 我们可以忽略单个文件的 100%，或者将其视为中间状态
            percent = -1
          }

          win.webContents.send('download-progress', {
            percent: percent,
            status: status
          })
        }
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(true)
        } else {
          reject(new Error(`Model download failed with code ${code}`))
        }
      })
    })
  } catch (e: any) {
    logger.error('Main', `Model download error: ${e.message}`)
    throw e
  }
})

ipcMain.handle('install_napcat', async () => {
  const win = windowManager.launcherWin
  if (!win) return false
  try {
    return await installNapCat(win)
  } catch {
    return false
  }
})

ipcMain.handle('start_napcat', async () => {
  const win = windowManager.launcherWin
  if (!win) return
  try {
    await startNapCat(win)
  } catch (e: any) {
    throw e.message
  }
})

ipcMain.handle('stop_napcat_wrapper', async () => {
  stopNapCat()
})

ipcMain.handle('get_napcat_logs', () => {
  return getNapCatLogs()
})

ipcMain.handle('send_napcat_command_wrapper', (_, args) => {
  // 检查 args 是字符串还是对象 { command: string }
  const cmd = typeof args === 'string' ? args : args?.command
  if (cmd) sendNapCatCommand(cmd)
})

ipcMain.handle('open_root_folder', () => {
  shell.openPath(process.cwd())
})

ipcMain.handle('open_pet_window', () => {
  windowManager.createPetWindow()
  return true
})

ipcMain.handle('hide_pet_window', () => {
  windowManager.petWin?.hide()
})

ipcMain.handle('open_dashboard_window', () => {
  windowManager.createDashboardWindow()
})

ipcMain.handle('open_dashboard', () => {
  windowManager.createDashboardWindow()
})

ipcMain.handle('close_launcher', () => {
  windowManager.closeLauncherWindow()
})

ipcMain.handle('hide_launcher', () => {
  logger.info('Main', 'IPC: hide_launcher 收到隐藏请求')
  windowManager.hideLauncherWindow()
})

ipcMain.handle('open_ide_window', () => {
  windowManager.createIDEWindow()
})

ipcMain.handle('set_ignore_mouse', (event, ignore: boolean) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.handle('set_fix_window_topmost', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.setAlwaysOnTop(true, 'screen-saver')
})

let dragInterval: NodeJS.Timeout | null = null

ipcMain.on('window-drag-start', (event, { offsetX, offsetY }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return

  if (dragInterval) clearInterval(dragInterval)

  // 缓存大小以进行 setBounds 优化 (在 Windows 上更平滑)
  const { width, height } = window.getBounds()

  // 在主进程中轮询鼠标位置以直接移动窗口
  // 避免 IPC 延迟循环，并提供了类似原生的流畅度
  dragInterval = setInterval(() => {
    try {
      if (window.isDestroyed()) {
        if (dragInterval) clearInterval(dragInterval)
        return
      }

      const cursor = screen.getCursorScreenPoint()
      // 使用 setBounds，它通常是原子的，并且比 setPosition 更平滑
      window.setBounds({
        x: cursor.x - Math.round(offsetX),
        y: cursor.y - Math.round(offsetY),
        width,
        height
      })
    } catch (e) {
      logger.error('Main', `拖拽错误: ${e}`)
      if (dragInterval) clearInterval(dragInterval)
    }
  }, 1) // 1ms 间隔 (最大平滑度)
})

ipcMain.on('window-drag-end', () => {
  if (dragInterval) {
    clearInterval(dragInterval)
    dragInterval = null
  }
})

// 保留旧的处理程序以实现兼容性或回退
ipcMain.on('window-move-fast', (event, { x, y }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.setPosition(Math.round(x), Math.round(y))
  }
})

ipcMain.handle('window-move', (event, { x, y }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    // console.log(`[IPC] 移动窗口到: ${x}, ${y}`)
    window.setPosition(Math.round(x), Math.round(y))
  }
})

// 窗口控制
ipcMain.handle('window-minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.minimize()
})
ipcMain.handle('window-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window?.isMaximized()) {
    window.unmaximize()
    return false
  } else {
    window?.maximize()
    return true
  }
})
ipcMain.handle('window-toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window?.isMaximized()) {
    window.unmaximize()
    return false
  } else {
    window?.maximize()
    return true
  }
})
ipcMain.handle('window-unmaximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.unmaximize()
  return false
})
ipcMain.handle('window-close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.close()
})
ipcMain.handle('window-is-maximized', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window?.isMaximized()
})

ipcMain.handle('show_window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.show()
    window.focus()
  }
})

ipcMain.handle('window-show', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.show()
    window.focus()
  }
})

ipcMain.handle('window-focus', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.focus()
})

ipcMain.handle('close_dashboard', () => {
  windowManager.dashboardWin?.close()
})

ipcMain.handle('get_app_version', () => {
  return app.getVersion()
})

ipcMain.handle('open-win', (_, arg) => {
  // 稍后使用窗口管理器？目前是简单的实现
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    // 使用 app.getAppPath() 以确保在 ASAR 打包后路径正确
    childWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'), { hash: arg })
  }
})
