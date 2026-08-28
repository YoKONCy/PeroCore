/**
 * Gateway 协议类型
 *
 * 定义前后端 WebSocket 通信的消息格式。
 * 使用 JSON-RPC 格式。
 *
 * @module packages/backend/src/services/gateway/types
 */

// ─────────────────────────────────────────────
// 信封 (Envelope)
// ─────────────────────────────────────────────

import type { DeliveryAudience, KernelEventDurability } from '@infos/shared'

/** WS 消息信封 (类 JSON-RPC) */
export interface GatewayEnvelope {
  protocolVersion: 1
  /** 消息 ID (UUID) */
  id: string
  /** 消息类型 */
  type: GatewayMessageType
  /** 发送方 ID */
  sourceId: string
  /** 目标 ID；业务投递范围由 audience 决定。 */
  targetId: string
  audience?: DeliveryAudience
  durability?: KernelEventDurability
  streamId?: string
  sequence?: number
  /** 时间戳 (ms) */
  timestamp: number
  /** 负载 */
  payload: Record<string, unknown>
}

/** 消息类型 */
export type GatewayMessageType =
  // ── 握手 ──
  | 'hello'
  | 'hello_ack'
  // ── 心跳 ──
  | 'heartbeat'
  | 'heartbeat_ack'
  | 'ping'
  // ── 请求/响应 ──
  | 'request'
  | 'response'
  // ── 控制 ──
  | 'abort'
  // ── 推送 (广播) ──
  | 'push'
  // ── 错误 ──
  | 'error'

// ─────────────────────────────────────────────
// 预定义 Action (payload.action)
// ─────────────────────────────────────────────

/** Push 推送的 action 名 */
export type PushAction =
  | 'state_update' // PetState 更新
  | 'text_response' // LLM 文本响应
  | 'surface' // Internal Surface 帧
  | 'agent_changed' // Agent 切换
  | 'task_progress' // 任务进度
  | 'notification' // 通知
  | 'system_error' // 系统错误

/** Request 请求的 action 名 */
export type RequestAction =
  | 'chat' // 发起对话
  | 'chat_stream' // 发起流式对话
  | 'stop_generation' // 停止生成
  | 'switch_agent' // 切换 Agent
  | 'inject_instruction' // 注入即时指令
  | 'tts_speak' // TTS 语音合成
  | 'asr_recognize' // ASR 语音识别

// ─────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────

/** 创建信封工厂 */
export function createEnvelope(
  type: GatewayMessageType,
  payload: Record<string, unknown> = {},
  targetId = 'broadcast',
  delivery?: {
    audience?: DeliveryAudience
    durability?: KernelEventDurability
    streamId?: string
  },
): GatewayEnvelope {
  return {
    protocolVersion: 1,
    id: crypto.randomUUID(),
    type,
    sourceId: 'backend',
    targetId,
    audience: delivery?.audience,
    durability: delivery?.durability,
    streamId: delivery?.streamId,
    timestamp: Date.now(),
    payload,
  }
}
