import type { ConfigRepository } from '../../repositories/config.repo'
import type { ConversationLogService } from '../memory/conversationLog'
import type { MemoryService } from '../memory/memoryService'
import { AppError } from '../../lib/appError'

export type ChatResetAction = 'clear_logs' | 'reset_memories' | 'factory_reset'

interface ChatResetServiceDeps {
  logService: ConversationLogService
  memoryService: MemoryService
  configRepo: ConfigRepository
}

interface ChatResetResult {
  message: string
  data?: Record<string, unknown>
}

export class ChatResetService {
  constructor(private deps: ChatResetServiceDeps) {}

  async reset(action: string, agentId: string): Promise<ChatResetResult> {
    switch (action) {
      case 'clear_logs':
        return this.clearLogs(agentId)
      case 'reset_memories':
        return this.resetMemories(agentId)
      case 'factory_reset':
        return this.factoryReset(agentId)
      default:
        throw new AppError('INVALID_PARAMETER', {
          message: `未知操作: ${action}`,
          data: { field: 'action', expected: 'clear_logs | reset_memories | factory_reset' },
        })
    }
  }

  private async clearLogs(agentId: string): Promise<ChatResetResult> {
    const count = await this.deps.logService.deleteAllSessions(agentId)
    return {
      message: `已删除 ${count} 个会话的对话记录`,
      data: { deletedSessionCount: count },
    }
  }

  private async resetMemories(agentId: string): Promise<ChatResetResult> {
    const deletedCount = await this.deleteAllMemories(agentId)
    return {
      message: `已删除 ${deletedCount} 条记忆`,
      data: { deletedMemoryCount: deletedCount },
    }
  }

  private async factoryReset(agentId: string): Promise<ChatResetResult> {
    const deletedSessionCount = await this.deps.logService.deleteAllSessions(agentId)
    const deletedMemoryCount = await this.deleteAllMemories(agentId)
    const deletedConfigCount = await this.deleteAgentConfigs(agentId)

    return {
      message: '恢复出厂设置完成',
      data: {
        deletedSessionCount,
        deletedMemoryCount,
        deletedConfigCount,
      },
    }
  }

  private async deleteAllMemories(agentId: string): Promise<number> {
    const { data: memories } = await this.deps.memoryService.list({
      agentId,
      page: 1,
      pageSize: 100000,
    })

    for (const mem of memories) {
      await this.deps.memoryService.delete(mem.id, agentId)
    }

    return memories.length
  }

  private async deleteAgentConfigs(agentId: string): Promise<number> {
    const configs = await this.deps.configRepo.listAll(`agent.${agentId}`)
    for (const cfg of configs) {
      await this.deps.configRepo.delete(cfg.key)
    }

    return configs.length
  }
}
