import { Tiktoken } from 'tiktoken/lite'
import o200kBase from 'tiktoken/encoders/o200k_base'
import type { ContextTokenizer } from '@infos/shared'

/** 后端统一使用的本地 o200k_base Tokenizer。 */
export class O200kTokenCounter implements ContextTokenizer {
  readonly tokenizerId = 'o200k_base'
  private readonly encoder = new Tiktoken(
    o200kBase.bpe_ranks,
    o200kBase.special_tokens,
    o200kBase.pat_str,
  )

  countTokens(content: string): number {
    if (!content) return 0
    return this.encoder.encode_ordinary(content).length
  }

  countMessages(messages: ReadonlyArray<{ role: string; content: unknown }>): number {
    return messages.reduce((total, message) => {
      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      return total + this.countTokens(message.role) + this.countTokens(content ?? '')
    }, 0)
  }
}

/** 单例复用词表与 WASM 实例，避免每次计数重复初始化。 */
export const tokenCounter = new O200kTokenCounter()
