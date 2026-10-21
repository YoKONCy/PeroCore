/**
 * 请求日志中间件
 *
 * 记录方法、路径、状态码和耗时，
 * 仅在异常或超过分类阈值时打 warn，详见 .docs/S03_LOGGING_SPEC.md。
 *
 * @module packages/backend/src/middleware/requestLogger
 */

import type { MiddlewareHandler } from 'hono'
import { createLogger } from '../lib/logger'
import { t } from '../lib/i18n'

const logger = createLogger('HTTP')

const SLOW_REQUEST_THRESHOLDS = {
  read: 10_000,
  write: 15_000,
  remote: 60_000,
  file: 120_000,
  generation: 300_000,
  maintenance: 300_000,
  streamSetup: 60_000,
} as const

/** 按实际操作分类；历史记录、配置和状态查询不随整个模块放宽。 */
function getSlowRequestThreshold(method: string, path: string, contentType: string): number {
  // 这里只衡量响应建立耗时，不把 SSE 连接寿命当成请求处理耗时。
  if (contentType.toLowerCase().startsWith('text/event-stream')) {
    return SLOW_REQUEST_THRESHOLDS.streamSetup
  }

  if (method === 'POST') {
    // 等待模型生成、语音推理或多步 Agent 执行。
    if (
      /^\/api\/chat(?:\/stream)?$/.test(path) ||
      /^\/api\/models\/[^/]+\/test$/.test(path) ||
      /^\/api\/voice\/(?:tts|asr)$/.test(path) ||
      /^\/api\/stronghold\/rooms\/[^/]+\/(?:messages|butler-command)$/.test(path) ||
      /^\/api\/tarot\/(?:draw|[^/]+\/interpret)$/.test(path)
    ) {
      return SLOW_REQUEST_THRESHOLDS.generation
    }

    // 批量索引、数据同步与重置可能涉及大量磁盘或网络操作。
    if (
      /^\/api\/maintenance\/(?:trigger|reindex)$/.test(path) ||
      path === '/api/knowledge/reindex' ||
      /^\/api\/distributed\/(?:snapshot(?:\/import)?|sync\/[^/]+|rollback)$/.test(path) ||
      /^\/api\/reset\/(?:clear-logs|memories|factory)$/.test(path)
    ) {
      return SLOW_REQUEST_THRESHOLDS.maintenance
    }

    // 远端探测、模型列表和上下文预览允许网络往返、重试与检索等待。
    if (
      path === '/api/models/list-remote' ||
      /^\/api\/models\/providers\/[^/]+\/(?:probe|models)$/.test(path) ||
      path === '/api/distributed/servers/probe' ||
      path === '/api/knowledge/search' ||
      /^\/api\/chat\/threads\/[^/]+\/token-budget-preview$/.test(path) ||
      /^\/api\/mcp\/(?:connect|[^/]+\/reconnect)$/.test(path) ||
      /^\/api\/applications\/(?:arca|pictoria)\/(?:start|stop|shutdown-managed|reconnect)$/.test(
        path,
      )
    ) {
      return SLOW_REQUEST_THRESHOLDS.remote
    }
  }

  if (method === 'GET' && path === '/api/system/weather') {
    return SLOW_REQUEST_THRESHOLDS.remote
  }

  // 只放宽文件内容、上传和转换操作，附件元数据与目录列表仍按普通接口处理。
  if (
    /^\/api\/attachments\/(?:[^/]+\/content|reference-content)$/.test(path) ||
    /^\/html-previews(?:\/|$)/.test(path) ||
    /^\/api\/workspace\/(?:content|read|write|search)$/.test(path) ||
    /^\/api\/assets\/audio\/[^/]+$/.test(path) ||
    path === '/api/system/chat-background/content' ||
    (method === 'PUT' && path === '/api/system/chat-background') ||
    (method === 'POST' &&
      (path === '/api/attachments' ||
        /^\/api\/attachments\/(?:browser-preview|resolve-reference|preview-text|preview-document)$/.test(
          path,
        ) ||
        /^\/api\/attachments\/[^/]+\/retry$/.test(path) ||
        /^\/api\/knowledge\/documents(?:\/(?:upload|[^/]+\/retry))?$/.test(path) ||
        path === '/api/system/storage/sqlite-snapshot'))
  ) {
    return SLOW_REQUEST_THRESHOLDS.file
  }

  return ['GET', 'HEAD', 'OPTIONS'].includes(method)
    ? SLOW_REQUEST_THRESHOLDS.read
    : SLOW_REQUEST_THRESHOLDS.write
}

/** 请求日志中间件 — 记录方法、路径、状态码、耗时 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const requestPath = c.req.path.replace(/\/+$/, '') || '/'
  const path = c.req.path.replace(
    /^\/html-previews\/[^/]+/,
    `/html-previews/[${t('logs.middleware', '预览')}]`,
  )

  await next()

  const elapsed = Date.now() - start
  const status = c.res.status

  const slowThreshold = getSlowRequestThreshold(
    method,
    requestPath,
    c.res.headers.get('content-type') ?? '',
  )
  const message = t('logs.middleware', '{0} {1} → {2} ({3}ms)', [method, path, status, elapsed])

  // 失败请求保留告警；成功请求只有明显超过对应操作阈值时才标黄。
  if (status >= 400 || elapsed > slowThreshold) {
    logger.warn(message)
  } else {
    logger.trace(message)
  }
}
