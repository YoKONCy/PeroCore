import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * 单次请求的链路上下文。
 *
 * 这里保存的是“当前异步调用链”内需要自动随日志携带的字段，
 * 例如 requestId、traceId、agentId、sessionId 等。业务层无需手动把这些字段逐层传参，
 * logger 在格式化日志时会从 AsyncLocalStorage 中读取当前上下文。
 */
export interface RequestContext {
  /** 请求唯一标识；优先来自 x-request-id，没有则由后端生成 */
  requestId: string
  /** W3C traceparent 中解析出的 traceId，用于未来接入 OpenTelemetry 时对齐链路 */
  traceId?: string
  /** 当前请求关联的 Agent ID；可由业务层在进入具体会话后补充 */
  agentId?: string
  /** 当前请求关联的会话 ID；可由业务层在进入具体会话后补充 */
  sessionId?: string
  /** 当前请求来源，例如 desktop、web、social 等 */
  source?: string
}

/** 请求上下文存储；Node 会按异步调用链隔离不同请求的数据 */
const storage = new AsyncLocalStorage<RequestContext>()

/** 生成后端自有 requestId，统一带 req_ 前缀便于日志检索 */
export function createRequestId(): string {
  return `req_${randomUUID()}`
}

/** 在指定请求上下文中执行回调，回调内部及其后续异步链路都能读取该上下文 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback)
}

/** 获取当前异步调用链绑定的请求上下文 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/** 获取当前请求的 requestId；没有处于请求链路中时返回 undefined */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId
}

/** 在当前请求上下文中补充业务字段，例如 agentId、sessionId 或 source */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const context = storage.getStore()
  if (!context) return
  Object.assign(context, patch)
}
