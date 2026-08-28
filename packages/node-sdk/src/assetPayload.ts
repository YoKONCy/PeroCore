import { createHash } from 'node:crypto'
import type { NodeAssetPayload } from './types'

export function createNodeAssetPayload(input: {
  assetId: string
  mimeType: string
  bytes: Uint8Array
}): NodeAssetPayload {
  const buffer = Buffer.from(input.bytes)
  return {
    assetId: input.assetId,
    mimeType: input.mimeType,
    byteLength: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    base64: buffer.toString('base64'),
  }
}

export function verifyNodeAssetPayload(payload: NodeAssetPayload): Buffer {
  const bytes = Buffer.from(payload.base64, 'base64')
  if (bytes.byteLength !== payload.byteLength) {
    throw new Error('NODE_ASSET_SIZE_MISMATCH: Asset 大小不一致')
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== payload.sha256) {
    throw new Error('NODE_ASSET_DIGEST_MISMATCH: Asset 摘要不一致')
  }
  return bytes
}
