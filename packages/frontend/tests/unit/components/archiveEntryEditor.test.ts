// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ArchiveEntryEditor from '../../../src/components/dashboard/memories/ArchiveEntryEditor.vue'
import { ApiError } from '../../../src/api/errors'
import type { EventNote } from '@infos/shared'

const mocks = vi.hoisted(() => ({ edit: vi.fn(), editFact: vi.fn() }))
vi.mock('../../../src/api/modules/memoryApi', () => ({ memoryApi: { edit: mocks.edit } }))
vi.mock('../../../src/api/modules/knowledgeApi', () => ({
  knowledgeApi: { editFact: mocks.editFact },
}))
vi.mock('../../../src/i18n/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/i18n/index')>()),
  t: (_scope: string, source: string) => source,
}))

const note: EventNote = {
  id: 'note-old',
  agentId: 'pero',
  narrative: '我和主人约定周一复盘。',
  eventAt: '2026-10-22T02:00:00.000Z',
  createdAt: '2026-10-22T02:01:00.000Z',
  importance: 6,
  affect: { tones: ['期待'], valence: 7, arousal: 3 },
  participants: ['主人'],
  places: [],
  objects: [],
  topics: ['复盘'],
  origin: {
    mode: 'active',
    threadId: 'thread-1',
    pairIds: ['pair-1'],
    messageIds: ['1', '2'],
    channel: 'desktop',
  },
  status: 'archived',
}
const wrappers: VueWrapper[] = []
function editor() {
  const wrapper = mount(ArchiveEntryEditor, {
    props: { target: { kind: 'memory', note } },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)!
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '')
  })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open')
  })
  vi.spyOn(HTMLFormElement.prototype, 'reportValidity').mockReturnValue(true)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('记忆与事实编辑窗口', () => {
  it('默认保留向量并提交归档状态，正文不会带入可修改的来源字段', async () => {
    mocks.edit.mockResolvedValue({ data: { ...note, id: 'note-new' } })
    const wrapper = editor()
    expect(button(wrapper, '保存修改').attributes('disabled')).toBeDefined()
    await wrapper.find('textarea').setValue('我和主人约定改为周五复盘。')
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    const payload = mocks.edit.mock.calls[0]![1]
    expect(payload).toMatchObject({
      narrative: '我和主人约定改为周五复盘。',
      expectedStatus: 'archived',
      regenerateVector: false,
      participants: ['主人'],
      affect: { tones: ['期待'], valence: 7, arousal: 3 },
    })
    expect(payload).not.toHaveProperty('origin')
    expect(payload).not.toHaveProperty('agentId')
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({
      kind: 'memory',
      note: { id: 'note-new' },
    })
  })

  it('向量失败时保留正文，可取消重新生成后再次保存', async () => {
    mocks.edit
      .mockRejectedValueOnce(new ApiError('EMBEDDING_ERROR', '向量生成失败'))
      .mockResolvedValueOnce({ data: { ...note, id: 'note-new' } })
    const wrapper = editor()
    await wrapper.find('textarea').setValue('我记住了更正后的计划。')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    expect(mocks.edit.mock.calls[0]![1].regenerateVector).toBe(true)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      '我记住了更正后的计划。',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    expect(mocks.edit.mock.calls[1]![1].regenerateVector).toBe(false)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('冲突保留草稿并停止覆盖，取消时需明确放弃修改', async () => {
    mocks.edit.mockRejectedValue(new ApiError('CONFLICT', '条目已有新版本'))
    const wrapper = editor()
    await wrapper.find('textarea').setValue('我正在编辑的草稿。')
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    expect(button(wrapper, '保存修改').attributes('disabled')).toBeDefined()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      '我正在编辑的草稿。',
    )
    await button(wrapper, '取消').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    await button(wrapper, '继续编辑').trigger('click')
    await button(wrapper, '取消').trigger('click')
    await button(wrapper, '放弃修改').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('网络失败后相同草稿沿用操作编号重试', async () => {
    mocks.edit
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce({ data: { ...note, id: 'note-new' } })
    const wrapper = editor()
    await wrapper.find('textarea').setValue('我需要保存这一版。')
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    expect(mocks.edit.mock.calls[0]![1].operationId).toBe(mocks.edit.mock.calls[1]![1].operationId)
  })

  it('事实编辑采用客观正文，数值可信度可正常提交', async () => {
    const fact = {
      id: 'fact-1',
      objectId: 'object-1',
      objectName: '小林',
      statement: '偏好红茶',
      observedAt: note.eventAt,
      createdAt: note.createdAt,
      createdByAgentId: 'pero',
      status: 'active' as const,
    }
    mocks.editFact.mockResolvedValue({ data: { ...fact, id: 'fact-2' } })
    const wrapper = mount(ArchiveEntryEditor, {
      props: { target: { kind: 'fact', fact } },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.find('textarea').setValue('偏好乌龙茶')
    await wrapper.find('input[type="number"]').setValue('0.65')
    await button(wrapper, '保存修改').trigger('click')
    await flushPromises()
    expect(mocks.editFact).toHaveBeenCalledWith(
      'fact-1',
      expect.objectContaining({ statement: '偏好乌龙茶', confidence: 0.65 }),
    )
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})
