import { describe, expect, it } from 'vitest'
import { NitStreamFilter, ThinkingStreamFilter } from '@perocore/backend/nit/streamFilter'

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
    it('应当隐藏中文方括号 Thinking 块', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('你好【Thinking 私密思考】世界') + filter.flush()

      expect(output).toBe('你好世界')
    })

    it('应当隐藏英文方括号和圆括号 Monologue 块', () => {
      const square = new ThinkingStreamFilter()
      const round = new ThinkingStreamFilter()

      const squareOutput = square.filter('A[Monologue secret]B') + square.flush()
      const roundOutput = round.filter('A(Thinking secret)B') + round.flush()

      expect(squareOutput).toBe('AB')
      expect(roundOutput).toBe('AB')
    })

    it('应当处理跨 chunk 的 Thinking 块并保留安全尾部', () => {
      const filter = new ThinkingStreamFilter()

      const output = [
        filter.filter('前缀【Think'),
        filter.filter('ing 隐藏'),
        filter.filter('内容】后缀'),
        filter.flush(),
      ].join('')

      expect(output).toBe('前缀后缀')
    })

    it('流结束时未闭合 Thinking 块应当丢弃块内容', () => {
      const filter = new ThinkingStreamFilter()

      const output = filter.filter('可见【Thinking 未闭合') + filter.flush()

      expect(output).toBe('可见')
    })
  })
})
