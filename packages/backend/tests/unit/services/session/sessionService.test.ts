import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionService } from '@perocore/backend/services/session/sessionService'

vi.mock('@perocore/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

type ConfigRepositoryMock = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

type ConversationLogServiceMock = {
  count: ReturnType<typeof vi.fn>
}

describe('SessionService', () => {
  let configRepo: ConfigRepositoryMock
  let logService: ConversationLogServiceMock
  let service: SessionService

  beforeEach(() => {
    configRepo = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    logService = {
      count: vi.fn(),
    }
    service = new SessionService(configRepo as never, logService as never)
  })

  describe('getOrCreateDefault', () => {
    it('应当从配置恢复当前会话和 profile', async () => {
      configRepo.get.mockImplementation(async (key: string) => {
        if (key === 'session.pero.current') return 'chat_001'
        if (key === 'session.pero.profile') return 'lightweight'
        return null
      })

      const result = await service.getOrCreateDefault('pero')

      expect(result).toMatchObject({
        sessionId: 'chat_001',
        agentId: 'pero',
        mode: 'default',
        profile: 'lightweight',
        messageCount: 0,
      })
      expect(service.getCurrentSession('pero')).toBe(result)
    })

    it('已有内存会话时应当直接复用且不重复读取配置', async () => {
      configRepo.get.mockResolvedValue(null)
      const first = await service.getOrCreateDefault('pero')
      configRepo.get.mockClear()

      const second = await service.getOrCreateDefault('pero')

      expect(second).toBe(first)
      expect(configRepo.get).not.toHaveBeenCalled()
    })
  })

  describe('switchProfile', () => {
    it('切入 companion 时应当保存 profile 并启动调度器', async () => {
      const start = vi.fn()
      const stop = vi.fn()
      const notifyActivity = vi.fn()
      service.setCompanionSchedulerFactory(() => ({
        start,
        stop,
        notifyActivity,
        isRunning: false,
      }))

      const result = await service.switchProfile('pero', 'companion')
      service.notifyCompanionActivity('pero')

      expect(configRepo.set).toHaveBeenCalledWith('session.pero.profile', 'companion')
      expect(start).toHaveBeenCalledOnce()
      expect(notifyActivity).toHaveBeenCalledOnce()
      expect(result.profile).toBe('companion')
    })

    it('切出 companion 时应当停止调度器', async () => {
      const stop = vi.fn().mockResolvedValue(undefined)
      service.setCompanionSchedulerFactory(() => ({
        start: vi.fn(),
        stop,
        notifyActivity: vi.fn(),
        isRunning: true,
      }))
      await service.switchProfile('pero', 'companion')

      const result = await service.switchProfile('pero', 'default')

      expect(stop).toHaveBeenCalledOnce()
      expect(result.profile).toBe('default')
    })

    it('切换到 work profile 时应当提示使用工作模式入口', async () => {
      await expect(service.switchProfile('pero', 'work')).rejects.toThrow(
        '请使用 enterWorkMode() 进入工作模式',
      )
    })
  })

  describe('工作模式', () => {
    it('enterWorkMode 应当创建隔离工作会话并持久化切换信息', async () => {
      await service.getOrCreateDefault('pero')

      const result = await service.enterWorkMode('pero', '写测试')

      expect(result).toMatchObject({
        agentId: 'pero',
        mode: 'work',
        profile: 'work',
        taskName: '写测试',
        messageCount: 0,
      })
      expect(result.sessionId).toMatch(/^work_pero_\d{8}/)
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.work_task', '写测试')
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.profile', 'work')
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.prev_profile', 'default')
    })

    it('已经在工作模式时再次进入应当抛出错误', async () => {
      await service.enterWorkMode('pero', '任务 A')

      await expect(service.enterWorkMode('pero', '任务 B')).rejects.toThrow(
        '已在工作模式中，请先退出',
      )
    })

    it('exitWorkMode 应当统计日志并恢复默认会话', async () => {
      configRepo.get.mockImplementation(async (key: string) => {
        if (key === 'session.pero.prev_profile') return 'companion'
        return null
      })
      logService.count.mockResolvedValue(7)
      const workSession = await service.enterWorkMode('pero', '整理资料')

      const result = await service.exitWorkMode('pero')

      expect(logService.count).toHaveBeenCalledWith('pero', workSession.sessionId)
      expect(result).toEqual({ logCount: 7 })
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.current', 'default')
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.profile', 'companion')
      expect(configRepo.delete).toHaveBeenCalledWith('session.pero.work_task')
      expect(configRepo.delete).toHaveBeenCalledWith('session.pero.prev_profile')
      expect(service.getCurrentSession('pero')).toMatchObject({
        sessionId: 'default',
        profile: 'companion',
        mode: 'default',
      })
    })

    it('不在工作模式时退出应当抛出错误', async () => {
      await expect(service.exitWorkMode('pero')).rejects.toThrow('当前不在工作模式')
    })
  })

  describe('会话状态', () => {
    it('incrementMessageCount 应当递增当前会话消息数', async () => {
      await service.getOrCreateDefault('pero')

      service.incrementMessageCount('pero')
      service.incrementMessageCount('pero')

      expect(service.getCurrentSession('pero')?.messageCount).toBe(2)
    })

    it('clearSession 应当创建新的默认聊天会话并持久化', async () => {
      await service.switchProfile('pero', 'lightweight')

      const result = await service.clearSession('pero')

      expect(result).toMatchObject({
        agentId: 'pero',
        mode: 'default',
        profile: 'lightweight',
        messageCount: 0,
      })
      expect(result.sessionId).toMatch(/^chat_\d+$/)
      expect(configRepo.set).toHaveBeenCalledWith('session.pero.current', result.sessionId)
    })

    it('工作模式中清除会话应当抛出错误', async () => {
      await service.enterWorkMode('pero', '任务')

      await expect(service.clearSession('pero')).rejects.toThrow(
        '工作模式中不能清除会话，请先退出工作模式',
      )
    })

    it('getCurrentProfile 应当优先返回内存会话 profile，否则从配置读取', async () => {
      configRepo.get.mockResolvedValue('companion')
      const fromConfig = await service.getCurrentProfile('pero')
      await service.switchProfile('pero', 'lightweight')

      const fromMemory = await service.getCurrentProfile('pero')

      expect(fromConfig).toBe('companion')
      expect(fromMemory).toBe('lightweight')
    })
  })
})
