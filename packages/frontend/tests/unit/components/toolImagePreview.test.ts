// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ToolCallCard from '../../../src/components/tools/ToolCallCard.vue'

vi.mock('../../../src/composables/tools/useToolDisplay', async (original) => ({
  ...(await original<typeof import('../../../src/composables/tools/useToolDisplay')>()),
  resolveToolDisplay: vi.fn(async () => ({
    label: '读取图片',
    icon: 'image',
    color: 'sky',
    style: 'read',
  })),
}))
vi.mock('../../../src/api/modules/attachmentsApi', () => ({
  attachmentsApi: { contentUrl: (id: string) => `/api/attachments/${id}/content` },
}))

const wrappers: VueWrapper[] = []
function card() {
  const wrapper = mount(ToolCallCard, {
    attachTo: document.body,
    props: {
      tool: {
        name: 'read_image',
        args: '{"file_path":"example.png"}',
        result: JSON.stringify({
          imagePreview: {
            id: 'image-preview-1',
            kind: 'image',
            name: 'example.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
          },
        }),
      },
    },
    global: {
      stubs: {
        WorkspaceImageViewer: {
          props: ['src'],
          template: '<div data-test="large-image">{{ src }}</div>',
        },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

describe('工具栏图片的两阶段浏览', () => {
  it.each(['take_screenshot', 'browser_screenshot', 'browser_page_image'])(
    '%s 和读图一样先内嵌预览，点击图片再放大',
    async (name) => {
      const wrapper = card()
      await wrapper.setProps({
        tool: {
          name,
          args: '{}',
          result: JSON.stringify({
            screenshots: [
              {
                imagePreview: {
                  id: 'screen-1',
                  kind: 'image',
                  name: '截图.png',
                  mimeType: 'image/png',
                  sizeBytes: 1024,
                },
              },
            ],
          }),
        },
      })
      expect(wrapper.find('img').exists()).toBe(false)
      await wrapper.get('summary').trigger('click')
      expect(wrapper.get('img').attributes('src')).toBe('/api/attachments/screen-1/content')
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await wrapper.get('img').trigger('load')
      await wrapper.get('.tool-image__frame').trigger('click')
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    },
  )
  it('批量工具结果展示全部图片，并保留每张图的放大入口', async () => {
    const wrapper = card()
    await wrapper.setProps({
      tool: {
        name: 'read_image',
        args: '{"file_paths":["a.png","b.png"]}',
        result: JSON.stringify({
          images: ['a', 'b'].map((id) => ({
            imagePreview: {
              id,
              name: `${id}.png`,
              kind: 'image',
              mimeType: 'image/png',
              sizeBytes: 10,
            },
          })),
        }),
      },
    })
    await wrapper.get('summary').trigger('click')
    expect(wrapper.findAll('img').map((image) => image.attributes('src'))).toEqual([
      '/api/attachments/a/content',
      '/api/attachments/b/content',
    ])
    await wrapper.findAll('img')[1]!.trigger('load')
    await wrapper.findAll('.tool-image__frame')[1]!.trigger('click')
    expect(document.querySelector('[data-test="large-image"]')?.textContent).toContain('/b/content')
  })
  it('首次点击只在工具栏显示图片，再次点击图片才弹出浮窗', async () => {
    const wrapper = card()
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('summary').trigger('click')
    expect(wrapper.get('img').attributes('src')).toBe('/api/attachments/image-preview-1/content')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await wrapper.get('img').trigger('load')
    await wrapper.get('.tool-image__frame').trigger('click')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[data-test="large-image"]')?.textContent).toContain(
      'image-preview-1',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('details').attributes()).toHaveProperty('open')
  })

  it('折叠卡片会卸载原图并关闭浮窗，失效图片提供重试入口', async () => {
    const wrapper = card()
    await wrapper.get('summary').trigger('click')
    await wrapper.get('img').trigger('error')
    expect(wrapper.text()).toContain('图片已不可用')
    await wrapper.get('.tool-image__empty button').trigger('click')
    await wrapper.get('img').trigger('load')
    await wrapper.get('.tool-image__frame').trigger('click')
    await wrapper.get('summary').trigger('click')
    await nextTick()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('离开当前会话展示时关闭浮窗并释放内嵌图片', async () => {
    const wrapper = card()
    await wrapper.get('summary').trigger('click')
    await wrapper.get('img').trigger('load')
    await wrapper.get('.tool-image__frame').trigger('click')
    await wrapper.setProps({ active: false })
    await nextTick()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
