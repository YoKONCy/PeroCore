/**
 * Diary Engine — 统一日记生成引擎
 *
 * 综合所有来源（桌面对话、社交事件等）的当日摘要，
 * 一次 LLM 调用同时输出日记 + 实体 + 图谱边 + 情感。
 *
 * @module packages/backend/src/services/memory/diaryEngine
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'
import type { VectorRepository } from '../../repositories/vector.repo'
import type { EmbeddingProvider } from '../embedding/embeddingService'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'

const logger = createLogger('DiaryEngine')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 日记条目 */
export interface DiaryEntry {
  /** 日期 (ISO 格式: "2026-04-19") */
  date: string
  /** 生成日记的 Agent */
  agentId: string
  /** 日记正文 (角色视角叙述) */
  diary: string
  /** 实体抽取 */
  entities: DiaryEntity[]
  /** 图谱关系 */
  relations: DiaryRelation[]
  /** 当日情感 */
  mood: string
  /** 亮点事件 */
  highlights: string[]
}

/** 日记实体 */
export interface DiaryEntity {
  name: string
  type: 'person' | 'place' | 'item' | 'concept' | 'event'
}

/** 日记图谱关系 */
export interface DiaryRelation {
  from: string
  to: string
  label: string
  weight: number
}

/** 日记生成输入 */
export interface DiaryInput {
  /** 当日对话摘要列表 (Scorer 产出的记忆 content) */
  summaries: string[]
  /** Agent ID */
  agentId: string
  /** Agent 名字 (日记叙述用) */
  agentName: string
  /** 主人名字 */
  ownerName?: string
  /** 用户称呼（AI 对用户的亲密称谓，如 主人/哥哥/老师，来自角色 agent.json 的 owner_appellation） */
  ownerAppellation?: string
  /** Agent 人设定义 (完整人设文本) */
  personaDefinition?: string
  /** 附加上下文 (如工作模式的任务名) */
  extraContext?: string
}

// ─────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────

export class DiaryEngine {
  constructor(
    private llmService: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private mdpEngine: MdpEngine,
    private vectorRepo: VectorRepository,
    private embeddingService: EmbeddingProvider,
  ) {}

  /**
   * 生成日记
   *
   * 一次 LLM 调用，输出日记 + 实体 + 图谱边 + 情感。
   * 单次调用统一编排 Scorer + GraphGardener + DiaryGenerator。
   */
  async generate(input: DiaryInput): Promise<DiaryEntry | null> {
    const {
      summaries,
      agentId,
      agentName,
      ownerName,
      ownerAppellation,
      personaDefinition,
      extraContext,
    } = input

    if (summaries.length === 0) {
      logger.info(`无摘要可生成日记: agent=${agentId}`)
      return null
    }

    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      logger.warn('未配置 LLM，跳过日记生成')
      return null
    }

    const today = new Date().toISOString().slice(0, 10)
    const owner = ownerName ?? '用户'
    const appellation = ownerAppellation ?? '主人'

    // 通过 MDP 模板渲染 Prompt
    const systemPrompt = this.mdpEngine.render('tasks/diary/diary', {
      agent_name: agentName,
      owner_name: owner,
      owner_appellation: appellation,
      persona_definition: personaDefinition ?? '',
      extra_context: extraContext ?? '',
      date_str: today,
      summaries: summaries.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    })
    const userContent = this.buildUserContent(summaries, today)

    try {
      const completion = await this.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        {
          responseFormat: { type: 'json_object' },
        },
      )

      const rawContent = completion.choices[0]?.message?.content
      if (!rawContent) return null

      const parsed = parseLlmJson<LlmDiaryOutput>(rawContent)
      if (!parsed) return null

      const entry: DiaryEntry = {
        date: today,
        agentId,
        diary: parsed.diary ?? '',
        entities: (parsed.entities ?? []).map((e) => ({
          name: e.name,
          type: (e.type ?? 'concept') as DiaryEntity['type'],
        })),
        relations: (parsed.relations ?? []).map((r) => ({
          from: r.from,
          to: r.to,
          label: r.label ?? 'related',
          weight: r.weight ?? 0.5,
        })),
        mood: parsed.mood ?? 'neutral',
        highlights: parsed.highlights ?? [],
      }

      logger.info(
        `日记生成完成: ${today} mood=${entry.mood}, ` +
          `entities=${entry.entities.length}, relations=${entry.relations.length}`,
      )

      // 持久化到 diary.tdb
      await this.persist(entry)

      return entry
    } catch (err) {
      logger.error(`日记生成失败: ${err}`)
      return null
    }
  }

  // ── 持久化 ──

  /**
   * 将日记写入 diary.tdb
   *
   * - 生成日记文本的 embedding 向量
   * - 以日期哈希作为稳定节点 ID (同日重复生成为 upsert)
   * - 建立日记图谱边 (from → to 关系)
   */
  private async persist(entry: DiaryEntry): Promise<void> {
    try {
      const nodeId = this.generateDiaryNodeId(entry.date, entry.agentId)

      // AIOS 第八阶段：embedding 不可用时跳过日记持久化
      if (!this.embeddingService.isAvailable) {
        logger.warn('Embedding 不可用，日记跳过持久化（文本仍保存到 SQLite）')
        return
      }

      // 生成日记文本的 embedding
      const vector = await this.embeddingService.embedOne(entry.diary)
      if (!vector?.length) {
        logger.warn('日记 embedding 生成失败，跳过持久化')
        return
      }

      // AIOS(Phase5): 日记按 Agent 隔离，upsertDiary 需要 agentId 路由到 agent_{id}/diary.tdb
      await this.vectorRepo.upsertDiary(
        nodeId,
        vector,
        {
          type: 'diary',
          date: entry.date,
          agentId: entry.agentId,
          diary: entry.diary,
          mood: entry.mood,
          highlights: entry.highlights,
          entities: entry.entities,
          relations: entry.relations,
        },
        entry.agentId,
      )

      // 建立图谱边
      for (const rel of entry.relations) {
        // 用 from/to 的哈希作为 edge ID 的一部分，保存语义关系
        await this.vectorRepo.linkDiary(nodeId, nodeId, rel.label, rel.weight, entry.agentId)
      }

      logger.info(`日记已持久化: nodeId=${nodeId}, date=${entry.date}, agent=${entry.agentId}`)
    } catch (err) {
      logger.warn(`日记持久化失败 (不影响生成结果): ${err}`)
    }
  }

  /**
   * 生成稳定的日记节点 ID
   *
   * 基于日期 + agentId 生成确定性哈希，
   * 保证同一天同一 Agent 的日记始终映射到同一个节点 ID (upsert 语义)。
   */
  private generateDiaryNodeId(date: string, agentId: string): number {
    const key = `diary:${agentId}:${date}`
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
    }
    // 确保正数且不和 memoryNodes ID 冲突 (高位区间)
    return Math.abs(hash) + 0x7000_0000
  }

  // ── 私有方法 ──

  private buildUserContent(summaries: string[], date: string): string {
    const lines = [`日期: ${date}`, '', '今日对话摘要:', '']
    for (let i = 0; i < summaries.length; i++) {
      lines.push(`${i + 1}. ${summaries[i]}`)
    }
    return lines.join('\n')
  }
}

/** LLM 原始输出结构 */
interface LlmDiaryOutput {
  diary?: string
  entities?: Array<{ name: string; type?: string }>
  relations?: Array<{ from: string; to: string; label?: string; weight?: number }>
  mood?: string
  highlights?: string[]
}
