/**
 * staticAssetService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/** 发行包静态资源读取服务。 */
export class StaticAssetService {
  constructor(private readonly root: string) {}

  read(requested: string): { body: ArrayBuffer; contentType: string; cacheControl: string } | null {
    const root = path.resolve(this.root)
    const target = path.resolve(root, requested)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('FORBIDDEN')
    if (!existsSync(target) || !statSync(target).isFile()) return null
    const content = readFileSync(target)
    return {
      body: content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      cacheControl:
        path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    }
  }
}
