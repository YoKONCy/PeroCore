import { describe, expect, it, vi } from 'vitest'
import type { BoundCapabilityPort } from '@infos/backend/kernel'
import { createBrowserToolContributions } from '@infos/backend/tools/browserControl'

const context = {
  agentId: 'pero',
  sessionId: 'thread-1',
  source: 'desktop',
  threadId: 'thread-1',
  channel: 'desktop',
}

describe('Browser Tool ABI', () => {
  it('应通过 Bound Port 调用并发布观察结果', async () => {
    const invoke = vi.fn().mockResolvedValue({ generation: 2, output: { content: '页面' } })
    const observe = vi.fn()
    const tools = createBrowserToolContributions(
      { invoke } as unknown as BoundCapabilityPort,
      observe,
    )
    const open = tools.find((tool) => tool.definition.name === 'browser_open_url')!
    const result = await open.handler({ url: 'example.com' }, context)
    expect(invoke).toHaveBeenCalledWith(
      'open',
      { url: 'https://example.com' },
      expect.objectContaining({ principalId: 'pero' }),
    )
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ operation: 'open', context }))
    expect(result).toContain('success')
  })

  it('网页截图应转换为统一多模态截图结构', async () => {
    const tools = createBrowserToolContributions({
      invoke: vi.fn().mockResolvedValue({
        output: { result: { base64: 'YWJj', mimeType: 'image/png' } },
      }),
    } as unknown as BoundCapabilityPort)
    const screenshot = tools.find((tool) => tool.definition.name === 'browser_screenshot')!
    const output = JSON.parse(String(await screenshot.handler({}, context)))
    expect(output.screenshots[0].dataUri).toBe('data:image/png;base64,YWJj')
  })

  it('网页局部图片应转换为统一多模态截图结构', async () => {
    const tools = createBrowserToolContributions({
      invoke: vi.fn().mockResolvedValue({
        output: { result: { base64: 'aW1hZ2U=', mimeType: 'image/png' } },
      }),
    } as unknown as BoundCapabilityPort)
    const image = tools.find((tool) => tool.definition.name === 'browser_page_image')!
    const output = JSON.parse(String(await image.handler({ imageId: 'IMG1' }, context)))
    expect(output.screenshots[0].dataUri).toBe('data:image/png;base64,aW1hZ2U=')
  })

  it('应只注册原子 Browser Tool ABI', () => {
    const tools = createBrowserToolContributions({
      invoke: vi.fn(),
    } as unknown as BoundCapabilityPort)
    const names = tools.map((tool) => tool.definition.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'browser_search',
        'browser_screenshot',
        'browser_page_image',
        'browser_wait',
        'browser_tabs',
        'browser_interact',
        'browser_query_dom',
      ]),
    )
    expect(names).not.toEqual(
      expect.arrayContaining([
        'browser_scene',
        'browser_plan_form',
        'browser_receipts',
        'browser_site_model',
        'browser_compile_capability',
      ]),
    )
  })
})
