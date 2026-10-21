import { describe, expect, it, vi } from 'vitest'
import type { EventNote } from '@infos/shared'
import { LlmEventReflectionModel } from '@infos/backend/services/memory/llmEventReflectionModel'

describe('记忆反思保留角色人格', () => {
  it('关系维护也带入人格和称呼，正文修订不能脱离所属角色', async () => {
    const chatText = vi.fn().mockResolvedValue('{"links":[],"removeLinks":[],"archive":false}')
    const persona = {
      agent_name: 'Pero',
      persona_definition: '我喜欢用自己的口吻记事。',
      owner_appellation: '主人',
    }
    const resolve = vi.fn().mockResolvedValue(persona)
    const model = new LlmEventReflectionModel(
      { chatText } as never,
      async () => ({ provider: 'openai', modelId: 'memory', apiKey: '' }),
      resolve,
    )
    await model.reflect({
      event: { agentId: 'pero', origin: { channel: 'desktop' } } as EventNote,
      candidates: [],
    })
    expect(resolve).toHaveBeenCalledWith('pero', 'desktop')
    expect(chatText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        promptTask: 'memory.reflect',
        promptVariables: persona,
        promptSources: ['persona_definition', 'channel_patch'],
      }),
    )
  })
})
