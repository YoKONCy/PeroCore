import { tokenCounter } from '../tokenizer/tokenCounter'

/** 只估算 Provider 实际发送的输入；二进制与签名不能当作普通文本编码。 */
export function estimateInputPayloadTokens(payload: Record<string, unknown>): number {
  let imageTokens = 0
  const serialized = JSON.stringify(payload, (key, value: unknown) => {
    if (key === 'encrypted_content' || key === 'signature' || key === 'thoughtSignature')
      return undefined
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>
      if (object.type === 'reasoning.encrypted')
        return { type: object.type, id: object.id, index: object.index }
      if (object.type === 'image_url' || object.type === 'input_image') {
        imageTokens += 1024
        return { type: object.type, image: '[图片内容]' }
      }
      if (object.type === 'image' && object.source) {
        imageTokens += 1024
        return { type: 'image', image: '[图片内容]' }
      }
      if (key === 'inlineData') {
        imageTokens += 1024
        return { mimeType: object.mimeType, data: '[媒体内容]' }
      }
      if (object.type === 'input_audio') return { type: 'input_audio', audio: '[音频内容]' }
    }
    return value
  })
  // 图片采用固定占位预估；各模型实际图像 Token 由上游决定。
  return tokenCounter.countTokens(serialized ?? '') + imageTokens
}
