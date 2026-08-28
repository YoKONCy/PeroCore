/**
 * 核心类型定义（AIOS 版）
 *
 * AIOS: 旧版 5 阶段管道（Ingress → Enrichment → PromptAssembly → Egress）
 * 已由 ContextCompiler + ThreadService 替代，相关 Phase 类型
 * （ChatRequest/IngressResult/Enricher/EnrichedContext/AssembledPrompt/
 *   EgressInput/EgressResult）已移除，完整内容见 types.ts.bak。
 *
 * 本文件仅保留被 agentService / reactLoop / toolRegistry / mcpToolBridge
 * 等活跃模块引用的核心类型。
 *
 * @module packages/backend/src/services/pipeline/types
 */

import type { ContentPart } from '../llm/types'
import type { ToolDisplayMeta } from '@infos/shared'

// ─────────────────────────────────────────────
// 消息与工具类型（活跃）
// ─────────────────────────────────────────────

/** 聊天消息 (OpenAI 格式兼容) */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  name?: string
  /** 工具结果消息 (role:'tool') 关联的调用 ID，与 LLM 层 camelCase 命名保持一致 */
  toolCallId?: string
  /** assistant 消息发起的工具调用列表，必须与 assistant 消息一起下发，否则后续 tool 消息会成为孤儿 */
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** 推理模型的原生 reasoning_content，回传多轮上下文时必须保留。 */
  reasoningContent?: string
  nativeReasoning?: import('../llm/types').NativeReasoningPayload[]
}

/**
 * 多模态内容块 (判别联合)
 *
 * 定义为判别联合而非松散 interface，使其可直接赋值给 LLM 层的 ContentPart，
 * 避免 image_url 块在传递过程中因类型不匹配而被静默丢弃。
 */
export type MultimodalContent =
  | { type: 'text'; text: string }
  /** detail 控制图片清晰度档位 (low/high/auto)，截图统一用 low 以省 token */
  | { type: 'image_url'; image_url: { url: string; detail?: string } }

/** 工具定义 (OpenAI function calling 格式) */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 工具显示元数据（前端 ReAct 轨迹区渲染用，可选） */
  display?: ToolDisplayMeta
  /** 工具自身声明每次调用前需要审批。 */
  requiresApproval?: boolean
}

/** 工具调用记录 */
export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result: string
  durationMs: number
  isError: boolean
  callId: string
}
