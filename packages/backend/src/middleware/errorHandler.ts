import { t as __t } from '../lib/i18n'
/**
 * 全局错误处理中间件
 *
 * 将 AppError 转为标准信封响应，未知异常兜底为 500。
 * 技术细节入日志，不泄露堆栈。
 *
 * @module packages/backend/src/middleware/errorHandler
 */

import type { ErrorHandler } from 'hono'
import { SERVER_ERROR_CODES, CODE_MESSAGES } from '@infos/shared'
import { AppError } from '../lib/appError'
import { createLogger } from '../lib/logger'
import { translateDiagnostic, normalizeLocale, getLocale } from '@infos/shared/i18n'

const logger = createLogger('ErrorHandler')

/**
 * Hono 全局错误处理中间件
 * - AppError: 按 code 映射 HTTP 状态码，返回标准信封
 * - 未知异常: 500 + INTERNAL_ERROR，打日志不泄露堆栈
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const language = c.req.header('Accept-Language')
    ? normalizeLocale(c.req.header('Accept-Language'))
    : getLocale()
  if (err instanceof AppError) {
    return c.json(
      {
        code: err.code,
        message: translateDiagnostic(err.message, language),
        data: err.data,
      },
      err.httpStatus as 400,
    )
  }

  // 未知异常 → 500 + INTERNAL_ERROR
  logger.error(__t('logs.middleware', '未捕获异常'), {
    error: err.message,
    stack: err.stack,
  })

  const fallbackCode = SERVER_ERROR_CODES.INTERNAL_ERROR
  return c.json(
    {
      code: fallbackCode,
      message: translateDiagnostic(CODE_MESSAGES[fallbackCode], language),
    },
    500,
  )
}
