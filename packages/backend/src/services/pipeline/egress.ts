/**
 * Phase 5: Egress — 后处理 + 持久化 + 攒批入队
 *
 * 职责：
 * 1. 过滤 Thinking 块
 * 2. 清理 NIT 标签
 * 3. 生成 TTS 文本
 * 4. 保存对话日志 (savePair)
 * 5. 触发 Scorer 攒批检查
 * 6. 广播宠物状态更新
 *
 * 替代 v1 的 ThinkingFilterPostprocessor + NITFilterPostprocessor。
 *
 * @module packages/backend/src/services/pipeline/egress
 */

import type { EgressInput, EgressResult, ToolCallRecord } from './types'
import type { ConversationLogService } from '../memory/conversationLog'
import type { ScorerService } from '../memory/scorerService'
import type { GatewayHub } from '../gateway/gatewayHub'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Egress')

// ─────────────────────────────────────────────
// 正则
// ─────────────────────────────────────────────

/** 思考块 (中文 + 英文) */
const RE_THINKING = /【\s*(?:Thinking|Monologue)\s*:[\s\S]*?】/g

/** XML 大写标签 (旧版工具输出) */
const RE_XML_BLOCK = /<([A-Z_]+)>[\s\S]*?<\/\1>/g

/** 残留 HTML 标签 */
const RE_HTML_TAG = /<[^>]+>/g

/** NIT 工具调用标签 (v1: <nit-XXXX>, v3: <nit>) */
const RE_NIT_TAG = /<(nit(?:-[a-zA-Z0-9_]+)?)>[\s\S]*?<\/\1>/g

/** RAG 注释块 */
const RE_RAG_BLOCK = /<!-- PERO_RAG_BLOCK_START[\s\S]*?-->[\s\S]*?<!-- PERO_RAG_BLOCK_END -->/g

// ─────────────────────────────────────────────
// 纯函数 Egress (保持向后兼容)
// ─────────────────────────────────────────────

/**
 * 后处理 LLM 回复 (纯函数，无副作用)
 */
export function runEgress(input: EgressInput): EgressResult {
  const { rawReply, toolCalls } = input

  // 1. 清洗回复文本 (给用户看)
  const reply = cleanForDisplay(rawReply, toolCalls)

  // 2. 生成 TTS 文本 (更激进的清洗)
  const ttsText = cleanForTts(reply)

  return {
    reply,
    ttsText,
    logPairId: null,
  }
}

// ─────────────────────────────────────────────
// EgressService (有副作用: 持久化 + 广播)
// ─────────────────────────────────────────────

export class EgressService {
  constructor(
    private logService: ConversationLogService,
    private scorerService: ScorerService,
    private gateway?: GatewayHub,
  ) {}

  /**
   * 完整 Egress: 文本清洗 + 持久化 + Scorer 攒批 + 广播
   */
  async process(input: EgressInput): Promise<EgressResult> {
    const { rawReply, toolCalls, request } = input
    const { agentId, source, sessionId } = request

    // 1. 文本清洗
    const reply = cleanForDisplay(rawReply, toolCalls)
    const ttsText = cleanForTts(reply)

    // 2. 持久化对话日志
    let logPairId: string | null = null
    try {
      const userText = typeof request.messages[request.messages.length - 1]?.content === 'string'
        ? request.messages[request.messages.length - 1]?.content as string
        : ''

      const result = await this.logService.savePair({
        sessionId,
        source,
        agentId,
        userContent: userText,
        assistantContent: reply,
      })
      logPairId = result.pairId
      logger.debug(`对话日志已保存: pairId=${logPairId}`)
    } catch (err) {
      logger.warn(`对话日志保存失败: ${err}`)
    }

    // 3. Scorer 攒批检查 (异步，不阻塞响应)
    this.scorerService.checkAndProcess(agentId).catch((err) => {
      logger.warn(`Scorer 攒批触发失败: ${err}`)
    })

    // 4. 广播通知 (通知前端对话完成)
    if (this.gateway) {
      try {
        await this.gateway.pushNotification({
          title: '对话完成',
          body: reply.slice(0, 100),
          level: 'info',
          source: 'egress',
        })
      } catch (err) {
        logger.debug(`广播失败: ${err}`)
      }
    }

    return { reply, ttsText, logPairId }
  }
}

// ─────────────────────────────────────────────
// 清洗函数
// ─────────────────────────────────────────────

/** 清洗回复文本 (显示用) */
function cleanForDisplay(text: string, toolCalls: ToolCallRecord[]): string {
  let cleaned = text

  // 移除 RAG 注释块
  cleaned = cleaned.replace(RE_RAG_BLOCK, '')

  // 移除 NIT 标签
  cleaned = cleaned.replace(RE_NIT_TAG, '')

  // 移除 XML 大写标签块
  cleaned = cleaned.replace(RE_XML_BLOCK, '')

  // 移除残留 HTML 标签
  cleaned = cleaned.replace(RE_HTML_TAG, '')

  // 如果有工具调用，附加摘要
  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map((t) => t.name))].join(', ')
    cleaned += `\n[调用了工具: ${toolNames}]`
  }

  return cleaned.trim()
}

/** 清洗 TTS 文本 (更激进) */
function cleanForTts(text: string): string {
  let cleaned = text

  // 移除思考块
  cleaned = cleaned.replace(RE_THINKING, '')

  // 移除工具调用摘要行
  cleaned = cleaned.replace(/\[调用了工具:.*?\]/g, '')

  // 移除 Markdown 格式
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '') // 代码块
  cleaned = cleaned.replace(/`[^`]+`/g, '') // 行内代码
  cleaned = cleaned.replace(/[*_~#>\-|]/g, '') // Markdown 标记

  // 取最后一段 (避免 TTS 太长)
  const segments = cleaned.split('\n').filter((s) => s.trim())
  if (segments.length > 0) {
    cleaned = segments[segments.length - 1] ?? cleaned
  }

  return cleaned.trim()
}
