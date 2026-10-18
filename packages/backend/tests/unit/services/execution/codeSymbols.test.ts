import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeSymbols } from '../../../../src/services/execution/codeSymbols'

afterEach(() => vi.unstubAllEnvs())

describe('按需符号定位', () => {
  it('限定名和精确字符范围不包含同一行的其他声明', async () => {
    const text =
      'const first = () => 1; const second = () => 2;\nclass Store { save() { return "中文🎉" } }'
    const symbols = await codeSymbols('source.ts', text)
    const second = symbols.find((symbol) => symbol.name === 'second')!
    expect(text.slice(second.start, second.end)).toBe('const second = () => 2;')
    const method = symbols.find((symbol) => symbol.name === 'Store.save')!
    expect(text.slice(method.start, method.end)).toBe('save() { return "中文🎉" }')
  })

  it('解析失败和未支持语言明确拒绝，不产生伪精确范围', async () => {
    await expect(codeSymbols('source.ts', 'function broken( {')).rejects.toThrow('语法错误')
    await expect(codeSymbols('source.unknown', 'function valid() {}')).rejects.toThrow('不支持')
  })

  it('Python 无系统命令环境也能定位声明，忽略字符串和注释中的伪声明', async () => {
    vi.stubEnv('PATH', '')
    const text = [
      '# def comment(): pass',
      'text = """',
      'class Fake:',
      '    def fake(): pass',
      '"""',
      'class Store:',
      '    @decorate("中文🎉")',
      '    async def save(',
      '        self, value="class Hidden:"',
      '    ):',
      '        def nested(): pass',
      '        return value',
      'def outside(): pass',
    ].join('\r\n')
    const symbols = await codeSymbols('source.py', text)
    expect(symbols.map((symbol) => symbol.name)).toEqual([
      'Store',
      'Store.save',
      'Store.save.nested',
      'outside',
    ])
    const save = symbols.find((symbol) => symbol.name === 'Store.save')!
    expect(save).toMatchObject({ locationOnly: true, lineStart: 8, lineEnd: 8 })
    expect(text.slice(save.start, save.end)).toBe('async def save(')
  })

  it('复杂 Python 语法和不完整文本交由工具层回退，不冒充精确函数体', async () => {
    await expect(codeSymbols('source.py', 'value = f"{render("same quote")}"')).rejects.toThrow(
      '回退源码读取',
    )
    await expect(codeSymbols('source.py', 'value = """\ndef fake():')).rejects.toThrow(
      '字符串不完整',
    )
    await expect(codeSymbols('source.py', 'def broken(')).rejects.toThrow('不完整')
    await expect(codeSymbols('source.py', 'class Store:\n \tdef save(): pass')).rejects.toThrow(
      '混合缩进',
    )
  })

  it('取消直接传播，不被当作解析失败继续处理', async () => {
    const controller = new AbortController()
    controller.abort(new Error('任务已停止'))
    await expect(codeSymbols('source.py', 'def save(): pass', controller.signal)).rejects.toThrow(
      '任务已停止',
    )
    await expect(codeSymbols('source.ts', 'function save() {}', controller.signal)).rejects.toThrow(
      '任务已停止',
    )
  })
})
