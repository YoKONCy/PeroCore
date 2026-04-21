/**
 * browserControl — 浏览器交互控制工具
 *
 * 的浏览器交互部分:
 * - browser_open_url → 打开 URL
 * - browser_click → 点击元素
 * - browser_type → 输入文本
 * - browser_scroll → 滚动页面
 * - browser_back → 返回上一页
 * - browser_get_content → 获取页面内容
 *
 * - 通过 BrowserBridge 抽象层与实际浏览器通信
 * - Electron 环境: 通过浏览器插件 WebSocket 桥接 (继承 v1)
 * - 其他环境: 可替换为 Playwright / Puppeteer 适配器
 *
 * @module packages/backend/src/tools/browserControl
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

const logger = createLogger('BrowserControl')

// ── 浏览器桥接抽象 ──

/** 浏览器桥接接口 (由 container.ts 注入) */
export interface BrowserBridge {
  /** 发送命令给浏览器 */
  sendCommand(command: string, params?: Record<string, unknown>): Promise<BrowserCommandResult>
  /** 获取当前页面的 Markdown 内容 */
  getPageContent(): Promise<string>
  /** 是否已连接 */
  readonly isConnected: boolean
}

export interface BrowserCommandResult {
  status: 'success' | 'error'
  error?: string
  data?: unknown
}

/** 全局引用 */
let browserBridge: BrowserBridge | null = null

/** 注入浏览器桥接 (由 container.ts 调用) */
export function injectBrowserBridge(bridge: BrowserBridge): void {
  browserBridge = bridge
  logger.info('浏览器桥接已注入')
}

/** 辅助: 执行命令并附加页面内容 */
async function execWithContent(command: string, params?: Record<string, unknown>): Promise<string> {
  if (!browserBridge) {
    return JSON.stringify({ error: '浏览器桥接未初始化。请确保浏览器插件已连接。' })
  }

  if (!browserBridge.isConnected) {
    return JSON.stringify({ error: '浏览器未连接。请确保浏览器插件已启动并连接。' })
  }

  const result = await browserBridge.sendCommand(command, params)
  const content = await browserBridge.getPageContent()

  const status =
    result.status === 'success' ? '✅ 执行成功' : `❌ 执行失败: ${result.error ?? '未知错误'}`

  return JSON.stringify({
    success: result.status === 'success',
    message: status,
    pageContent: content.slice(0, 15000),
    truncated: content.length > 15000,
  })
}

// ── browser_open_url ──

export const browserOpenUrlTool: BuiltinTool = {
  definition: {
    name: 'browser_open_url',
    description: '在浏览器中打开指定的 URL。需要浏览器插件已连接。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要打开的 URL' },
      },
      required: ['url'],
    },
  },

  async execute(args) {
    let url = args.url as string
    if (!url?.trim()) {
      return JSON.stringify({ error: '请提供 URL' })
    }
    if (!url.startsWith('http')) url = 'https://' + url

    logger.info(`打开 URL: ${url}`)
    return execWithContent('open_url', { url })
  },
}

// ── browser_click ──

export const browserClickTool: BuiltinTool = {
  definition: {
    name: 'browser_click',
    description: '点击当前页面上的元素（按钮、链接等）。通过文本内容或 CSS 选择器定位。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '元素的文本内容或 CSS 选择器' },
      },
      required: ['target'],
    },
  },

  async execute(args) {
    const target = args.target as string
    if (!target?.trim()) {
      return JSON.stringify({ error: '请提供目标元素' })
    }

    logger.info(`点击元素: ${target}`)
    return execWithContent('click', { target })
  },
}

// ── browser_type ──

export const browserTypeTool: BuiltinTool = {
  definition: {
    name: 'browser_type',
    description: '在输入框中输入文本。先通过选择器定位输入框，再输入内容。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '输入框的选择器或标签文本' },
        text: { type: 'string', description: '要输入的文本' },
      },
      required: ['target', 'text'],
    },
  },

  async execute(args) {
    const target = args.target as string
    const text = args.text as string
    if (!target?.trim() || !text) {
      return JSON.stringify({ error: '请提供目标元素和输入文本' })
    }

    logger.info(`输入文本: ${target} ← "${text.slice(0, 50)}"`)
    return execWithContent('type', { target, text })
  },
}

// ── browser_scroll ──

export const browserScrollTool: BuiltinTool = {
  definition: {
    name: 'browser_scroll',
    description: '向上或向下滚动当前页面。',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: '滚动方向: "up" 或 "down"',
          enum: ['up', 'down'],
        },
      },
    },
  },

  async execute(args) {
    const direction = (args.direction as string) ?? 'down'
    logger.info(`滚动页面: ${direction}`)
    return execWithContent('scroll', { text: direction })
  },
}

// ── browser_back ──

export const browserBackTool: BuiltinTool = {
  definition: {
    name: 'browser_back',
    description: '返回浏览器历史记录中的上一页。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  async execute() {
    logger.info('返回上一页')
    return execWithContent('back')
  },
}

// ── browser_get_content ──

export const browserGetContentTool: BuiltinTool = {
  definition: {
    name: 'browser_get_content',
    description: '获取当前浏览器页面的文本内容 (Markdown 格式)。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  async execute() {
    if (!browserBridge) {
      return JSON.stringify({ error: '浏览器桥接未初始化' })
    }
    if (!browserBridge.isConnected) {
      return JSON.stringify({ error: '浏览器未连接' })
    }

    const content = await browserBridge.getPageContent()
    logger.info(`获取页面内容: ${content.length} 字符`)

    return JSON.stringify({
      success: true,
      content: content.slice(0, 20000),
      truncated: content.length > 20000,
    })
  },
}
