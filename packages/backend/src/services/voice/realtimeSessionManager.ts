/**
 * Realtime Session Manager — 语音全链路编排器
 *
 * (26K, 621行) 的核心能力。
 * 负责语音对话的全链路自动化管道:
 *
 * ASR (语音识别) → Agent (对话处理) → TTS (文本转语音) → Gateway (音频流推送)
 *
 * 主要创新点:
 * - ReAct TTS 过滤: 自动移除 <Thinking>/<Plan>/<Action> 等 Agent 内部推理文本
 * - 语音参数动态调整: 根据回复内容情感动态调整语速/音调
 * - 取消安全: 任意阶段可取消，不泄漏资源
 *
 * 三层架构: Service 层 — 负责编排，不构造 HTTP 响应。
 *
 * @see 预留位置
 * @module packages/backend/src/services/voice/realtimeSessionManager
 */

import type { TtsService, TtsResult } from './ttsService'
import type { AsrService, AsrResult } from './asrService'
import type { AgentService } from '../agent/agentService'
import type { GatewayHub } from '../gateway/gatewayHub'
// AIOS: SessionService 依赖已移除（新版不再使用旧 Session 模型）
import type { ThreadService } from '../thread/threadService'
import type { ConversationTurnService } from '../conversation/conversationTurnService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('RealtimeSession')

// ── 类型 ──

/** 语音会话状态 */
export type SessionState =
  | 'idle' // 等待输入
  | 'listening' // 正在接收音频
  | 'recognizing' // ASR 识别中
  | 'thinking' // Agent 思考中
  | 'speaking' // TTS 播放中
  | 'error' // 出错

/** 语音会话事件 */
export interface VoiceSessionEvent {
  type: 'state_change' | 'transcript' | 'reply' | 'audio' | 'error'
  sessionId: string
  data: unknown
}

/** 语音会话配置 */
export interface VoiceSessionConfig {
  /** TTS 声音 ID */
  voice?: string
  /** 语言 (BCP-47) */
  language?: string
  /** 超时 (秒) — 等待用户语音的最大时间 */
  timeoutSec?: number
  /** 是否启用 ReAct 文本过滤 */
  enableReActFilter?: boolean
}

/** 语音处理管道结果 */
export interface VoicePipelineResult {
  /** ASR 识别文本 */
  transcript: string
  /** Agent 回复文本 */
  reply: string
  /** TTS 音频 */
  audio: TtsResult | null
  /** 各阶段耗时 */
  timing: {
    asrMs: number
    agentMs: number
    ttsMs: number
    totalMs: number
  }
}

// ── 依赖 ──

export interface RealtimeSessionDeps {
  ttsService: TtsService
  asrService: AsrService
  agentService: AgentService
  gatewayHub: GatewayHub
  // AIOS: 新增 Thread + ContextCompiler 依赖，替代旧 SessionService
  threadService: ThreadService
  conversationTurnService: ConversationTurnService
}

// ── Service ──

export class RealtimeSessionManager {
  private deps: RealtimeSessionDeps
  private activeSessions = new Map<string, ActiveVoiceSession>()

  constructor(deps: RealtimeSessionDeps) {
    this.deps = deps
    logger.info('实时语音会话管理器初始化完成')
  }

  /**
   * 处理一次完整的语音管道
   *
   * 音频输入 → ASR → Agent → TTS → 返回音频
   * 每个阶段的状态变化通过 Gateway 实时广播。
   */
  async processVoicePipeline(
    audioData: ArrayBuffer,
    agentId: string,
    sessionId: string,
    config?: VoiceSessionConfig,
  ): Promise<VoicePipelineResult> {
    const startMs = Date.now()
    const enableFilter = config?.enableReActFilter !== false

    // 注册活跃会话
    const session: ActiveVoiceSession = { state: 'listening', startedAt: startMs }
    this.activeSessions.set(sessionId, session)

    try {
      // ── 阶段 1: ASR 语音识别 ──
      await this.broadcastState(sessionId, 'recognizing')
      session.state = 'recognizing'

      const asrStartMs = Date.now()
      const asrResult = await this.runAsr(audioData, config?.language)
      const asrMs = Date.now() - asrStartMs

      logger.info(`ASR 完成: "${asrResult.text}" (${asrMs}ms)`)

      // 广播识别结果
      await this.deps.gatewayHub.pushNotification({
        title: '语音识别',
        body: asrResult.text,
      })

      // ── 阶段 2: Agent 对话处理 ──
      await this.broadcastState(sessionId, 'thinking')
      session.state = 'thinking'

      const agentStartMs = Date.now()
      const reply = await this.runAgent(asrResult.text, agentId, sessionId)
      const agentMs = Date.now() - agentStartMs

      logger.info(`Agent 回复: "${reply.slice(0, 50)}..." (${agentMs}ms)`)

      // ── 阶段 3: 文本清洗 (ReAct 过滤) ──
      const ttsText = enableFilter ? cleanTextForTts(reply) : reply

      // ── 阶段 4: TTS 语音合成 ──
      await this.broadcastState(sessionId, 'speaking')
      session.state = 'speaking'

      let audio: TtsResult | null = null
      let ttsMs = 0

      if (ttsText.trim()) {
        const ttsStartMs = Date.now()
        const voiceParams = detectVoiceParams(ttsText)
        audio = await this.runTts(ttsText, config?.voice, voiceParams)
        ttsMs = Date.now() - ttsStartMs
        logger.info(`TTS 完成: ${ttsMs}ms`)
      }

      // ── 完成 ──
      await this.broadcastState(sessionId, 'idle')
      session.state = 'idle'

      const totalMs = Date.now() - startMs
      return {
        transcript: asrResult.text,
        reply,
        audio,
        timing: { asrMs, agentMs, ttsMs, totalMs },
      }
    } catch (err) {
      session.state = 'error'
      await this.broadcastState(sessionId, 'error')
      logger.error(`语音管道错误: ${err}`)
      throw err
    } finally {
      this.activeSessions.delete(sessionId)
    }
  }

