import { Lexer } from 'marked'
import { isOfficeDocumentName, type MessageResource } from '@infos/shared'

const FILE_EXTENSIONS =
  /\.(?:html?|svg|png|jpe?g|gif|webp|avif|bmp|ico|mp4|webm|mov|m4v|ogv|mkv|mp3|wav|ogg|oga|opus|m4a|aac|flac|pdf|zip|7z|rar|tar|gz|doc[xm]?|xls[xmb]?|ppt[xm]?|pps[xm]?|pot|od[tsp]|rtf|epub|txt|md|markdown|csv|json|ya?ml|xml|js|mjs|ts|tsx|jsx|py|css|vue|rs|go|c|h|cpp|java|sh|ps1|log|toml|ini)(?:[?#]|$)/i

export function isResourceLink(value: string): boolean {
  return (
    /^(?:attachment:|workspace:|resource:|arca:|file:|[a-z]:[\\/]|\.\.?\/)/i.test(value) ||
    (/^https?:\/\//i.test(value)
      ? FILE_EXTENSIONS.test(value)
      : /^(?:\/|(?:[^:/#\s]+\/)*[^:/#\s]+\.[\w]+(?:#L\d+)?$)/.test(value))
  )
}

export function resourceLinkKind(value: string): string {
  const clean = value.split(/[?#]/)[0]?.toLowerCase() || ''
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(clean)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(clean)) return 'video'
  if (/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/.test(clean)) return 'audio'
  if (/\.pdf$/.test(clean)) return 'pdf'
  if (/\.html?$/.test(clean)) return 'web'
  return 'file'
}

export function resourcePreviewKind(item: MessageResource): string {
  const mime = item.mimeType.split(';')[0]?.toLowerCase() || ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'web'
  if (isOfficeDocumentName(item.name)) return 'office'
  if (/\.(?:md|markdown)$/i.test(item.name) || mime === 'text/markdown') return 'markdown'
  return item.kind
}

export function isFileReference(value: string): boolean {
  return !/[<>\n\r]/.test(value) && FILE_EXTENSIONS.test(value) && isResourceLink(value)
}

function isPreviewReference(token: { type: string; href?: string }): boolean {
  return (
    (token.type === 'link' || token.type === 'image') &&
    Boolean(token.href) &&
    (isResourceLink(token.href!) || (token.type === 'image' && /^https?:\/\//i.test(token.href!)))
  )
}

export function isHtmlFileReference(value: string): boolean {
  return /\.html?$/i.test(value) && !/[<>\n\r]/.test(value) && isResourceLink(value)
}

/** 正文中的资源链接与 Markdown 图片进入预览；代码块、行内代码和表格仍保留原结构。 */
export function splitResourceCards(source: string) {
  const markdownSource =
    source.match(/^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n?```\s*$/i)?.[1] ?? source
  const result: Array<{
    type: 'rich-text' | 'resource-reference'
    source: string
    label?: string
  }> = []
  let text = ''
  for (const token of Lexer.lex(markdownSource)) {
    if (token.type !== 'paragraph' || !token.tokens?.some(isPreviewReference)) {
      text += token.raw
      continue
    }
    for (const inline of token.tokens) {
      if ((inline.type === 'link' || inline.type === 'image') && isPreviewReference(inline)) {
        if (text.trim()) result.push({ type: 'rich-text', source: text })
        text = ''
        result.push({ type: 'resource-reference', source: inline.href, label: inline.text })
      } else text += inline.raw
    }
    text += '\n\n'
  }
  if (text) result.push({ type: 'rich-text', source: text })
  return result
}
