import { describe, expect, it } from 'vitest'
import {
  SpokenReplyFilter,
  splitSpokenReply,
  validSpokenReply,
} from '@infos/backend/nit/spokenReplyFilter'
import { cleanTextForTts } from '@infos/backend/services/voice/spokenReply'

describe('独立口语答复', () => {
  it('先输出开场白再输出口语块也应分离，任意字符分片不能泄漏标签', () => {
    const source = '做好了。\n<spoken_reply>文件已经完成。</spoken_reply>\n交付正文。'
    const filter = new SpokenReplyFilter()
    let visible = ''
    for (const character of source) visible += filter.filter(character)
    visible += filter.flush()
    expect(visible).toBe('做好了。\n\n交付正文。')
    expect(filter.value).toBe('文件已经完成。')
    expect(splitSpokenReply(source)).toEqual({ content: visible, spokenReply: filter.value })
  })

  it('围栏、行内和缩进代码里的标签必须保留，后面的真实口语块仍能识别', () => {
    const example = '<spoken_reply>代码示例</spoken_reply>'
    const code = `\`\`\`xml\n${example}\n\`\`\`\n\`${example}\`\n    ${example}\n`
    const source = code + '<SPOKEN_REPLY >真实答复</SPOKEN_REPLY >正文'
    const filter = new SpokenReplyFilter()
    let visible = ''
    for (const character of source) visible += filter.filter(character)
    visible += filter.flush()
    expect(visible).toBe(code + '正文')
    expect(filter.value).toBe('真实答复')
  })

  it('重复口语块全部从正文移除，只取首个有效口语答复', () => {
    expect(
      splitSpokenReply(
        '前文<spoken_reply>第一条</spoken_reply>中间<spoken_reply>第二条</spoken_reply>结尾',
      ),
    ).toEqual({ content: '前文中间结尾', spokenReply: '第一条' })
  })
  it('支持每个字符分片，正文与口语答复互不混入', () => {
    const filter = new SpokenReplyFilter()
    let visible = ''
    for (const character of '  <spoken_reply>已经整理好了。</spoken_reply>完整正文\n第二段')
      visible += filter.filter(character)
    visible += filter.flush()
    expect(filter.value).toBe('已经整理好了。')
    expect(visible).toBe('完整正文\n第二段')
  })
  it('普通正文中的代码标签保持原样，缺少口语答复时不使用正文回退', () => {
    const filter = new SpokenReplyFilter()
    const text = '使用这个协议：\n```xml\n<spoken_reply>示例</spoken_reply>\n```'
    expect(filter.filter(text) + filter.flush()).toBe(text)
    expect(filter.value).toBe('')
    expect(validSpokenReply(undefined)).toBe('')
  })
  it('未闭合或超长口语块不能泄漏进正文，也不会截取后朗读', () => {
    const unfinished = new SpokenReplyFilter()
    expect(unfinished.filter('<spoken_reply>不完整') + unfinished.flush()).toBe('')
    expect(unfinished.value).toBe('')
    const oversized = new SpokenReplyFilter()
    expect(oversized.filter('<spoken_reply>' + '长'.repeat(241) + '</spoken_reply>真正正文')).toBe(
      '真正正文',
    )
    expect(oversized.value).toBe('')
  })
  it('清除代码、链接目标、emoji、标点和装饰，保留数字语义与断句空格', () => {
    expect(cleanTextForTts('😊 **完成！** 进度 12.5%，距离 2-3km；重量 5kg。')).toBe(
      '完成 进度 百分之12点5 距离 2至3千米 重量 5千克',
    )
    expect(
      cleanTextForTts('[结果](https://example.com)\n```js\nsecret()\n```<think>内部推理</think>✨'),
    ).toBe('结果')
  })
})
