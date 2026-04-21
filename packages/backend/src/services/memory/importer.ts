/**
 * Memory Importer — 故事/文本批量导入
 *
 * 将用户提供的长文本（故事、回忆录等）通过 LLM 拆分为
 * 独立的事件记忆，批量写入记忆系统。
 *
 *.py 的核心逻辑:
 * 1. 将长文本分段
 * 2. LLM 逐段提取事件
 * 3. 批量创建记忆 + 建时间链
 *
 * @module packages/backend/src/services/memory/importer
 */

import type { MemoryService } from './memoryService'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'
import { AppError } from '../../lib/appError'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MemoryImporter')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 导入请求 */
export interface ImportRequest {
  /** 待导入的故事文本 */
  text: string
  /** Agent ID */
  agentId: string
  /** 记忆来源标记 */
  source?: string
  /** 记忆类型 */
  type?: string
  /** 分段长度 (字符) */
  chunkSize?: number
}

/** 导入结果 */
export interface ImportResult {
  /** 总共导入的记忆数 */
  imported: number
  /** 跳过的数量 (解析失败等) */
  skipped: number
  /** 各段详情 */
  details: Array<{ content: string; tags: string; importance: number }>
}

/** LLM 返回的事件列表 */
interface ExtractedEvent {
  content: string
  tags: string[]
  importance: number
  sentiment?: string
  type?: string
}

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 3000 // 字符
const MAX_EVENTS_PER_CHUNK = 10

// ─────────────────────────────────────────────
// Importer
// ─────────────────────────────────────────────

export class MemoryImporter {
  constructor(
    private memoryService: MemoryService,
    private llmService: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private mdpEngine: MdpEngine,
  ) {}

  /**
   * 导入故事文本为记忆
   *
   * 流程:
   * 1. 将文本按 chunkSize 分段 (尊重段落边界)
   * 2. 逐段调 LLM 提取事件
   * 3. 批量创建记忆
   */
  async importStory(request: ImportRequest): Promise<ImportResult> {
    const {
      text,
      agentId,
      source = 'import',
      type = 'event',
      chunkSize = DEFAULT_CHUNK_SIZE,
    } = request

    if (!text.trim()) {
      return { imported: 0, skipped: 0, details: [] }
    }

    const modelConfig = await this.resolveModelConfig()

    // 1. 分段
    const chunks = this.splitIntoChunks(text, chunkSize)
    logger.info(`开始导入: ${text.length} 字, 分为 ${chunks.length} 段`)

    const result: ImportResult = { imported: 0, skipped: 0, details: [] }
    let prevMemoryId: number | undefined

    // 2. 逐段处理
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      logger.debug(`处理第 ${i + 1}/${chunks.length} 段 (${chunk.length} 字)`)

      try {
        const events = await this.extractEvents(modelConfig, chunk, i + 1, chunks.length)

        // 3. 逐条写入记忆
        for (const event of events) {
          try {
            const memory = await this.memoryService.create({
              content: event.content,
              agentId,
              tags: event.tags.join(','),
              importance: event.importance,
              sentiment: event.sentiment ?? 'neutral',
              type: event.type ?? type,
              source,
              prevId: prevMemoryId,
            })

            prevMemoryId = memory.id
            result.imported++
            result.details.push({
              content: event.content,
              tags: event.tags.join(','),
              importance: event.importance,
            })
          } catch (err) {
            logger.warn(`写入记忆失败: ${err}`)
            result.skipped++
          }
        }
      } catch (err) {
        logger.error(`第 ${i + 1} 段提取失败: ${err}`)
        result.skipped++
      }
    }

    logger.info(`导入完成: ${result.imported} 条记忆, ${result.skipped} 条跳过`)
    return result
  }

  // ── 内部方法 ──

  /**
   * 按段落边界分段
   */
  private splitIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = []
    const paragraphs = text.split(/\n\n+/)

    let current = ''
    for (const para of paragraphs) {
      if (current.length + para.length > chunkSize && current.length > 0) {
        chunks.push(current.trim())
        current = ''
      }
      current += para + '\n\n'
    }
    if (current.trim()) {
      chunks.push(current.trim())
    }

    return chunks.length > 0 ? chunks : [text]
  }

  /**
   * 调 LLM 从文本段落中提取事件
   */
  private async extractEvents(
    modelConfig: ModelConfig,
    chunk: string,
    chunkIndex: number,
    totalChunks: number,
  ): Promise<ExtractedEvent[]> {
    const systemPrompt = this.mdpEngine.render('tasks/memory/importer/extract_events', {
      chunk_index: String(chunkIndex),
      total_chunks: String(totalChunks),
      max_events: String(MAX_EVENTS_PER_CHUNK),
    })

    const completion = await this.llmService.chat(
      modelConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: chunk },
      ],
      { temperature: 0.3, responseFormat: { type: 'json_object' } },
    )

    const raw = completion.choices[0]?.message?.content
    if (!raw) return []

    const parsed = parseLlmJson<ExtractedEvent[] | { events: ExtractedEvent[] }>(raw)

    if (Array.isArray(parsed)) {
      return parsed.filter((e) => e.content?.trim())
    }
    if (parsed && 'events' in parsed && Array.isArray(parsed.events)) {
      return parsed.events.filter((e) => e.content?.trim())
    }

    return []
  }

  /** 获取模型配置 (由 ModelRoleResolver 提供，缺失时抛出异常) */
  private async resolveModelConfig(): Promise<ModelConfig> {
    const config = await this.getModelConfig()
    if (!config) {
      throw new AppError('CONFIG_ERROR', {
        message: '未配置 LLM 模型，无法导入记忆',
      })
    }
    return config
  }
}
