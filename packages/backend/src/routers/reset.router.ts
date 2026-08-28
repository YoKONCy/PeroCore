/**
 * Reset Router — 危险区域重置 API
 *
 * 三个端点均要求调用方提交确认短语，防止误触：
 * - POST /api/reset/clear-logs      确认短语：清空记录
 * - POST /api/reset/memories        确认短语：忘掉一切
 * - POST /api/reset/factory         确认短语：我们还会再见的
 *
 * 端点均为物理删除且不可撤销，执行成功后前端应刷新页面。
 *
 * @module packages/backend/src/routers/reset.router
 */

import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'

/** 各操作的确认短语（与前端提示保持一致） */
const CONFIRM_PHRASES = {
  'clear-logs': '清空记录',
  memories: '忘掉一切',
  factory: '我们还会再见的',
} as const

const confirmSchema = z.object({
  confirm: z.string().min(1, '请填写确认短语'),
})

export function createResetRouter(ctx: AppContext) {
  const router = new Hono()

  router.post('/clear-logs', zValidator('json', confirmSchema), async (c) => {
    const { confirm } = c.req.valid('json')
    if (confirm.trim() !== CONFIRM_PHRASES['clear-logs']) {
      throw new AppError('INVALID_PARAMETER', { message: '确认短语不匹配，操作已取消' })
    }
    const result = await ctx.resetService.clearLogs()
    return c.json({ code: 'OK', message: '对话记录已清空', data: result })
  })

  router.post('/memories', zValidator('json', confirmSchema), async (c) => {
    const { confirm } = c.req.valid('json')
    if (confirm.trim() !== CONFIRM_PHRASES.memories) {
      throw new AppError('INVALID_PARAMETER', { message: '确认短语不匹配，操作已取消' })
    }
    const result = await ctx.resetService.resetMemories()
    return c.json({ code: 'OK', message: '记忆已重置', data: result })
  })

  router.post('/factory', zValidator('json', confirmSchema), async (c) => {
    const { confirm } = c.req.valid('json')
    if (confirm.trim() !== CONFIRM_PHRASES.factory) {
      throw new AppError('INVALID_PARAMETER', { message: '确认短语不匹配，操作已取消' })
    }
    const result = await ctx.resetService.factoryReset()
    return c.json({ code: 'OK', message: '已恢复出厂设置', data: result })
  })

  return router
}
