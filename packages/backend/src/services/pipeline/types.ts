/**
 * Pipeline Phase 类型定义
 *
 * 5 阶段管道架构：
 * Ingress → Enrichment → PromptAssembly → ReActLoop → Egress
 *
 * 每个 Phase 的输入/输出都有严格类型 (替代 v1 的 Dict[str, Any] 黑洞)。
 *
 * @module packages/backend/src/services/pipeline/types
 */

import type { MemorySource } from '@perocore/shared'

// ─────────────────────────────────────────────
// 入口请求
// ─────────────────────────────────────────────

/** 对话请求 (Router → AgentService 传入) */
export interface ChatRequest {
  /** 消息列表 (OpenAI 格式) */
  messages: ChatMessage[]
  /** Agent ID */
  agentId: string
  /** 消息来源 */
  source: MemorySource
  /** 会话 ID */
  sessionId: string
  /** 是否语音模式 */
  isVoiceMode?: boolean
  /** 额外变量覆盖 (由调用方注入) */
  extraVars?: Record<string, string>
}

/** 聊天消息 (OpenAI 格式兼容) */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | MultimodalContent[]
  name?: string
  tool_call_id?: string
}

/** 多模态内容块 */
export interface MultimodalContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

// ─────────────────────────────────────────────
// Phase 1: Ingress (纯数据提取, 无副作用)
// ─────────────────────────────────────────────

/** Ingress 输出 */
export interface IngressResult {
  /** 提取的用户文本 */
  userText: string
  /** 是否包含多模态内容 */
  isMultimodal: boolean
  /** 原始消息列表 */
  rawMessages: ChatMessage[]
  /** 图片/文件附件 URL */
  attachments?: string[]
  /** 消息来源 */
  source?: string
}

// ─────────────────────────────────────────────
// Phase 2: Enrichment (并行注入上下文)
// ─────────────────────────────────────────────

/** 单个 Enricher 的接口 */
export interface Enricher {
  readonly name: string
  enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>>
}

/** Enricher 输入 */
export interface EnrichmentInput {
  userText: string
  agentId: string
  source: MemorySource
  sessionId: string
}

/** Enrichment 输出 (所有 Enricher 结果合并) */
export interface EnrichedContext {
  // ── 历史 ──
  /** 桌面历史 (XML 压扁) */
  flattenedDesktopHistory: string
  /** 群聊历史 (XML 压扁) */
  flattenedGroupHistory: string

  // ── 记忆 ──
  /** RAG 检索结果 (格式化文本) */
  memoryContext: string
  /** 图谱闪回碎片 */
  graphContext: string
  /** 周报 */
  weeklyReportContext: string

  // ── 状态 ──
  /** 当前时间 */
  currentTime: string
  /** Agent 心情 */
  mood: string
  /** 活力 */
  vibe: string
  /** 内心活动 */
  mind: string
  /** 主人名 */
  ownerName: string
  /** 用户画像 */
  userPersona: string

  // ── 能力 ──
  /** 是否启用视觉 */
  enableVision: boolean
  /** 是否启用语音 */
  enableVoice: boolean
}

// ─────────────────────────────────────────────
// Phase 3: Prompt Assembly
// ─────────────────────────────────────────────

/** PromptAssembly 输出 */
export interface AssembledPrompt {
  /** 组装好的消息列表 (可直接送 LLM) */
  messages: ChatMessage[]
  /** 可用的工具定义 (用于 ReAct) */
  tools?: ToolDefinition[]
}

/** 工具定义 (OpenAI function calling 格式) */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// ─────────────────────────────────────────────
// Phase 4: ReAct Loop (在 reactLoop.ts 中定义)
// ─────────────────────────────────────────────

// ReAct Loop 的输出就是 LLM 的回复文本 + 工具调用记录

// ─────────────────────────────────────────────
// Phase 5: Egress (后处理 + 持久化)
// ─────────────────────────────────────────────

/** Egress 输入 */
export interface EgressInput {
  /** LLM 原始回复 */
  rawReply: string
  /** 工具调用历史 */
  toolCalls: ToolCallRecord[]
  /** 请求上下文 */
  request: ChatRequest
}

/** 工具调用记录 */
export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result: string
  durationMs: number
}

/** Egress 输出 */
export interface EgressResult {
  /** 清洗后的回复文本 (给用户看) */
  reply: string
  /** TTS 用的文本 (可能更短) */
  ttsText: string
  /** 保存的对话日志 ID */
  logPairId: string | null
}
