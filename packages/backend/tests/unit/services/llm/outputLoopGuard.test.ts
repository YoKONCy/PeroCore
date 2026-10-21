import { describe, expect, it } from 'vitest'
import { GenerationLoopError, OutputLoopGuard } from '@infos/backend/services/llm/outputLoopGuard'
import type { ChatDelta } from '@infos/backend/services/llm/types'

const text = (content: string): ChatDelta => ({ choices: [{ delta: { content } }] })
const argumentsDelta = (value: string, index = 0): ChatDelta => ({
  choices: [
    {
      delta: {
        toolCalls: [{ index, function: { arguments: value } }],
      },
    },
  ],
})

describe('保守的模型流式复读检测', () => {
  it('正文按不同网络分片传输都能检测，异常不可自动重试', () => {
    const output = '我需要再次确认当前状态，然后再次确认当前状态。'.repeat(600)
    for (const size of [1, 31, 513, output.length]) {
      const guard = new OutputLoopGuard()
      let failure: unknown
      try {
        for (let index = 0; index < output.length; index += size)
          guard.check(text(output.slice(index, index + size)))
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(GenerationLoopError)
      expect(failure).toMatchObject({ data: { retryable: false, loopDetected: true } })
    }
  })

  it('原生思考单独检测，不需要先向界面开放思考', () => {
    const guard = new OutputLoopGuard()
    expect(() =>
      guard.check({
        choices: [
          {
            delta: {
              reasoningContent: '还需要继续分析这同一个问题，没有任何新的信息。'.repeat(600),
            },
          },
        ],
      }),
    ).toThrow(GenerationLoopError)
  })

  it('共享前缀但内容不同的长列表和纯结构数据不会触发', () => {
    const guard = new OutputLoopGuard()
    expect(() => {
      for (let index = 0; index < 1200; index++)
        guard.check(
          text(`当前条目的字段说明一致，但这里对应不同对象 ${index}，取值为 ${index * 37}。\n`),
        )
      guard.check(text('000000[]\n'.repeat(15_000)))
    }).not.toThrow()
  })

  it('重复代码采用更高门槛，不因为普通夹具和批量模板立即停止', () => {
    const guard = new OutputLoopGuard()
    expect(() =>
      guard.check(
        text('```ts\n' + 'const fixture = "这是正常的重复测试数据";\n'.repeat(350) + '```'),
      ),
    ).not.toThrow()
  })

  it('工具参数使用独立高门槛，达到严重复读规模才拒绝', () => {
    const unit = '{"任务":"仍在重复同一条操作","状态":"没有变化"},'
    expect(() => new OutputLoopGuard().check(argumentsDelta(unit.repeat(700)))).not.toThrow()
    expect(() => new OutputLoopGuard().check(argumentsDelta(unit.repeat(3000)))).toThrow(
      GenerationLoopError,
    )
  })

  it('不同工具调用不合并计数，也不把原始媒体编码当自然语言复读', () => {
    const guard = new OutputLoopGuard()
    const unit = '{"内容":"这是一段重复模板"},'
    expect(() => {
      guard.check(argumentsDelta(unit.repeat(700), 0))
      guard.check(argumentsDelta(unit.repeat(700), 1))
      guard.check(argumentsDelta('AAAA'.repeat(30_000), 2))
    }).not.toThrow()
  })

  it('非流式完成结果在工具执行前也接受检查', () => {
    expect(() =>
      new OutputLoopGuard().checkCompletion({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '继续重复当前同一句话，继续重复当前同一句话。'.repeat(600),
            },
          },
        ],
      }),
    ).toThrow(GenerationLoopError)
  })
})
