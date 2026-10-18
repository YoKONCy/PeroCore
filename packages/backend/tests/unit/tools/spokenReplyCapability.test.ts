import { describe, expect, it } from 'vitest'
import { spokenReplyToolDefinition } from '@infos/backend/tools/spokenReplyCapability'

describe('口语工具字段门控', () => {
  it('桌宠隐藏时移除口语字段，恢复显示时不能因共享清单被修改而丢失能力', () => {
    const tool = {
      name: 'finish_task',
      description: '完成任务',
      parameters: {
        type: 'object',
        properties: { reply: { type: 'string' }, spoken_reply: { type: 'string' } },
        required: ['reply'],
      },
    }
    const hidden = spokenReplyToolDefinition(tool, false)
    expect(hidden.parameters.properties).not.toHaveProperty('spoken_reply')
    expect(hidden.parameters.properties).toHaveProperty('reply')
    expect(spokenReplyToolDefinition(tool, true).parameters.properties).toHaveProperty(
      'spoken_reply',
    )
    expect(tool.parameters.properties).toHaveProperty('spoken_reply')
  })
})
