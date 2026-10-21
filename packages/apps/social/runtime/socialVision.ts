import { t as __t } from './i18n'
import { GifReader } from 'omggif'
import { PNG } from 'pngjs'
import {
  createLogger,
  safeModelDiagnostic,
  type ChatMessage,
  type ContentPart,
} from '@infos/backend/applicationHostAbi'
import { currentSocialRecovery } from './socialRecovery'

const logger = createLogger('SocialVision')
const MAX_GIF_BYTES = 20 * 1024 * 1024
const MAX_GIF_PIXELS = 4 * 1024 * 1024

/** 只转换模型观察副本，发送与收藏继续使用原始动图。恢复检查点和工具读图也经过此入口。 */
export function prepareSocialVision(messages: ChatMessage[], signal?: AbortSignal): void {
  const record = currentSocialRecovery()?.record
  const context = { turnId: record?.id, agentId: record?.agentId, channelId: record?.channelId }
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    message.content = message.content.flatMap((part): ContentPart[] => {
      signal?.throwIfAborted()
      if (part.type !== 'image_url') return [part]
      const match = /^data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(part.image_url.url)
      if (!match) return [part]
      // 部分缓存的后缀与内容不一致，用少量文件头字节识别 GIF。
      const gif = /^GIF8[79]a$/.test(
        Buffer.from(match[2]!.slice(0, 12), 'base64').toString('ascii', 0, 6),
      )
      if (!gif && match[1]!.toLowerCase() !== 'gif') return [part]
      try {
        if (match[2]!.length > Math.ceil(MAX_GIF_BYTES / 3) * 4)
          throw new Error('动图超过 20 MB 视觉读取限制')
        const data = Buffer.from(match[2]!, 'base64')
        if (!gif || data.length < 10) throw new Error('动图内容不完整或格式不正确')
        const width = data.readUInt16LE(6),
          height = data.readUInt16LE(8)
        if (!width || !height || width * height > MAX_GIF_PIXELS)
          throw new Error('动图画布超过 400 万像素视觉读取限制')
        const reader = new GifReader(data)
        if (!reader.numFrames()) throw new Error('动图中没有可读取的画面')
        const raster = new PNG({ width, height, fill: true })
        reader.decodeAndBlitFrameRGBA(0, raster.data)
        const png = PNG.sync.write(raster, { colorType: 6, deflateLevel: 6 })
        signal?.throwIfAborted()
        logger.info(__t('apps.social.logs', '社交动图已转换为模型可读静态图'), {
          ...context,
          width,
          height,
          frames: reader.numFrames(),
          bytes: png.length,
        })
        return [
          {
            type: 'text',
            text: __t(
              'apps.social.ui',
              '[图片说明：以下图片是 GIF 的首帧静态画面，不代表已经观看完整动画。]',
            ),
          },
          {
            ...part,
            image_url: {
              ...part.image_url,
              url: `data:image/png;base64,${png.toString('base64')}`,
            },
          },
        ]
      } catch (error) {
        signal?.throwIfAborted()
        const reason = safeModelDiagnostic(
          error instanceof Error ? error.message : String(error),
          200,
        )
        logger.warn(__t('apps.social.logs', '社交动图读取失败，已保留文字说明继续处理'), {
          ...context,
          reason,
        })
        return [
          {
            type: 'text',
            text: __t('apps.social.ui', '[动图未能读取：{0}。不要声称已经看过图片。]', [reason]),
          },
        ]
      }
    })
  }
}
