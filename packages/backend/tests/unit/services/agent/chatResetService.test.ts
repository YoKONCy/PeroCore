import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatResetService } from '@perocore/backend/services/agent/chatResetService'
import type { AppError } from '@perocore/backend/lib/appError'

type LogServiceMock = {
  deleteAllSessions: ReturnType<typeof vi.fn>
}

type MemoryServiceMock = {
  list: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

type ConfigRepositoryMock = {
  listAll: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

describe('ChatResetService', () => {
  let logService: LogServiceMock
  let memoryService: MemoryServiceMock
  let configRepo: ConfigRepositoryMock
  let service: ChatResetService

  beforeEach(() => {
    logService = {
      deleteAllSessions: vi.fn(),
    }
    memoryService = {
      list: vi.fn(),
      delete: vi.fn(),
    }
    configRepo = {
      listAll: vi.fn(),
      delete: vi.fn(),
    }
    service = new ChatResetService({
      logService: logService as never,
      memoryService: memoryService as never,
      configRepo: configRepo as never,
    })
  })

  describe('reset', () => {
    it('clear_logs 应当只删除指定 Agent 的会话日志', async () => {
      logService.deleteAllSessions.mockResolvedValue(3)

      const result = await service.reset('clear_logs', 'pero')

      expect(logService.deleteAllSessions).toHaveBeenCalledWith('pero')
      expect(memoryService.delete).not.toHaveBeenCalled()
      expect(configRepo.delete).not.toHaveBeenCalled()
      expect(result).toEqual({
        message: '已删除 3 个会话的对话记录',
        data: { deletedSessionCount: 3 },
      })
    })

    it('reset_memories 应当逐条删除指定 Agent 的全部记忆', async () => {
      memoryService.list.mockResolvedValue({
        data: [{ id: 1 }, { id: 2 }],
        total: 2,
      })
      memoryService.delete.mockResolvedValue(undefined)

      const result = await service.reset('reset_memories', 'nana')

      expect(memoryService.list).toHaveBeenCalledWith({
        agentId: 'nana',
        page: 1,
        pageSize: 100000,
      })
      expect(memoryService.delete).toHaveBeenNthCalledWith(1, 1, 'nana')
      expect(memoryService.delete).toHaveBeenNthCalledWith(2, 2, 'nana')
      expect(result).toEqual({
        message: '已删除 2 条记忆',
        data: { deletedMemoryCount: 2 },
      })
    })

    it('factory_reset 应当删除日志、记忆和 Agent 配置', async () => {
      logService.deleteAllSessions.mockResolvedValue(1)
      memoryService.list.mockResolvedValue({ data: [{ id: 9 }], total: 1 })
      memoryService.delete.mockResolvedValue(undefined)
      configRepo.listAll.mockResolvedValue([
        { key: 'agent.pero.mode' },
        { key: 'agent.pero.voice' },
      ])
      configRepo.delete.mockResolvedValue(undefined)

      const result = await service.reset('factory_reset', 'pero')

      expect(logService.deleteAllSessions).toHaveBeenCalledWith('pero')
      expect(memoryService.delete).toHaveBeenCalledWith(9, 'pero')
      expect(configRepo.listAll).toHaveBeenCalledWith('agent.pero')
      expect(configRepo.delete).toHaveBeenNthCalledWith(1, 'agent.pero.mode')
      expect(configRepo.delete).toHaveBeenNthCalledWith(2, 'agent.pero.voice')
      expect(result).toEqual({
        message: '恢复出厂设置完成',
        data: {
          deletedSessionCount: 1,
          deletedMemoryCount: 1,
          deletedConfigCount: 2,
        },
      })
    })

    it('未知 action 应当抛出参数错误', async () => {
      await expect(service.reset('unknown', 'pero')).rejects.toMatchObject({
        code: 'INVALID_PARAMETER',
        message: '未知操作: unknown',
        data: { field: 'action', expected: 'clear_logs | reset_memories | factory_reset' },
      } satisfies Partial<AppError>)
      expect(logService.deleteAllSessions).not.toHaveBeenCalled()
      expect(memoryService.delete).not.toHaveBeenCalled()
      expect(configRepo.delete).not.toHaveBeenCalled()
    })
  })
})
