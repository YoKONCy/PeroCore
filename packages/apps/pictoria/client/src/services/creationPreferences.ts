import type { CreationPreferences } from '../types'

/** 本地草稿可能不完整，不能让损坏的创作参数阻断整个画布挂载。 */
export function normalizeCreationPreferences(value: unknown): CreationPreferences {
  const record = (input: unknown): input is Record<string, unknown> =>
    Boolean(input && typeof input === 'object' && !Array.isArray(input))
  const source = record(value) ? value : {}
  return {
    stepId: typeof source.stepId === 'string' ? source.stepId : '',
    text: typeof source.text === 'string' ? source.text : '',
    inputsByStep: Object.fromEntries(
      Object.entries(record(source.inputsByStep) ? source.inputsByStep : {}).filter(
        (entry): entry is [string, Record<string, unknown>] => record(entry[1]),
      ),
    ),
  }
}
