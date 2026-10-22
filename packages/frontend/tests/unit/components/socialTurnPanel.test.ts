// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { SocialTurnListItem } from '@infos/shared'
import SocialTurnPanel from '../../../src/components/social/SocialTurnPanel.vue'

const mocks = vi.hoisted(() => ({ turns: vi.fn() }))
vi.mock('../../../src/api/modules/socialApi', () => ({ socialApi: { turns: mocks.turns } }))
vi.mock('../../../src/i18n/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/i18n/index')>()),
  t: (_scope: string, source: string) => source,
  getDisplayLocale: () => 'zh-CN',
}))
const global = {
  stubs: {
    PCard: { template: '<section><slot /></section>' },
    PButton: true,
    PixelIcon: true,
  },
}

function record(
  id: string,
  text: string,
  status: SocialTurnListItem['status'] = 'completed',
): SocialTurnListItem {
  return {
    id,
    status,
    agentId: 'pero',
    accountId: '123456789',
    channelType: 'private',
    channelId: '987654321',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 60_000).toISOString(),
    attempts: 1,
    sourceCount: 1,
    sourcePreview: { senderName: '群友', content: text },
    orchestrationSummary: {
      plans: 1,
      stepsCompleted: 1,
      stepsFailed: 3,
      stepsUncertain: 0,
      stepsSkipped: 0,
      businessCalls: 3,
      sends: 1,
    },
  }
}

beforeEach(() => mocks.turns.mockReset())

describe('社交聊天与任务展示分离', () => {
  it('任务中心拒绝普通聊天，即使旧服务返回工具失败的聊天回合也不会混入', async () => {
    mocks.turns.mockResolvedValue({
      data: [
        record('social:chat', '普通聊天'),
        record('social:command:delegated', '明确委派', 'running'),
      ],
    })
    const wrapper = mount(SocialTurnPanel, { props: { agentId: 'pero', tasksOnly: true }, global })
    try {
      await flushPromises()
      expect(mocks.turns).toHaveBeenLastCalledWith('pero', 'task')
      expect(wrapper.text()).toContain('明确委派')
      expect(wrapper.text()).not.toContain('普通聊天')
    } finally {
      wrapper.unmount()
    }
  })

  it('只有聊天异常时，任务中心不显示社交任务卡片，也不产生任务待阅提示', async () => {
    mocks.turns.mockResolvedValue({ data: [record('social:chat', '普通聊天', 'failed')] })
    const wrapper = mount(SocialTurnPanel, { props: { agentId: 'pero', tasksOnly: true }, global })
    try {
      await flushPromises()
      expect(wrapper.find('.social-turns').exists()).toBe(false)
      expect(wrapper.emitted('attention-change')?.at(-1)).toEqual([false])
      expect(wrapper.emitted('history-change')?.at(-1)).toEqual([false])
    } finally {
      wrapper.unmount()
    }
  })

  it('社交诊断仍可查看聊天回合和失败步骤，并使用社交回合标题', async () => {
    mocks.turns.mockResolvedValue({ data: [record('social:chat', '普通聊天')] })
    const wrapper = mount(SocialTurnPanel, { props: { agentId: 'pero' }, global })
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('社交回合')
      expect(wrapper.text()).toContain('普通聊天')
      expect(wrapper.text()).not.toContain('社交任务')
    } finally {
      wrapper.unmount()
    }
  })
})
