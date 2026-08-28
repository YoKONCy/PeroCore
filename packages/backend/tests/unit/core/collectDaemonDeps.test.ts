import { describe, expect, it } from 'vitest'
import { classifyManifestDependencies } from '../../../../../scripts/collect-daemon-deps.mjs'

describe('Daemon 发行依赖分类', () => {
  it('应当区分必需依赖和可选依赖', () => {
    expect(
      classifyManifestDependencies({
        dependencies: {
          hono: '^4.0.0',
          xmlbuilder: '11.0.1',
        },
        optionalDependencies: {
          '@nut-tree-fork/nut-js': '^4.2.6',
          'node-pty': '^1.1.0',
        },
      }),
    ).toEqual([
      { name: 'hono', optional: false },
      { name: 'xmlbuilder', optional: false },
      { name: '@nut-tree-fork/nut-js', optional: true },
      { name: 'node-pty', optional: true },
    ])
  })

  it('同名依赖应当按 optionalDependencies 语义标记为可选', () => {
    expect(
      classifyManifestDependencies({
        dependencies: { demo: '^1.0.0' },
        optionalDependencies: { demo: '^1.0.0' },
      }),
    ).toEqual([{ name: 'demo', optional: true }])
  })

  it('缺少依赖字段时应当返回空列表', () => {
    expect(classifyManifestDependencies({})).toEqual([])
  })
})
