import type { ChatDelta } from './types'
import type { ConversationGenerationStats } from '@infos/shared'
import { tokenCount } from './usage'

/** 仅计本次模型请求耗时；工具执行发生在外层 ReAct，不进入速率分母。 */
export async function* measureModelGeneration(
  deltas: AsyncIterable<ChatDelta>,
  estimateOutput: () => number,
  onMeasured: (stats: ConversationGenerationStats) => void,
): AsyncGenerator<ChatDelta> {
  let startedAt = performance.now()
  let outputTokens: number | undefined
  let reasoningTokens = 0
  let activeAttempt = true
  const finishAttempt = () => {
    if (!activeAttempt) return
    activeAttempt = false
    onMeasured({
      outputTokens:
        outputTokens === undefined ? estimateOutput() : Math.max(0, outputTokens - reasoningTokens),
      modelDurationMs: Math.max(0, performance.now() - startedAt),
      modelCalls: 1,
      estimated: outputTokens === undefined,
    })
  }
  try {
    for await (const delta of deltas) {
      if (
        delta.retry?.state === 'waiting' ||
        delta.retry?.state === 'failed' ||
        delta.retry?.state === 'cancelled'
      )
        finishAttempt()
      if (delta.retry?.state === 'retrying') {
        startedAt = performance.now()
        activeAttempt = true
        outputTokens = undefined
        reasoningTokens = 0
      }
      if (delta.usage) {
        const output =
          delta.usage.outputReported === false
            ? undefined
            : tokenCount(delta.usage.completionTokens)
        if (output !== undefined) outputTokens = Math.max(outputTokens ?? 0, output)
        reasoningTokens = Math.max(reasoningTokens, tokenCount(delta.usage.reasoningTokens) ?? 0)
      }
      yield delta
    }
  } finally {
    finishAttempt()
  }
}
