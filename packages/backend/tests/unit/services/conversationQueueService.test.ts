import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDrizzleConnection,
  closeDrizzleConnection,
  type DrizzleDb,
} from '@infos/backend/database'
import { ConversationQueueRepository } from '@infos/backend/repositories/conversationQueue.repo'
import { ConversationQueueService } from '@infos/backend/services/conversation/conversationQueueService'
import { RuntimeStateService } from '@infos/backend/services/runtime/runtimeStateService'

let db: DrizzleDb
let runtime: RuntimeStateService
let queue: ConversationQueueService
beforeEach(() => {
  vi.useFakeTimers()
  db = createDrizzleConnection(':memory:')
  runtime = new RuntimeStateService()
  queue = new ConversationQueueService(
    new ConversationQueueRepository(db),
    runtime,
    {
      getThread: async () => ({ id: 't', channel: 'desktop', status: 'active', agentId: 'pero' }),
    } as never,
    { findByIds: async () => [] } as never,
    () => false,
  )
  queue.start()
})
afterEach(() => {
  queue.stop()
  for (const task of runtime.listActiveTasks()) runtime.unregisterTask(task.threadId)
  closeDrizzleConnection(db)
  vi.useRealTimers()
})

describe('后台消息队列调度', () => {
  it('前一条持久执行未结算前绝不派发第二条，失败后自动暂停', async () => {
    let finish!: (value: { success: boolean; error: string }) => void
    const runner = vi.fn(
      () =>
        new Promise<{ success: boolean; error: string }>((resolve) => {
          finish = resolve
        }),
    )
    queue.setRunner(runner)
    await queue.enqueue('a', { threadId: 't', content: '第一条' })
    await queue.enqueue('b', { threadId: 't', content: '第二条' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(runner).toHaveBeenCalledOnce()
    expect(queue.snapshot('t').items.find((item) => item.id === 'b')?.state).toBe('queued')
    finish({ success: false, error: '上游请求失败' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(queue.snapshot('t').paused).toBe(true)
    expect(runner).toHaveBeenCalledOnce()
  })

  it('立即提交先落盘再发出模型交接信号，保留工具父信号', async () => {
    runtime.registerTask('t', 'pero')
    const toolSignal = runtime.getAbortSignal('t')!
    await queue.enqueue('a', { threadId: 't', content: '等待' })
    await queue.enqueue('b', { threadId: 't', content: '立即改方向' })
    const item = queue.snapshot('t').items.find((entry) => entry.id === 'b')!
    await queue.change('t', item.id, item.revision, { immediate: true })
    expect(runtime.isHandoffRequested('t')).toBe(true)
    expect(runtime.getModelInterruptSignal('t')!.aborted).toBe(true)
    expect(toolSignal.aborted).toBe(false)
    expect(new ConversationQueueRepository(db).snapshot('t').items[0]).toMatchObject({
      id: 'b',
      immediate: true,
    })
  })

  it('拒绝跨角色与未就绪附件，不能在队列里延迟绕过校验', async () => {
    await expect(
      queue.enqueue('a', { threadId: 't', agentId: 'nana', content: '错误角色' }),
    ).rejects.toThrow('不匹配')
    await expect(
      queue.enqueue('b', { threadId: 't', content: '错误附件', attachmentIds: ['missing'] }),
    ).rejects.toThrow('附件')
    expect(queue.snapshot('t').items).toEqual([])
  })

  it('历史修改期间禁止并发入队、恢复派发和调序，释放后正常接收新分支消息', async () => {
    await queue.enqueue('old', { threadId: 't', content: '旧分支请求' })
    const old = queue.snapshot('t').items[0]!
    const release = queue.beginHistoryChange('t')
    await expect(
      queue.enqueue('race', { threadId: 't', content: '修改中的竞态请求' }),
    ).rejects.toThrow('历史正在更新')
    expect(() => queue.pause('t', false)).toThrow('历史正在更新')
    expect(() => queue.reorder('t', [{ id: old.id, revision: old.revision }])).toThrow(
      '历史正在更新',
    )
    await expect(queue.change('t', old.id, old.revision, { immediate: true })).rejects.toThrow(
      '历史正在更新',
    )
    queue.historyChanged('t', false, true)
    release()
    await queue.enqueue('new', { threadId: 't', content: '新分支请求' })
    expect(queue.snapshot('t').items.map((item) => item.id)).toEqual(['new'])
  })
})
