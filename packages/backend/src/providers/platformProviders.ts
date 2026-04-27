/**
 * 平台能力提供者 — nut-js 驱动版
 *
 * 使用 @nut-tree/nut-js v4 统一实现跨平台桌面 GUI 能力:
 * - 截图 (ScreenshotProvider)
 * - 窗口管理 (WindowProvider)
 * - 桌面自动化 (DesktopAutomationProvider)
 *
 * 架构要点:
 * - nut-js 为 optionalDependency，通过动态 import() 懒加载
 * - Docker/无头环境: import 失败 → 工厂函数返回 null → 不注入 → 工具返回友好错误
 * - Electron 桌面模式: 正常加载，由 container.ts 按环境门控注入
 * - 截图: screen.grab() 获取内存 Image → bgrToPng 编码 → base64 (零临时文件)
 * - PNG 编码使用 Node.js 内置 zlib (零外部依赖)
 * - 通知功能 nut-js 不覆盖，保留平台 shell 命令
 *
 * @module packages/backend/src/providers/platformProviders
 */

import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import zlib from 'node:zlib'
import { createLogger } from '../lib/logger'

import type { ScreenshotProvider } from '../tools/screenVision'
import type { WindowProvider, WindowInfo } from '../tools/systemInfo'
import type { DesktopAutomationProvider } from '../tools/desktopAutomation'

const logger = createLogger('PlatformProviders')

// ─────────────────────────────────────────────
// nut-js 懒加载 (optionalDependency, 动态 import)
// ─────────────────────────────────────────────

/** nut-js 图片结构 */
interface NutImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

/** nut-js 窗口结构 */
interface NutWindow {
  title: Promise<string> | string
  focus(): Promise<void>
}

/** nut-js 模块最小结构类型 */
interface NutJsModule {
  screen: {
    grab(): Promise<NutImage>
  }
  getWindows(): Promise<NutWindow[]>
  mouse: {
    setPosition(point: unknown): Promise<void>
    click(button: number): Promise<void>
    doubleClick(button: number): Promise<void>
    pressButton(button: number): Promise<void>
    releaseButton(button: number): Promise<void>
    move(path: unknown): Promise<void>
    getPosition(): Promise<{ x: number; y: number }>
  }
  keyboard: {
    type(text: string): Promise<void>
    pressKey(...keys: number[]): Promise<void>
    releaseKey(...keys: number[]): Promise<void>
  }
  Point: new (x: number, y: number) => unknown
  Button: {
    LEFT: number
    RIGHT: number
  }
  Key: Record<string, number>
  straightTo(point: unknown): Promise<unknown> | unknown
}

/** 单例缓存: undefined=未尝试, null=不可用, NutJsModule=已加载 */
let _nutJs: NutJsModule | null | undefined
const require = createRequire(import.meta.url)

/**
 * 懒加载 nut-js — 首次调用时动态 import，后续返回缓存
 *
 * Docker/无头环境下 native addon 不存在，import 会静默失败并缓存 null。
 */
