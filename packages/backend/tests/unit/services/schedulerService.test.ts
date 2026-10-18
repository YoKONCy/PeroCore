import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDrizzleConnection,
  closeDrizzleConnection,
  type DrizzleDb,
} from '@infos/backend/database'
import { scheduledTasks } from '@infos/backend/database/schema'
import { SchedulerService } from '@infos/backend/services/scheduler/schedulerService'
import { ProactiveWorkRepository } from '@infos/backend/repositories/proactiveWork.repo'
import { eq } from 'drizzle-orm'
import {
  setSchedulerService,
  setReminderTool,
  cancelReminderTool,
} from '@infos/backend/tools/scheduler'

let db: DrizzleDb
const context = {
  agentId: 'nana',
  threadId: 'thread-nana',
  channel: 'desktop',
  source: 'desktop',
  sessionId: 'thread-nana',
}
const future = () => new Date(Date.now() + 120_000).toISOString()
function setup() {
  const gateway = {
    broadcast: vi.fn().mockResolvedValue(undefined),
    pushNotification: vi.fn().mockResolvedValue(undefined),
  }
  const dispatch = vi.fn().mockImplementation(async (input) => ({ id: input.idempotencyKey }))
  const validate = vi.fn().mockResolvedValue(undefined)
  const service = new SchedulerService(db, gateway as never, undefined, validate)
  service.setTaskDispatcher(dispatch)
  return { service, gateway, dispatch, validate }
}
function row(id: number) {
  return db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  db = createDrizzleConnection(':memory:')
})
afterEach(() => {
  closeDrizzleConnection(db)
  setSchedulerService(null)
  vi.useRealTimers()
})

