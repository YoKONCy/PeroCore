import { describe, expect, it, vi } from 'vitest'
import type { KernelExecutionId } from '@infos/shared'
import { KernelScheduler } from '@infos/backend/kernel/kernelScheduler'
import { LlmService } from '@infos/backend/services/llm/llmService'

describe('LlmService内核记账', () => {
  it('应自动消费当前Execution的调用数与Token', async () => {
    const runtime = {
      create: vi.fn(async (input) => ({
        executionId: crypto.randomUUID() as KernelExecutionId,
        processId: crypto.randomUUID(),
        principalId: input.principalId,
        taskId: input.taskId,
        class: input.class,
        priority: input.priority ?? 5,
        budget: input.budget ?? {},
      })),
      start: vi.fn(),
      stateChanged: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
      timeout: vi.fn(),
      fail: vi.fn(),
    }
    const scheduler = new KernelScheduler(runtime as never)
    const llm = new LlmService()
    vi.spyOn(llm, 'createProvider').mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '完成' }, finishReason: 'stop' }],
        usage: { promptTokens: 12, completionTokens: 4 },
      }),
      chatStream: vi.fn(),
      listModels: vi.fn(),
    } as never)

    const terminal = await scheduler.submitAndWait({
      principalId: 'system',
      class: 'maintenance',
      budget: { maxLlmCalls: 1, maxInputTokens: 20, maxOutputTokens: 10 },
      run: async () => {
        await llm.chat({ provider: 'openai', modelId: 'test', apiKey: 'test' }, [
          { role: 'user', content: '测试' },
        ])
      },
    })

    expect(terminal).toMatchObject({
      state: 'completed',
      usage: { llmCalls: 1, inputTokens: 12, outputTokens: 4 },
    })
  })
})