async function getNutJs(): Promise<NutJsModule | null> {
  if (_nutJs !== undefined) return _nutJs
  try {
    _nutJs = require('@nut-tree/nut-js') as NutJsModule
    logger.info('nut-js 已加载，桌面自动化功能可用')
    return _nutJs
  } catch (err) {
    _nutJs = null
    logger.warn(`nut-js 加载失败 (无头环境?): ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// ─────────────────────────────────────────────
// PNG 编码工具 (BGR/BGRA → PNG, Node.js 内置 zlib)
// ─────────────────────────────────────────────

/** CRC32 查询表 (PNG 校验和) */
const CRC32_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]!) & 0xff]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const payload = Buffer.concat([typeBytes, data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(payload), 0)
  return Buffer.concat([len, payload, checksum])
}

/**
 * 将 nut-js Image 的原始像素数据编码为 PNG Buffer
 *
 * nut-js screen.grab() 默认返回 BGR (3ch) 或 BGRA (4ch)。
 * 输出 RGB (无 alpha) PNG，使用 Node.js 内置 zlib deflate。
 */
function imageToPng(data: Buffer, width: number, height: number, channels: number): Buffer {
  const rowBytes = width * 3 // 输出 RGB PNG

  // BGR(A) → RGB + 每行前加 filter byte (0 = None)
  const filtered = Buffer.alloc(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    const dstRow = y * (rowBytes + 1)
    filtered[dstRow] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels
      const dst = dstRow + 1 + x * 3
      filtered[dst] = data[src + 2]! // R ← B
      filtered[dst + 1] = data[src + 1]! // G ← G
      filtered[dst + 2] = data[src]! // B ← R
    }
  }

  const compressed = zlib.deflateSync(filtered, { level: 6 })

  // IHDR (13 bytes): width, height, bitDepth=8, colorType=2 (RGB)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB (无 alpha，减小体积)
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: adaptive
  ihdr[12] = 0 // interlace: none

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG 签名
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─────────────────────────────────────────────
// NutScreenshotProvider — 跨平台截图
// ─────────────────────────────────────────────

/**
 * 基于 nut-js 的截图提供者
 *
 * screen.grab() → BGR Image → PNG base64
 * 全内存处理，无临时文件。
 */
export class NutScreenshotProvider implements ScreenshotProvider {
  async capture(): Promise<string | null> {
    const nut = await getNutJs()
    if (!nut) return null

    try {
      // grab() 返回内存 Image 对象 (BGR/BGRA)
      const image = await nut.screen.grab()
      const pngBuffer = imageToPng(image.data, image.width, image.height, image.channels)
      return pngBuffer.toString('base64')
    } catch (err) {
      logger.error(`截图失败: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
}

// ─────────────────────────────────────────────
// NutWindowProvider — 跨平台窗口管理
// ─────────────────────────────────────────────

/**
 * 基于 nut-js 的窗口管理提供者
 *
 * getWindows() 返回 Window[] 对象，每个有 .title / .focus() 等方法。
 */
export class NutWindowProvider implements WindowProvider {
  async getActiveWindows(): Promise<WindowInfo[]> {
    const nut = await getNutJs()
    if (!nut) return []

    try {
      const windows = await nut.getWindows()
      const results: WindowInfo[] = []

      for (const w of windows) {
        try {
          const title = await w.title
          if (title) {
            results.push({ processName: title, title })
          }
        } catch {
          // 跳过无法读取的窗口 (最小化/系统窗口等)
        }
      }

      return results
    } catch (err) {
      logger.error(`获取窗口列表失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  async activateWindow(target: string): Promise<string> {
    const nut = await getNutJs()
    if (!nut) throw new Error('桌面环境不可用')

    const windows = await nut.getWindows()
    const lowerTarget = target.toLowerCase()

    for (const w of windows) {
      try {
        const title = await w.title
        if (title?.toLowerCase().includes(lowerTarget)) {
          await w.focus()
          return `已切换到窗口: ${title}`
        }
      } catch {
        continue
      }
    }

    throw new Error(`未找到匹配 "${target}" 的窗口`)
  }
}

// ─────────────────────────────────────────────
// NutDesktopAutomationProvider — 跨平台 GUI 自动化
// ─────────────────────────────────────────────

/**
 * 基于 nut-js 的桌面自动化提供者
 *
 * 鼠标/键盘操作通过 nut-js 统一 API，无需平台 switch/case。
 * 通知功能 nut-js 不覆盖，保留 shell 命令降级。
 */
export class NutDesktopAutomationProvider implements DesktopAutomationProvider {
  async moveTo(x: number, y: number): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    await nut.mouse.setPosition(new nut.Point(x, y))
  }

  async click(x?: number, y?: number): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    if (x != null && y != null) await nut.mouse.setPosition(new nut.Point(x, y))
    await nut.mouse.click(nut.Button.LEFT)
  }

  async doubleClick(x?: number, y?: number): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    if (x != null && y != null) await nut.mouse.setPosition(new nut.Point(x, y))
    await nut.mouse.doubleClick(nut.Button.LEFT)
  }

  async rightClick(x?: number, y?: number): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    if (x != null && y != null) await nut.mouse.setPosition(new nut.Point(x, y))
    await nut.mouse.click(nut.Button.RIGHT)
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    await nut.mouse.setPosition(new nut.Point(x1, y1))
    await nut.mouse.pressButton(nut.Button.LEFT)
    await new Promise((r) => setTimeout(r, 100))
    await nut.mouse.move(await nut.straightTo(new nut.Point(x2, y2)))
    await new Promise((r) => setTimeout(r, 100))
    await nut.mouse.releaseButton(nut.Button.LEFT)
  }

  async typeText(text: string): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    await nut.keyboard.type(text)
  }

  async hotkey(keys: string[]): Promise<void> {
    const nut = await getNutJs()
    if (!nut) return
    const nutKeys = keys.map((k) => toNutKey(k))
    await nut.keyboard.pressKey(...nutKeys)
    await nut.keyboard.releaseKey(...nutKeys)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // @platform WINDOWS | DARWIN | LINUX — 系统通知
  // nut-js 不覆盖通知功能，保留平台 shell 命令
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async sendNotification(title: string, message: string): Promise<void> {
    const platform = os.platform()
    const t = title.replace(/"/g, '\\"')
    const m = message.replace(/"/g, '\\"')

    try {
      if (platform === 'win32') {
        const ps = [
          '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
          '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
          `$template = '<toast><visual><binding template="ToastText02"><text id="1">${t}</text><text id="2">${m}</text></binding></visual></toast>'`,
          '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
          '$xml.LoadXml($template)',
          '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
          '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PeroCore").Show($toast)',
        ].join('; ')
        execSync(`powershell -ExecutionPolicy Bypass -Command "${ps}"`, {
          timeout: 10_000,
          windowsHide: true,
        })
      } else if (platform === 'darwin') {
        execSync(`osascript -e 'display notification "${m}" with title "${t}"'`, { timeout: 5000 })
      } else {
        execSync(`notify-send "${t}" "${m}" 2>/dev/null || true`, { timeout: 5000 })
      }
    } catch (err) {
      logger.warn(`发送通知失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async getMousePosition(): Promise<{ x: number; y: number }> {
    const nut = await getNutJs()
    if (!nut) return { x: 0, y: 0 }
    const pos = await nut.mouse.getPosition()
    return { x: pos.x, y: pos.y }
  }
}

// ─────────────────────────────────────────────
// 按键名映射 (用户输入字符串 → nut-js Key 枚举值)
// ─────────────────────────────────────────────

/** Key enum 需要从已加载的模块中获取，这里做静态映射表 + 运行时查找 */
const KEY_NAME_MAP: Record<string, string> = {
  ctrl: 'LeftControl',
  control: 'LeftControl',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  shift: 'LeftShift',
  meta: 'LeftSuper',
  cmd: 'LeftCmd',
  command: 'LeftCmd',
  win: 'LeftWin',
  enter: 'Enter',
  return: 'Return',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
}

/** 单字符 → Key enum name 映射 (a-z → A-Z, 0-9 → Num0-Num9) */
function charToKeyName(ch: string): string | undefined {
  if (/^[a-z]$/i.test(ch)) return ch.toUpperCase()
  if (/^[0-9]$/.test(ch)) return `Num${ch}`
  return undefined
}

/**
 * 将用户输入的按键名转换为 nut-js Key 枚举值
 *
 * 使用延迟导入的 Key enum (因为 nut-js 是动态加载的)。
 * 如果 nut-js 未加载，返回 0。
 */
function toNutKey(key: string): number {
  if (!_nutJs) return 0

  const Key = _nutJs.Key as unknown as Record<string, number>
  const lower = key.toLowerCase()

  // 1. 查映射表
  const mapped = KEY_NAME_MAP[lower]
  if (mapped && Key[mapped] !== undefined) return Key[mapped]!

  // 2. 单字符映射 (a→A, 1→Num1)
  if (key.length === 1) {
    const keyName = charToKeyName(key)
    if (keyName && Key[keyName] !== undefined) return Key[keyName]!
  }

  // 3. 直接用键名尝试 (如 "Space", "Enter" 等)
  if (Key[key] !== undefined) return Key[key]!

  logger.warn(`未知按键: "${key}"，降级为 Space`)
  return Key.Space ?? 108
}

// ─────────────────────────────────────────────
// 工厂函数 (供 container.ts 调用)
// ─────────────────────────────────────────────

/** 桌面 Provider 套件 */
export interface DesktopProviders {
  screenshot: NutScreenshotProvider
  window: NutWindowProvider
  automation: NutDesktopAutomationProvider
}

/**
 * 创建桌面环境 Provider 套件
 *
 * 尝试加载 nut-js:
 * - 成功: 返回三个 Provider 实例
 * - 失败: 返回 null (Docker/无头环境)
 *
 * container.ts 应在 **非 Docker 环境** 下调用此函数:
 * ```ts
 * if (!process.env.PERO_DOCKER) {
 *   const providers = await createDesktopProviders()
 *   if (providers) {
 *     injectScreenshotProvider(providers.screenshot)
 *     injectWindowProvider(providers.window)
 *     injectDesktopAutomationProvider(providers.automation)
 *   }
 * }
 * ```
 */
export async function createDesktopProviders(): Promise<DesktopProviders | null> {
  const nut = await getNutJs()
  if (!nut) {
    logger.info('无桌面环境，跳过 Provider 创建')
    return null
  }

  return {
    screenshot: new NutScreenshotProvider(),
    window: new NutWindowProvider(),
    automation: new NutDesktopAutomationProvider(),
  }
}
