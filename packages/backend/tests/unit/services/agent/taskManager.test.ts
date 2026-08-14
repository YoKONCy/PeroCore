import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskManager } from '@infos/backend/services/agent/taskManager'

vi.mock('@infos/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('TaskManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('register 和 unregister', () => {
    it('应当注册任务、广播开始并在注销时广播完成', () => {
      const manager = new TaskManager(1000)
      const broadcaster = vi.fn().mockResolvedValue(undefined)
      manager.setBroadcaster(broadcaster)

      manager.register('session-1', 'pero')
      manager.updateTurn('session-1', 3)
      manager.unregister('session-1')

      expect(manager.activeCount).toBe(0)
      expect(broadcaster).toHaveBeenNthCalledWith(1, {
        sessionId: 'session-1',
        turn: 0,
        state: 'running',
        message: '任务已开始',
      })
      expect(broadcaster).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-1',
        turn: 3,
        state: 'completed',
        message: '任务完成',
      })
    })

    it('重复注册同一会话应当清理旧任务并只保留新任务', () => {
      const manager = new TaskManager(1000)

      manager.register('session-1', 'pero')
      manager.pause('session-1')
      manager.register('session-1', 'nana')

      expect(manager.activeCount).toBe(1)
      expect(manager.getTaskInfo('session-1')).toMatchObject({
        sessionId: 'session-1',
        state: 'running',
        agentId: 'nana',
      })
    })
  })

  describe('任务状态操作', () => {
    it('pause、resume、inject 和 cancel 应当更新任务状态', () => {
      const manager = new TaskManager(1000)
      const broadcaster = vi.fn().mockResolvedValue(undefined)
      manager.setBroadcaster(broadcaster)
      manager.register('session-1', 'pero')

      const paused = manager.pause('session-1')
      const injected = manager.inject('session-1', '请优先总结')
      const instruction = manager.getInjectedInstruction('session-1')
      const instructionAfterRead = manager.getInjectedInstruction('session-1')
      const resumed = manager.resume('session-1')
      const cancelled = manager.cancel('session-1')

      expect(paused).toBe(true)
      expect(injected).toBe(true)
      expect(instruction).toBe('请优先总结')
      expect(instructionAfterRead).toBeNull()
      expect(resumed).toBe(true)
      expect(cancelled).toBe(true)
      expect(manager.isCancelled('session-1')).toBe(true)
      expect(manager.getTaskInfo('session-1')).toMatchObject({ state: 'cancelled' })
      expect(broadcaster).toHaveBeenLastCalledWith({
        sessionId: 'session-1',
        turn: 0,
        state: 'cancelled',
        message: '任务已取消',
      })
    })

    it('不存在的任务操作应当返回 false 或空值', () => {
      const manager = new TaskManager(1000)

      expect(manager.pause('missing')).toBe(false)
      expect(manager.resume('missing')).toBe(false)
      expect(manager.inject('missing', '指令')).toBe(false)
      expect(manager.cancel('missing')).toBe(false)
      expect(manager.isCancelled('missing')).toBe(false)
      expect(manager.getInjectedInstruction('missing')).toBeNull()
      expect(manager.getTaskInfo('missing')).toBeNull()
    })

    it('listActiveTasks 应当返回 running、paused 和 cancelled 状态', () => {
      const manager = new TaskManager(1000)
      manager.register('running-session', 'pero')
      manager.register('paused-session', 'nana')
      manager.register('cancelled-session', 'mika')
      manager.pause('paused-session')
      manager.cancel('cancelled-session')
      manager.updateTurn('running-session', 2)

      const tasks = manager.listActiveTasks()

      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'running-session',
            state: 'running',
            currentTurn: 2,
          }),
          expect.objectContaining({ sessionId: 'paused-session', state: 'paused' }),
          expect.objectContaining({ sessionId: 'cancelled-session', state: 'cancelled' }),
        ]),
      )
    })
  })

  describe('暂停与超时', () => {
    it('checkPause 应当等待恢复后继续执行并广播暂停与恢复', async () => {
      const manager = new TaskManager(10_000)
      const broadcaster = vi.fn().mockResolvedValue(undefined)
      manager.setBroadcaster(broadcaster)
      manager.register('session-1')
      manager.pause('session-1')

      const promise = manager.checkPause('session-1')
      await vi.advanceTimersByTimeAsync(500)
      manager.resume('session-1')
      await vi.advanceTimersByTimeAsync(500)
      await promise

      expect(broadcaster).toHaveBeenCalledWith({
        sessionId: 'session-1',
        turn: 0,
        state: 'paused',
        message: '任务已暂停',
      })
      expect(broadcaster).toHaveBeenCalledWith({
        sessionId: 'session-1',
        turn: 0,
        state: 'running',
        message: '任务已恢复',
      })
    })

    it('任务超时时应当标记取消并广播 error 状态', async () => {
      const manager = new TaskManager(100)
      const broadcaster = vi.fn().mockResolvedValue(undefined)
      manager.setBroadcaster(broadcaster)
      manager.register('session-1')

      await vi.advanceTimersByTimeAsync(100)

      expect(manager.isCancelled('session-1')).toBe(true)
      expect(broadcaster).toHaveBeenLastCalledWith({
        sessionId: 'session-1',
        turn: 0,
        state: 'error',
        message: '任务超时 (0.1s)',
      })
    })
  })
})
