import { describe, expect, it, vi } from 'vitest'
import { browserNavigationTarget } from '../../../src/tools/browserControl/navigationTarget'
import { HtmlPreviewService } from '../../../src/services/attachment/htmlPreviewService'

const context = {
  agentId: 'pero',
  threadId: 'thread',
  source: 'desktop',
  sessionId: 'thread',
  channel: 'desktop',
}

describe('浏览器网址与工作区预览', () => {
  it.each([
    'index.html',
    './场景.html#视角',
    'workspace:demo/index.html',
    'C:\\workspace\\index.html',
    'file:///C:/workspace/index.html',
    'attachment:page',
  ])('本地目标 %s 通过预览解析，不拼成外部域名', async (source) => {
    const preview = vi
      .fn()
      .mockResolvedValue('http://127.0.0.1:9120/html-previews/ticket/index.html')
    expect(await browserNavigationTarget(source, context, preview)).toContain('/html-previews/')
    expect(preview).toHaveBeenCalledWith(source, context)
  })

  it.each(['example.com', 'example.com/path/index.html', 'localhost:3000/index.html'])(
    '无协议网址 %s 保持网站导航',
    async (source) => {
      const preview = vi.fn()
      expect(await browserNavigationTarget(source, context, preview)).toBe(`https://${source}`)
      expect(preview).not.toHaveBeenCalled()
    },
  )

  it('拒绝不支持的协议，缺少预览服务不回退系统启动器', async () => {
    await expect(browserNavigationTarget('javascript:alert(1)', context)).rejects.toThrow(
      'SCHEME_BLOCKED',
    )
    await expect(browserNavigationTarget('index.html', context)).rejects.toThrow(
      'PREVIEW_UNAVAILABLE',
    )
  })

  it('统一资源前缀兼容网站与工作区来源', async () => {
    expect(await browserNavigationTarget('resource:https://example.com', context)).toBe(
      'https://example.com',
    )
    const preview = vi.fn().mockResolvedValue('http://127.0.0.1/preview')
    await browserNavigationTarget('resource:workspace:scene.html', context, preview)
    expect(preview).toHaveBeenCalledWith('workspace:scene.html', context)
  })

  it('取消后的解析不能继续导航', async () => {
    const parent = new AbortController()
    const preview = vi.fn(async () => {
      parent.abort()
      return 'http://127.0.0.1/preview'
    })
    await expect(
      browserNavigationTarget('index.html', { ...context, signal: parent.signal }, preview),
    ).rejects.toThrow()
  })

  it('工具票据与 HTTP 预览共用实例，保留相对资源与查询片段', async () => {
    const resources = {
      resolveReference: vi.fn().mockResolvedValue({ name: 'index.html' }),
      referenceFile: vi.fn(async (_ctx, source) => ({
        resource: {
          mimeType: 'text/html',
          sizeBytes: 32,
          name: 'index.html',
          origin: {
            value: source.startsWith('workspace:') ? decodeURIComponent(source.slice(10)) : source,
          },
        },
        filePath: '/workspace/index.html',
      })),
    }
    const service = new HtmlPreviewService(
      resources as never,
      {} as never,
      { getThread: vi.fn().mockResolvedValue({ id: 'thread' }) } as never,
    )
    const issued = await service.issueForTool(context, 'demo/index.html?quality=high#view')
    const url = new URL(issued.path, 'http://localhost')
    expect(url.search).toBe('?quality=high')
    expect(url.hash).toBe('#view')
    const token = url.pathname.split('/')[2]!
    await expect(service.resolve(token, 'demo/index.html')).resolves.toMatchObject({
      mimeType: 'text/html',
    })
    await expect(service.resolve(token, 'demo/../secret')).rejects.toThrow('路径无效')
  })

  it('越界目标解析失败时不签发可访问的预览', async () => {
    const service = new HtmlPreviewService(
      { resolveReference: vi.fn().mockRejectedValue(new Error('工作区越界')) } as never,
      {} as never,
      {} as never,
    )
    await expect(service.issueForTool(context, '../secret.html')).rejects.toThrow('越界')
  })
})
