/** 局域网 HTTP 也使用安全随机数，避免依赖仅在安全上下文提供的 randomUUID。 */
export function createClientUuid(): string {
  const provider = globalThis.crypto
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID()
  if (typeof provider?.getRandomValues !== 'function')
    throw new Error('当前浏览器不支持安全随机数，请升级浏览器')
  const bytes = provider.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 手机 HTTP 使用用户手势触发的复制回退，失败时交给调用方提示。 */
export async function copyClientText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      /* 浏览器权限或非安全上下文限制时，继续使用兼容接口。 */
    }
  }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : []
  const input = document.createElement('textarea')
  input.value = value
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px'
  document.body.append(input)
  try {
    input.select()
    input.setSelectionRange(0, value.length)
    if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请长按文字手动复制')
  } finally {
    input.remove()
    focused?.focus({ preventScroll: true })
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
  }
}
