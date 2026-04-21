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

/** WS 消息信封 (类 JSON-RPC) */
export interface GatewayEnvelope {
  /** 消息 ID (UUID) */
  id: string
  /** 消息类型 */
  type: GatewayMessageType
  /** 发送方 ID */
  sourceId: string
  /** 目标 ID ("broadcast" = 广播) */
  targetId: string
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
  // ── 请求/响应 ──
  | 'request'
  | 'response'
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
  | 'stream_delta' // 流式增量
  | 'stream_end' // 流式结束
  | 'agent_changed' // Agent 切换
  | 'tool_status' // 工具执行状态
  | 'task_progress' // 任务进度
  | 'notification' // 通知
  | 'system_error' // 系统错误
  | 'audio_chunk' // TTS 音频推送

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
): GatewayEnvelope {
  return {
    id: crypto.randomUUID(),
    type,
    sourceId: 'backend',
    targetId,
    timestamp: Date.now(),
    payload,
  }
}
