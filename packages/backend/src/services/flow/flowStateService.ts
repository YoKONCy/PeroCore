/**
 * flowStateService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import type { FlowStateRepository } from '../../repositories/flowState.repo'
import type { ThreadService } from '../thread/threadService'
import { AppError } from '../../lib/appError'
import type { ConfigRepository } from '../../repositories/config.repo'
import { loadMemoryRuntimeConfig } from '../memory/memoryRuntimeConfig'

export interface FlowStateInfo {
  threadId: string
  agentId: string
  currentGoal: string
  privateFacts: string
  workContext: string
  /** 按生命周期从旧到新排列，供模型窗口不足时逐轮裁剪。 */
  workContextSegments: string[]
  workContextRemainingPairs: number
  revision: number
  updatedAt: string | null
}

export interface AutomaticWorkContextItem {
  sourceKey: string
  content: string
}

interface StoredAutomaticWorkContext {
  version: 1
  items: AutomaticWorkContextItem[]
}

/** Thread × Agent 私有临时记忆领域服务。 */
export class FlowStateService {
  constructor(
    private readonly repo: FlowStateRepository,
    private readonly threadService: ThreadService,
    private readonly configRepo: Pick<ConfigRepository, 'get'>,
  ) {}

  async get(threadId: string, agentId: string): Promise<FlowStateInfo> {
    await this.assertScope(threadId, agentId)
    const row = await this.repo.get(threadId, agentId)
    return row ? await this.toInfo(row) : this.empty(threadId, agentId)
  }

