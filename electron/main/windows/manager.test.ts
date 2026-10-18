import { describe, expect, it } from 'vitest'
import { resolveWindowBackground } from './windowConfig'

describe('resolveWindowBackground', () => {
  it('可缩放主窗口应使用不透明底色', () => {
    expect(resolveWindowBackground({ transparent: false })).toMatch(/^#[\da-f]{6}(?:ff)?$/i)
  })

  it('桌宠等透明窗口应继续使用透明底色', () => {
    expect(resolveWindowBackground({ transparent: true })).toMatch(/^#[\da-f]{6}00$/i)
  })
})