describe('持久跟进与建议', () => {
  it('采纳派发失败会恢复待处理状态，允许用户重试或忽略', async () => {
    const { service, dispatch } = setup()
    const item = await service.suggest({
      agentId: 'nana',
      threadId: 'thread-nana',
      title: '整理',
      instruction: '整理报告',
      reason: '新报告已生成',
    })
    dispatch.mockRejectedValueOnce(new Error('任务服务不可用'))
    await expect(service.acceptSuggestion(item.id, 'nana')).rejects.toThrow(
      expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
    )
    expect((await service.listSuggestions('nana'))[0]!.status).toBe('open')
    expect((await service.acceptSuggestion(item.id, 'nana')).status).toBe('accepted')
  })
  it('检查所有角色的到期计划，通知成功之后才结算', async () => {
    const { service, gateway } = setup()
    const item = await service.create({ agentId: 'nana', time: future(), content: '喝水' })
    vi.advanceTimersByTime(120_001)
    await service.dispatchDueTasks()
    expect(gateway.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'nana',
        body: '喝水',
        notificationId: `schedule:${item.id}`,
      }),
    )
    expect(row(item.id)).toMatchObject({ status: 'completed', isTriggered: true, attempts: 1 })
    await service.dispatchDueTasks()
    expect(gateway.pushNotification).toHaveBeenCalledTimes(1)
  })

  it('派发失败保持可重试，退避后成功不丢失计划', async () => {
    const { service, gateway } = setup()
    gateway.pushNotification.mockRejectedValueOnce(new Error('连接中断'))
    const item = await service.create({ time: future(), content: '检查通知' })
    vi.advanceTimersByTime(120_001)
    await service.dispatchDueTasks()
    expect(row(item.id)).toMatchObject({
      status: 'pending',
      isTriggered: false,
      attempts: 1,
      lastError: '连接中断',
    })
    await service.dispatchDueTasks()
    expect(gateway.pushNotification).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date(row(item.id).nextAttemptAt!))
    await service.dispatchDueTasks()
    expect(row(item.id)).toMatchObject({ status: 'completed', attempts: 2, lastError: null })
  })

  it('三次失败后停止自动派发，用户可重试', async () => {
    const { service, gateway } = setup()
    gateway.pushNotification.mockRejectedValue(new Error('服务不可用'))
    const item = await service.create({ agentId: 'nana', time: future(), content: '提醒' })
    vi.advanceTimersByTime(120_001)
    for (let attempt = 0; attempt < 3; attempt++) {
      await service.dispatchDueTasks()
      const next = row(item.id).nextAttemptAt
      if (next) vi.setSystemTime(new Date(next))
    }
    await service.dispatchDueTasks()
    expect(row(item.id).status).toBe('failed')
    expect(gateway.pushNotification).toHaveBeenCalledTimes(3)
    expect(await service.retry(item.id, 'pero')).toBe(false)
    expect(await service.retry(item.id, 'nana')).toBe(true)
    expect(row(item.id)).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('领取期间不重复派发；进程重启后租约过期可接管', async () => {
    const { service, dispatch } = setup()
    const item = await service.create({
      type: 'agent_task',
      agentId: 'nana',
      time: future(),
      content: '检查结果',
    })
    vi.advanceTimersByTime(120_001)
    const repo = new ProactiveWorkRepository(db)
    const [claimed] = repo.claimDue(new Date().toISOString())
    expect(claimed!.status).toBe('dispatching')
    await service.dispatchDueTasks()
    expect(dispatch).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(Date.parse(claimed!.leaseUntil!) + 1))
    const recovered = setup()
    await recovered.service.dispatchDueTasks()
    expect(recovered.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'nana', idempotencyKey: `schedule:${item.id}` }),
    )
    expect(row(item.id)).toMatchObject({ status: 'dispatched', attempts: 2 })
    expect(repo.settle(claimed!, '过期领取者')).toBeUndefined()
  })

  it('跟进绑定来源并以受限能力派发，数量限制不可通过取消绕过每日上限', async () => {
    const { service, dispatch, validate } = setup()
    const create = () =>
      service.create({
        type: 'follow_up',
        agentId: 'nana',
        threadId: 'thread-nana',
        reason: '等构建结束',
        content: '读取构建结果',
        time: future(),
      })
    const items = await Promise.all(Array.from({ length: 5 }, create))
    await expect(create()).rejects.toThrow(expect.objectContaining({ code: 'INVALID_PARAMETER' }))
    expect(validate).toHaveBeenCalledWith('nana', 'thread-nana')
    vi.advanceTimersByTime(120_001)
    await service.dispatchDueTasks()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          capabilityScope: 'follow_up',
          originThreadId: 'thread-nana',
        }),
      }),
    )
    for (let index = 5; index < 20; index++) {
      const item = await create()
      await service.cancel(item.id, 'nana')
    }
    await expect(create()).rejects.toThrow(expect.objectContaining({ code: 'INVALID_PARAMETER' }))
    expect(items).toHaveLength(5)
  })

  it('建议先保存，只有采纳才派发；重复采纳使用同一去重键', async () => {
    const { service, dispatch } = setup()
    const item = await service.suggest({
      agentId: 'nana',
      threadId: 'thread-nana',
      title: '整理结果',
      instruction: '整理刚生成的报告',
      reason: '观察到报告已生成',
    })
    expect(dispatch).not.toHaveBeenCalled()
    await expect(service.acceptSuggestion(item.id, 'pero')).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    const accepted = await service.acceptSuggestion(item.id, 'nana')
    expect(accepted.status).toBe('accepted')
    await service.acceptSuggestion(item.id, 'nana')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'user', idempotencyKey: `suggestion:${item.id}` }),
    )
  })

  it('忽略不派发，重复建议去重，未完成的采纳在扫描时恢复', async () => {
    const { service, dispatch } = setup()
    const input = {
      agentId: 'nana',
      threadId: 'thread-nana',
      title: '检查报告',
      instruction: '检查报告',
      reason: '已有报告',
    }
    const item = await service.suggest(input)
    expect((await service.suggest(input)).id).toBe(item.id)
    await service.dismissSuggestion(item.id, 'nana')
    await expect(service.acceptSuggestion(item.id, 'nana')).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(dispatch).not.toHaveBeenCalled()
    const another = await service.suggest({ ...input, instruction: '重新检查报告' })
    new ProactiveWorkRepository(db).transitionSuggestion(another.id, 'nana', ['open'], 'accepting')
    await setup().service.dispatchDueTasks()
    expect(new ProactiveWorkRepository(db).suggestion(another.id, 'nana')!.status).toBe('accepted')
  })

  it('提醒工具绑定当前角色，无法取消其他角色或伪造全权限定时任务', async () => {
    const { service } = setup()
    setSchedulerService(service)
    const output = JSON.parse(
      (await setReminderTool.execute({ time: future(), content: '喝水' }, context)) as string,
    )
    expect(row(output.reminder.id).agentId).toBe('nana')
    const wrong = JSON.parse(
      (await cancelReminderTool.execute(
        { id: output.reminder.id },
        { ...context, agentId: 'pero' },
      )) as string,
    )
    expect(wrong.error).toBeTruthy()
    const forged = JSON.parse(
      (await setReminderTool.execute(
        { time: future(), content: '执行', type: 'agent_task' },
        context,
      )) as string,
    )
    expect(forged.error).toBeTruthy()
  })
})
