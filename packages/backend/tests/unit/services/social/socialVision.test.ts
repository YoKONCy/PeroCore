import { describe, expect, it } from 'vitest'
import { prepareSocialVision } from '@infos/social/runtime/socialVision'
import type { ChatMessage } from '@infos/backend/applicationHostAbi'

const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const imageMessage = (url: string): ChatMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: '看看这个表情' },
    { type: 'image_url', image_url: { url, detail: 'high' } },
  ],
})

describe('社交动图视觉兼容', () => {
  it('把真实 GIF 转为 PNG，保留尺寸、细节选项和首帧说明', () => {
    const input = [imageMessage(`data:image/gif;base64,${gif}`)]
    prepareSocialVision(input)
    const content = input[0]!.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error('应保留多模态内容')
    const image = content.find((part) => part.type === 'image_url')
    if (image?.type !== 'image_url') throw new Error('应生成静态 PNG')
    expect(image.image_url.detail).toBe('high')
    expect(image.image_url.url).toMatch(/^data:image\/png;base64,/)
    const png = Buffer.from(image.image_url.url.split(',')[1]!, 'base64')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(1)
    expect(png.readUInt32BE(20)).toBe(1)
    expect(content).toContainEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('首帧') }),
    )
    const normalized = structuredClone(input)
    prepareSocialVision(input)
    expect(input).toEqual(normalized)
  })

  it('按实际字节识别被错误标成 JPEG 的 GIF，并保持正常 PNG 原样交付', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const input = [imageMessage(`data:image/jpeg;base64,${gif}`), imageMessage(png)]
    prepareSocialVision(input)
    expect(JSON.stringify(input[0])).not.toContain(gif)
    expect(JSON.stringify(input[1])).toContain(png)
  })

  it('损坏或超大画布的 GIF 只替换为失败说明，不阻断其他消息', () => {
    const huge = Buffer.alloc(10)
    huge.write('GIF89a')
    huge.writeUInt16LE(6000, 6)
    huge.writeUInt16LE(6000, 8)
    const input = [
      imageMessage('data:image/gif;base64,R0lGODlh'),
      imageMessage(`data:image/gif;base64,${huge.toString('base64')}`),
    ]
    prepareSocialVision(input)
    for (const message of input) {
      if (!Array.isArray(message.content)) throw new Error('应保留文字说明')
      expect(message.content.some((part) => part.type === 'image_url')).toBe(false)
      expect(message.content).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining('未能读取') }),
      )
    }
  })

  it('父回合取消后不继续转换或把取消误报为坏图', () => {
    const controller = new AbortController()
    const cancelled = new Error('社交任务已取消')
    controller.abort(cancelled)
    expect(() =>
      prepareSocialVision([imageMessage(`data:image/gif;base64,${gif}`)], controller.signal),
    ).toThrow(cancelled)
  })
})
