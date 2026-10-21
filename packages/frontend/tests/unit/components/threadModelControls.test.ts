// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ThreadModelSettings } from '@infos/shared'
import { reasoningEffortOptions, normalizeReasoningEffort } from '@infos/shared'
import ThreadModelControls from '../../../src/components/chat/ThreadModelControls.vue'

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('../../../src/api/modules/threadsApi', () => ({
  threadsApi: { getModelSettings: mocks.get, updateModelSettings: mocks.update },
}))
vi.mock('../../../src/stores/useNotificationStore', () => ({
  useNotificationStore: () => ({ toast: mocks.toast }),
}))
const wrappers: VueWrapper[] = []
const settings = (
  threadId: string,
  effort: ThreadModelSettings['reasoningEffort'] = null,
): ThreadModelSettings => ({
  threadId,
  modelConfigId: null,
  reasoningEffort: effort,
  effective: {
    name: '主用',
    modelId: 'gpt-test',
    reasoningEffort: effort ?? 'low',
    enableVision: false,
    enableAudioInput: false,
  },
  models: [{ id: 2, name: '备用', modelId: 'claude-test', reasoningEffort: 'medium' }],
})
async function setup() {
  mocks.get.mockImplementation(async (id: string) => ({ data: settings(id) }))
  const wrapper = mount(ThreadModelControls, {
    props: { threadId: 'a' },
    global: { stubs: { PSelect: true, BrandIcon: true, PixelIcon: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

describe('输入栏会话模型快捷配置', () => {
  it('保存当前会话模型，强度随有效配置增强', async () => {
    const wrapper = await setup()
    mocks.update.mockResolvedValue({ data: { ...settings('a', 'max'), modelConfigId: 2 } })
    wrapper.findAllComponents({ name: 'PSelect' })[0]!.vm.$emit('change', '2')
    await flushPromises()
    expect(mocks.update).toHaveBeenCalledWith('a', { modelConfigId: 2, reasoningEffort: null })
    expect(wrapper.get('.thread-model-controls').attributes('data-effort')).toBe('5')
    expect(wrapper.emitted('busy')).toContainEqual([true])
  })

  it('旧会话的迟到响应不会覆盖新会话', async () => {
    const wrapper = await setup()
    let finish!: (value: { data: ThreadModelSettings }) => void
    mocks.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    wrapper.findAllComponents({ name: 'PSelect' })[1]!.vm.$emit('change', 'max')
    await wrapper.setProps({ threadId: 'b' })
    await flushPromises()
    finish({ data: settings('a', 'max') })
    await flushPromises()
    expect(wrapper.emitted('changed')?.at(-1)?.[0]).toMatchObject({ threadId: 'b' })
    expect(wrapper.get('.thread-model-controls').attributes('data-effort')).toBe('1')
  })

  it('与模型设置页共用档位，Gemini 4 自动校正旧强度', () => {
    expect(reasoningEffortOptions('gpt-test').map((item) => item.value)).toEqual([
      '',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(reasoningEffortOptions('[渠道]gemini-4-argon').map((item) => item.value)).toEqual([
      '',
      'low',
      'medium',
      'high',
    ])
    expect(normalizeReasoningEffort('gemini-4-argon', 'max')).toBe('high')
    expect(normalizeReasoningEffort('gemini-4-argon', 'off')).toBe('low')
  })
})