  async listByThread(threadId: string): Promise<FlowStateInfo[]> {
    const thread = await this.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: '会话不存在' })
    return Promise.all((await this.repo.listByThread(threadId)).map((row) => this.toInfo(row)))
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

  /** Agent 手动压缩全部工作上下文，并从当前对话轮重新计时。 */
  async updateWorkContext(input: {
    threadId: string
    agentId: string
    content: string
    pairId?: string | null
  }): Promise<FlowStateInfo> {
    await this.assertScope(input.threadId, input.agentId)
    const before = await this.repo.get(input.threadId, input.agentId)
    const thread = await this.threadService.getThread(input.threadId)
    await this.repo.clearWorkContextEntries(input.threadId, input.agentId)
    const row = await this.repo.save({
      threadId: input.threadId,
      agentId: input.agentId,
      pairId: input.pairId,
      currentGoal: before?.currentGoal ?? '',
      privateFacts: before?.privateFacts ?? '',
      workContext: this.normalize(input.content),
      workContextUpdatedAtPairCount: (thread?.pairCount ?? 0) + (input.pairId ? 1 : 0),
    })
    return this.toInfo(row)
  }

  /** 将一个完整 ReAct 对话轮的过程文本自动追加到工作上下文。 */
  async appendAutomaticWorkContext(input: {
    threadId: string
    agentId: string
    pairId: string
    content?: string
    items?: AutomaticWorkContextItem[]
  }): Promise<void> {
    await this.assertScope(input.threadId, input.agentId)
    const items = (input.items ?? [])
      .map((item) => ({
        sourceKey: item.sourceKey.trim().toLocaleLowerCase(),
        content: this.normalize(item.content),
      }))
      .filter((item) => item.sourceKey && item.content)
    const legacyContent = this.normalize(input.content ?? '')
    if (!items.length && !legacyContent) return
    const content = items.length
      ? JSON.stringify({ version: 1, items } satisfies StoredAutomaticWorkContext)
      : legacyContent
    const thread = await this.threadService.getThread(input.threadId)
    const before = await this.repo.get(input.threadId, input.agentId)
    if (!before) {
      await this.repo.save({
        threadId: input.threadId,
        agentId: input.agentId,
        currentGoal: '',
        privateFacts: '',
      })
    }
    await this.repo.appendWorkContextEntry({
      threadId: input.threadId,
      agentId: input.agentId,
      pairId: input.pairId,
      pairCount: thread?.pairCount ?? 0,
      content,
    })
  }

  async clearWorkContext(
    threadId: string,
    agentId: string,
    pairId?: string | null,
  ): Promise<FlowStateInfo> {
    await this.repo.clearWorkContextEntries(threadId, agentId)
    return this.updateWorkContext({ threadId, agentId, pairId, content: '' })
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

  async getRealm(realmId: string, sessionId: string, agentId: string): Promise<FlowStateInfo> {
    const key = this.realmKey(realmId, sessionId)
    const row = await this.repo.get(key, agentId)
    return row ? this.toInfoWithoutExpiration(row) : this.empty(key, agentId)
  }

  async updateRealm(input: {
    realmId: string
    sessionId: string
    agentId: string
    currentGoal?: string
    privateFacts?: string
  }): Promise<FlowStateInfo> {
    const threadId = this.realmKey(input.realmId, input.sessionId)
    if (input.currentGoal === undefined && input.privateFacts === undefined) {
      throw new AppError('INVALID_PARAMETER', { message: '至少需要更新当前目标或私有事实之一' })
    }
    const before = await this.repo.get(threadId, input.agentId)
    return this.toInfoWithoutExpiration(
      await this.repo.save({
        threadId,
        agentId: input.agentId,
        currentGoal: this.normalize(input.currentGoal ?? before?.currentGoal ?? ''),
        privateFacts: this.normalize(input.privateFacts ?? before?.privateFacts ?? ''),
      }),
    )
  }

  formatForPrompt(state: FlowStateInfo): string {
    const goal = state.currentGoal || '暂无明确的持续目标。'
    const facts = state.privateFacts || '暂无需要私下持续记住的事实。'
    return `<Flow_State>\n<Current_Goal>\n${goal}\n</Current_Goal>\n<Private_Facts>\n${facts}\n</Private_Facts>\n</Flow_State>`
  }

  formatWorkContextForPrompt(state: FlowStateInfo): string {
    return state.workContext || '暂无工作上下文。'
  }

  private async assertScope(threadId: string, agentId: string): Promise<void> {
    const thread = await this.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: '会话不存在' })
    // 普通单 Agent Thread 必须匹配归属；群聊允许参与 Agent 分别维护独立心流。
    if (thread.channel !== 'group' && thread.agentId !== agentId) {
      throw new AppError('FORBIDDEN', { message: '不能访问其他 Agent 的会话心流' })
    }
  }

  private realmKey(realmId: string, sessionId: string): string {
    if (!realmId.trim() || !sessionId.trim()) {
      throw new AppError('INVALID_PARAMETER', { message: 'Realm与Session标识不能为空' })
    }
    return `realm:${realmId}:${sessionId}`
  }

  private normalize(value: string): string {
    return value.trim().slice(0, 8000)
  }

  private empty(threadId: string, agentId: string): FlowStateInfo {
    return {
      threadId,
      agentId,
      currentGoal: '',
      privateFacts: '',
      workContext: '',
      workContextSegments: [],
      workContextRemainingPairs: 0,
      revision: 0,
      updatedAt: null,
    }
  }

  private toInfoWithoutExpiration(row: Parameters<FlowStateService['toInfo']>[0]): FlowStateInfo {
    return {
      ...row,
      workContextSegments: row.workContext ? [row.workContext] : [],
      workContextRemainingPairs: 0,
    }
  }

  private deduplicateAutomaticEntries(
    entries: Array<{ content: string }>,
  ): string[] {
    const seen = new Set<string>()
    const retained: string[][] = []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const parsed = this.parseAutomaticEntry(entries[index]!.content)
      const items: string[] = []
      for (let itemIndex = parsed.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = parsed[itemIndex]!
        if (item.sourceKey && seen.has(item.sourceKey)) continue
        if (item.sourceKey) seen.add(item.sourceKey)
        items.unshift(item.content)
      }
      if (items.length) retained.unshift(items)
    }
    return retained.flat()
  }

  private parseAutomaticEntry(content: string): AutomaticWorkContextItem[] {
    try {
      const parsed = JSON.parse(content) as Partial<StoredAutomaticWorkContext>
      if (parsed.version === 1 && Array.isArray(parsed.items)) {
        return parsed.items
          .filter(
            (item): item is AutomaticWorkContextItem =>
              typeof item?.sourceKey === 'string' && typeof item?.content === 'string',
          )
          .map((item) => ({
            sourceKey: item.sourceKey.trim().toLocaleLowerCase(),
            content: item.content.trim(),
          }))
          .filter((item) => item.content)
      }
    } catch {
      // 旧版本逐轮纯文本没有来源键，继续按原有顺序保留。
    }
    const normalized = content.trim()
    return normalized ? [{ sourceKey: '', content: normalized }] : []
  }

  private async toInfo(row: {
    threadId: string
    agentId: string
    currentGoal: string
    privateFacts: string
    workContext: string
    workContextUpdatedAtPairCount: number
    revision: number
    updatedAt: string
  }): Promise<FlowStateInfo> {
    const thread = await this.threadService.getThread(row.threadId)
    const expiration = (await loadMemoryRuntimeConfig(this.configRepo)).workContextExpirationPairs
    const currentPairCount = thread?.pairCount ?? 0
    const minimumPairCount = Math.max(0, currentPairCount - expiration)
    await this.repo.deleteExpiredWorkContextEntries(row.threadId, row.agentId, minimumPairCount)
    const entries = await this.repo.listWorkContextEntries(
      row.threadId,
      row.agentId,
      minimumPairCount,
    )
    const summaryElapsed = Math.max(0, currentPairCount - row.workContextUpdatedAtPairCount)
    const summaryRemaining = Math.max(0, expiration - summaryElapsed)
    let summary = row.workContext
    let currentRow = row
    if (summary && summaryRemaining === 0) {
      currentRow = await this.repo.save({
        threadId: row.threadId,
        agentId: row.agentId,
        currentGoal: row.currentGoal,
        privateFacts: row.privateFacts,
        workContext: '',
        workContextUpdatedAtPairCount: 0,
      })
      summary = ''
    }
    const automatic = this.deduplicateAutomaticEntries(entries)
    const workContextSegments = [summary, ...automatic].filter(Boolean)
    const workContext = workContextSegments.join('\n\n')
    const automaticRemaining = entries.length
      ? Math.max(0, expiration - (currentPairCount - entries[entries.length - 1]!.pairCount))
      : 0
    return {
      ...currentRow,
      workContext,
      workContextSegments,
      workContextRemainingPairs: workContext
        ? Math.max(summary ? summaryRemaining : 0, automaticRemaining)
        : 0,
    }
  }
}
