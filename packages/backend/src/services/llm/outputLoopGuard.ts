import { t as __t } from '../../lib/i18n'
import { AppError } from '../../lib/appError'
import type { ChatCompletion, ChatDelta } from './types'

export interface LoopEvidence {
  channel: string
  period: number
  repetitions: number
  repeatedCharacters: number
}

/** 明确的退化输出不是网络故障，不允许重试或回退链重新播放。 */
export class GenerationLoopError extends AppError {
  constructor(readonly evidence: LoopEvidence) {
    const label = evidence.channel.startsWith('arguments:')
      ? '工具参数'
      : evidence.channel.startsWith('tool-name:')
        ? '工具名称'
        : evidence.channel.startsWith('reasoning:')
          ? '思考'
          : '正文'
    super('LLM_ERROR', {
      message: __t(
        'server.llm',
        '检测到{0}连续重复生成，已中断本次模型请求；未完成的工具参数不会执行。',
        [label],
      ),
      data: { retryable: false, loopDetected: true, ...evidence },
    })
    this.name = 'GenerationLoopError'
  }
}

// 足以确认最长 4096 字符周期连续重复 64 次，且不随输出总长增长。
const WINDOW = 262_144
const CHECK_INTERVAL = 512
const MAX_PERIOD = 4096

/** 只认连续、逐字相同的周期，不以相似度、低熵或常见词判断卡死。 */
class ChannelWindow {
  private tail = ''
  private unchecked = ''
  private fenced = false
  private ticks = 0

  constructor(private channel: string) {}

  add(value: string): void {
    // 固定内部边界，判断不依赖服务商如何拆分网络分片；大分片也不复制整份历史。
    for (let offset = 0; offset < value.length; ) {
      const size = Math.min(CHECK_INTERVAL - this.unchecked.length, value.length - offset)
      this.unchecked += value.slice(offset, offset + size)
      offset += size
      if (this.unchecked.length !== CHECK_INTERVAL) continue
      const chunk = this.unchecked
      this.unchecked = ''
      for (const character of chunk) {
        if (character === '`') this.ticks++
        else {
          if (this.ticks >= 3) this.fenced = !this.fenced
          this.ticks = 0
        }
      }
      this.tail = (this.tail + chunk).slice(-WINDOW)
      this.check()
    }
  }

  private check(): void {
    const argumentsChannel = this.channel.startsWith('arguments:')
    const nameChannel = this.channel.startsWith('tool-name:')
    const structured =
      this.fenced || /(?:^|\n)[ \t]*(?:\||#{1,6}\s|[-*+]\s|\d+\.\s)/.test(this.tail)
    const minimumCharacters = nameChannel
      ? 4096
      : argumentsChannel
        ? 65_536
        : structured
          ? 32_768
          : 8192
    const minimumRepeats = argumentsChannel ? 64 : structured ? 32 : 16
    if (this.tail.length < minimumCharacters) return
    const anchor = this.tail.slice(-32)
    let position = this.tail.lastIndexOf(anchor, this.tail.length - 33)
    for (let candidates = 0; position >= 0 && candidates < 64; candidates++) {
      const period = this.tail.length - 32 - position
      if (period > MAX_PERIOD) break
      const unit = this.tail.slice(-period)
      // 空白、分隔线、纯数字及括号等结构重复，不作为停止依据。
      if (/\p{L}/u.test(unit) && !(argumentsChannel && /^[A-Za-z0-9+/=]+$/.test(unit))) {
        let start = this.tail.length - period
        while (start > 0 && this.tail[start - 1] === this.tail[start - 1 + period]) start--
        const repeatedCharacters = this.tail.length - start
        const repetitions = Math.floor(repeatedCharacters / period)
        if (repeatedCharacters >= minimumCharacters && repetitions >= minimumRepeats)
          throw new GenerationLoopError({
            channel: this.channel,
            period,
            repetitions,
            repeatedCharacters,
          })
      }
      position = this.tail.lastIndexOf(anchor, position - 1)
    }
  }
}

/** 每次请求尝试单独建窗口；正文、思考及每个工具参数互不拼接。 */
export class OutputLoopGuard {
  private channels = new Map<string, ChannelWindow>()

  private add(channel: string, value: string | undefined): void {
    if (!value) return
    let window = this.channels.get(channel)
    if (!window) {
      window = new ChannelWindow(channel)
      this.channels.set(channel, window)
    }
    window.add(value)
  }

  check(delta: ChatDelta): void {
    delta.choices.forEach((choice, index) => {
      this.add(`content:${index}`, choice.delta.content)
      this.add(`reasoning:${index}`, choice.delta.reasoningContent)
      if (!choice.delta.reasoningContent)
        for (const payload of choice.delta.nativeReasoning ?? [])
          this.add(`reasoning:${index}`, payload.text)
      for (const call of choice.delta.toolCalls ?? []) {
        this.add(`arguments:${index}:${call.index}`, call.function?.arguments)
        this.add(`tool-name:${index}:${call.index}`, call.function?.name)
      }
    })
  }

  checkCompletion(completion: ChatCompletion): void {
    this.check({
      choices: completion.choices.map((choice) => ({
        delta: {
          content: choice.message.content ?? undefined,
          reasoningContent: choice.message.reasoningContent,
          nativeReasoning: choice.message.nativeReasoning,
          toolCalls: choice.message.toolCalls?.map((call, index) => ({ ...call, index })),
        },
      })),
    })
  }
}
