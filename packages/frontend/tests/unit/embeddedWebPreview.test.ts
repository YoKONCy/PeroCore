import { describe, expect, it } from 'vitest'
import { buildEmbeddedWebDocument, segmentChatContent } from '../../src/lib/embeddedWebPreview'

describe('embeddedWebPreview', () => {
  it('应将内嵌样式和脚本的HTML片段拆为隔离预览', () => {
    const segments = segmentChatContent(
      '上文\n<div style="color:red"><button onclick="this.textContent=\'完成\'">点击</button></div>\n下文',
    )

    expect(segments).toEqual([
      expect.objectContaining({ type: 'rich-text', source: expect.stringContaining('上文') }),
      expect.objectContaining({ type: 'web-preview', source: expect.stringContaining('<button') }),
      expect.objectContaining({ type: 'rich-text', source: expect.stringContaining('下文') }),
    ])
  })

  it('应将html围栏识别为预览并保留其他代码围栏', () => {
    const segments = segmentChatContent(
      '```html\n<style>body{color:red}</style><div>预览</div>\n```\n```js\nconsole.log(1)\n```',
    )

    expect(segments[0]).toMatchObject({ type: 'web-preview' })
    expect(segments[1]).toMatchObject({
      type: 'rich-text',
      source: expect.stringContaining('```js'),
    })
  })

  it('沙箱文档应阻断网络和同源能力并注入自适应桥接', () => {
    const document = buildEmbeddedWebDocument(
      '<script>document.body.textContent="运行"</script>',
      'c1',
    )

    expect(document).toContain("default-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain('infos-embedded-resize')
    expect(document).toContain('<script>document.body.textContent="运行"</script>')
  })

  it('普通HTML/XML标签仍应作为富文本源码处理', () => {
    expect(segmentChatContent('说明：<user id="1">内容</user>')).toEqual([
      { type: 'rich-text', source: '说明：<user id="1">内容</user>' },
    ])
  })
})
