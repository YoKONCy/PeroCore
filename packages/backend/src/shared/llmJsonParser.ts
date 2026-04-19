/**
 * LLM JSON 鲁棒解析器
 *
 * 消除 v1 中 5+ 处重复的 JSON 解析逻辑 (10_MEMORY_SYSTEM.md §4.2)。
 * 支持：
 * - 直接 JSON
 * - ```json ... ``` 代码块
 * - 裸 {...} 或 [...]
 * - 尾随逗号修复、单引号修复
 *
 * @module packages/backend/src/shared/llmJsonParser
 */

import { createLogger } from '../lib/logger'

const logger = createLogger('LlmJsonParser')

/**
 * 鲁棒解析 LLM 返回的 JSON
 *
 * LLM 经常返回包裹在 markdown 代码块中的 JSON，
 * 或在 JSON 前后加入解释文字。本函数按优先级尝试多种解析策略。
 *
 * @param raw - LLM 原始输出
 * @returns 解析后的对象，失败返回 null
 */
export function parseLlmJson<T = unknown>(raw: string): T | null {
  if (!raw?.trim()) return null

  const trimmed = raw.trim()

  // 策略 1: 直接解析
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* noop */
  }

  // 策略 2: ```json ... ``` 代码块
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlock?.[1]) {
    try {
      return JSON.parse(codeBlock[1]) as T
    } catch {
      /* noop */
    }
  }

  // 策略 3: 最外层 {...}
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T
    } catch {
      /* noop */
    }
  }

  // 策略 4: 最外层 [...]
  const arrMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) as T
    } catch {
      /* noop */
    }
  }

  // 策略 5: 修复常见 JSON 错误 (尾随逗号、单引号)
  const candidate = objMatch?.[0] ?? arrMatch?.[0] ?? trimmed
  try {
    const fixed = candidate
      .replace(/,\s*([\]}])/g, '$1') // 移除尾随逗号
      .replace(/(?<=[\[{,]\s*)'([^']*)'(?=\s*[:,\]}])/g, '"$1"') // 简单单引号 → 双引号
    return JSON.parse(fixed) as T
  } catch {
    /* noop */
  }

  logger.debug(`无法解析 LLM JSON 输出: ${trimmed.slice(0, 100)}...`)
  return null
}

/**
 * 解析 LLM JSON (带默认值)
 *
 * 解析失败时返回默认值而非 null。
 */
export function parseLlmJsonOrDefault<T>(raw: string, defaultValue: T): T {
  return parseLlmJson<T>(raw) ?? defaultValue
}

/**
 * 解析 LLM JSON 数组
 *
 * 专门用于解析列表输出，确保返回值始终为数组。
 */
export function parseLlmJsonArray<T = unknown>(raw: string): T[] {
  const result = parseLlmJson<T[]>(raw)
  if (Array.isArray(result)) return result
  // 如果解析出的是对象，包装为单元素数组
  if (result !== null) return [result as T]
  return []
}

/**
 * 解析 LLM JSON，失败时抛出异常（严格模式）
 */
export function parseLlmJsonStrict<T = unknown>(raw: string, context?: string): T {
  const result = parseLlmJson<T>(raw)
  if (result === null) {
    throw new Error(`LLM JSON 解析失败${context ? ` (${context})` : ''}: ${raw.slice(0, 200)}`)
  }
  return result
}
