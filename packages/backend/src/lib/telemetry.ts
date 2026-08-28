/**
 * telemetry — 通用基础设施
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import type { ChatMessage, ChatOptions, UsageInfo } from '../services/llm/types'
import type { ModelConfig } from '../services/llm/llmService'
import { getRequestContext } from './requestContext'
import { createLogger } from './logger'

const logger = createLogger('Telemetry')
const tracerName = '@infos/backend'
let provider: NodeTracerProvider | null = null

/** 初始化 OpenTelemetry。未配置导出器时仍创建本地 Span，便于上下文传播与测试。 */
export function initTelemetry(): void {
  if (provider || process.env.OTEL_SDK_DISABLED === 'true') return

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const spanProcessors = endpoint
    ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: normalizeTraceEndpoint(endpoint) }))]
    : process.env.INFOS_OTEL_CONSOLE === 'true'
      ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
      : []

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'infos-backend',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? 'development',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    spanProcessors,
  })
  provider.register()
  logger.info(
    endpoint
      ? `OpenTelemetry 已启用，导出到 ${normalizeTraceEndpoint(endpoint)}`
      : 'OpenTelemetry 已启用（仅上下文传播，未配置导出器）',
  )
}

/** 关闭 Telemetry Provider，确保批量 Span 在进程退出前完成导出。 */
export async function shutdownTelemetry(): Promise<void> {
  const current = provider
  provider = null
  if (current) await current.shutdown()
}

export function getTracer() {
  return trace.getTracer(tracerName)
}

/** 从 HTTP 请求头提取 W3C Trace Context。 */
export function extractTraceContext(headers: Headers) {
  const carrier: Record<string, string> = {}
  headers.forEach((value, key) => {
    carrier[key] = value
  })
  return propagation.extract(context.active(), carrier)
}

/** 为 LLM 调用创建结构化 Span，并记录真实 Provider usage。 */
export function startLlmSpan(input: {
  config: ModelConfig
  messages: ChatMessage[]
  options: ChatOptions
  streaming: boolean
}): Span {
  const request = getRequestContext()
  const attributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.system': input.config.provider,
    'gen_ai.request.model': input.config.modelId,
    'gen_ai.request.streaming': input.streaming,
    'gen_ai.request.message.count': input.messages.length,
    'gen_ai.request.input.characters': countMessageCharacters(input.messages),
    'gen_ai.request.tool.count': input.options.tools?.length ?? 0,
    'gen_ai.request.max_tokens': input.options.maxTokens ?? 0,
    'infos.llm.message.roles': input.messages.map((message) => message.role).join(','),
  }
  if (request?.agentId) attributes['infos.agent.id'] = request.agentId
  if (request?.sessionId) attributes['infos.session.id'] = request.sessionId
  if (request?.source) attributes['infos.channel'] = request.source
  if (process.env.INFOS_OTEL_CAPTURE_LLM_CONTENT === 'true') {
    attributes['gen_ai.input.messages'] = truncate(JSON.stringify(input.messages), 16_000)
  }
  return getTracer().startSpan(`gen_ai.chat ${input.config.modelId}`, {
    kind: SpanKind.CLIENT,
    attributes,
  })
}

/** 完成 LLM Span；usage 必须来自供应商真实响应，不进行估算。 */
export function finishLlmSpan(
  span: Span,
  input: {
    usage?: UsageInfo
    finishReason?: string | null
    output?: string
    error?: unknown
    retries?: number
    firstTokenMs?: number
  },
): void {
  if (input.usage) {
    span.setAttributes({
      'gen_ai.usage.input_tokens': input.usage.promptTokens,
      'gen_ai.usage.output_tokens': input.usage.completionTokens,
      'gen_ai.usage.total_tokens': input.usage.totalTokens,
    })
  }
  if (input.finishReason) span.setAttribute('gen_ai.response.finish_reasons', input.finishReason)
  if (input.retries !== undefined) span.setAttribute('infos.llm.retry.count', input.retries)
  if (input.firstTokenMs !== undefined)
    span.setAttribute('gen_ai.response.time_to_first_token_ms', input.firstTokenMs)
  if (input.output !== undefined) {
    span.setAttribute('gen_ai.response.output.characters', input.output.length)
    if (process.env.INFOS_OTEL_CAPTURE_LLM_CONTENT === 'true') {
      span.setAttribute('gen_ai.output.messages', truncate(input.output, 16_000))
    }
  }
  if (input.error) {
    span.recordException(
      input.error instanceof Error ? input.error : new Error(String(input.error)),
    )
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(input.error) })
  } else {
    span.setStatus({ code: SpanStatusCode.OK })
  }
  span.end()
}

function countMessageCharacters(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    if (typeof message.content === 'string') return total + message.content.length
    if (!message.content) return total
    return (
      total +
      message.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)
    )
  }, 0)
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

function normalizeTraceEndpoint(endpoint: string): string {
  const normalized = endpoint.replace(/\/$/, '')
  return normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`
}
