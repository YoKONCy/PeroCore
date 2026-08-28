import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { failDocument } from './errors'

export interface BlobDescriptor {
  blobId: string
  byteLength: number
  sha256: string
}

export class ContentAddressedBlobStore {
  constructor(private readonly rootPath: string) {
    mkdirSync(this.rootPath, { recursive: true })
  }

  put(content: Uint8Array): BlobDescriptor {
    const bytes = Buffer.from(content)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const blobId = `sha256:${sha256}`
    const target = this.pathFor(sha256)
    if (!existsSync(target)) {
      mkdirSync(path.dirname(target), { recursive: true })
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, bytes, { flag: 'wx' })
        if (createHash('sha256').update(readFileSync(temporary)).digest('hex') !== sha256) {
          failDocument('DOCUMENT_BLOB_DIGEST_MISMATCH', 'Blob 临时文件摘要不一致')
        }
        renameSync(temporary, target)
      } finally {
        rmSync(temporary, { force: true })
      }
    }
    return { blobId, byteLength: bytes.byteLength, sha256 }
  }

  get(blobId: string): Buffer {
    const sha256 = this.digest(blobId)
    const file = this.pathFor(sha256)
    if (!existsSync(file)) failDocument('DOCUMENT_BLOB_NOT_FOUND', `Blob 不存在: ${blobId}`)
    const bytes = readFileSync(file)
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      failDocument('DOCUMENT_BLOB_DIGEST_MISMATCH', `Blob 摘要验证失败: ${blobId}`)
    }
    return bytes
  }

  has(blobId: string): boolean {
    return existsSync(this.pathFor(this.digest(blobId)))
  }

  private digest(blobId: string): string {
    const match = /^sha256:([a-f0-9]{64})$/.exec(blobId)
    if (!match) failDocument('DOCUMENT_BLOB_ID_INVALID', 'Blob ID 必须是 sha256 内容地址')
    return match[1]!
  }

  private pathFor(sha256: string): string {
    return path.join(this.rootPath, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }
}
