import { isDeepStrictEqual } from 'node:util'

/** 按 JSON 数据语义核对请求体，不把对象键的序列化顺序写成协议要求。 */
export function jsonBody(expected: unknown) {
  const normalized = JSON.parse(JSON.stringify(expected))
  return {
    expected: normalized,
    asymmetricMatch(actual: unknown): boolean {
      if (typeof actual !== 'string') return false
      try {
        return isDeepStrictEqual(JSON.parse(actual), normalized)
      } catch {
        return false
      }
    },
    toString: () => 'JSON 请求体',
  }
}
