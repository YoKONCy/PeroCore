/**
 * surface.router — HTTP 路由适配层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

const inputSchema = z.object({
  surfaceId: z.string().min(1),
  nodeId: z.string().min(1),
  generation: z.string().min(1),
  seat: z
    .object({
      seatId: z.string().min(1),
      sessionId: z.string().min(1),
      windowId: z.string().min(1),
      epoch: z.number().int().positive(),
    })
    .optional(),
  action: z.enum(['approval.resolve', 'agent-input.resolve', 'background-task.submit-input']),
  payload: z.record(z.unknown()),
})

/** Internal Surface 的统一用户输入入口。 */
export function createSurfaceRouter(ctx: AppContext) {
  const router = new Hono()

  router.post('/input', zValidator('json', inputSchema), async (c) => {
    const input = c.req.valid('json')
    if (
      (input.action === 'approval.resolve' || input.action === 'agent-input.resolve') &&
      ctx.nodeRegistry.listSessions().some((session) => session.carrier === 'websocket')
    ) {
      if (!input.seat) {
        throw new AppError('VALIDATION_ERROR', { message: '当前操作需要有效 Input Seat' })
      }
      const principalId = String(input.payload.principalId ?? input.payload.agentId ?? 'pero')
      ctx.nodeRegistry.validateInputSeat({
        seatId: input.seat.seatId as import('@infos/shared').KernelInputSeatId,
        sessionId: input.seat.sessionId as import('@infos/shared').KernelNodeSessionId,
        principalId,
        windowId: input.seat.windowId,
        epoch: input.seat.epoch,
        capability: input.action === 'approval.resolve' ? 'approval' : 'input',
      })
    }
    if (input.action === 'approval.resolve') {
      const approvalId = String(input.payload.approvalId ?? '')
      const request = ctx.approvalService.get(approvalId)
      if (!request) throw new AppError('NOT_FOUND', { message: '审批请求不存在' })
      const expectedSurfaceId = request.taskId
        ? `background-task:${request.taskId}`
        : `conversation:${request.threadId}:${request.sessionId}`
      if (
        input.surfaceId !== expectedSurfaceId &&
        input.surfaceId !== `conversation-approval:${approvalId}` &&
        !input.surfaceId.startsWith('conversation-message:')
      ) {
        throw new AppError('VALIDATION_ERROR', { message: '审批 Surface 身份不匹配' })
      }
      const expectedGeneration = request.taskId
        ? (await ctx.backgroundTaskProjection.getSnapshot(request.taskId)).surfaces[0]?.generation
        : `conversation-approval:${approvalId}`
      if (input.generation !== expectedGeneration) {
        throw new AppError('VALIDATION_ERROR', { message: '审批 Surface 已过期，请刷新后重试' })
      }
      const decision = input.payload.decision
      if (!['allow_once', 'allow_session', 'deny_once'].includes(String(decision))) {
        throw new AppError('VALIDATION_ERROR', { message: '审批决定无效' })
      }
      const resolved = ctx.approvalService.resolve(
        approvalId,
        decision as 'allow_once' | 'allow_session' | 'deny_once',
        typeof input.payload.message === 'string' ? input.payload.message : undefined,
      )
      if (!resolved.taskId) ctx.conversationProjection.invalidate(resolved.threadId)
      const projection = resolved.taskId
        ? await ctx.backgroundTaskProjection.getSnapshot(resolved.taskId)
        : await ctx.conversationProjection.getSnapshot(resolved.threadId)
      return c.json({ code: 'OK', data: { projection } })
    }

    if (input.action === 'agent-input.resolve') {
      const inputId = String(input.payload.inputId ?? '')
      const request = ctx.agentInputService.get(inputId)
      if (!request) throw new AppError('NOT_FOUND', { message: '求助请求不存在' })
      const expectedSurfaceId = request.taskId
        ? `background-task:${request.taskId}`
        : `conversation-input:${inputId}`
      const expectedGeneration = request.taskId
        ? (await ctx.backgroundTaskProjection.getSnapshot(request.taskId)).surfaces[0]?.generation
        : `conversation-input:${inputId}`
      if (input.surfaceId !== expectedSurfaceId || input.generation !== expectedGeneration) {
        throw new AppError('VALIDATION_ERROR', { message: '求助 Surface 版本已失效，请刷新后重试' })
      }
      const resolved = ctx.agentInputService.resolve(inputId, {
        skipped: input.payload.skipped === true,
        selectedOptionIds: Array.isArray(input.payload.selectedOptionIds)
          ? input.payload.selectedOptionIds.map(String)
          : [],
        message: typeof input.payload.message === 'string' ? input.payload.message : undefined,
      })
      ctx.conversationProjection.invalidate(resolved.threadId)
      const projection = resolved.taskId
        ? await ctx.backgroundTaskProjection.getSnapshot(resolved.taskId)
        : await ctx.conversationProjection.getSnapshot(resolved.threadId)
      return c.json({ code: 'OK', data: { projection } })
    }

    const taskId = String(input.payload.taskId ?? '')
    const current = await ctx.backgroundTaskProjection.getSnapshot(taskId)
    if (
      input.surfaceId !== `background-task:${taskId}` ||
      input.generation !== current.surfaces[0]?.generation
    ) {
      throw new AppError('VALIDATION_ERROR', { message: '任务 Surface 已过期，请刷新后重试' })
    }
    const decision = input.payload.decision
    if (!['allow_once', 'allow_session', 'deny_once'].includes(String(decision))) {
      throw new AppError('VALIDATION_ERROR', { message: '任务输入决定无效' })
    }
    await ctx.backgroundTaskService.submitInput(taskId, {
      decision: decision as 'allow_once' | 'allow_session' | 'deny_once',
      message: typeof input.payload.message === 'string' ? input.payload.message : undefined,
    })
    const projection = await ctx.backgroundTaskProjection.getSnapshot(taskId)
    return c.json({ code: 'OK', data: { projection } })
  })

  return router
}
