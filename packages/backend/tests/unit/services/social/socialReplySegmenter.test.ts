import { describe, expect, it } from 'vitest'
import {
  expandSocialMessageSegments,
  socialTypingDelayMs,
  splitSocialText,
} from '@infos/social/runtime/socialReplySegmenter'

describe('社交回复自然分块', () => {
  it('按完整句子拆分并移除分块末尾的句号和分号', () => {
    expect(
      splitSocialText(
        '这个功能已经处理好了。接下来重启一下应用就能生效；如果仍然不行，再把日志发给我看看。',
      ),
    ).toEqual([
      '这个功能已经处理好了',
      '接下来重启一下应用就能生效',
      '如果仍然不行，再把日志发给我看看',
    ])
  })

  it('保留问号与感叹号所表达的聊天语气', () => {
    expect(splitSocialText('你现在方便吗？我这边已经准备好了！等你回复。')).toEqual([
      '你现在方便吗？',
      '我这边已经准备好了！',
      '等你回复',
    ])
  })

  it('短句自动合并，长句按弱边界或长度继续拆分', () => {
    const chunks = splitSocialText(
      '可以，不过这个配置在 Windows 环境下还要检查数据目录权限，确认当前用户能够正常写入，然后再重新启动后台服务观察日志输出',
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 56)).toBe(true)
    expect(chunks.join('')).toContain('Windows 环境下')
  })

  it('在文字与表情包之间保持原有顺序', () => {
    expect(
      expandSocialMessageSegments([
        { type: 'text', content: '第一句话很长所以需要单独发出去。第二句话也应该单独发出去。' },
        { type: 'sticker', name: '开心', filePath: '开心.jpg' },
        { type: 'text', content: '最后补充一句。' },
      ]),
    ).toEqual([
      { type: 'text', content: '第一句话很长所以需要单独发出去' },
      { type: 'text', content: '第二句话也应该单独发出去' },
      { type: 'sticker', name: '开心', filePath: '开心.jpg' },
      { type: 'text', content: '最后补充一句' },
    ])
  })

  it('拟人延迟随文字长度增加且限制在合理范围', () => {
    expect(socialTypingDelayMs('短句', () => 0)).toBe(550)
    expect(socialTypingDelayMs('这是一段明显更长的消息内容', () => 0)).toBeGreaterThan(550)
    expect(socialTypingDelayMs('很长'.repeat(100), () => 1)).toBe(2200)
  })
})
