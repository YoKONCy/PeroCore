import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientUuid, copyClientText } from '../../src/lib/clientPlatform'

afterEach(() => vi.unstubAllGlobals())

describe('局域网 HTTP 浏览器兼容', () => {
  it('缺少 randomUUID 时仍使用安全随机数生成不同的 UUID v4', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const ids = Array.from({ length: 4 }, () => createClientUuid())
    expect(new Set(ids).size).toBe(4)
    for (const id of ids)
      expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  })

  it('不使用可预测随机数替代缺失的安全随机源', () => {
    vi.stubGlobal('crypto', {})
    expect(() => createClientUuid()).toThrow('安全随机数')
  })

  it('HTTP 复制失败时保留明确错误，不伪报复制成功', async () => {
    const remove = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('window', { getSelection: () => null })
    vi.stubGlobal('document', {
      activeElement: null,
      body: { append: vi.fn() },
      createElement: () => ({ style: {}, select: vi.fn(), setSelectionRange: vi.fn(), remove }),
      execCommand: () => false,
    })
    await expect(copyClientText('正文')).rejects.toThrow('长按文字')
    expect(remove).toHaveBeenCalledOnce()
  })
})
