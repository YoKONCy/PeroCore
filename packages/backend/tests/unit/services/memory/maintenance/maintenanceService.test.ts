import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MaintenanceService } from '@infos/backend/services/memory/maintenance/maintenanceService'

type SchedulerMock = {
  isStarted: boolean
  getStatus: ReturnType<typeof vi.fn>
}

type MemoryServiceMock = {
  list: ReturnType<typeof vi.fn>
}

type VectorSyncRepoMock = {
  getPending: ReturnType<typeof vi.fn>
}

describe('MaintenanceService', () => {
  let scheduler: SchedulerMock
  let memoryService: MemoryServiceMock
  let vectorSyncRepo: VectorSyncRepoMock
  let service: MaintenanceService

  beforeEach(() => {
    scheduler = {
      isStarted: true,
      getStatus: vi.fn(),
    }
    memoryService = {
      list: vi.fn(),
    }
    vectorSyncRepo = {
      getPending: vi.fn(),
    }
    service = new MaintenanceService({
      scheduler: scheduler as never,
      memoryService: memoryService as never,
      vectorSyncRepo: vectorSyncRepo as never,
    })
  })

  describe('getStatus', () => {
    it('应当只返回维护任务并汇总记忆和同步状态', async () => {
      scheduler.getStatus.mockReturnValue([
        {
          name: 'memory-scorer',
          running: false,
          lastFinishedAt: 1710000000000,
          intervalMs: 30_000,
          stats: { ok: true },
        },
        {
          name: 'daily-diary',
          running: true,
          lastFinishedAt: 1710003600000,
          intervalMs: 120_000,
          stats: { count: 2 },
        },
        {
          name: 'chat-cleanup',
          running: false,
          lastFinishedAt: 1710007200000,
          intervalMs: 7200_000,
          stats: {},
        },
      ])
      memoryService.list.mockResolvedValue({ data: [], total: 42 })
      vectorSyncRepo.getPending.mockResolvedValue([{ id: 1 }, { id: 2 }])

      const result = await service.getStatus()

      expect(result.schedulerRunning).toBe(true)
      expect(result.tasks).toEqual([
        {
          name: 'memory-scorer',
          running: false,
          lastRunAt: new Date(1710000000000).toISOString(),
          intervalDesc: '30秒',
          stats: { ok: true },
        },
        {
          name: 'daily-diary',
          running: true,
          lastRunAt: new Date(1710003600000).toISOString(),
          intervalDesc: '2分钟',
          stats: { count: 2 },
        },
      ])
      expect(result.memory).toEqual({
        totalMemories: 42,
        pendingSyncCount: 2,
      })
    })

    it('依赖查询失败时应当返回 0 作为降级值', async () => {
      scheduler.getStatus.mockReturnValue([
        {
          name: 'reflection-worker',
          running: false,
          lastFinishedAt: 1710000000000,
          intervalMs: 3600_000,
          stats: null,
        },
      ])
      memoryService.list.mockRejectedValue(new Error('db failed'))
      vectorSyncRepo.getPending.mockRejectedValue(new Error('sync failed'))

      const result = await service.getStatus()

      expect(result.tasks[0]?.intervalDesc).toBe('1.0小时')
      expect(result.memory).toEqual({
        totalMemories: 0,
        pendingSyncCount: 0,
      })
    })
  })

  describe('getReindexStatus', () => {
    it('应当返回指定 Agent 和当前待同步数量', async () => {
      vectorSyncRepo.getPending.mockResolvedValue([{ id: 10 }])

      const result = await service.getReindexStatus('pero')

      expect(vectorSyncRepo.getPending).toHaveBeenCalledWith(1)
      expect(result).toEqual({
        agentId: 'pero',
        pendingCount: 1,
      })
    })
  })
})
