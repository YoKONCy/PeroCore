import { describe, expect, it } from 'vitest'
import type { PackageManifest } from '@infos/shared'
import {
  legacyPackageManifestToPackage,
  requiredToolsToRequirements,
  type LegacyPackageManifestInput,
  validatePackageManifest,
} from '@infos/backend/packages'

const historicalManifest: LegacyPackageManifestInput = {
  id: 'historical.tools',
  name: 'Historical Tools',
  version: '1.0.0',
  description: '历史工具安装输入',
  type: 'tool',
  entry: './index.js',
  tools: [{ name: 'demo', description: 'demo', parameters: { type: 'object' } }],
}

describe('Package Manifest', () => {
  it('应允许一个 Package 声明多种 Contribution', () => {
    const manifest: PackageManifest = {
      manifestVersion: 2,
      packageId: 'demo.package',
      name: 'Demo',
      version: '1.0.0',
      trust: 'signed',
      contributions: [
        { id: 'app.demo', kind: 'application' },
        {
          id: 'provider.demo',
          kind: 'capability-provider',
          capabilityType: 'demo.value',
          contractVersion: '1.0',
          operations: ['read'],
        },
        { id: 'skill.demo', kind: 'skill' },
      ],
    }
    expect(() => validatePackageManifest(manifest)).not.toThrow()
  })

  it('历史安装输入应在边界投影为 Package', () => {
    const manifest = legacyPackageManifestToPackage(historicalManifest)
    expect(manifest.manifestVersion).toBe(2)
    expect(manifest.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool.demo', kind: 'tool' }),
        expect.objectContaining({ id: 'skill.historical.tools', kind: 'skill' }),
      ]),
    )
  })

  it('Skill requiredTools 只应转换为 Requirement', () => {
    expect(requiredToolsToRequirements('writer', ['read_file', 'write_file'])).toEqual([
      expect.objectContaining({
        capabilityType: 'filesystem.object',
        operations: ['read', 'write'],
        required: true,
      }),
    ])
  })
})
