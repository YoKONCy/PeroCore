/**
 * LLM 消息内容净化工具
 *
 * Provider 层的通用防御：工具返回 (role:'tool') 里若混入超长 base64 data URI
 * (如截图、音频)，会爆 token 且污染上下文，模型也只会看到一堆乱码。
 * 此处统一把 base64 data URI 替换为简短占位符。
 *
 * 注意：合法的多模态图片是以 image_url / inlineData 的「数组内容块」形式传递的
 * (非字符串)，本工具只处理字符串，不会影响正常的图片注入。
 *
 * @module packages/backend/src/services/llm/sanitize
 */

/** 匹配 base64 data URI，如 data:image/png;base64,iVBORw0... */
const RE_BASE64_DATA_URI = /data:([^;,\s]+);base64,[A-Za-z0-9+/=\s]+/g

/**
 * 剥离文本中的 base64 data URI，替换为占位符
 *
 * @param text - 原始文本 (可能内嵌 base64 data URI)
 * @returns 净化后的文本；若无匹配则原样返回
 */
export function stripBase64DataUris(text: string): string {
  if (!text.includes(';base64,')) return text
  return text.replace(RE_BASE64_DATA_URI, (_m, mime: string) => `[已省略 ${mime} base64 数据]`)
}
