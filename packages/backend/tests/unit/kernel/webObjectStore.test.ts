import { describe, expect, it } from 'vitest'
import { WebObjectStore } from '@infos/backend/runtime'

const firstPage = {
  url: 'https://example.com',
  title: '示例',
  text: '正文',
  elements: [{ handle: 'e0', role: 'button', name: '提交', tag: 'button', disabled: false }],
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
}

describe('Web Kernel Objects', () => {
  it('导航后旧元素句柄必须失效', () => {
    const store = new WebObjectStore()
    store.update(firstPage, false)
    const stale = store.resolveElement('e0')
    expect(store.assertElement(stale).name).toBe('提交')

    store.update({ ...firstPage, url: 'https://example.com/next' }, true)
    expect(() => store.assertElement(stale)).toThrow('RUNTIME_STALE_HANDLE')
    expect(store.pageRef.generation).toBe(2)
  })
})
