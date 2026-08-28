import { describe, expect, it } from 'vitest'
import { NitStreamFilter, ThinkingStreamFilter } from '@infos/backend/nit/streamFilter'

describe('NitStreamFilter', () => {
  describe('filter', () => {
    it('应当隐藏完整 NIT 块并收集脚本内容', () => {
      const filter = new NitStreamFilter()

      const output = filter.filter('开头<nit>tool("secret")</nit>结尾') + filter.flush()

      expect(output).toBe('开头结尾')
      expect(filter.hasScripts()).toBe(true)
      expect(filter.getCollectedScripts()).toEqual(['tool("secret")'])
    })

    it('应当处理跨 chunk 拆分的开始标签和结束标签', () => {
      const filter = new NitStreamFilter()

      const output = [
        filter.filter('可见<ni'),
        filter.filter('t>隐藏'),
        filter.filter('内容</n'),
        filter.filter('it>继续'),
        filter.flush(),
      ].join('')

      expect(output).toBe('可见继续')
      expect(filter.getCollectedScripts()).toEqual(['隐藏内容'])
    })

    it('流结束时未闭合的 NIT 块应当丢弃可见输出但保留脚本', () => {
      const filter = new NitStreamFilter()

      const output = filter.filter('前缀<nit>未闭合脚本') + filter.flush()

      expect(output).toBe('前缀')
      expect(filter.getCollectedScripts()).toEqual(['未闭合脚本'])
    })

    it('reset 应当清空缓冲区和已收集脚本', () => {
      const filter = new NitStreamFilter()
      filter.filter('A<nit>x</nit>')

      filter.reset()
      const output = filter.filter('普通文本') + filter.flush()

      expect(output).toBe('普通文本')
      expect(filter.hasScripts()).toBe(false)
      expect(filter.getCollectedScripts()).toEqual([])
    })
  })
})

describe('ThinkingStreamFilter', () => {
  describe('filter', () => {
    it('应当隐藏完整 <think> 块', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('你好<think>私密思考</think>世界') + filter.flush()

      expect(output).toBe('你好世界')
    })

    it('应当隐藏多行 <think> 块并保留尾部文本', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('开头<think>第一行\n第二行</think>结尾') + filter.flush()

      expect(output).toBe('开头结尾')
    })

    it('应当隐藏大小写变体 <THINK> 块', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('A<THINK>secret</THINK>B') + filter.flush()

      expect(output).toBe('AB')
    })

    it('应当处理跨 chunk 拆分的开始标签', () => {
      const filter = new ThinkingStreamFilter()

      const output = [
        filter.filter('前缀<th'),
        filter.filter('ink>隐藏'),
        filter.filter('内容</th'),
        filter.filter('ink>后缀'),
        filter.flush(),
      ].join('')

      expect(output).toBe('前缀后缀')
    })

    it.each([
      ['thought', '<thought>另一种思考标签</thought>'],
      ['thinking', '<thinking>完整名称标签</thinking>'],
    ])('应当隐藏并采集%s别名块', (_name, block) => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter(`前${block}后`) + filter.flush()
      const events = filter.drainEvents()

      expect(output).toBe('前后')
      expect(events).toEqual(
        expect.arrayContaining([
          { type: 'start' },
          expect.objectContaining({ type: 'delta' }),
          { type: 'end' },
        ]),
      )
    })

    it('应当处理跨chunk拆分的thought标签', () => {
      const filter = new ThinkingStreamFilter()

      const output = [
        filter.filter('前缀<tho'),
        filter.filter('ught>隐藏内容</thou'),
        filter.filter('ght>后缀'),
        filter.flush(),
      ].join('')

      expect(output).toBe('前缀后缀')
    })

    it('流结束时未闭合 <think> 块应当丢弃块内容', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('可见<think>未闭合') + filter.flush()

      expect(output).toBe('可见')
    })
  })
})
