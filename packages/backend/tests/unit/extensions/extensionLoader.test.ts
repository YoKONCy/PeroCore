import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ExtensionLoader } from '@infos/backend/extensions/extensionLoader'

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/tools')

describe('ExtensionLoader 静态内置清单', () => {
  it('内置扫描时静默跳过静态注册的心流清单', async () => {
    const loader = new ExtensionLoader()

    await expect(
      loader.loadFromDir(path.join(toolsDir, 'flowState'), {
        skipStaticBuiltinManifests: true,
      }),
    ).resolves.toBeNull()
  })

  it('静态清单字段完整，非跳过模式可通过校验并加载', async () => {
    const loader = new ExtensionLoader()

    const result = await loader.loadFromDir(path.join(toolsDir, 'flowState'))
    expect(result?.error).toBeUndefined()
    expect(result?.manifest).toMatchObject({
      id: 'flow-state',
      type: 'tool',
      entry: 'index.ts',
    })
  })
})
