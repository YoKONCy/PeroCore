import { describe, expect, it, vi } from 'vitest'
import { NitLexer } from '@infos/backend/nit/lexer'
import { NitParser } from '@infos/backend/nit/parser'
import { NitRuntime } from '@infos/backend/nit/runtime'

function parseSource(source: string) {
  const tokens = new NitLexer(source).tokenize()
  return new NitParser(tokens).parse()
}

async function executeSource(source: string, toolExecutor = vi.fn()) {
  const runtime = new NitRuntime(toolExecutor)
  return runtime.execute(parseSource(source))
}

describe('NitRuntime', () => {
  describe('execute', () => {
    it('应当执行赋值、表达式和 return 并返回结果', async () => {
      const source = `name = "pero"
count = 2 + 3
return name + count`

      const result = await executeSource(source)

      expect(result).toEqual({
        value: 'pero5',
        toolCalls: [],
      })
    })

    it('应当按 truthy 规则执行 if 和 else 分支', async () => {
      const truthySource = 'if [1] { return "then" } else { return "else" }'
      const falsySource = 'if [] { return "then" } else { return "else" }'

      const truthyResult = await executeSource(truthySource)
      const falsyResult = await executeSource(falsySource)

      expect(truthyResult.value).toBe('then')
      expect(falsyResult.value).toBe('else')
    })

    it('应当执行 for 循环并保留最后一次块结果', async () => {
      const source = `items = [1, 2, 3]
for item in items {
  result = item
}`

      const result = await executeSource(source)

      expect(result.value).toBe(3)
    })

    it('for 目标不是数组时应当抛出错误', async () => {
      const source = 'for item in "abc" { item }'

      await expect(executeSource(source)).rejects.toThrow(
        'NIT Runtime: for 循环需要数组，得到 string',
      )
    })

    it('应当并行执行表达式并返回结果数组', async () => {
      const source = `parallel {
  "a"
  2
  true
}`

      const result = await executeSource(source)

      expect(result.value).toEqual(['a', 2, true])
    })

    it('try/catch 应当捕获普通错误并执行 catch 块', async () => {
      const source = `try {
  unknown.method()
} catch {
  return "已恢复"
}`

      const result = await executeSource(source)

      expect(result.value).toBe('已恢复')
    })

    it('应当执行数组和字符串内置方法', async () => {
      const source = `items = ["a", "", "b"]
items.push("c")
joined = items.filter().join("|")
text = "  infos  ".trim()
return joined + ":" + text.length`

      const result = await executeSource(source)

      expect(result.value).toBe('a|b|c:5')
    })

    it('应当执行 merge 内置函数并支持分隔符', async () => {
      const source = 'return merge(["a", "b"], separator="|")'

      const result = await executeSource(source)

      expect(result.value).toBe('a|b')
    })

    it('应当把单个位置参数转换为 input 调用工具', async () => {
      const toolExecutor = vi.fn().mockResolvedValue('工具结果')
      const source = 'return search("关键词")'

      const result = await executeSource(source, toolExecutor)

      expect(toolExecutor).toHaveBeenCalledWith('search', { input: '关键词' })
      expect(result).toEqual({
        value: '工具结果',
        toolCalls: [{ name: 'search', args: { input: '关键词' }, result: '工具结果' }],
      })
    })

    it('应当把多个位置参数和命名参数传给工具', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ ok: true })
      const source = 'return callTool("a", "b", level=2)'

      const result = await executeSource(source, toolExecutor)

      expect(toolExecutor).toHaveBeenCalledWith('callTool', { level: 2, _positional: ['a', 'b'] })
      expect(result.value).toEqual({ ok: true })
    })

    it('工具调用次数超过上限时应当抛出错误', async () => {
      const calls = Array.from({ length: 51 }, (_, index) => `tool${index}()`).join('\n')
      const toolExecutor = vi.fn().mockResolvedValue('ok')

      await expect(executeSource(calls, toolExecutor)).rejects.toThrow(
        'NIT Runtime: 工具调用次数超过上限 (50)',
      )
    })

    it('未知方法应当抛出错误', async () => {
      const source = 'return "abc".missing()'

      await expect(executeSource(source)).rejects.toThrow('NIT Runtime: 未知方法 .missing()')
    })
  })
})
