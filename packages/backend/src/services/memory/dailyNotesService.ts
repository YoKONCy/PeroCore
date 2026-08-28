import { existsSync, readFileSync } from 'node:fs'
import type { EventNote } from '@infos/shared'
import type { PathResolver } from '../../core/pathResolver'
import type { EventMemoryService } from './eventMemoryService'
import type { EventNoteRepository } from '../../repositories/eventNote.repo'
import type { ThreadRepository } from '../../repositories/thread.repo'
import type { AgentManager } from '../agent/agentManager'
import type { LocalWorkspaceService } from '../workspace/workspaceService'
import type { LlmService, ModelConfig } from '../llm/llmService'
import { tokenCounter } from '../tokenizer/tokenCounter'

const RETRY_MINUTES = [10, 30, 60] as const

export class DailyNotesService {
  constructor(
    private eventMemory: EventMemoryService,
    private agentManager: AgentManager,
    private workspace: LocalWorkspaceService,
    private pathResolver: PathResolver,
    private llm: LlmService,
    private getModelConfig: (agentId: string) => Promise<ModelConfig | null>,
    private repo: EventNoteRepository,
    private threads?: Pick<ThreadRepository, 'findMessagesByPairIds'>,
    private collectApplicationSummaries?: (agentId: string, date: string) => Promise<string[]>,
    private now: () => Date = () => new Date(),
  ) {}

  setApplicationSummaryCollector(
    collector: (agentId: string, date: string) => Promise<string[]>,
  ): void {
    this.collectApplicationSummaries = collector
  }

  async generate(agentId: string, date: string, sourceIncomplete = false): Promise<string[]> {
    await this.repo.ensureDailyNoteTask({
      id: `daily-note:${agentId}:${date}`,
      agentId,
      date,
      sourceIncomplete,
    })
    const task = await this.repo.dailyNoteTask(agentId, date)
    if (!task || task.status === 'completed') return task?.writtenFiles ?? []
    if (task.status === 'exhausted') return []
    const now = this.now()
    if (task.nextAttemptAt && task.nextAttemptAt > now.toISOString()) return []

    try {
      const notes = (
        await this.eventMemory.query({
          agentId,
          mode: 'time_range',
          includeArchived: true,
          limit: 10_000,
        })
      )
        .filter((note) => this.localDate(new Date(note.eventAt)) === date)
        .sort((a, b) => a.eventAt.localeCompare(b.eventAt))
      const reviewedInteractions = await this.reviewedInteractions(agentId, date)
      const applicationSummaries = this.collectApplicationSummaries
        ? await this.collectApplicationSummaries(agentId, date)
        : []
      const chunks = this.chunk(notes, reviewedInteractions, applicationSummaries, 20_000)
      const written: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        const content = await this.render(
          agentId,
          date,
          chunk.notes,
          chunk.reviewedInteractions,
          chunk.applicationSummaries,
        )
        const fileName = chunks.length === 1 ? `${date}.md` : `${date}-part-${index + 1}.md`
        await this.workspace.write(agentId, `dailynotes/${fileName}`, content, 'desktop')
        written.push(fileName)
      }
      await this.repo.completeDailyNoteTask(task.id, written)
      return written
    } catch (error) {
      const retryMinutes = RETRY_MINUTES[task.attempts]
      const nextAttemptAt =
        retryMinutes === undefined
          ? null
          : new Date(now.getTime() + retryMinutes * 60_000).toISOString()
      await this.repo.failDailyNoteTask(task.id, String(error), nextAttemptAt)
      throw error
    }
  }

  private async render(
    agentId: string,
    date: string,
    notes: EventNote[],
    reviewedInteractions: string[],
    applicationSummaries: string[],
  ): Promise<string> {
    const config = await this.getModelConfig(agentId)
    if (!config) throw new Error('日记生成模型未配置')
    const profile = this.agentManager.getAgent(agentId)
    const promptPath =
      profile?.promptPath ?? this.pathResolver.resolve(`@data/agents/${agentId}/system_prompt.md`)
    const persona = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : ''
    const diary = await this.llm.chatText(
      config,
      [
        {
          role: 'system',
          content: `你是${agentId}。以下是你的人格设定：\n${persona}\n请严格以第一人称和该人格写当天日记。只能根据事件记忆，不得写系统状态、任务错误或技术审计信息。输出Markdown正文，不要代码围栏。`,
        },
        {
          role: 'user',
          content: `日期：${date}\n事件记忆：\n${JSON.stringify(notes)}\n已审阅但未形成事件的互动：\n${JSON.stringify(reviewedInteractions)}\nApplication当日摘要：\n${JSON.stringify(applicationSummaries)}`,
        },
      ],
      { temperature: 0.6, maxTokens: 3000 },
    )
    return `# ${date}\n\n${diary.trim()}\n`
  }

  private async reviewedInteractions(agentId: string, date: string): Promise<string[]> {
    if (!this.threads) return []
    const coverages = (await this.repo.reviewedNoEventCoverages(agentId))
      .filter((coverage) => this.localDate(new Date(coverage.coveredAt)) === date)
      .sort((a, b) => a.coveredAt.localeCompare(b.coveredAt))
    const interactions: string[] = []
    for (const coverage of coverages) {
      const messages = await this.threads.findMessagesByPairIds(coverage.threadId, coverage.pairIds)
      const content = messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
        .trim()
      if (content) interactions.push(content)
    }
    return interactions
  }

  private chunk(
    notes: EventNote[],
    reviewedInteractions: string[],
    applicationSummaries: string[],
    tokenLimit: number,
  ): Array<{
    notes: EventNote[]
    reviewedInteractions: string[]
    applicationSummaries: string[]
  }> {
    const sources = [
      ...notes.map((note) => ({
        kind: 'note' as const,
        value: note,
        tokens: tokenCounter.countTokens(JSON.stringify(note)),
      })),
      ...reviewedInteractions.map((value) => ({
        kind: 'reviewed' as const,
        value,
        tokens: tokenCounter.countTokens(value),
      })),
      ...applicationSummaries.map((value) => ({
        kind: 'application' as const,
        value,
        tokens: tokenCounter.countTokens(value),
      })),
    ]
    if (!sources.length) return []
    const chunks: Array<{
      notes: EventNote[]
      reviewedInteractions: string[]
      applicationSummaries: string[]
    }> = []
    let current = {
      notes: [] as EventNote[],
      reviewedInteractions: [] as string[],
      applicationSummaries: [] as string[],
    }
    let tokens = 0
    for (const source of sources) {
      if (tokens && tokens + source.tokens > tokenLimit) {
        chunks.push(current)
        current = { notes: [], reviewedInteractions: [], applicationSummaries: [] }
        tokens = 0
      }
      if (source.kind === 'note') current.notes.push(source.value)
      else if (source.kind === 'reviewed') current.reviewedInteractions.push(source.value)
      else current.applicationSummaries.push(source.value)
      tokens += source.tokens
    }
    chunks.push(current)
    return chunks
  }

  private localDate(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
}
