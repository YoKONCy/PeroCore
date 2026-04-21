/**
 * 桌面感知服务
 *
 * Electron 专属的桌面环境感知能力：
 * - 屏幕截图      → desktopCapturer (Electron 内置)
 * - 剪贴板读写    → clipboard (Electron 内置)
 * - 前台窗口识别  → PowerShell (Windows) / AppleScript (macOS)
 *
 * 全部零第三方依赖。
 *
 * @platform ELECTRON
 * @module electron/main/services/desktopAwareness
 */

import { desktopCapturer, clipboard, nativeImage } from 'electron'
import { exec } from 'node:child_process'
import { logger } from '../utils/logger'

// ── 屏幕截图 ──

export interface ScreenshotResult {
  /** Base64 编码的 PNG 数据 */
  dataUrl: string
  /** 原始宽度 */
  width: number
  /** 原始高度 */
  height: number
  /** 截图时间戳 */
  timestamp: number
}

/**
 * 截取整个主屏幕
 *
 * @param maxWidth 最大宽度 (缩放以节省 token), 默认 1280
 */
export async function captureScreen(maxWidth = 1280): Promise<ScreenshotResult | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: Math.round(maxWidth * 0.5625) },
    })

    if (sources.length === 0) {
      logger.warn('DesktopAwareness', '未找到可截取的屏幕')
      return null
    }

    const primary = sources[0]
    if (!primary) {
      logger.warn('DesktopAwareness', '未找到可截取的屏幕')
      return null
    }
    const thumbnail = primary.thumbnail
    const size = thumbnail.getSize()

    return {
      dataUrl: thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
      timestamp: Date.now(),
    }
  } catch (err) {
    logger.error('DesktopAwareness', `截屏失败: ${err}`)
    return null
  }
}

// ── 剪贴板 ──

export interface ClipboardContent {
  text: string
  hasImage: boolean
  formats: string[]
}

/** 读取剪贴板内容 */
export function readClipboard(): ClipboardContent {
  return {
    text: clipboard.readText(),
    hasImage: !clipboard.readImage().isEmpty(),
    formats: clipboard.availableFormats(),
  }
}

/** 写入文本到剪贴板 */
export function writeClipboard(text: string): void {
  clipboard.writeText(text)
}

/** 读取剪贴板图片 (Base64) */
export function readClipboardImage(): string | null {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return img.toDataURL()
}

/** 写入图片到剪贴板 */
export function writeClipboardImage(dataUrl: string): void {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
}

// ── 前台窗口识别 ──

export interface ActiveWindowInfo {
  title: string
  processName: string
  pid: number
}

/**
 * 获取当前前台窗口信息
 *
 * Windows: PowerShell Get-Process
 * macOS: osascript
 * Linux: xdotool
 *
 * 零第三方依赖。
 */
export function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // PowerShell 一行命令获取前台窗口
      const cmd = `powershell -NoProfile -Command "
        Add-Type @'
          using System;
          using System.Runtime.InteropServices;
          public class User32 {
            [DllImport(\\"user32.dll\\")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport(\\"user32.dll\\", SetLastError=true)]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
            [DllImport(\\"user32.dll\\", CharSet=CharSet.Unicode)]
            public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
          }
'@
        $hwnd = [User32]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder(256)
        [void][User32]::GetWindowText($hwnd, $sb, 256)
        $pid = 0
        [void][User32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
        Write-Output \\"$($sb.ToString())|$name|$pid\\"
      "`

      exec(cmd, { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const parts = stdout.trim().split('|')
        if (parts.length >= 3) {
          resolve({
            title: parts[0] ?? '',
            processName: parts[1] ?? '',
            pid: parseInt(parts[2] ?? '0', 10) || 0,
          })
        } else {
          resolve(null)
        }
      })
    } else if (process.platform === 'darwin') {
      const cmd = `osascript -e 'tell application "System Events" to get {name, unix id} of first process whose frontmost is true'`
      exec(cmd, { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const parts = stdout.trim().split(', ')
        resolve({
          title: parts[0] ?? '',
          processName: parts[0] ?? '',
          pid: parseInt(parts[1] ?? '0', 10) || 0,
        })
      })
    } else {
      // Linux: xdotool
      exec('xdotool getactivewindow getwindowname', { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        resolve({
          title: stdout.trim(),
          processName: '',
          pid: 0,
        })
      })
    }
  })
}
