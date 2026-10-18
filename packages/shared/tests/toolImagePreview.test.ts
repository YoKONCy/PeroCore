import { describe, expect, it } from 'vitest'
import {
  imagePreviewFromToolResult,
  imagePreviewsFromToolResult,
  resourceFromToolResult,
} from '../src/resources'

const preview = {
  id: 'preview-1',
  kind: 'image',
  name: '图片.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
}
describe('读图工具的图片引用', () => {
  it.each(['take_screenshot', 'browser_screenshot', 'browser_page_image', 'automation_execute'])(
    '%s 复用受控附件预览，按截图顺序排除无效引用',
    (name) => {
      const result = JSON.stringify({
        screenshots: [
          { imagePreview: preview },
          { imagePreview: { ...preview, id: 'https://外部图片.test/a.png' } },
          { imagePreview: { ...preview, id: 'second' } },
        ],
      })
      expect(imagePreviewsFromToolResult(name, result)).toEqual([
        preview,
        { ...preview, id: 'second' },
      ])
    },
  )
  it('批量结果按读取顺序提供所有有效引用，坏项不影响其他图片', () => {
    const second = { ...preview, id: 'preview-2', name: '第二张.png' }
    const result = JSON.stringify({
      images: [
        { imagePreview: preview },
        { imagePreview: { ...preview, id: 'https://invalid.test/a.png' } },
        { imagePreview: second },
        { imagePreview: preview },
      ],
    })
    expect(imagePreviewsFromToolResult('read_image', result)).toEqual([preview, second])
  })
  it('只解析读图工具的已存储图片，不把工具卡片替换成发送资源卡片', () => {
    const result = JSON.stringify({ imagePreview: preview })
    expect(imagePreviewFromToolResult('read_image', result)).toEqual(preview)
    expect(imagePreviewFromToolResult('web_fetch', result)).toBeNull()
    expect(resourceFromToolResult('read_image', result)).toBeNull()
  })
  it('拒绝损坏、非图片与任意 URL，不把外部地址当作附件加载', () => {
    expect(imagePreviewFromToolResult('read_image', '{')).toBeNull()
    for (const invalid of [
      { ...preview, id: 'https://example.test/image.png' },
      { ...preview, kind: 'file' },
      { ...preview, mimeType: 'image/svg+xml' },
      { ...preview, sizeBytes: -1 },
    ])
      expect(
        imagePreviewFromToolResult('read_image', JSON.stringify({ imagePreview: invalid })),
      ).toBeNull()
  })
})
