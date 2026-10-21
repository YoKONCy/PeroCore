/**
 * ChatBackgroundService — 应用背景预设资产服务
 *
 * 将上传校验、数据目录寻址和原子替换收口在服务层，Router 只负责 HTTP 协议转换。
 * 各预设独立保存图片，预设一兼容原有路径与配置。
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { PathResolver } from '../../core/pathResolver'
import { AppError } from '../../lib/appError'

const MAX_BYTES = 15 * 1024 * 1024
export const BACKGROUND_PRESET_IDS = ['preset-1', 'preset-2', 'preset-3'] as const
type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number]
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
  private mutations = new Map<BackgroundPresetId, Promise<void>>()
  constructor(
    private pathResolver: PathResolver,
    private configRepo: ConfigRepository,
  ) {}

  async save(file: File, preset: BackgroundPresetId = 'preset-1'): Promise<void> {
    if (file.size === 0 || file.size > MAX_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', { message: '背景图片应大于 0 且不超过 15MB' })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    // 浏览器可能沿用错误扩展名的 MIME；持久化必须以真实文件签名为准。
    const format = detectFormat(bytes)
    if (!format) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', { message: '背景图片仅支持 PNG、JPEG 或 WebP' })
    }

    await this.mutate(preset, async () => {
      const directory = this.directory(preset)
      await mkdir(directory, { recursive: true })
      const target = path.join(directory, `background${format.extension}`)
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, bytes)
        await rename(temporary, target)
        await this.configRepo.set(this.mimeKey(preset), format.mime)
        await this.removeFiles(preset, format.extension)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
    })
  }

  async read(preset: BackgroundPresetId = 'preset-1'): Promise<{ bytes: Buffer; mime: string }> {
    const mime = await this.configRepo.get(this.mimeKey(preset))
    const format = mime ? FORMATS.get(mime) : undefined
    if (!format) throw new AppError('NOT_FOUND', { message: '尚未设置聊天背景' })
    const bytes = await readFile(
      path.join(this.directory(preset), `background${format.extension}`),
    ).catch(() => null)
    if (!bytes) throw new AppError('NOT_FOUND', { message: '聊天背景文件不存在' })
    return { bytes, mime: mime! }
  }

  async remove(preset: BackgroundPresetId = 'preset-1'): Promise<void> {
    await this.mutate(preset, async () => {
      await this.removeFiles(preset)
      await this.configRepo.delete(this.mimeKey(preset))
    })
  }

  private mimeKey(preset: BackgroundPresetId): string {
    return preset === 'preset-1' ? 'ui.chatBackground.mime' : `ui.chatBackground.${preset}.mime`
  }

  private directory(preset: BackgroundPresetId): string {
    if (!BACKGROUND_PRESET_IDS.includes(preset)) {
      throw new AppError('VALIDATION_ERROR', { message: '背景预设不存在' })
    }
    const root = this.pathResolver.resolve('@data/ui/chat-background')
    return preset === 'preset-1' ? root : path.join(root, preset)
  }

  private async mutate(preset: BackgroundPresetId, operation: () => Promise<void>): Promise<void> {
    const previous = this.mutations.get(preset) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.mutations.set(preset, current)
    try {
      await current
    } finally {
      if (this.mutations.get(preset) === current) this.mutations.delete(preset)
    }
  }

  private async removeFiles(preset: BackgroundPresetId, keepExtension?: string): Promise<void> {
    const directory = this.directory(preset)
    await Promise.all(
      [...FORMATS.values()]
        .filter(({ extension }) => extension !== keepExtension)
        .map(({ extension }) =>
          unlink(path.join(directory, `background${extension}`)).catch(() => undefined),
        ),
    )
  }
}
