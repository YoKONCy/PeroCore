// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  officialToolSignatures,
  resolveToolSignature,
} from '../../src/components/tools/toolSignatures'

describe('Tool Atelier签名目录', () => {
  it('全部官方签名应拥有唯一variant和完整状态字段', () => {
    const signatures = [...officialToolSignatures().entries()]
    const variants = signatures.map(([, signature]) => signature.variant)

    expect(signatures.length).toBeGreaterThanOrEqual(70)
    expect(new Set(variants).size).toBe(variants.length)
    for (const [, signature] of signatures) {
      expect(signature.archetype).toBeTruthy()
      expect(signature.chain).toBeTruthy()
      expect(signature.motion).toBeTruthy()
      expect(signature.silhouette).toBeTruthy()
      expect(signature.collapseDelayMs).toBe(600)
    }
  })

  it('相邻同类工具应共享链类型但保留独特variant', () => {
    const click = resolveToolSignature('browser_click')
    const type = resolveToolSignature('browser_type')
    const terminal = resolveToolSignature('terminal_execute')

    expect(click.chain).toBe(type.chain)
    expect(click.variant).not.toBe(type.variant)
    expect(click.chain).not.toBe(terminal.chain)
  })

  it('截图、编辑、传唤和完成任务应进入不同原型', () => {
    expect(resolveToolSignature('take_screenshot').archetype).toBe('vision-frame')
    expect(resolveToolSignature('edit_file').archetype).toBe('edit-splice')
    expect(resolveToolSignature('stronghold_summon_agents').archetype).toBe('stronghold-scene')
    expect(resolveToolSignature('finish_task').archetype).toBe('system-module')
  })

  it('社区工具应稳定回退到独立Generic节点', () => {
    const signature = resolveToolSignature('community_magic')
    expect(signature).toMatchObject({
      archetype: 'generic',
      chain: 'generic:community_magic',
      collapseDelayMs: 600,
    })
  })
})
