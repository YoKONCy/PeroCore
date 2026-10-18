// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import InputBar from '../../../src/components/chat/InputBar.vue'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  upload: vi.fn(),
  recognize: vi.fn(),
  getTools: vi.fn(),
  thread: {} as Record<string, unknown>,
  agent: {} as Record<string, unknown>,
}))
vi.mock('../../../src/stores', () => ({
  useAgentStore: () => mocks.agent,
  useThreadStore: () => mocks.thread,
  useNotificationStore: () => ({ toast: mocks.toast }),
}))
vi.mock('../../../src/api/modules/attachmentsApi', () => ({
  attachmentsApi: {
    capabilities: async () => ({ data: { pdf: true, maxPdfBytes: 10_000_000 } }),
    upload: mocks.upload,
  },
}))
vi.mock('../../../src/api/modules/configApi', () => ({
  configApi: {
    get: async () => ({ data: { value: '1' } }),
    batch: async () => ({ data: {} }),
  },
}))
vi.mock('../../../src/api/modules/modelApi', () => ({
  modelApi: {
    getById: async () => ({ data: { enableVision: true, enableAudioInput: true } }),
  },
}))
vi.mock('../../../src/api/modules/voiceApi', () => ({
  voiceApi: {
    getStatus: async () => ({ data: { asr: { available: false } } }),
    recognize: mocks.recognize,
  },
}))
vi.mock('../../../src/api/modules/threadsApi', () => ({
  threadsApi: {
    getTools: mocks.getTools,
    previewTokenBudget: async () => ({ data: null }),
  },
}))

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTools.mockResolvedValue({
    data: { tools: [], disabledTools: [], interactionMode: 'chat', executionMode: 'manual' },
  })
  mocks.thread = reactive({
    threadId: 'thread',
    agentId: 'pero',
    interactionMode: 'chat',
    executionMode: 'manual',
    isGenerating: false,
    isLoadingHistory: false,
    liveContextBudget: null,
  })
  mocks.agent = reactive({
    activeAgentId: 'pero',
    agents: [],
    currentAgent: { id: 'pero', name: 'Pero' },
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function input(compact = false) {
  wrapper = mount(InputBar, {
    props: { compact },
    attachTo: document.body,
    global: { stubs: { PixelIcon: true } },
  })
  await flushPromises()
  return wrapper
}

describe('输入栏合并入口', () => {
  it('工具视窗自动分区、聚合同包，搜索时保持相对顺序', async () => {
    const item = (name: string, packageId?: string, enabled = true, locked = false) => ({
      name,
      label: name,
      description: '功能',
      packageId,
      enabled,
      userEnabled: enabled,
      modeAllowed: true,
      locked,
    })
    mocks.getTools.mockResolvedValue({
      data: {
        tools: [
          item('write_file', 'files'),
          item('z_disabled', 'files', false),
          item('finish_task', undefined, true, true),
          item('get_system_info'),
          item('read_file', 'files'),
          item('ask_user', undefined, true, true),
          item('get_file_info', 'files'),
        ],
        disabledTools: ['z_disabled'],
        interactionMode: 'work',
        executionMode: 'manual',
      },
    })
    const view = await input()
    await view.get('button[title="管理本会话可用工具"]').trigger('click')
    await flushPromises()
    const labels = () => view.findAll('.tool-manager__meta > strong').map((label) => label.text())
    expect(labels()).toEqual([
      'ask_user',
      'finish_task',
      'get_file_info',
      'read_file',
      'write_file',
      'get_system_info',
      'z_disabled',
    ])
    await view.get('.tool-manager__search input').setValue('file')
    expect(labels()).toEqual(['get_file_info', 'read_file', 'write_file'])
  })

  it('文件入口共用一个多选选择器，包含图片、文本和 PDF', async () => {
    const view = await input()
    const files = view.findAll('input[type="file"]')
    expect(files).toHaveLength(1)
    expect(files[0]!.attributes('accept')).toContain('image/png')
    expect(files[0]!.attributes('accept')).toContain('.txt')
    expect(files[0]!.attributes('accept')).toContain('application/pdf')
    expect(files[0]!.attributes('multiple')).toBeDefined()
    expect(view.text()).not.toContain('添加图片')
    const click = vi.spyOn(files[0]!.element as HTMLInputElement, 'click')
    await view.get('button[title="添加图片、文本或 PDF 文件"]').trigger('click')
    expect(click).toHaveBeenCalledOnce()
  })

  it('原生音频只提示占位，不进入录音或上传流程', async () => {
    const view = await input()
    await view.get('button[aria-label="选择语音输入方式"]').trigger('click')
    await flushPromises()
    const menu = document.querySelector('.audio-input-popover')!
    expect(menu.textContent).toContain('语音转写')
    expect(menu.textContent).toContain('原生音频')
    ;(menu.querySelectorAll('button')[1] as HTMLButtonElement).click()
    await flushPromises()
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('原生音频输入暂未接入'), {
      type: 'warning',
    })
    expect(mocks.recognize).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(document.querySelector('.audio-input-popover')).toBeNull()
    expect(view.find('.record-strip').exists()).toBe(false)
  })

  it('转写入口仍执行既有能力校验', async () => {
    const view = await input()
    await view.get('button[aria-label="选择语音输入方式"]').trigger('click')
    await flushPromises()
    ;(document.querySelector('.audio-input-popover button') as HTMLButtonElement).click()
    await flushPromises()
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('ASR 当前不可用'), {
      type: 'warning',
    })
  })

  it('窄工作区弹层挂载在 body，Escape 和 Thread 切换均会收起', async () => {
    const view = await input(true)
    const toggle = view.get('button[aria-label="选择语音输入方式"]')
    await toggle.trigger('click')
    await flushPromises()
    const menu = document.querySelector('.audio-input-popover')!
    expect(view.element.contains(menu)).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('.audio-input-popover')).toBeNull()
    await toggle.trigger('click')
    await flushPromises()
    mocks.thread.threadId = 'another-thread'
    await flushPromises()
    expect(document.querySelector('.audio-input-popover')).toBeNull()
  })
})
