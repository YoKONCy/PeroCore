/**
 * webFetch — 轻量级网页抓取工具
 *
 * 使用 Node.js 原生 fetch (Node 18+) + 简易 HTML→文本提取。
 * 完全跨平台，无需浏览器插件。
 *
 * @module packages/backend/src/tools/webFetch
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

const logger = createLogger('WebFetch')

/** 最大输出字符数 */
const MAX_OUTPUT_LENGTH = 20_000

/** 请求超时 (ms) */
const FETCH_TIMEOUT_MS = 30_000

/** 默认 User-Agent */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 简易 HTML 标签剥离 + 文本清理
 *
 * 轻量实现，不依赖 DOM 解析库 (cheerio/jsdom)。
 * 移除 script/style/nav/footer 等无用区块，保留正文。
 */
function htmlToText(html: string): string {
  let text = html

  // 移除垃圾区块 (script, style, nav, footer, header, iframe, noscript)
  text = text.replace(/<(script|style|nav|footer|header|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')

  // 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // 将 br/p/div/li/h* 转为换行
  text = text.replace(/<\/?(?:br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')

  // 移除所有剩余标签
  text = text.replace(/<[^>]+>/g, '')

  // HTML 实体解码 (常见)
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  // 清理多余空白
  const lines = text.split('\n')
  const cleaned = lines.map((line) => line.trim()).filter((line) => line.length > 0)

  return cleaned.join('\n')
}

export const webFetchTool: BuiltinTool = {
  name: 'web_fetch',

  async execute(args) {
    let url = args.url as string
    const maxLength = Math.min((args.max_length as number) ?? MAX_OUTPUT_LENGTH, MAX_OUTPUT_LENGTH)

    if (!url?.trim()) {
      return JSON.stringify({ error: '请提供 URL' })
    }

    // 自动补全协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    logger.info(`抓取网页: ${url}`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        return JSON.stringify({
          error: `HTTP ${response.status} ${response.statusText}`,
          url,
        })
      }

      const contentType = response.headers.get('content-type') ?? ''
      const html = await response.text()

      // 如果是纯文本/JSON，直接返回
      if (contentType.includes('application/json') || contentType.includes('text/plain')) {
        const truncated = html.slice(0, maxLength)
        return JSON.stringify({
          success: true,
          url,
          content: truncated,
          truncated: html.length > maxLength,
        })
      }

      // HTML → 文本提取
      const text = htmlToText(html)
      const truncated = text.slice(0, maxLength)

      logger.info(`抓取完成: ${url} (${text.length} 字符)`)

      return JSON.stringify({
        success: true,
        url,
        content: truncated,
        truncated: text.length > maxLength,
        originalLength: text.length,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`抓取失败: ${url} - ${errMsg}`)
      return JSON.stringify({ error: `获取网页失败: ${errMsg}`, url })
    }
  },
}
