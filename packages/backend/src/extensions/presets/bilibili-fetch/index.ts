/**
 * bilibili-fetch — B站助手预置扩展
 *
 * - bilibili_get_info: 获取视频基本信息 (标题、简介、UP主、数据)
 * - bilibili_get_subtitles: 获取视频 CC 字幕
 *
 * - 预置扩展 (bundled)，放在 extensions/presets/ 目录
 * - 仅参考用，暂未加入能力矩阵
 * - 纯网络 API 调用，全平台兼容
 *
 * @module packages/backend/src/extensions/presets/bilibili-fetch
 */

import type { ToolExtension } from '../../types'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('BilibiliFetch')

// ─────────────────────────────────────────────
// 常量 & 辅助
// ─────────────────────────────────────────────

const BILIBILI_VIDEO_BASE_URL = 'https://www.bilibili.com/video/'
const PAGELIST_API_URL = 'https://api.bilibili.com/x/player/pagelist'
const PLAYER_WBI_API_URL = 'https://api.bilibili.com/x/player/wbi/v2'
const VIEW_API_URL = 'https://api.bilibili.com/x/web-interface/view'

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

/** 从 URL 或直接输入中提取 BV 号 */
function extractBvid(input: string): string | null {
  // 从 URL 中提取
  let match = input.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i)
  if (match) return match[1]!
  // 直接 BV 号
  match = input.match(/^(BV[a-zA-Z0-9]+)$/i)
  if (match) return match[1]!
  return null
}

// ─────────────────────────────────────────────
// 字幕获取核心逻辑
// ─────────────────────────────────────────────

async function getSubtitles(bvid: string): Promise<string> {
  const referer = `${BILIBILI_VIDEO_BASE_URL}${bvid}/`
  const headers = { ...HEADERS, Referer: referer }

  try {
    // 步骤 1: 从页面 HTML 提取 AID
    const pageResp = await fetch(referer, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const html = await pageResp.text()
    const aidMatch = html.match(/"aid"\s*:\s*(\d+)/)
    const aid = aidMatch?.[1]
    if (!aid) return JSON.stringify({ error: '无法找到 AID' })

    // 步骤 2: 获取 CID
    const cidResp = await fetch(`${PAGELIST_API_URL}?bvid=${bvid}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const cidData = (await cidResp.json()) as { code: number; data?: Array<{ cid: number }> }
    if (cidData.code !== 0 || !cidData.data?.length) {
      return JSON.stringify({ error: '无法找到 CID' })
    }
    const cid = cidData.data[0]!.cid

    // 步骤 3: 获取字幕列表
    const playerResp = await fetch(`${PLAYER_WBI_API_URL}?aid=${aid}&cid=${cid}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const playerData = (await playerResp.json()) as {
      data?: { subtitle?: { subtitles?: Array<{ lan: string; subtitle_url: string }> } }
    }
    const subtitles = playerData.data?.subtitle?.subtitles ?? []
    if (subtitles.length === 0) return JSON.stringify({ body: [] })

    // 步骤 4: 获取字幕内容 (优先 zh-CN)
    const target = subtitles.find((s) => s.lan === 'zh-CN') ?? subtitles[0]!
    let subUrl = target.subtitle_url
    if (subUrl.startsWith('//')) subUrl = 'https:' + subUrl

    const contentResp = await fetch(subUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const content = await contentResp.json()
    return JSON.stringify(content)
  } catch (err) {
    return JSON.stringify({ error: String(err) })
  }
}

// ─────────────────────────────────────────────
// 扩展导出 — 两个工具
// ─────────────────────────────────────────────

/** bilibili_get_info 工具 */
const bilibiliGetInfo: ToolExtension = {
  definition: {
    name: 'bilibili_get_info',
    description:
      '获取 Bilibili 视频信息。解析链接或 BV 号，返回标题、简介、UP主及播放/点赞/投币/收藏数据。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '视频链接或 BV 号' },
      },
      required: ['url'],
    },
  },

  async execute(args) {
    const input = args.url as string
    const bvid = extractBvid(input)
    if (!bvid) return { success: false, error: '无效的 Bilibili 链接或 BV 号。' }

    try {
      const resp = await fetch(`${VIEW_API_URL}?bvid=${bvid}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await resp.json()) as {
        code: number
        message?: string
        data?: {
          title: string
          desc: string
          owner: { name: string }
          stat: { view: number; like: number; coin: number; favorite: number }
        }
      }

      if (data.code !== 0 || !data.data) {
        return { success: false, error: `API 错误: ${data.code} - ${data.message}` }
      }

      const d = data.data
      return {
        success: true,
        data: {
          title: d.title,
          desc: d.desc,
          owner: d.owner.name,
          view: d.stat.view,
          like: d.stat.like,
          coin: d.stat.coin,
          favorite: d.stat.favorite,
        },
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`获取视频信息失败: ${errMsg}`)
      return { success: false, error: `获取视频信息失败: ${errMsg}` }
    }
  },
}

/** bilibili_get_subtitles 工具 */
const bilibiliGetSubtitles: ToolExtension = {
  definition: {
    name: 'bilibili_get_subtitles',
    description: '获取 Bilibili 视频的 CC 字幕。提取字幕内容以便总结视频。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '视频链接或 BV 号' },
      },
      required: ['url'],
    },
  },

  async execute(args) {
    const input = args.url as string
    const bvid = extractBvid(input)
    if (!bvid) return { success: false, error: '无效的 Bilibili 链接或 BV 号。' }

    try {
      const result = await getSubtitles(bvid)
      return { success: true, data: result }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`获取字幕失败: ${errMsg}`)
      return { success: false, error: `获取字幕失败: ${errMsg}` }
    }
  },
}

export { bilibiliGetInfo, bilibiliGetSubtitles }
export default bilibiliGetInfo
