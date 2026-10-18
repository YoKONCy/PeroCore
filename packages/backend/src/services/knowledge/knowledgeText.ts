import { tokenCounter } from '../tokenizer/tokenCounter'
import { AppError } from '../../lib/appError'

export const MAX_DOCUMENT_TOKENS = 400_000
export const SPLIT_DOCUMENT_TOKENS = 10_000
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024

export function normalizeKnowledgeText(input: string): { content: string; tokenCount: number } {
  if (Buffer.byteLength(input, 'utf8') > MAX_SOURCE_BYTES) {
    throw new AppError('BAD_REQUEST', { message: '文本过大，请先手动切分后导入' })
  }
  const content = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!content || content.includes('\0')) {
    throw new AppError('BAD_REQUEST', { message: '请选择非空的 UTF-8 文本' })
  }
  const tokenCount = tokenCounter.countTokens(content)
  if (tokenCount > MAX_DOCUMENT_TOKENS) {
    throw new AppError('BAD_REQUEST', { message: '文本超过 400K Token，请先手动切分后导入' })
  }
  return { content, tokenCount }
}

export function decodeKnowledgeText(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new AppError('BAD_REQUEST', { message: '文件过大，请先手动切分后导入' })
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new AppError('BAD_REQUEST', { message: '文件编码不是 UTF-8，请转换后导入' })
  }
}

function htmlToText(html: string): string {
  return html
    .replace(
      /<(head|script|style|nav|footer|header|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const value =
        code.startsWith('x') || code.startsWith('X') ? parseInt(code.slice(1), 16) : Number(code)
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, key: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[key]!,
    )
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function fetchKnowledgePage(
  input: string,
): Promise<{ content: string; title: string; source: string }> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new AppError('BAD_REQUEST', { message: '请输入有效的网页地址' })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError('BAD_REQUEST', { message: '仅支持 HTTP / HTTPS 网页地址' })
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'text/html,text/plain,text/markdown,application/json' },
  })
  if (!response.ok)
    throw new AppError('BAD_REQUEST', { message: `网页读取失败：HTTP ${response.status}` })
  const mime = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (mime && !mime.startsWith('text/') && !/application\/(json|xml|xhtml\+xml)/.test(mime)) {
    await response.body?.cancel()
    throw new AppError('BAD_REQUEST', { message: '该链接不是文本网页，请导入文本文件' })
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AppError('BAD_REQUEST', { message: '网页没有正文' })
  const buffers: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SOURCE_BYTES)
        throw new AppError('BAD_REQUEST', { message: '网页过大，请先保存并手动切分' })
      buffers.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const text = decodeKnowledgeText(Buffer.concat(buffers))
  const html = mime.includes('html') || /^\s*(<!doctype html|<html)/i.test(text)
  const title = html ? htmlToText(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') : ''
  return {
    content: html ? htmlToText(text) : text,
    title: title.slice(0, 200) || url.hostname,
    source: response.url || url.href,
  }
}

/** 结果预算按真实 Token 计数；游标保持在 Unicode 字符边界上。 */
export function fitKnowledgeText(text: string, budget: number): string {
  if (budget <= 0) return ''
  let low = 0
  let high = Math.min(text.length, budget * 12)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (tokenCounter.countTokens(text.slice(0, mid)) <= budget) low = mid
    else high = mid - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low--
  return text.slice(0, low)
}
