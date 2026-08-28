import { describe, expect, it } from 'vitest'
import { resolveWindowBackground } from './windowConfig'

describe('resolveWindowBackground', () => {
  it('可缩放主窗口应使用不透明底色', () => {
    expect(resolveWindowBackground({ transparent: false })).toBe('#f6f2ff')
  })

  it('桌宠等透明窗口应继续使用透明底色', () => {
    expect(resolveWindowBackground({ transparent: true })).toBe('#00000000')
  })
})
