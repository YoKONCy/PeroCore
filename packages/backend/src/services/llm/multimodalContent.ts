import type { ChatMessage, ContentPart } from './types'
import { AppError } from '../../lib/appError'

/** 只转换协议结构，不重采样、压缩或改写图片字节。 */
export function anthropicContent(
  content: ChatMessage['content'],
): string | Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return content ?? ''
  return content.map((part): Record<string, unknown> => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type !== 'image_url')
      throw new AppError('BAD_REQUEST', {
        message: 'Anthropic 原生协议暂不支持此音频输入，请先转写为文字',
      })
    const url = part.image_url.url
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(url)
    if (match)
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
    if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } }
    throw new AppError('BAD_REQUEST', {
      message: 'Anthropic 图片须为 PNG/JPEG/WebP/GIF 数据或 HTTP/HTTPS 地址',
    })
  })
}

export function responsesContent(
  content: ChatMessage['content'],
  role: ChatMessage['role'],
): string | Array<Record<string, unknown>> | null {
  if (!Array.isArray(content)) return content
  return content.map((part: ContentPart): Record<string, unknown> => {
    if (part.type === 'text')
      return { type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
    if (part.type === 'image_url')
      return {
        type: 'input_image',
        image_url: part.image_url.url,
        detail: part.image_url.detail ?? 'auto',
      }
    throw new AppError('BAD_REQUEST', { message: 'Responses 音频输入暂未适配，请先转写为文字' })
  })
}
