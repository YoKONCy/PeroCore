import type { NativeReasoningPayload } from './types'

/** 将流式推理片段合并为协议块；纯文本思考已存在 reasoningContent，不重复保存。 */
export function appendNativeReasoning(
  target: NativeReasoningPayload[],
  incoming: NativeReasoningPayload[],
): void {
  for (const payload of incoming) {
    if (payload.format === 'reasoning_content') continue
    if (payload.format === 'reasoning_details' && Array.isArray(payload.opaque)) {
      let bucket = target.find((item) => item.format === 'reasoning_details')
      if (!bucket) {
        bucket = { format: 'reasoning_details', opaque: [] }
        target.push(bucket)
      }
      const details = bucket.opaque as Array<Record<string, unknown>>
      for (const value of payload.opaque) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const part = value as Record<string, unknown>
        if (
          part.id === undefined &&
          part.index === undefined &&
          typeof part.text !== 'string' &&
          typeof part.summary !== 'string'
        ) {
          // 无标识的签名块不能猜测属于同一个块，完整保留。
          details.push(structuredClone(part))
          continue
        }
        const previous = details.find(
          (item) =>
            item.type === part.type &&
            (part.id !== undefined ? item.id === part.id : (item.index ?? 0) === (part.index ?? 0)),
        )
        if (!previous) details.push(structuredClone(part))
        else {
          // text、summary 是增量；签名和加密数据保留上游最后提供的完整值。
          const text =
            typeof part.text === 'string' ? String(previous.text ?? '') + part.text : previous.text
          const summary =
            typeof part.summary === 'string'
              ? String(previous.summary ?? '') + part.summary
              : previous.summary
          Object.assign(previous, structuredClone(part))
          if (text !== undefined) previous.text = text
          if (summary !== undefined) previous.summary = summary
        }
      }
      continue
    }
    if (
      payload.format === 'responses_reasoning' &&
      payload.opaque &&
      typeof payload.opaque === 'object'
    ) {
      const object = payload.opaque as Record<string, unknown>
      const index =
        object.id === undefined
          ? -1
          : target.findIndex(
              (item) =>
                item.format === payload.format &&
                (item.opaque as Record<string, unknown> | undefined)?.id === object.id,
            )
      if (index < 0) target.push({ format: payload.format, opaque: structuredClone(object) })
      else target[index] = { format: payload.format, opaque: structuredClone(object) }
    }
  }
}

/** 恢复旧检查点时也移除重复文本包装，并合并历史流式片段。 */
export function compactNativeReasoning(
  payloads: NativeReasoningPayload[],
): NativeReasoningPayload[] {
  const result: NativeReasoningPayload[] = []
  appendNativeReasoning(result, payloads)
  return result
}
