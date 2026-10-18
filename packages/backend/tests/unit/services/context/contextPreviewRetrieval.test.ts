import { describe, expect, it, vi } from 'vitest'
import { ContextCompiler } from '@infos/backend/services/context/contextCompiler'
import { ToolRegistry } from '@infos/backend/services/agent/toolRegistry'
import { isToolAllowedInInteractionMode } from '@infos/backend/tools/interactionMode'

function fixture(
  channel: 'desktop' | 'group',
  mode: 'chat' | 'work' = 'chat',
  disabledTools: string[] = [],
) {
  const workingPairs = vi.fn().mockResolvedValue([])
  const automaticRag = vi.fn().mockResolvedValue([])
  const registry = new ToolRegistry()
  const renderSlots = vi.fn((_slots: unknown, _vars: Record<string, unknown>) => [
    { role: 'system', content: '本地提示词' },
  ])
  const planGet = vi.fn().mockReturnValue({ id: 'plan', revision: 1, title: '当前计划', steps: [] })
  const compiler = new ContextCompiler(
    {
      getThread: vi.fn().mockResolvedValue({
        id: 'thread-test',
        agentId: 'test',
        channel,
        interactionMode: mode,
        disabledTools,
        contextPolicy: JSON.stringify({
          enableStateInjection: false,
          enableToolDescriptions: false,
          enableContinuity: false,
        }),
      }),
      getActiveMessagePairs: vi.fn().mockResolvedValue([
        {
          id: 'message-test',
          pairId: 'pair-test',
          role: 'user',
          content: '历史问题',
          revision: 1,
          metadataJson: '{}',
        },
      ]),
      getWorkingMessagePairs: workingPairs,
    } as never,
    { getAgent: vi.fn().mockReturnValue(undefined) } as never,
    { get: vi.fn().mockResolvedValue(null) } as never,
    { buildDefaultSlots: () => [], renderSlots } as never,
    {
      resolve: () => ({
        allowedTools: new Set(['update_plan']),
        promptFragments: [],
        skillMenuText: '',
      }),
      isToolAllowedInMode: (name: string, interactionMode: 'chat' | 'work') =>
        isToolAllowedInInteractionMode(name, interactionMode, registry),
    } as never,
    { get: vi.fn().mockResolvedValue({ currentGoal: '', privateFacts: '' }) } as never,
  )
  compiler.setEventMemoryService({ automaticRag } as never)
  compiler.setTaskPlanService({ get: planGet } as never)
  return { compiler, automaticRag, renderSlots, planGet, workingPairs }
}

describe('预算预览与远程记忆检索隔离', () => {
  it('仅桌面工作模式加载按预算分页的工作历史，聊天与 Realm 保持隔离', async () => {
    const work = fixture('desktop', 'work')
    await work.compiler.compile('thread-test', 'test', {
      disableMemoryRetrieval: true,
      maxInputTokens: 12_000,
    })
    expect(work.workingPairs).toHaveBeenCalledWith('thread-test', 12_000)
    const chat = fixture('desktop', 'chat')
    await chat.compiler.compile('thread-test', 'test', { disableMemoryRetrieval: true })
    expect(chat.workingPairs).not.toHaveBeenCalled()
    const realm = fixture('desktop', 'work')
    await realm.compiler.compile('thread-test', 'test', { realmExecution: true })
    expect(realm.workingPairs).not.toHaveBeenCalled()
  })
  it.each([
    { mode: 'chat' as const, disabled: [], enabled: false },
    { mode: 'work' as const, disabled: ['update_plan'], enabled: false },
    { mode: 'work' as const, disabled: [], enabled: true },
  ])('计划提示词遵守模式与用户开关：$mode / $enabled', async ({ mode, disabled, enabled }) => {
    const { compiler, renderSlots, planGet } = fixture('desktop', mode, disabled)
    await compiler.compile('thread-test', 'test', { disableMemoryRetrieval: true })
    expect(renderSlots.mock.calls[0]?.[1].task_plan_enabled).toBe(enabled)
    if (enabled) {
      expect(planGet).toHaveBeenCalledOnce()
      expect(renderSlots.mock.calls[0]?.[1].task_plan).toMatchObject({ id: 'plan' })
    } else {
      expect(planGet).not.toHaveBeenCalled()
      expect(renderSlots.mock.calls[0]?.[1].task_plan).toBeNull()
    }
  })

  it.each(['desktop', 'group'] as const)(
    '%s 的草稿和空草稿预览都不检索，正常对话仍检索',
    async (channel) => {
      const { compiler, automaticRag } = fixture(channel)
      for (const retrievalQuery of ['待发送草稿', '']) {
        const preview = await compiler.compile('thread-test', 'test', {
          retrievalQuery,
          appendThreadMessages: false,
          disableContinuity: true,
          disableMemoryRetrieval: true,
        })
        expect(preview.messages).toEqual([{ role: 'system', content: '本地提示词' }])
        expect(preview.manifest.hasMemoryRetrieval).toBe(false)
      }
      expect(automaticRag).not.toHaveBeenCalled()

      const normal = await compiler.compile('thread-test', 'test', { retrievalQuery: '正常发送' })
      expect(automaticRag).toHaveBeenCalledTimes(1)
      expect(automaticRag).toHaveBeenCalledWith(
        'test',
        '正常发送',
        expect.any(Number),
        channel,
        undefined,
        undefined,
      )
      expect(normal.manifest.hasMemoryRetrieval).toBe(true)
      expect(normal.messages.at(-1)).toMatchObject({ role: 'user', content: '历史问题' })
    },
  )
})
