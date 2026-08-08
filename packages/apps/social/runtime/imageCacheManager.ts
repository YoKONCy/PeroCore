/**
 * ImageCacheManager — 社交图片本地缓存
 *
 * 负责:
 * 1. 将 OneBot 消息中的远程图片 URL 下载到本地缓存目录
 * 2. 提供本地绝对路径，供后续 base64 编码传给 LLM
 * 3. 自动清理旧文件，保持缓存大小在限定范围内
 *
 * 缓存目录: data/social_images/
 *
 * @module packages/apps/social/runtime/imageCacheManager
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('ImageCache')

export interface ImageCacheConfig {
  /** 缓存目录绝对路径 */
  cacheDir: string
  /** 最大缓存文件数 */
  maxFiles: number
  /** 下载超时 (ms) */
  downloadTimeout: number
}

const DEFAULT_CONFIG: ImageCacheConfig = {
  cacheDir: '', // 由外部注入
  maxFiles: 100,
  downloadTimeout: 10_000,
}

export class ImageCacheManager {
  private config: ImageCacheConfig
  private initialized = false

  constructor(config: Partial<ImageCacheConfig> & { cacheDir: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** 确保缓存目录存在 */
  private ensureDir(): void {
    if (this.initialized) return
    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true })
      logger.info(`缓存目录已创建: ${this.config.cacheDir}`)
    }
    this.initialized = true
  }

  /**
   * 下载远程图片到本地缓存
   *
   * @returns 本地绝对路径; 下载失败返回 null
   */
  async download(url: string): Promise<string | null> {
    try {
      this.ensureDir()

      // 使用 URL 的 MD5 作为文件名
      const hash = crypto.createHash('md5').update(url).digest('hex')
      const ext = this.guessExtension(url)
      const filename = `${hash}.${ext}`
      const filepath = path.join(this.config.cacheDir, filename)

      // 命中缓存直接返回
      if (fs.existsSync(filepath)) {
        return filepath
      }

      // 使用 fetch 下载 (Node 18+ 原生支持)
      // QQ 多媒体服务器 (multimedia.nt.qq.com.cn) 会拒绝无请求头的请求 (HTTP 400)，
      // 需要带上浏览器风格的 User-Agent 和 Referer 才能正常下载
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.downloadTimeout)

      try {
        const headers: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        // QQ 多媒体域名需要带 Referer
        if (url.includes('qq.com')) {
          headers['Referer'] = 'https://qq.com'
        }

        const resp = await fetch(url, { signal: controller.signal, headers })
        clearTimeout(timeout)

        if (!resp.ok) {
          logger.warn(`下载图片失败 ${url}: HTTP ${resp.status}`)
          return null
        }

        const buffer = Buffer.from(await resp.arrayBuffer())
        fs.writeFileSync(filepath, buffer)

        // 清理旧文件
        this.cleanup()

        return filepath
      } catch (fetchErr) {
        clearTimeout(timeout)
        throw fetchErr
      }
    } catch (err) {
      logger.warn(`下载图片错误: ${err}`)
      return null
    }
  }

  /**
   * 将本地缓存图片读取为 data URL (base64)
   *
   * @returns data:image/xxx;base64,... 格式字符串; 失败返回 null
   */
  readAsDataUrl(filepath: string): string | null {
    try {
      if (!fs.existsSync(filepath)) return null

      const ext = path.extname(filepath).slice(1).toLowerCase()
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      }
      const mime = mimeMap[ext] ?? 'image/jpeg'

      const data = fs.readFileSync(filepath)
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  }

  /** 从 URL 推断扩展名 */
  private guessExtension(url: string): string {
    if (url.includes('.png')) return 'png'
    if (url.includes('.gif')) return 'gif'
    if (url.includes('.webp')) return 'webp'
    return 'jpg'
  }

  /** 清理旧文件，保持缓存大小在 maxFiles 以内 */
  private cleanup(): void {
    try {
      const dir = this.config.cacheDir
      const entries = fs
        .readdirSync(dir)
        .map((name) => {
          const fullPath = path.join(dir, name)
          const stat = fs.statSync(fullPath)
          return { path: fullPath, mtime: stat.mtimeMs }
        })
        .sort((a, b) => a.mtime - b.mtime) // 最旧的在前

      if (entries.length <= this.config.maxFiles) return

      const toDelete = entries.length - this.config.maxFiles
      for (let i = 0; i < toDelete; i++) {
        try {
          fs.unlinkSync(entries[i]!.path)
        } catch {
          // 静默忽略删除错误
        }
      }

      logger.debug(`缓存清理: 删除了 ${toDelete} 个旧文件`)
    } catch {
      // 清理失败不影响主流程
    }
  }
}
