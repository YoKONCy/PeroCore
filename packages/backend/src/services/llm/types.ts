/**
 * LLM 类型定义
 *
 * 统一的消息格式和 Provider 接口。
 * 所有 Provider 的输出统一转换为 OpenAI 格式。
 *
 * @module packages/backend/src/services/llm/types
 */

// ─────────────────────────────────────────────
// 消息类型 (以 OpenAI 格式为基准)
// ─────────────────────────────────────────────

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  name?: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

/** 多模态内容部分 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }

/** 工具调用 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** 工具定义 (OpenAI function calling 格式) */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// ─────────────────────────────────────────────
// 调用选项
// ─────────────────────────────────────────────

/** 模型推理强度；undefined 表示完全不向 Provider 传参。 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ChatOptions {
  /** 温度 (0-2) */
  temperature?: number
  /** Top P (0-1) */
  topP?: number
  /** 最大生成 Token 数 */
  maxTokens?: number
  /** 模型推理强度 */
  reasoningEffort?: ReasoningEffort
  /** 工具定义列表 */
  tools?: ToolDefinition[]
  /** 响应格式 (如 json_object) */
  responseFormat?: Record<string, unknown>
  /** 请求超时 (毫秒) */
  timeout?: number
  /** 工具选择策略 */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  /** 停止序列 */
  stop?: string[]
  /** 取消在飞请求的信号 */
  signal?: AbortSignal
}

// ─────────────────────────────────────────────
// 返回类型
// ─────────────────────────────────────────────

/** Token 使用量 */
export interface UsageInfo {
  /** 输入 Token 数 */
  promptTokens: number
  /** 输出 Token 数 */
  completionTokens: number
  /** 总 Token 数 */
  totalTokens: number
}

/** 非流式完整回复 */
export interface ChatCompletion {
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      toolCalls?: ToolCall[]
    }
    finishReason?: string
  }>
  /** Token 用量 */
  usage?: UsageInfo
}

/** 流式增量中的工具调用片段 */
export interface StreamToolCallDelta {
  /** 数组索引 (用于匹配同一工具调用的多个增量) */
  index: number
  /** 调用 ID (仅首次出现时有值) */
  id?: string
  /** 类型 (仅首次出现时有值) */
  type?: 'function'
  /** 函数增量 */
  function?: {
    name?: string
    arguments?: string
  }
}

/** 流式增量 */
export interface ChatDelta {
  choices: Array<{
    delta: {
      role?: string
      content?: string
      toolCalls?: StreamToolCallDelta[]
    }
    finishReason?: string | null
  }>
  /** Token 用量 (部分 Provider 在最后一个 chunk 中包含) */
  usage?: UsageInfo
}

// ─────────────────────────────────────────────
// Provider 接口
// ─────────────────────────────────────────────

/** LLM Provider 接口 */
export interface LlmProvider {
  /** 非流式调用 */
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatCompletion>
  /** 流式调用 */
  chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatDelta>
  /** 列出可用模型 */
  listModels(): Promise<string[]>
}

/** Provider 基础配置 */
export interface ProviderConfig {
  /** API Key */
  apiKey: string
  /** API 基址 */
  apiBase: string
  /** 模型 ID */
  modelId: string
  /** 最大 Token 数 (Anthropic 必填) */
  maxTokens?: number
}
