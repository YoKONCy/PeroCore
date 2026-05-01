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

/** 桌面自动化提供者接口 (由 container.ts 注入) */
export interface DesktopAutomationProvider {
  /** 移动鼠标到指定坐标 */
  moveTo(x: number, y: number): Promise<void>
  /** 点击 */
  click(x?: number, y?: number): Promise<void>
  /** 双击 */
  doubleClick(x?: number, y?: number): Promise<void>
  /** 右键点击 */
  rightClick(x?: number, y?: number): Promise<void>
  /** 拖拽 */
  drag(x1: number, y1: number, x2: number, y2: number): Promise<void>
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

// ── automation_execute ──

export const automationExecuteTool: BuiltinTool = {
  name: 'automation_execute',

  async execute(args) {
    if (!_automationProvider) {
      return JSON.stringify({
        error: '桌面自动化服务未初始化。当前环境可能不支持 GUI 操作。',
      })
    }

    const action = args.action as AutomationAction
    const x = args.x as number | undefined
    const y = args.y as number | undefined
    const x2 = args.x2 as number | undefined
    const y2 = args.y2 as number | undefined
    const text = args.text as string | undefined
    const message = args.message as string | undefined

    logger.info(`执行自动化: ${action} (x=${x}, y=${y})`)

    try {
      switch (action) {
        case 'click':
          await _automationProvider.click(x, y)
          return JSON.stringify({ success: true, message: `已在 (${x}, ${y}) 执行点击` })

        case 'double_click':
          await _automationProvider.doubleClick(x, y)
          return JSON.stringify({ success: true, message: `已在 (${x}, ${y}) 执行双击` })

        case 'right_click':
          await _automationProvider.rightClick(x, y)
          return JSON.stringify({ success: true, message: `已在 (${x}, ${y}) 执行右键点击` })

        case 'drag':
          if (x == null || y == null || x2 == null || y2 == null) {
            return JSON.stringify({ error: '拖拽操作需要起始坐标 (x, y) 和目标坐标 (x2, y2)' })
          }
          await _automationProvider.drag(x, y, x2, y2)
          return JSON.stringify({
            success: true,
            message: `已从 (${x}, ${y}) 拖拽到 (${x2}, ${y2})`,
          })

        case 'type':
          if (!text) {
            return JSON.stringify({ error: '请提供要输入的文本 (text)' })
          }
          await _automationProvider.typeText(text)
          return JSON.stringify({ success: true, message: `已输入文本: "${text.slice(0, 50)}"` })

        case 'hotkey': {
          if (!text) {
            return JSON.stringify({ error: '请提供快捷键组合 (text), 如 "ctrl+c"' })
          }
          const keys = text.replace(/\s/g, '').split('+')
          await _automationProvider.hotkey(keys)
          return JSON.stringify({ success: true, message: `已执行快捷键: ${text}` })
        }

        case 'notification': {
          const title = text ?? 'Pero 提醒'
          const body = message ?? '主人，我有事情要告诉你哦！'
          await _automationProvider.sendNotification(title, body)
          return JSON.stringify({ success: true, message: `已发送通知: ${title}` })
        }

        default:
          return JSON.stringify({ error: `未知的自动化动作: ${action}` })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`自动化操作失败: ${errMsg}`)
      return JSON.stringify({ error: `自动化操作失败: ${errMsg}` })
    }
  },
}

// ── get_mouse_position ──

export const getMousePositionTool: BuiltinTool = {
  name: 'get_mouse_position',

  async execute() {
    if (!_automationProvider) {
      return JSON.stringify({ error: '桌面自动化服务未初始化' })
    }

    try {
      const pos = await _automationProvider.getMousePosition()
      return JSON.stringify({
        success: true,
        position: pos,
        message: `当前鼠标位置: (${pos.x}, ${pos.y})`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `获取鼠标位置失败: ${errMsg}` })
    }
  },
}
