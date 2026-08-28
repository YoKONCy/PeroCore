import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setFinishTaskDeps } from '../../../src/tools/finishTask'
import { updateStateTool } from '../../../src/tools/updateState'

const update = vi.fn()
const broadcast = vi.fn()

beforeEach(() => {
  update.mockReset().mockResolvedValue('2026-08-20T12:00:00.000Z')
  broadcast.mockReset().mockResolvedValue(undefined)
  setFinishTaskDeps({ petStateUpdater: { update }, gatewayBroadcast: broadcast })
})

describe('update_state', () => {
  it('应通过现有路径更新四个标准触碰部位并广播', async () => {
    const result = await updateStateTool.execute(
      {
        mood: '开心',
        touch_reactions: { head: ['摸摸'], arm: '牵手', unknown: ['不应保存'] },
        click_body_msgs: ['不要戳啦'],
        click_leg_msgs: ['站稳啦'],
        idle_msgs: ['正在发呆'],
      },
      {
        agentId: 'nana',
        sessionId: 's1',
        source: 'desktop',
        threadId: 's1',
        channel: 'desktop',
      },
    )

    expect(update).toHaveBeenCalledWith('nana', {
      mood: '开心',
      vibe: undefined,
      mind: undefined,
      clickMessages: {
        head: ['摸摸'],
        arm: ['牵手'],
        body: ['不要戳啦'],
        leg: ['站稳啦'],
      },
      idleMessages: ['正在发呆'],
      backMessages: undefined,
    })
    expect(broadcast).toHaveBeenCalledWith(
      'state_update',
      expect.objectContaining({ agentId: 'nana', mood: '开心' }),
    )
    expect(result).toMatchObject({ ok: true })
  })

  it('不应再识别chest旧字段', async () => {
    const result = await updateStateTool.execute(
      { click_chest_msgs: ['旧字段'] },
      {
        agentId: 'nana',
        sessionId: 's1',
        source: 'desktop',
        threadId: 's1',
        channel: 'desktop',
      },
    )

    expect(update).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false })
  })
})
