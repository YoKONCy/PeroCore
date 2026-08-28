/**
 * embeddedWebPreview — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { Marked } from 'marked'

export interface ChatContentSegment {
  type: 'rich-text' | 'web-preview'
  source: string
}

const segmentLexer = new Marked({ breaks: true, gfm: true })
const RENDERABLE_HTML =
  /<(?:!doctype|html|body|main|article|section|div|header|footer|nav|form|button|canvas|svg)\b/i
const ACTIVE_HTML = /<(?:style|script)\b|\sstyle\s*=|\son\w+\s*=/i

function splitRawHtmlBlock(source: string): { preview: string; trailing: string } {
  const root = source.match(
    /<(html|body|main|article|section|div|header|footer|nav|form|svg)\b[^>]*>/i,
  )
  if (!root || root.index === undefined) return { preview: source, trailing: '' }
  const tag = root[1]!
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
  tags.lastIndex = root.index
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(source)) !== null) {
    depth += /^<\//.test(match[0]) ? -1 : 1
    if (depth === 0) {
      return { preview: source.slice(0, tags.lastIndex), trailing: source.slice(tags.lastIndex) }
    }
  }
  return { preview: source, trailing: '' }
}

function isPreviewHtml(source: string): boolean {
  const value = source.trim()
  return (
    RENDERABLE_HTML.test(value) &&
    (ACTIVE_HTML.test(value) || /<\/(?:html|body|main|article|section|div|form|svg)>/i.test(value))
  )
}

/** 将消息中的完整HTML文档或HTML围栏拆成隔离预览，其余内容继续按普通富文本渲染。 */
export function segmentChatContent(source: string): ChatContentSegment[] {
  if (!source.trim()) return []
  const segments: ChatContentSegment[] = []
  let richText = ''

  const flushRichText = () => {
    if (!richText) return
    segments.push({ type: 'rich-text', source: richText })
    richText = ''
  }

  for (const token of segmentLexer.lexer(source)) {
    const raw = token.raw ?? ''
    const fencedHtml =
      token.type === 'code' && /^(?:html|htm)$/i.test((token.lang ?? '').trim())
        ? token.text
        : undefined
    const rawHtml = token.type === 'html' && isPreviewHtml(raw) ? splitRawHtmlBlock(raw) : undefined
    const preview = fencedHtml ?? rawHtml?.preview
    if (preview && isPreviewHtml(preview)) {
      flushRichText()
      segments.push({ type: 'web-preview', source: preview.trim() })
      richText += rawHtml?.trailing ?? ''
    } else {
      richText += raw
    }
  }
  flushRichText()
  return segments
}

/** 构造无同源权限的自包含网页；仅允许内联样式、脚本和data/blob图片。 */
export function buildEmbeddedWebDocument(source: string, channel: string): string {
  const resizeBridge = `<script>(()=>{const send=()=>parent.postMessage({type:'infos-embedded-resize',channel:${JSON.stringify(channel)},height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)},'*');addEventListener('load',send);new ResizeObserver(send).observe(document.documentElement);setTimeout(send,0)})()</script>`
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`
  const baseStyle = `<style>html,body{margin:0;min-height:1px;background:transparent;color-scheme:light dark}*{box-sizing:border-box}</style>`
  if (/<html[\s>]/i.test(source)) {
    let document = source
    document = /<head[\s>]/i.test(document)
      ? document.replace(/<head([^>]*)>/i, `<head$1>${policy}${baseStyle}`)
      : document.replace(/<html([^>]*)>/i, `<html$1><head>${policy}${baseStyle}</head>`)
    document = /<\/body>/i.test(document)
      ? document.replace(/<\/body>/i, `${resizeBridge}</body>`)
      : document.replace(/<\/html>/i, `${resizeBridge}</html>`)
    return document
  }
  return `<!doctype html><html><head><meta charset="utf-8">${policy}${baseStyle}</head><body>${source}${resizeBridge}</body></html>`
}
