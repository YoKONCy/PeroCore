/**
 * Diary Engine — 统一日记生成引擎
 *
 * 替代 v1 的 5 套独立报告:
 * - desktop_diary  → profile="default"
 * - social_daily   → profile="social"
 * - work_log       → profile="work"
 * - weekly_report  → ❌ 砍掉 (D56)
 * - waifu_text     → Hook 扩展
 *
 * 核心创新 (10_MEMORY_SYSTEM.md §11.2):
 * 一次 LLM 调用同时输出日记 + 实体 + 图谱边 + 情感
 *
 * @module packages/backend/src/services/memory/diaryEngine
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ConfigRepository } from '../../repositories/config.repo'
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
  /** 来源 Profile */
  profile: string
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
  /** 来源 Profile */
  profile: string
  /** 主人名字 */
  ownerName?: string
  /** 附加上下文 (如工作模式的任务名) */
  extraContext?: string
}

// ─────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────

export class DiaryEngine {
  constructor(
    private llmService: LlmService,
    private configRepo: ConfigRepository,
  ) {}

  /**
   * 生成日记
   *
   * 一次 LLM 调用，输出日记 + 实体 + 图谱边 + 情感。
   * 替代 v1 的 3 次独立调用 (Scorer + GraphGardener + DiaryGenerator)。
   */
  async generate(input: DiaryInput): Promise<DiaryEntry | null> {
    const { summaries, agentId, agentName, profile, ownerName, extraContext } = input

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
    const owner = ownerName ?? '主人'

    // 组装 Prompt
    const systemPrompt = this.buildPrompt(agentName, owner, profile, extraContext)
    const userContent = this.buildUserContent(summaries, today)

    try {
      const completion = await this.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        {
          temperature: 0.7,
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
        profile,
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
        `日记生成完成: ${today} [${profile}] mood=${entry.mood}, ` +
          `entities=${entry.entities.length}, relations=${entry.relations.length}`,
      )

      return entry
    } catch (err) {
      logger.error(`日记生成失败: ${err}`)
      return null
    }
  }

  // ── 私有方法 ──

  private buildPrompt(
    agentName: string,
    ownerName: string,
    profile: string,
    extraContext?: string,
  ): string {
    const profileDesc = PROFILE_DESCRIPTIONS[profile] ?? '日常对话'

    const lines = [
      `你是 ${agentName}，正在写今天的日记。`,
      `你的主人叫 ${ownerName}。今天的对话属于「${profileDesc}」类型。`,
      extraContext ? `额外信息: ${extraContext}` : '',
      '',
      '请根据今天的对话摘要，以第一人称视角写一篇简短日记。',
      '同时提取出人物、地点、物品、概念等实体，以及它们之间的关系。',
      '',
      '输出严格 JSON 格式（不要使用 markdown 代码块）:',
      '{',
      '  "diary": "日记正文（200-400字，第一人称，带情感）",',
      '  "entities": [{"name": "实体名", "type": "person|place|item|concept|event"}],',
      '  "relations": [{"from": "主体", "to": "客体", "label": "关系", "weight": 0.0-1.0}],',
      '  "mood": "happy|calm|sad|excited|tired|anxious|neutral",',
      '  "highlights": ["今日亮点1", "今日亮点2"]',
      '}',
    ]
    return lines.filter(Boolean).join('\n')
  }

  private buildUserContent(summaries: string[], date: string): string {
    const lines = [`日期: ${date}`, '', '今日对话摘要:', '']
    for (let i = 0; i < summaries.length; i++) {
      lines.push(`${i + 1}. ${summaries[i]}`)
    }
    return lines.join('\n')
  }

  private async getModelConfig(): Promise<ModelConfig | null> {
    const apiKey = await this.configRepo.get('global_llm_api_key')
    if (!apiKey) return null

    const apiBase = await this.configRepo.get('global_llm_api_base')
    const modelId = await this.configRepo.get('diary_model_id')

    return {
      provider: 'openai',
      modelId: modelId ?? 'gpt-4o-mini',
      apiKey,
      apiBase: apiBase ?? undefined,
    }
  }
}

// ── 辅助 ──

/** Profile 描述映射 */
const PROFILE_DESCRIPTIONS: Record<string, string> = {
  default: '日常桌面对话',
  lightweight: '轻量模式对话',
  companion: '陪伴模式互动',
  work: '工作模式协作',
  social: '社交平台互动',
}

/** LLM 原始输出结构 */
interface LlmDiaryOutput {
  diary?: string
  entities?: Array<{ name: string; type?: string }>
  relations?: Array<{ from: string; to: string; label?: string; weight?: number }>
  mood?: string
  highlights?: string[]
}
