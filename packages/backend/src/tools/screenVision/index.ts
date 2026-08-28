/**
 * screenVision — 屏幕截图工具
 *
 * 为 Agent 提供视觉感知能力。
 * 通过「截图提供者」抽象层解耦：
 *   - Electron 桌面端: desktopCapturer / IPC 注入
 *   - 其他环境: 可替换为 native addon (screenshot-desktop) 或远程截图服务
 * 截图结果以 base64 data URI 形式返回，reactLoop 提取后转为 image_url 内容块注入 LLM。
 *
 * @module packages/backend/src/tools/screenVision
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ScreenVision')

export interface ScreenshotCoordinateContext {
  displayId: string
  coordinateSpace: 'screenshot'
  screenshotWidth: number
  screenshotHeight: number
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

export interface ScreenshotCapture {
  base64: string
  coordinateContext?: ScreenshotCoordinateContext
}

/** 截图提供者接口 */
export interface ScreenshotProvider {
  /** 截取当前屏幕，返回 PNG 与坐标上下文 */
  capture(): Promise<ScreenshotCapture | null>
}

/** 模块引用 */
let _screenshotProvider: ScreenshotProvider | null = null

/** 设置截图提供者 */
export function setScreenshotProvider(provider: ScreenshotProvider | null): void {
  _screenshotProvider = provider
}

// ── take_screenshot 工具 ──

export const takeScreenshotTool: BuiltinTool = {
  name: 'take_screenshot',

  async execute(args) {
    if (!_screenshotProvider) {
      return JSON.stringify({
        error: '截图服务未初始化。当前环境可能不支持屏幕截图。',
      })
    }

    const count = Math.min(Math.max(1, (args.count as number) ?? 1), 3)

    try {
      const screenshots: ScreenshotCapture[] = []

      for (let i = 0; i < count; i++) {
        const capture = await _screenshotProvider.capture()
        if (capture) {
          screenshots.push(capture)
        } else {
          logger.warn(`第 ${i + 1} 张截图获取失败`)
        }

        // 多张截图之间间隔 500ms (捕捉动态变化)
        if (i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }

      if (screenshots.length === 0) {
        return JSON.stringify({ error: '截图获取失败，请稍后重试' })
      }

      logger.info(`已获取 ${screenshots.length} 张截图`)

      return JSON.stringify({
        success: true,
        screenshots: screenshots.map((capture, i) => ({
          index: i,
          dataUri: `data:image/png;base64,${capture.base64}`,
          ...(capture.coordinateContext ? { coordinateContext: capture.coordinateContext } : {}),
        })),
        message: `已获取 ${screenshots.length} 张屏幕截图`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`截图失败: ${errMsg}`)
      return JSON.stringify({ error: `截图失败: ${errMsg}` })
    }
  },
}
