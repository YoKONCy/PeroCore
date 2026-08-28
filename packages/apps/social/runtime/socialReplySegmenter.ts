import type { MessageSegment, TextSegment } from './stickerService'

const STRONG_BOUNDARY = /[。！？!?；;\n]/
const SOFT_BOUNDARY = /[，,、：:]/
const TRAILING_SPLIT_PUNCTUATION = /[。．.;；]+$/u
const MIN_SEGMENT_LENGTH = 6
const TARGET_SEGMENT_LENGTH = 32
const MAX_SEGMENT_LENGTH = 56
const MAX_TEXT_SEGMENTS = 6

/**
 * 把社交长回复拆成适合即时聊天的短消息。
 *
 * 强边界始终形成独立消息；单句过长时再按逗号等弱边界拆分，并合并过短碎片。
 * 作为分块边界的句号和分号会被移除，问号与感叹号保留其语气。
 */
export function splitSocialText(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length <= TARGET_SEGMENT_LENGTH && !STRONG_BOUNDARY.test(normalized)) {
    return [stripBoundaryPunctuation(normalized)]
  }

  const chunks: string[] = []
  for (const sentence of splitAtBoundaries(normalized, STRONG_BOUNDARY, true)) {
    const sentenceChunks =
      sentence.length > MAX_SEGMENT_LENGTH
        ? mergeShortParts(splitAtBoundaries(sentence, SOFT_BOUNDARY, false))
        : [sentence]
    for (const chunk of sentenceChunks.flatMap((part) => hardWrap(part, MAX_SEGMENT_LENGTH))) {
      const clean = stripBoundaryPunctuation(chunk)
      if (clean) chunks.push(clean)
    }
  }

  while (chunks.length > MAX_TEXT_SEGMENTS) {
    const tail = chunks.pop()!
    chunks[chunks.length - 1] = `${chunks.at(-1) ?? ''}${tail}`
  }
  return chunks
}

/** 在文字与表情包有序段之间继续拆分文字，保持表情包原有位置。 */
export function expandSocialMessageSegments(segments: MessageSegment[]): MessageSegment[] {
  const expanded: MessageSegment[] = []
  for (const segment of segments) {
    if (segment.type === 'sticker') {
      expanded.push(segment)
      continue
    }
    for (const content of splitSocialText(segment.content)) {
      const text: TextSegment = { type: 'text', content }
      expanded.push(text)
    }
  }
  return expanded
}

/** 根据上一段消息长度计算拟人化输入间隔，并加入少量随机抖动。 */
export function socialTypingDelayMs(content: string, random = Math.random): number {
  const typing = content.length * 55
  const jitter = Math.floor(random() * 350)
  return Math.min(2200, Math.max(550, 350 + typing + jitter))
}

function splitAtBoundaries(
  content: string,
  boundary: RegExp,
  preserveExpressive: boolean,
): string[] {
  const parts: string[] = []
  let current = ''
  for (const char of content) {
    if (!boundary.test(char)) {
      current += char
      continue
    }
    if (preserveExpressive && /[！？!?]/.test(char)) current += char
    if (current.trim()) parts.push(current.trim())
    current = ''
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function mergeShortParts(parts: string[]): string[] {
  const merged: string[] = []
  for (const part of parts) {
    const clean = part.trim()
    if (!clean) continue
    const previous = merged.at(-1)
    if (
      previous &&
      (clean.length < MIN_SEGMENT_LENGTH || previous.length + clean.length <= TARGET_SEGMENT_LENGTH)
    ) {
      merged[merged.length - 1] = `${previous}${clean}`
    } else {
      merged.push(clean)
    }
  }
  return merged
}

function hardWrap(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]
  const parts: string[] = []
  let remaining = content
  while (remaining.length > maxLength) {
    let cut = maxLength
    const whitespace = remaining.lastIndexOf(' ', maxLength)
    if (whitespace >= Math.floor(maxLength * 0.6)) cut = whitespace
    parts.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

function stripBoundaryPunctuation(content: string): string {
  return content.replace(TRAILING_SPLIT_PUNCTUATION, '').trim()
}
