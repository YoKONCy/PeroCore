import { describe, expect, it } from 'vitest'
import {
  trimFileImageContext,
  desktopCheckpointMessages,
} from '@infos/backend/services/agent/reactLoop'
import type { ChatMessage } from '@infos/backend/services/pipeline/types'

function group(label: string, count: number): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text: `【文件图片】\n${label} attachment:${label}` },
      ...Array.from({ length: count }, () => ({
        type: 'image_url' as const,
        image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' },
      })),
    ],
  }
}
describe('文件图片的成组保留', () => {
  it('同一批八张图片不会在第五张时失去前面的对照图', () => {
    const messages = [group('batch', 8)]
    trimFileImageContext(messages)
    expect(Array.isArray(messages[0]!.content) && messages[0]!.content.length).toBe(9)
    desktopCheckpointMessages(messages)
    expect(Array.isArray(messages[0]!.content) && messages[0]!.content.length).toBe(9)
  })
  it('容量超限时释放最早整组并保留可重读来源，不拆分最新一组', () => {
    const messages = [group('old', 8), group('middle', 8), group('latest', 8)]
    trimFileImageContext(messages)
    expect(messages[0]!.content).toContain('attachment:old')
    expect(messages[0]!.content).toContain('已释放')
    expect(messages[1]!.content).toContain('已释放')
    expect(Array.isArray(messages[2]!.content)).toBe(true)
    const checkpoint = desktopCheckpointMessages(messages)
    expect(JSON.stringify(checkpoint)).not.toContain('base64')
    expect(JSON.stringify(checkpoint)).toContain('attachment:latest')
  })
  it('连续截图不滚动改写旧画面，达到边界才成批释放', () => {
    const screenshot = (): ChatMessage => ({
      role: 'user',
      content: [
        { type: 'text', text: '【系统】以下是刚刚截取的屏幕截图，请直接分析：' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    })
    const messages: ChatMessage[] = []
    for (let index = 0; index < 16; index++) {
      const prefix = structuredClone(messages)
      messages.push(screenshot())
      trimFileImageContext(messages)
      expect(messages.slice(0, prefix.length)).toEqual(prefix)
    }
    messages.push(screenshot())
    trimFileImageContext(messages)
    expect(messages.filter((message) => Array.isArray(message.content))).toHaveLength(8)
    expect(messages[0]?.content).toContain('屏幕或网页画面请重新截图')
    const prefix = structuredClone(messages)
    messages.push(screenshot())
    trimFileImageContext(messages)
    expect(messages.slice(0, prefix.length)).toEqual(prefix)
  })
  it('预算回收也保留最新整组，由容量检查明确报错而非静默删掉当前观察', () => {
    const messages = [group('previous', 2), group('current', 8)]
    trimFileImageContext(messages, () => false)
    expect(typeof messages[0]!.content).toBe('string')
    expect(Array.isArray(messages[1]!.content)).toBe(true)
  })
})
