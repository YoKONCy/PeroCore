import type { FlowStateRepository } from '../../repositories/flowState.repo'
import type { ThreadService } from '../thread/threadService'
import { AppError } from '../../lib/appError'

export interface FlowStateInfo {
  threadId: string
  agentId: string
  currentGoal: string
  privateFacts: string
  revision: number
  updatedAt: string | null
}

/** Thread × Agent 私有临时记忆领域服务。 */
export class FlowStateService {
  constructor(
    private readonly repo: FlowStateRepository,
    private readonly threadService: ThreadService,
  ) {}

  async get(threadId: string, agentId: string): Promise<FlowStateInfo> {
    await this.assertScope(threadId, agentId)
    const row = await this.repo.get(threadId, agentId)
    return row ? this.toInfo(row) : this.empty(threadId, agentId)
  }

  async listByThread(threadId: string): Promise<FlowStateInfo[]> {
    const thread = await this.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: '会话不存在' })
    return (await this.repo.listByThread(threadId)).map((row) => this.toInfo(row))
  }

  async update(input: {
    threadId: string
    agentId: string
    currentGoal?: string
    privateFacts?: string
    pairId?: string | null
  }): Promise<FlowStateInfo> {
    await this.assertScope(input.threadId, input.agentId)
    if (input.currentGoal === undefined && input.privateFacts === undefined) {
      throw new AppError('INVALID_PARAMETER', { message: '至少需要更新当前目标或私有事实之一' })
    }
    const before = await this.repo.get(input.threadId, input.agentId)
    const currentGoal = this.normalize(input.currentGoal ?? before?.currentGoal ?? '')
    const privateFacts = this.normalize(input.privateFacts ?? before?.privateFacts ?? '')
    const row = await this.repo.save({ ...input, currentGoal, privateFacts })
    return this.toInfo(row)
  }

  async clear(threadId: string, agentId: string): Promise<FlowStateInfo> {
    await this.assertScope(threadId, agentId)
    return this.toInfo(await this.repo.clear(threadId, agentId))
  }

  async rollbackPairs(threadId: string, pairIds: string[]): Promise<void> {
    await this.repo.rollbackPairs(threadId, pairIds)
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.repo.deleteThread(threadId)
  }

  formatForPrompt(state: FlowStateInfo): string {
    const goal = state.currentGoal || '暂无明确的持续目标。'
    const facts = state.privateFacts || '暂无需要私下持续记住的事实。'
    return `<Flow_State>\n<Current_Goal>\n${goal}\n</Current_Goal>\n<Private_Facts>\n${facts}\n</Private_Facts>\n</Flow_State>`
  }

  private async assertScope(threadId: string, agentId: string): Promise<void> {
    const thread = await this.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: '会话不存在' })
    // 普通单 Agent Thread 必须匹配归属；群聊允许参与 Agent 分别维护独立心流。
    if (thread.channel !== 'group' && thread.agentId !== agentId) {
      throw new AppError('FORBIDDEN', { message: '不能访问其他 Agent 的会话心流' })
    }
  }

  private normalize(value: string): string {
    return value.trim().slice(0, 8000)
  }

  private empty(threadId: string, agentId: string): FlowStateInfo {
    return { threadId, agentId, currentGoal: '', privateFacts: '', revision: 0, updatedAt: null }
  }

  private toInfo(row: {
    threadId: string
    agentId: string
    currentGoal: string
    privateFacts: string
    revision: number
    updatedAt: string
  }): FlowStateInfo {
    return { ...row }
  }
}
