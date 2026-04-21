/**
 * anime-finder — 番剧识别预置扩展
 *
 * - 使用 trace.moe API 进行以图搜番
 * - 返回 Top 3 匹配结果 (番名、集数、时间点)
 *
 * - 预置扩展 (bundled)，放在 extensions/presets/ 目录
 * - 仅参考用，暂未加入能力矩阵
 * - 纯网络 API 调用，全平台兼容
 *
 * @module packages/backend/src/extensions/presets/anime-finder
 */

import type { ToolExtension } from '../../types'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('AnimeFinder')

const TRACE_MOE_API = 'https://api.trace.moe/search?cutBorders&anilistInfo'

const animeFinder: ToolExtension = {
  definition: {
    name: 'find_anime_by_image',
    description: '识图搜番。通过截图或图片链接查找动漫出处，返回番名、集数和时间点。',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: '图片的 URL 地址',
        },
      },
      required: ['image_url'],
    },
  },

  async execute(args) {
    const imageUrl = args.image_url as string

    try {
      // 1. 下载图片
      const imgResp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'PeroCore/2.0' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!imgResp.ok) {
        return { success: false, error: `图片下载失败: HTTP ${imgResp.status}` }
      }
      const imageBlob = await imgResp.blob()

      // 2. 上传到 trace.moe
      const formData = new FormData()
      formData.append('image', imageBlob, 'screenshot.jpg')

      const traceResp = await fetch(TRACE_MOE_API, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30_000),
      })
      if (!traceResp.ok) {
        return { success: false, error: `trace.moe API 错误: HTTP ${traceResp.status}` }
      }
      const data = (await traceResp.json()) as {
        result?: Array<{
          anilist?: { title?: { native?: string; romaji?: string; english?: string } }
          similarity?: number
          episode?: number | string
          from?: number
          to?: number
        }>
      }

      // 3. 格式化结果
      if (!data.result || data.result.length === 0) {
        return { success: true, data: '未找到匹配的番剧。' }
      }

      const top3 = data.result.slice(0, 3)
      let output = '### 番剧识别结果\n\n'

      for (let i = 0; i < top3.length; i++) {
        const res = top3[i]!
        const title = res.anilist?.title ?? {}
        const native = title.native ?? 'Unknown'
        const romaji = title.romaji ?? ''
        const english = title.english ?? ''
        const similarity = (res.similarity ?? 0) * 100
        const episode = res.episode ?? 'Unknown'

        output += `**匹配 ${i + 1}** (${similarity.toFixed(1)}%)\n`
        output += `- **标题**: ${native}${romaji ? ` (${romaji})` : ''}\n`
        if (english) output += `- **英文名**: ${english}\n`
        output += `- **集数**: ${episode}\n`
        output += `- **时间点**: ${(res.from ?? 0).toFixed(1)}s - ${(res.to ?? 0).toFixed(1)}s\n\n`
      }

      return { success: true, data: output }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`番剧识别失败: ${errMsg}`)
      return { success: false, error: `识别番剧时出错: ${errMsg}` }
    }
  },
}

export default animeFinder
