import path from 'node:path'
import type { WorkspacePreviewKind } from '@infos/shared'
import { resourceMime } from '../attachment/resourceSource'

/** 文件签名优先；仅对无法从短文件头区分的音视频容器使用扩展名提示。 */
export function workspaceFileType(
  name: string,
  header: Buffer,
): {
  kind: WorkspacePreviewKind
  mimeType: string
} {
  const signature = resourceMime('', '', header)
  if (signature.startsWith('image/')) return { kind: 'image', mimeType: signature }
  if (signature === 'application/pdf') return { kind: 'pdf', mimeType: signature }
  const extension = path.extname(name).toLowerCase()
  // PDF 可带前导数据，SVG 可有较长的 XML 声明或注释；交由对应渲染器校验完整内容。
  if (extension === '.pdf') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (extension === '.svg') return { kind: 'svg', mimeType: 'image/svg+xml' }
  const containers: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
  }
  const media = containers[extension]
  if (media) return { kind: media.startsWith('audio/') ? 'audio' : 'video', mimeType: media }
  if (header.subarray(0, 2).toString('ascii') === 'BM')
    return { kind: 'image', mimeType: 'image/bmp' }
  if (header.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))
    return { kind: 'image', mimeType: 'image/x-icon' }
  if (
    header
      .subarray(4, 12)
      .toString('ascii')
      .match(/^ftypavif/)
  )
    return { kind: 'image', mimeType: 'image/avif' }
  const binary = header.includes(0) || header.some((byte) => byte < 9 || (byte > 13 && byte < 32))
  return binary
    ? { kind: 'file', mimeType: 'application/octet-stream' }
    : { kind: 'text', mimeType: 'text/plain' }
}
