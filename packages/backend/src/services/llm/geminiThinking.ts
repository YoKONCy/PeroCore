import type { ChatOptions, ReasoningEffort } from './types'

/** Gemini 2.5 使用预算；Gemini 4 Argon 使用等级，不能把等级当成固定思考长度。 */
export function geminiThinkingFamily(modelId: string): 'budget' | 'level' | undefined {
  if (/gemini[-_ ]?2\.5(?:[._ /-]|$)/i.test(modelId)) return 'budget'
  if (/gemini[-_ ]?4(?:[._ /-]|$)/i.test(modelId)) return 'level'
  return undefined
}

/** 兼容已保存的通用档位；Gemini 4 的最低等级仍会进行思考。 */
export function geminiReasoningEffort(
  modelId: string,
  effort?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (geminiThinkingFamily(modelId) !== 'level' || !effort) return effort
  return effort === 'off' ? 'low' : effort === 'xhigh' || effort === 'max' ? 'high' : effort
}

export function geminiThinkingConfig(
  modelId: string,
  opts: ChatOptions,
): Record<string, unknown> | undefined {
  const effort = geminiReasoningEffort(modelId, opts.reasoningEffort)
  if (!effort && !opts.returnNativeReasoning) return undefined
  const config: Record<string, unknown> = { includeThoughts: opts.returnNativeReasoning === true }
  if (effort) {
    if (geminiThinkingFamily(modelId) === 'level') config.thinkingLevel = effort
    else
      config.thinkingBudget = {
        off: 0,
        low: 1024,
        medium: 4096,
        high: 8192,
        xhigh: 16384,
        max: 32768,
      }[effort]
  }
  return config
}

/** Google 专用扩展只发给官方端点，避免影响其他兼容服务。 */
export function isGoogleGeminiEndpoint(base: string): boolean {
  try {
    return new URL(base).hostname === 'generativelanguage.googleapis.com'
  } catch {
    return false
  }
}
