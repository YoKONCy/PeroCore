import type { TokenUsagePurpose } from '@infos/shared'
import type { UsageInfo } from './types'

export interface LlmUsageAttempt {
  id: string
  startedAt: number
  finishedAt: number
  provider: string
  modelId: string
  agentId?: string
  channel?: string
  threadId?: string
  applicationId?: string
  executionId?: string
  step?: number
  promptHash?: string
  prefixHash?: string
  toolsHash?: string
  purpose: TokenUsagePurpose
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  usage?: UsageInfo
}

/** 缺失与非法计数保留为空，不能伪装成供应商回传的零。 */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function normalizeTokenUsage(values: {
  input: unknown
  output: unknown
  total?: unknown
  cachedRead?: unknown
  cachedWrite?: unknown
  reasoning?: unknown
}): UsageInfo | undefined {
  const input = tokenCount(values.input)
  const output = tokenCount(values.output)
  const total = tokenCount(values.total)
  if (input === undefined && output === undefined && total === undefined) return undefined
  return {
    promptTokens: input ?? 0,
    completionTokens: output ?? 0,
    totalTokens: Math.max(total ?? 0, (input ?? 0) + (output ?? 0)),
    inputReported: input !== undefined,
    outputReported: output !== undefined,
    cachedReadTokens: tokenCount(values.cachedRead),
    cachedWriteTokens: tokenCount(values.cachedWrite),
    reasoningTokens: tokenCount(values.reasoning),
  }
}