  /**
   * 获取当前活跃的语音会话列表
   */
  getActiveSessions(): Array<{ sessionId: string; state: SessionState; startedAt: number }> {
    return Array.from(this.activeSessions.entries()).map(([id, s]) => ({
      sessionId: id,
      state: s.state,
      startedAt: s.startedAt,
    }))
  }

  /**
   * 取消一个语音会话
   */
  cancelSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId)
    if (!session) return false

    session.state = 'idle'
    this.activeSessions.delete(sessionId)
    logger.info(`语音会话已取消: ${sessionId}`)
    return true
  }

  // ── 内部方法 ──

  /** 执行 ASR */
  private async runAsr(audio: ArrayBuffer, language?: string): Promise<AsrResult> {
    return this.deps.asrService.recognize({ audio, language })
  }

  /**
   * 执行 Agent 对话（AIOS 新版流程）
   *
   * 语音场景的 sessionId 作为 threadId 使用：
   * 1. 获取或创建 desktop Thread
   * 2. 追加 user 消息
   * 3. ContextCompiler 编译上下文
   * 4. AgentService 执行对话（chatWithCompiledMessages）
   * 5. 追加 assistant 回复
   */
  private async runAgent(text: string, agentId: string, sessionId: string): Promise<string> {
    const threadId = sessionId

    // 获取或创建 Thread（语音复用 sessionId 作为 threadId）
    let thread = await this.deps.threadService.getThread(threadId)
    if (!thread) {
      thread = await this.deps.threadService.createThread({
        id: threadId, // 语音场景复用 sessionId 作为 threadId
        agentId,
        channel: 'desktop',
        title: '语音对话',
      })
    }

    const result = await this.deps.conversationTurnService.executeTurn({
      threadId,
      agentId,
      content: text,
    })

    return result.reply
  }

  /** 执行 TTS */
  private async runTts(text: string, voice?: string, params?: VoiceParams): Promise<TtsResult> {
    return this.deps.ttsService.synthesize({
      text,
      voice,
      speed: params?.speed,
      pitch: params?.pitch,
    })
  }

  /** 广播状态变更 */
  private async broadcastState(sessionId: string, state: SessionState): Promise<void> {
    try {
      await this.deps.gatewayHub.pushNotification({
        title: 'voice_state',
        body: JSON.stringify({ sessionId, state }),
      })
    } catch {
      // 广播失败不中断管道
    }
  }
}

// ── 活跃会话内部类型 ──

interface ActiveVoiceSession {
  state: SessionState
  startedAt: number
}

// ── ReAct 文本清洗 ──

/** ReAct 推理块模式 (正则) */
const REACT_BLOCK_PATTERNS = [
  /<Thinking>[\s\S]*?<\/Thinking>/gi,
  /<Plan>[\s\S]*?<\/Plan>/gi,
  /<Action>[\s\S]*?<\/Action>/gi,
  /<Observation>[\s\S]*?<\/Observation>/gi,
  /```[\s\S]*?```/g, // 代码块
]

/**
 * 清洗 Agent 回复文本用于 TTS
 *
 * 移除 ReAct 推理块、代码块等不适合朗读的内容。
 * `_clean_text()`。
 */
export function cleanTextForTts(text: string): string {
  let cleaned = text

  // 移除 ReAct 推理块
  for (const pattern of REACT_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // 移除 markdown 标记
  cleaned = cleaned
    .replace(/#{1,6}\s/g, '') // 标题
    .replace(/\*\*(.*?)\*\*/g, '$1') // 加粗
    .replace(/\*(.*?)\*/g, '$1') // 斜体
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/^\s*[-*]\s+/gm, '') // 列表项

  // 清理多余空白
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return cleaned
}

// ── 语音参数动态检测 ──

interface VoiceParams {
  speed?: number | string
  pitch?: string
}

/** 根据文本情感检测语音参数 */
function detectVoiceParams(text: string): VoiceParams {
  // 简单的情感关键词检测 (后续可接入 LLM 情感分析)
  const excitedPattern = /[!！]{2,}|哈哈|太好了|耶|棒|厉害/
  const sadPattern = /唉|难过|伤心|可惜|抱歉|对不起/
  const angryPattern = /生气|讨厌|烦|别/
  const calmPattern = /嗯|好的|了解|知道了|明白/

  if (excitedPattern.test(text)) {
    return { speed: '+15%', pitch: '+3Hz' }
  }
  if (sadPattern.test(text)) {
    return { speed: '-10%', pitch: '-2Hz' }
  }
  if (angryPattern.test(text)) {
    return { speed: '+5%', pitch: '+1Hz' }
  }
  if (calmPattern.test(text)) {
    return { speed: '-5%', pitch: '0Hz' }
  }

  // 默认参数
  return {}
}
