import { createHash } from 'node:crypto'
import { mkdir, rename, open, readFile, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { Asset } from './domain'
import { newId, type Store } from './store'
import {
  backoff,
  pause,
  persistenceError,
  retryAfter,
  ServiceRequestError,
  transient,
} from './requestSafety'

export const MAX_ASSET_BYTES = 100 * 1024 * 1024
export async function bounded(response: Response, maximum = MAX_ASSET_BYTES): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel()
    throw new Error('资源超过大小限制')
  }
  if (!response.body) throw new Error('响应内容为空')
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.length
      if (size > maximum) throw new Error('资源超过大小限制')
      parts.push(result.value)
    }
    const expected = Number(response.headers.get('content-length'))
    if (expected > 0 && !response.headers.get('content-encoding') && size !== expected)
      throw new ServiceRequestError('资源传输未完成', { retryable: true })
    return Buffer.concat(parts)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export class Assets {
  constructor(private readonly store: Store) {}
  path(asset: Asset): string {
    return path.join(this.store.root, 'assets', asset.sha256.slice(0, 2), asset.sha256)
  }
  async available(owner: string, reference: unknown) {
    if (
      !reference ||
      typeof reference !== 'object' ||
      typeof (reference as { assetId?: string }).assetId !== 'string'
    )
      return false
    const asset = this.store.asset((reference as { assetId: string }).assetId, owner)
    return this.validFile(this.path(asset), asset.sha256, asset.sizeBytes)
  }
  private async cached(owner: string, key?: string) {
    if (!key) return undefined
    const receipt = this.store.get<{ assetId: string }>(
      owner,
      'asset-receipt',
      createHash('sha256').update(key).digest('hex'),
    )
    if (!receipt) return undefined
    const asset = this.store.asset(receipt.assetId, owner)
    return (await this.validFile(this.path(asset), asset.sha256, asset.sizeBytes))
      ? asset
      : undefined
  }
  private async validFile(target: string, hash: string, size: number) {
    try {
      if ((await stat(target)).size !== size) return false
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(target)) digest.update(chunk)
      return digest.digest('hex') === hash
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  async save(
    owner: string,
    name: string,
    mimeType: string,
    bytes: Buffer,
    key?: string,
  ): Promise<Asset> {
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES)
      throw new Error('资源为空或超过 100 MB 限制')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const previous = await this.cached(owner, key)
    if (previous) {
      if (previous.sha256 !== hash) throw new Error('同一资源回执对应了不同内容')
      return previous
    }
    const asset: Asset = {
      id: newId(),
      owner,
      name: path.basename(name).slice(0, 180) || '作品',
      mimeType: mimeType.split(';')[0] || 'application/octet-stream',
      sizeBytes: bytes.length,
      sha256: hash,
      createdAt: new Date().toISOString(),
    }
    const target = this.path(asset)
    const temporary = `${target}.${newId()}.tmp`
    try {
      await mkdir(path.dirname(target), { recursive: true })
      if (!(await this.validFile(target, hash, bytes.length))) {
        const file = await open(temporary, 'wx')
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        try {
          await rename(temporary, target)
        } catch (error) {
          if (!(await this.validFile(target, hash, bytes.length))) throw error
        }
      }
    } catch (error) {
      throw persistenceError(error)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    try {
      this.store.transaction(() => {
        this.store.saveAsset(asset)
        if (key) {
          const id = createHash('sha256').update(key).digest('hex'),
            old = this.store.get<{ revision: number }>(owner, 'asset-receipt', id)
          this.store.put(owner, 'asset-receipt', { id, assetId: asset.id }, old?.revision ?? 0)
        }
      })
    } catch (error) {
      throw persistenceError(error)
    }
    return asset
  }
  async import(
    owner: string,
    source: string,
    name = '作品',
    mimeType?: string,
    signal?: AbortSignal,
    key?: string,
  ): Promise<Asset> {
    signal?.throwIfAborted()
    const previous = await this.cached(owner, key)
    if (previous) return previous
    if (source.startsWith('data:')) {
      const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(source)
      if (!match || match[2]!.length > MAX_ASSET_BYTES * 1.4)
        throw new Error('图片数据格式或大小无效')
      return this.save(owner, name, mimeType ?? match[1]!, Buffer.from(match[2]!, 'base64'), key)
    }
    const url = new URL(source)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('资源地址必须是 HTTP 地址')
    for (let attempt = 0; ; attempt++) {
      const downloadSignal = AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(120000),
      ])
      try {
        const response = await fetch(url, { signal: downloadSignal, redirect: 'error' })
        if (!response.ok) {
          await response.body?.cancel()
          throw new ServiceRequestError(`资源下载失败：HTTP ${response.status}`, {
            status: response.status,
            retryable: [408, 425, 429, 500, 502, 503, 504].includes(response.status),
            retryAfterMs: retryAfter(response.headers.get('retry-after')),
          })
        }
        return await this.save(
          owner,
          name,
          mimeType ?? response.headers.get('content-type') ?? 'application/octet-stream',
          await bounded(response),
          key,
        )
      } catch (error) {
        const retryable =
          transient(error) ||
          error instanceof TypeError ||
          (downloadSignal.aborted && !signal?.aborted)
        if (!retryable || signal?.aborted || attempt >= 2)
          throw error instanceof TypeError
            ? new ServiceRequestError('资源连接中断，已保存的资源已保留', { retryable: true })
            : error
        await pause(
          Math.max(
            (error as ServiceRequestError).detail?.retryAfterMs || 0,
            backoff(attempt, 1000, 8000),
          ),
          signal ?? new AbortController().signal,
        )
      }
    }
  }
  async dataUrl(owner: string, value: unknown): Promise<string> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('assetId' in value) ||
      typeof value.assetId !== 'string'
    )
      throw new Error('需要有效的素材引用')
    const asset = this.store.asset(value.assetId, owner)
    if (asset.sizeBytes > 20 * 1024 * 1024)
      throw new Error('当前服务的数据 URL 输入仅支持 20 MB 以内素材')
    return `data:${asset.mimeType};base64,${(await readFile(this.path(asset))).toString('base64')}`
  }
  async file(
    owner: string,
    value: unknown,
    maximum = MAX_ASSET_BYTES,
  ): Promise<{ blob: Blob; name: string }> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('assetId' in value) ||
      typeof value.assetId !== 'string'
    )
      throw new Error('文件输入需要素材引用')
    const asset = this.store.asset(value.assetId, owner)
    if (asset.sizeBytes > maximum) throw new Error('上传素材超过请求大小限制')
    return {
      blob: new Blob([new Uint8Array(await readFile(this.path(asset)))], { type: asset.mimeType }),
      name: asset.name,
    }
  }
  list(owner: string, limit = 50, offset = 0): Asset[] {
    return (
      this.store.db
        .prepare('SELECT value_json FROM assets WHERE owner=? ORDER BY rowid DESC LIMIT ? OFFSET ?')
        .all(owner, Math.min(100, limit), offset) as Array<{ value_json: string }>
    ).map((r) => JSON.parse(r.value_json) as Asset)
  }
}
