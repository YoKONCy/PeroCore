import type { SocialStoragePort } from '@infos/shared'
import type { StickerService } from '../runtime/stickerService'

export interface StickerTurnScope {
  agentId: string
  accountId: string
  channelId: string
  channelType: 'private' | 'group'
}

/** 账号与会话由可信入站消息绑定，模型不能自行指定其他账号或文件路径。 */
export async function executeSocialSticker(
  service: StickerService,
  storage: SocialStoragePort,
  scope: StickerTurnScope,
  args: Record<string, unknown>,
): Promise<string> {
  const action = String(args.action ?? '')
  try {
    if (action === 'list' || action === 'search') {
      const result = await service.list(
        scope.accountId,
        String(args.query ?? '').slice(0, 200),
        Number(args.offset ?? 0),
        Number(args.limit ?? 20),
        args.refresh === true,
      )
      return JSON.stringify({
        success: true,
        ...result,
        stickers: result.stickers.map(({ id, description }) => ({
          id,
          description: description || '暂无描述，可用 read 查看',
        })),
      })
    }
    if (action === 'read') {
      const image = await service.read(scope.accountId, String(args.sticker_id ?? ''))
      return JSON.stringify({
        success: true,
        images: [`data:${image.mimeType};base64,${image.bytes.toString('base64')}`],
      })
    }
    if (action === 'collect') {
      const messageId = String(args.message_id ?? '')
      if (!messageId || messageId.length > 100) throw new Error('收藏需要提供来源 message_id')
      const row = await storage.getByMsgId(scope.agentId, messageId)
      if (
        !row ||
        row.platform !== 'qq' ||
        row.channelId !== scope.channelId ||
        row.channelType !== scope.channelType
      )
        throw new Error('只能收藏当前会话中已收到的图片')
      const event = JSON.parse(row.rawEventJson || '{}') as {
        self_id?: string | number
        message?: Array<{ type: string; data?: { url?: string } }>
      }
      const sourceAccount = row.accountId || String(event.self_id ?? '')
      if (
        sourceAccount !== scope.accountId ||
        (event.self_id != null && String(event.self_id) !== scope.accountId)
      )
        throw new Error('来源图片不属于当前 QQ 账号')
      const images = Array.isArray(event.message)
        ? event.message.filter((item) => item.type === 'image')
        : []
      const index = Number(args.image_index ?? 1)
      if (!Number.isInteger(index) || index < 1)
        throw new Error('image_index 必须是从 1 开始的整数')
      const url = images[index - 1]?.data?.url
      if (!url) throw new Error('该消息中没有对应图片或原图链接已不可用')
      const result = await service.collect(
        scope.accountId,
        url,
        args.description === undefined ? undefined : String(args.description),
      )
      return JSON.stringify({
        success: true,
        sticker: { id: result.sticker.id, description: result.sticker.description },
        ...('warning' in result ? { warning: result.warning } : {}),
      })
    }
    if (action === 'describe') {
      if (typeof args.description !== 'string') throw new Error('请提供 description')
      const sticker = await service.describe(
        scope.accountId,
        String(args.sticker_id ?? ''),
        args.description,
      )
      return JSON.stringify({
        success: true,
        sticker: { id: sticker.id, description: sticker.description },
      })
    }
    if (action === 'delete') {
      return JSON.stringify({
        success: true,
        ...(await service.remove(scope.accountId, String(args.sticker_id ?? ''))),
      })
    }
    throw new Error('未知表情操作')
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...(['collect', 'describe', 'delete'].includes(action)
        ? { hint: '写操作失败或结果未确认时，先 refresh 查询再决定是否重试' }
        : {}),
    })
  }
}
