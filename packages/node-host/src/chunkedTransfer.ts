import { createHash, randomUUID } from 'node:crypto'

export interface NodeTransferManifest {
  transferId: string
  byteLength: number
  chunkSize: number
  totalChunks: number
  sha256: string
}

export interface NodeTransferChunk {
  transferId: string
  index: number
  offset: number
  base64: string
  sha256: string
}

interface IncomingTransfer {
  manifest: NodeTransferManifest
  chunks: Map<number, Buffer>
}

/** 可断点恢复的跨Node分块Transfer接收权威。 */
export class ChunkedNodeTransferRegistry {
  private readonly incoming = new Map<string, IncomingTransfer>()

  createManifest(bytes: Uint8Array, chunkSize = 256 * 1024): NodeTransferManifest {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0)
      throw new Error('TRANSFER_CHUNK_SIZE_INVALID')
    return {
      transferId: randomUUID(),
      byteLength: bytes.byteLength,
      chunkSize,
      totalChunks: Math.ceil(bytes.byteLength / chunkSize),
      sha256: digest(bytes),
    }
  }

  chunks(manifest: NodeTransferManifest, bytes: Uint8Array): NodeTransferChunk[] {
    if (bytes.byteLength !== manifest.byteLength || digest(bytes) !== manifest.sha256) {
      throw new Error('TRANSFER_SOURCE_MISMATCH')
    }
    const result: NodeTransferChunk[] = []
    for (let index = 0; index < manifest.totalChunks; index++) {
      const offset = index * manifest.chunkSize
      const chunk = Buffer.from(
        bytes.slice(offset, Math.min(offset + manifest.chunkSize, bytes.byteLength)),
      )
      result.push({
        transferId: manifest.transferId,
        index,
        offset,
        base64: chunk.toString('base64'),
        sha256: digest(chunk),
      })
    }
    return result
  }

  begin(manifest: NodeTransferManifest): void {
    if (
      manifest.byteLength < 0 ||
      manifest.totalChunks !== Math.ceil(manifest.byteLength / manifest.chunkSize)
    ) {
      throw new Error('TRANSFER_MANIFEST_INVALID')
    }
    const existing = this.incoming.get(manifest.transferId)
    if (existing && JSON.stringify(existing.manifest) !== JSON.stringify(manifest)) {
      throw new Error('TRANSFER_MANIFEST_CONFLICT')
    }
    if (!existing) this.incoming.set(manifest.transferId, { manifest, chunks: new Map() })
  }

  accept(chunk: NodeTransferChunk): number {
    const transfer = this.incoming.get(chunk.transferId)
    if (!transfer) throw new Error('TRANSFER_NOT_STARTED')
    if (chunk.index < 0 || chunk.index >= transfer.manifest.totalChunks) {
      throw new Error('TRANSFER_CHUNK_INDEX_INVALID')
    }
    const expectedOffset = chunk.index * transfer.manifest.chunkSize
    if (chunk.offset !== expectedOffset) throw new Error('TRANSFER_CHUNK_OFFSET_INVALID')
    const bytes = Buffer.from(chunk.base64, 'base64')
    if (digest(bytes) !== chunk.sha256) throw new Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH')
    const existing = transfer.chunks.get(chunk.index)
    if (existing && !existing.equals(bytes)) throw new Error('TRANSFER_CHUNK_CONFLICT')
    transfer.chunks.set(chunk.index, bytes)
    return this.nextMissingIndex(chunk.transferId)
  }

  nextMissingIndex(transferId: string): number {
    const transfer = this.incoming.get(transferId)
    if (!transfer) throw new Error('TRANSFER_NOT_STARTED')
    for (let index = 0; index < transfer.manifest.totalChunks; index++) {
      if (!transfer.chunks.has(index)) return index
    }
    return transfer.manifest.totalChunks
  }

  complete(transferId: string): Buffer {
    const transfer = this.incoming.get(transferId)
    if (!transfer) throw new Error('TRANSFER_NOT_STARTED')
    if (this.nextMissingIndex(transferId) !== transfer.manifest.totalChunks) {
      throw new Error('TRANSFER_INCOMPLETE')
    }
    const bytes = Buffer.concat(
      Array.from(
        { length: transfer.manifest.totalChunks },
        (_, index) => transfer.chunks.get(index)!,
      ),
    )
    if (
      bytes.byteLength !== transfer.manifest.byteLength ||
      digest(bytes) !== transfer.manifest.sha256
    ) {
      throw new Error('TRANSFER_FINAL_CHECKSUM_MISMATCH')
    }
    this.incoming.delete(transferId)
    return bytes
  }

  abort(transferId: string): boolean {
    return this.incoming.delete(transferId)
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
