import { describe, expect, it, vi } from 'vitest'
import { NitLexer } from '@infos/backend/nit/lexer'
import { NitParser } from '@infos/backend/nit/parser'
import { NitRuntime } from '@infos/backend/nit/runtime'
import { executeNit } from '@infos/backend/nit'

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
    it('父级取消不能被 catch 吞掉，也不能继续执行下一项', async () => {
      const controller = new AbortController()
      const executor = vi.fn(async () => {
        controller.abort(new Error('父任务已停止'))
        return '已返回'
      })
      await expect(
        executeNit('try { first() } catch { second() }\nthird()', executor, {
          signal: controller.signal,
        }),
      ).rejects.toThrow('父任务已停止')
      expect(executor).toHaveBeenCalledTimes(1)
    })

    it('并行失败会取消等待中的其他分支，外层仍可处理业务错误', async () => {
      let siblingSignal: AbortSignal | undefined
      let startSibling: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        startSibling = resolve
      })
      const executor = vi.fn(async (name: string, _args: unknown, signal?: AbortSignal) => {
        if (name === 'fail') {
          await started
          throw new Error('业务失败')
        }
        siblingSignal = signal
        startSibling()
        return new Promise<string>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        })
      })
      const result = await executeNit(
        'try { parallel { fail()\nwaiting() } } catch { return "已恢复" }',
        executor,
      )
      expect(result.value).toBe('已恢复')
      expect(siblingSignal?.aborted).toBe(true)
    })

    it('并行结果可赋值汇总，工具调用上限包含尚未返回的并发调用', async () => {
      const result = await executeNit(
        'items = parallel { first()\nsecond() }\nreturn merge(items)',
        async (name) => name,
      )
      expect(result.value).toBe('first\nsecond')
      const controller = new AbortController()
      const executor = vi.fn(() => new Promise(() => {}))
      const script = `parallel {\n${Array.from({ length: 60 }, () => 'work()').join('\n')}\n}`
      await expect(executeNit(script, executor, { signal: controller.signal })).rejects.toThrow(
        '工具调用次数超过上限',
      )
      expect(executor).toHaveBeenCalledTimes(50)
    })

    it('JSON 工具结果可用于条件判断，短路判断不会执行右侧工具', async () => {
      const executor = vi.fn().mockResolvedValue('{"ready":true}')
      const result = await executeNit(
        'state = parse_json(status())\nif state.ready { return "已就绪" }',
        executor,
      )
      expect(result.value).toBe('已就绪')
      executor.mockClear()
      await executeNit('false and dangerous()\ntrue or dangerous()', executor)
      expect(executor).not.toHaveBeenCalled()
    })

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

      await expect(executeSource(source)).rejects.toThrow(Error)
    })

    it('工具在任一项完成前全部启动，结果仍保持表达式顺序', async () => {
      const releases = new Map<string, (value: string) => void>()
      let cleaningUp = false
      const executor = vi.fn((name: string) =>
        cleaningUp
          ? Promise.resolve('清理')
          : new Promise<string>((resolve) => releases.set(name, resolve)),
      )
      const pending = executeSource('parallel {\nfirst()\nsecond()\n}', executor)
      try {
        await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2))
        releases.get('second')!('第二项')
        releases.get('first')!('第一项')
        expect((await pending).value).toEqual(['第一项', '第二项'])
      } finally {
        cleaningUp = true
        for (const release of releases.values()) release('清理')
        await pending
      }
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

    it('大量工具调用必须在全部执行前被安全上限中止', async () => {
      const calls = Array.from({ length: 1000 }, (_, index) => `tool${index}()`).join('\n')
      const toolExecutor = vi.fn().mockResolvedValue('ok')

      await expect(executeSource(calls, toolExecutor)).rejects.toThrow(Error)
      expect(toolExecutor.mock.calls.length).toBeGreaterThan(0)
      expect(toolExecutor.mock.calls.length).toBeLessThan(1000)
    })

    it('未知方法应当抛出错误', async () => {
      const source = 'return "abc".missing()'

      await expect(executeSource(source)).rejects.toThrow(/missing/)
    })
  })
})
