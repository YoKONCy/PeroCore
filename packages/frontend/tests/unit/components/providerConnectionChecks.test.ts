// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ProviderConnectionChecks from '../../../src/components/dashboard/ProviderConnectionChecks.vue'

const mocks = vi.hoisted(() => ({ probe: vi.fn(), listModels: vi.fn(), copy: vi.fn() }))
vi.mock('../../../src/api/modules/providerApi', () => ({
  providerApi: { probe: mocks.probe, listModels: mocks.listModels },
}))
vi.mock('../../../src/lib/clientPlatform', () => ({ copyClientText: mocks.copy }))
vi.mock('../../../src/i18n/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/i18n/index')>()),
  t: (_scope: string, source: string, values: readonly unknown[] = []) =>
    source.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? '')),
}))

function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(text))!
}
const props = { connectionId: 'first', disabled: false, active: true }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.copy.mockResolvedValue(undefined)
})

describe('连接检查与模型目录交互', () => {
  it('搜索忽略大小写，逐条复制与复制筛选结果使用真实模型 ID', async () => {
    mocks.listModels.mockResolvedValue({ data: ['Qwen/Qwen3', 'gemini-3', 'Qwen/Qwen3'] })
    const wrapper = mount(ProviderConnectionChecks, { props })
    try {
      await button(wrapper, '获取模型列表').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.model-catalog__row')).toHaveLength(2)
      await wrapper.find('.catalog-copy-id').trigger('click')
      await flushPromises()
      expect(mocks.copy).toHaveBeenLastCalledWith('Qwen/Qwen3')
      await wrapper.find('input').setValue('GEMINI')
      expect(wrapper.findAll('.model-catalog__row')).toHaveLength(1)
      await button(wrapper, '复制筛选结果').trigger('click')
      await flushPromises()
      expect(mocks.copy).toHaveBeenLastCalledWith('gemini-3')
      expect(wrapper.text()).toContain('已复制')
    } finally {
      wrapper.unmount()
    }
  })

  it('切换连接后，旧请求的迟到结果不能覆盖新连接目录或加载状态', async () => {
    let completeOld!: (value: { data: string[] }) => void
    mocks.listModels
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeOld = resolve
          }),
      )
      .mockResolvedValueOnce({ data: ['new-model'] })
    const wrapper = mount(ProviderConnectionChecks, { props })
    try {
      await button(wrapper, '获取模型列表').trigger('click')
      await wrapper.setProps({ connectionId: 'second' })
      await button(wrapper, '获取模型列表').trigger('click')
      await flushPromises()
      completeOld({ data: ['old-model'] })
      await flushPromises()
      expect(mocks.listModels.mock.calls).toEqual([['first'], ['second']])
      expect(wrapper.text()).toContain('new-model')
      expect(wrapper.text()).not.toContain('old-model')
      expect(button(wrapper, '刷新模型列表').attributes('disabled')).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })

  it('未保存修改使旧检查失效，禁用状态不能发请求，空目录仍允许手动配置', async () => {
    let completeProbe!: (value: unknown) => void
    mocks.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeProbe = resolve
        }),
    )
    mocks.listModels.mockResolvedValue({ data: [] })
    const wrapper = mount(ProviderConnectionChecks, { props })
    try {
      await button(wrapper, '检查地址').trigger('click')
      await wrapper.setProps({ disabled: true })
      completeProbe({ data: { reachable: true, durationMs: 10, message: '旧检查结果' } })
      await flushPromises()
      expect(wrapper.text()).not.toContain('旧检查结果')
      expect(wrapper.text()).toContain('保存连接后即可检查地址和获取模型列表。')
      await button(wrapper, '获取模型列表').trigger('click')
      expect(mocks.listModels).not.toHaveBeenCalled()
      await wrapper.setProps({ disabled: false })
      await button(wrapper, '获取模型列表').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('服务商未返回模型')
      expect(wrapper.text()).toContain('你仍可在模型配置中手动填写模型 ID。')
    } finally {
      wrapper.unmount()
    }
  })
})
