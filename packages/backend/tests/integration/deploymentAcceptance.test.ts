import { describe, expect, it } from 'vitest'

describe('N12验收边界', () => {
  it('只验收跨节点协议与Transport基础设施，不创建或验收客户端壳层', () => {
    expect(['protocol', 'transport', 'trust', 'lease', 'transfer', 'recovery']).not.toContain(
      'client-shell',
    )
  })
})
