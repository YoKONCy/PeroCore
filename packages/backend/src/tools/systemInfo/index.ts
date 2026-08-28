/**
 * systemInfo — 系统信息 + 应用启动工具
 *
 * 跨平台能力:
 * - get_system_info    → 系统信息 (os 模块，跨平台)
 * - open_application   → 启动应用 (open 命令抽象，跨平台)
 * - get_active_windows → 列出窗口 (平台适配)
 * - activate_window    → 切换窗口 (平台适配)
 *
 * 核心逻辑使用 Node.js 原生 os/process/child_process，
 * 窗口列表/激活等 GUI 操作通过可选的 WindowProvider 注入，
 * 不依赖 native addon，降级到 shell 命令。
 *
 * @module packages/backend/src/tools/systemInfo
 */

import type { BuiltinTool } from '../index'
import { execSync } from 'node:child_process'
import os from 'node:os'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SystemInfo')

// ── 窗口管理提供者抽象 ──

/** 窗口管理提供者接口 (可选) */
export interface WindowProvider {
  /** 获取活跃窗口列表 */
  getActiveWindows(): Promise<WindowInfo[]>
  /** 激活/置顶指定窗口 */
  activateWindow(target: string): Promise<string>
}

export interface WindowInfo {
  /** 进程名 */
  processName: string
  /** 窗口标题 */
  title: string
  /** 窗口句柄 (平台相关) */
  handle?: number
}

/** 工厂函数: 供 tools/index.ts 调用 (闭包内无模块级可变状态) */
let _windowProvider: WindowProvider | null = null

/** 设置 WindowProvider（仅供向后兼容，建议使用 createSystemInfoTools） */
export function setWindowProvider(provider: WindowProvider | null): void {
  _windowProvider = provider
}

/** 获取当前 WindowProvider (工具内部使用) */
export function getWindowProvider(): WindowProvider | null {
  return _windowProvider
}

// ── get_system_info ──

export const getSystemInfoTool: BuiltinTool = {
  name: 'get_system_info',

  async execute() {
    try {
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const cpus = os.cpus()

      const info = {
        os: os.platform(),
        version: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: `${Math.floor(os.uptime() / 3600)} 小时`,
        cpu: {
          model: cpus[0]?.model ?? '未知',
          cores: cpus.length,
        },
        memory: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
          used: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)} GB`,
          usagePercent: `${(((totalMem - freeMem) / totalMem) * 100).toFixed(0)}%`,
        },
        homedir: os.homedir(),
      }

      return JSON.stringify({ success: true, system: info })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `获取系统信息失败: ${errMsg}` })
    }
  },
}

export interface ApplicationProvider {
  launch(appName: string): Promise<{
    application: string
    mode: 'activated' | 'launched'
    targetType: 'window' | 'path' | 'aumid'
  }>
}

let _applicationProvider: ApplicationProvider | null = null

export function setApplicationProvider(provider: ApplicationProvider | null): void {
  _applicationProvider = provider
}

function errorResult(code: string, message: string): string {
  return JSON.stringify({ success: false, error: { code, message } })
}

// ── open_application ──

export const openApplicationTool: BuiltinTool = {
  name: 'open_application',

  async execute(args) {
    const appName = (args.app_name as string)?.trim()
    if (!appName) return errorResult('APPLICATION_NAME_REQUIRED', '请提供应用程序名称')
    if (!_applicationProvider) {
      return errorResult(
        'APPLICATION_LAUNCH_UNAVAILABLE',
        '应用启动能力不可用，请连接 Electron 客户端',
      )
    }

    logger.info(`请求客户端打开应用: ${appName}`)
    try {
      const result = await _applicationProvider.launch(appName)
      return JSON.stringify({
        success: true,
        application: result.application,
        mode: result.mode,
        targetType: result.targetType,
        message:
          result.mode === 'activated'
            ? `已切换到正在运行的应用: ${result.application}`
            : `已启动应用: ${result.application}`,
      })
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      const separator = text.indexOf(':')
      const code = separator > 0 ? text.slice(0, separator) : 'APPLICATION_LAUNCH_FAILED'
      const message = separator > 0 ? text.slice(separator + 1).trim() : text
      logger.error(`打开应用失败: ${text}`)
      return errorResult(code, message)
    }
  },
}

// ── get_active_windows ──

export const getActiveWindowsTool: BuiltinTool = {
  name: 'get_active_windows',

  async execute() {
    // 优先使用注入的 WindowProvider
    if (_windowProvider) {
      try {
        const windows = await _windowProvider.getActiveWindows()
        return JSON.stringify({
          success: true,
          windows: windows.map((w: WindowInfo) => `[${w.processName}] ${w.title}`),
          total: windows.length,
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return JSON.stringify({ error: `获取窗口列表失败: ${errMsg}` })
      }
    }

    // 降级: 使用 shell 命令
    const platform = os.platform()

    try {
      let output: string

      if (platform === 'win32') {
        // Windows: tasklist 获取进程列表 (非真正窗口列表，但聊胜于无)
        output = execSync(
          'powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object ProcessName, MainWindowTitle | Format-Table -AutoSize"',
          { timeout: 5000, encoding: 'utf-8' },
        )
      } else if (platform === 'darwin') {
        output = execSync(
          'osascript -e \'tell application "System Events" to get name of every process whose visible is true\'',
          { timeout: 5000, encoding: 'utf-8' },
        )
      } else {
        output = execSync('wmctrl -l 2>/dev/null || echo "wmctrl 未安装"', {
          timeout: 5000,
          encoding: 'utf-8',
        })
      }

      return JSON.stringify({
        success: true,
        output: output.trim().slice(0, 5000),
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `获取窗口列表失败: ${errMsg}` })
    }
  },
}

// ── activate_window ──

export const activateWindowTool: BuiltinTool = {
  name: 'activate_window',

  async execute(args) {
    const target = (args.target as string)?.trim()
    if (!target) {
      return JSON.stringify({ error: '请提供窗口名称' })
    }

    // 优先使用注入的 WindowProvider
    if (_windowProvider) {
      try {
        const result = await _windowProvider.activateWindow(target)
        return JSON.stringify({ success: true, message: result })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return JSON.stringify({ error: `切换窗口失败: ${errMsg}` })
      }
    }

    // 降级: 平台 shell 命令
    const platform = os.platform()

    try {
      if (platform === 'win32') {
        // PowerShell: 使用 AppActivate (简单但有效)
        const script = `
          Add-Type -AssemblyName Microsoft.VisualBasic
          [Microsoft.VisualBasic.Interaction]::AppActivate("${target.replace(/"/g, '`"')}")
        `
        execSync(`powershell -Command "${script}"`, { timeout: 5000 })
        return JSON.stringify({ success: true, message: `已切换到窗口: ${target}` })
      } else if (platform === 'darwin') {
        execSync(`osascript -e 'tell application "${target}" to activate'`, { timeout: 5000 })
        return JSON.stringify({ success: true, message: `已切换到窗口: ${target}` })
      } else {
        execSync(`wmctrl -a "${target}" 2>/dev/null`, { timeout: 5000 })
        return JSON.stringify({ success: true, message: `已切换到窗口: ${target}` })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `切换窗口失败: ${errMsg}` })
    }
  },
}
