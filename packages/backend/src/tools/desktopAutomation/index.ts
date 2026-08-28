/**
 * desktopAutomation — 桌面 GUI 自动化工具
 *
 * 中的 GUI 自动化能力:
 * - automation_execute(click/double_click/right_click/drag/type/hotkey/notification)
 * - get_mouse_position
 *
 * - 通过 DesktopAutomationProvider 抽象层解耦
 * - 实际实现可注入: nut-js / robotjs / pyautogui bridge / Electron IPC
 * - 不在 backend 层直接依赖 native addon，保持 backend 纯 TypeScript
 * - 此工具仅在 GUI 桌面环境可用 (标记 platforms: windows, darwin)
 *
 * @module packages/backend/src/tools/desktopAutomation
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

const logger = createLogger('DesktopAutomation')

// ── 桌面自动化提供者抽象 ──

/** 自动化动作类型 */
export type AutomationAction =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'drag'
  | 'type'
  | 'hotkey'
  | 'notification'

export type DesktopCoordinateSpace = 'normalized' | 'screenshot' | 'desktop'

export interface DesktopCoordinateOptions {
  coordinateSpace: DesktopCoordinateSpace
  displayId?: string
  screenshotWidth?: number
  screenshotHeight?: number
}

/** 桌面自动化提供者接口 (由 container.ts 注入) */
export interface DesktopAutomationProvider {
  /** 点击 */
  click(x: number, y: number, options: DesktopCoordinateOptions): Promise<void>
  /** 双击 */
  doubleClick(x: number, y: number, options: DesktopCoordinateOptions): Promise<void>
  /** 右键点击 */
  rightClick(x: number, y: number, options: DesktopCoordinateOptions): Promise<void>
  /** 拖拽 */
  drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: DesktopCoordinateOptions,
  ): Promise<void>
  /** 输入文本 (粘贴模式，免疫输入法) */
  typeText(text: string): Promise<void>
  /** 执行快捷键 */
  hotkey(keys: string[]): Promise<void>
  /** 发送系统通知 */
  sendNotification(title: string, message: string): Promise<void>
  /** 获取鼠标位置 */
  getMousePosition(): Promise<{ x: number; y: number }>
}

/** 模块引用 (由 setDesktopAutomationProvider 设置) */
let _automationProvider: DesktopAutomationProvider | null = null

/** 设置自动化提供者 (构造时调用) */
export function setDesktopAutomationProvider(provider: DesktopAutomationProvider | null): void {
  _automationProvider = provider
}

function errorResult(code: string, message: string): string {
  return JSON.stringify({ success: false, error: { code, message } })
}

function readCoordinate(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`DESKTOP_COORDINATE_INVALID: ${name}必须是有限数字`)
  }
  return value
}

function readCoordinateOptions(args: Record<string, unknown>): DesktopCoordinateOptions {
  const coordinateSpace = String(args.coordinateSpace ?? 'normalized')
  if (!['normalized', 'screenshot', 'desktop'].includes(coordinateSpace)) {
    throw new Error(`DESKTOP_COORDINATE_SPACE_INVALID: ${coordinateSpace}`)
  }
  const options: DesktopCoordinateOptions = {
    coordinateSpace: coordinateSpace as DesktopCoordinateSpace,
  }
  if (args.displayId != null) options.displayId = String(args.displayId)
  if (coordinateSpace === 'screenshot') {
    options.screenshotWidth = readCoordinate(args.screenshotWidth, 'screenshotWidth')
    options.screenshotHeight = readCoordinate(args.screenshotHeight, 'screenshotHeight')
  }
  return options
}

// ── automation_execute ──

export const automationExecuteTool: BuiltinTool = {
  name: 'automation_execute',

  async execute(args) {
    if (!_automationProvider) {
      return errorResult(
        'DESKTOP_AUTOMATION_UNAVAILABLE',
        '桌面自动化服务未初始化。当前环境可能不支持 GUI 操作。',
      )
    }

    const action = args.action as AutomationAction
    const text = args.text as string | undefined
    const message = args.message as string | undefined

    logger.info(`执行自动化: ${action}`)

    try {
      switch (action) {
        case 'click':
        case 'double_click':
        case 'right_click': {
          const x = readCoordinate(args.x, 'x')
          const y = readCoordinate(args.y, 'y')
          const options = readCoordinateOptions(args)
          if (action === 'click') await _automationProvider.click(x, y, options)
          else if (action === 'double_click') await _automationProvider.doubleClick(x, y, options)
          else await _automationProvider.rightClick(x, y, options)
          return JSON.stringify({
            success: true,
            message: `已在 (${x}, ${y}) 执行${action === 'click' ? '点击' : action === 'double_click' ? '双击' : '右键点击'}`,
          })
        }

        case 'drag': {
          const x = readCoordinate(args.x, 'x')
          const y = readCoordinate(args.y, 'y')
          const x2 = readCoordinate(args.x2, 'x2')
          const y2 = readCoordinate(args.y2, 'y2')
          const options = readCoordinateOptions(args)
          await _automationProvider.drag(x, y, x2, y2, options)
          return JSON.stringify({
            success: true,
            message: `已从 (${x}, ${y}) 拖拽到 (${x2}, ${y2})`,
          })
        }

        case 'type':
          if (!text) {
            return errorResult('DESKTOP_TEXT_REQUIRED', '请提供要输入的文本 (text)')
          }
          await _automationProvider.typeText(text)
          return JSON.stringify({ success: true, message: `已输入文本: "${text.slice(0, 50)}"` })

        case 'hotkey': {
          if (!text) {
            return errorResult('DESKTOP_HOTKEY_REQUIRED', '请提供快捷键组合 (text), 如 "ctrl+c"')
          }
          const keys = text.replace(/\s/g, '').split('+')
          await _automationProvider.hotkey(keys)
          return JSON.stringify({ success: true, message: `已执行快捷键: ${text}` })
        }

        case 'notification': {
          const title = text ?? 'Pero 提醒'
          const body = message ?? '我有事情要告诉你哦！'
          await _automationProvider.sendNotification(title, body)
          return JSON.stringify({ success: true, message: `已发送通知: ${title}` })
        }

        default:
          return errorResult('DESKTOP_ACTION_UNSUPPORTED', `未知的自动化动作: ${action}`)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const separator = errMsg.indexOf(':')
      const code = separator > 0 ? errMsg.slice(0, separator) : 'DESKTOP_AUTOMATION_FAILED'
      const detail = separator > 0 ? errMsg.slice(separator + 1).trim() : errMsg
      logger.error(`自动化操作失败: ${errMsg}`)
      return errorResult(code, detail)
    }
  },
}

// ── get_mouse_position ──

export const getMousePositionTool: BuiltinTool = {
  name: 'get_mouse_position',

  async execute() {
    if (!_automationProvider) {
      return errorResult('DESKTOP_AUTOMATION_UNAVAILABLE', '桌面自动化服务未初始化')
    }

    try {
      const pos = await _automationProvider.getMousePosition()
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        return errorResult('DESKTOP_COORDINATE_INVALID', '客户端返回了无效鼠标坐标')
      }
      return JSON.stringify({
        success: true,
        position: pos,
        message: `当前鼠标位置: (${pos.x}, ${pos.y})`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const separator = errMsg.indexOf(':')
      return errorResult(
        separator > 0 ? errMsg.slice(0, separator) : 'DESKTOP_MOUSE_POSITION_FAILED',
        separator > 0 ? errMsg.slice(separator + 1).trim() : errMsg,
      )
    }
  },
}
