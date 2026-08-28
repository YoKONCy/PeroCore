/**
 * ChatBackgroundService — 聊天页面背景资产服务
 *
 * 将上传校验、数据目录寻址和原子替换收口在服务层，Router 只负责 HTTP 协议转换。
 * 图片使用固定文件名，避免用户文件名参与路径解析。
 */
import path from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { PathResolver } from '../../core/pathResolver'
import { AppError } from '../../lib/appError'

const MAX_BYTES = 15 * 1024 * 1024
const FORMATS: Map<string, { extension: string; signature: (bytes: Buffer) => boolean }> = new Map([
  [
    'image/png',
    {
      extension: '.png',
      signature: (bytes) =>
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
  ],
  [
    'image/jpeg',
    {
      extension: '.jpg',
      signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    },
  ],
  [
    'image/webp',
    {
      extension: '.webp',
      signature: (bytes) =>
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    },
  ],
])

function detectFormat(bytes: Buffer):
  | {
      mime: string
      extension: string
    }
  | undefined {
  for (const [mime, format] of FORMATS) {
    if (format.signature(bytes)) {
      return { mime, extension: format.extension }
    }
  }
  return undefined
}

export class ChatBackgroundService {
  constructor(
    private pathResolver: PathResolver,
    private configRepo: ConfigRepository,
  ) {}

  async save(file: File): Promise<void> {
    if (file.size === 0 || file.size > MAX_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', { message: '背景图片应大于 0 且不超过 15MB' })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    // 浏览器可能沿用错误扩展名的 MIME；持久化必须以真实文件签名为准。
    const format = detectFormat(bytes)
    if (!format) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', { message: '背景图片仅支持 PNG、JPEG 或 WebP' })
    }

    const directory = this.directory()
    await mkdir(directory, { recursive: true })
    const target = path.join(directory, `background${format.extension}`)
    const temporary = `${target}.tmp`
    await writeFile(temporary, bytes)
    await this.removeFiles()
    await rename(temporary, target)
    await this.configRepo.set('ui.chatBackground.mime', format.mime)
  }

  async read(): Promise<{ bytes: Buffer; mime: string }> {
    const mime = await this.configRepo.get('ui.chatBackground.mime')
    const format = mime ? FORMATS.get(mime) : undefined
    if (!format) throw new AppError('NOT_FOUND', { message: '尚未设置聊天背景' })
    const bytes = await readFile(
      path.join(this.directory(), `background${format.extension}`),
    ).catch(() => null)
    if (!bytes) throw new AppError('NOT_FOUND', { message: '聊天背景文件不存在' })
    return { bytes, mime: mime! }
  }

  async remove(): Promise<void> {
    await this.removeFiles()
    await this.configRepo.delete('ui.chatBackground.mime')
  }

  private directory(): string {
    return this.pathResolver.resolve('@data/ui/chat-background')
  }

  private async removeFiles(): Promise<void> {
    await Promise.all(
      [...FORMATS.values()].map(({ extension }) =>
        unlink(path.join(this.directory(), `background${extension}`)).catch(() => undefined),
      ),
    )
  }
}
