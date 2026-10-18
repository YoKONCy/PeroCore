import { Lexer } from 'marked'

const FILE_EXTENSIONS =
  /\.(?:html?|svg|png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v|mp3|wav|ogg|opus|m4a|flac|pdf|zip|7z|rar|tar|gz|docx?|xlsx?|pptx?|txt|md|csv|json|ya?ml)(?:[?#]|$)/i

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
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(clean)) return 'image'
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video'
  if (/\.(mp3|wav|ogg|opus|m4a|flac)$/.test(clean)) return 'audio'
  if (/\.pdf$/.test(clean)) return 'pdf'
  if (/\.html?$/.test(clean)) return 'web'
  return 'file'
}

export function isHtmlFileReference(value: string): boolean {
  return /\.html?$/i.test(value) && !/[<>\n\r]/.test(value) && isResourceLink(value)
}

/** 只有独立的文件引用变成卡片，代码块和行内正文保留原有结构。 */
export function splitResourceCards(source: string) {
  const result: Array<{
    type: 'rich-text' | 'resource-reference'
    source: string
    label?: string
  }> = []
  let text = ''
  for (const token of Lexer.lex(source)) {
    const match =
      token.type === 'paragraph'
        ? token.raw.trim().match(/^\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s]+))\)$/)
        : null
    const href = match?.[2] || match?.[3]
    if (href && isResourceLink(href)) {
      if (text) result.push({ type: 'rich-text', source: text })
      text = ''
      result.push({ type: 'resource-reference', source: href, label: match?.[1] })
    } else text += token.raw
  }
  if (text) result.push({ type: 'rich-text', source: text })
  return result
}
