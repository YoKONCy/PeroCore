import { t as __t } from '../../lib/i18n'
import { z } from 'zod'
import { MAX_READ_IMAGE_COUNT, MAX_READ_IMAGE_BATCH_BYTES } from '@infos/shared'
import type { BuiltinTool } from '../index'
import type { ResourceService } from '../../services/attachment/resourceService'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'

const imagePath = z.string().trim().min(1).max(2048)
const inputSchema = z
  .object({
    file_path: imagePath.optional(),
    file_paths: z.array(imagePath).min(1).max(MAX_READ_IMAGE_COUNT).optional(),
  })
  .refine((value) => Boolean(value.file_path) !== Boolean(value.file_paths), {
    message: __t('server.tools', '请提供 file_path 或 file_paths，二者只能填写一项'),
  })
let resources: ResourceService | undefined

export function setImageReadResourceService(service: ResourceService): void {
  resources = service
}

export const readImageTool: BuiltinTool = {
  name: 'read_image',
  allowedSources: ['desktop', 'companion', 'group'],
  async execute(args, context) {
    if (!resources) throw new Error('图片读取服务未初始化')
    const input = inputSchema.parse(args)
    const paths = [...new Set(input.file_paths ?? [input.file_path!])]
    const images: Array<Record<string, unknown>> = []
    const metadata: Array<Record<string, unknown>> = []
    const errors: Array<{ source: string; error: string }> = []
    let totalBytes = 0
    // 保持输入顺序并逐个读取，避免多张原图同时解码、下载造成内存尖峰。
    for (const source of paths) {
      context.signal?.throwIfAborted()
      try {
        const read = await resources.readImage(context, source)
        if (totalBytes + read.bytes.length > MAX_READ_IMAGE_BATCH_BYTES)
          throw new Error('本次图片总量超过 40 MB，请拆分读取')
        const imagePreview = await resources.captureImagePreview(context, read)
        const { bytes, ...image } = read
        totalBytes += bytes.length
        images.push({
          ...image,
          snapshotRef: imagePreview.id ? `attachment:${imagePreview.id}` : undefined,
          imagePreview,
        })
        // 模型接收原始字节；二进制不进入工具正文、日志或 SSE。
        metadata.push({
          ...image,
          dataUri: `data:${image.mimeType};base64,${bytes.toString('base64')}`,
        })
      } catch (error) {
        context.signal?.throwIfAborted()
        errors.push({ source, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (!images.length)
      return toolFailure(
        'IMAGE_READ_FAILED',
        errors.map((item) => `${item.source}：${item.error}`).join('\n'),
      )
    if (paths.length === 1 && !errors.length)
      return toolSuccess(JSON.stringify(images[0]!), { image: metadata[0] })
    return toolSuccess(JSON.stringify({ images, errors, totalBytes }), { images: metadata })
  },
}
