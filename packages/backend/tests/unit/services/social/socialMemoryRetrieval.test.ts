import { fileURLToPath } from 'node:url'
import { MdpEngine } from '@infos/backend/services/prompt/mdpEngine'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SocialAppCompiler } from '@infos/social/runtime/compiler'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

function fixture(dimension: number) {
  const temporaryRoot = join(process.cwd(), 'TEMP')
  mkdirSync(temporaryRoot, { recursive: true })
  const root = mkdtempSync(join(temporaryRoot, 'social-memory-retrieval-'))
  const stores = new MemoryStoreRegistry(
    {
      resolve: (alias: string) =>
        alias === '@data' ? root : join(root, alias.slice('@data/'.length)),
    } as never,
    dimension,
  )
  cleanup.push(() => {
    stores.closeAll()
    rmSync(root, { recursive: true, force: true })
  })
  const store = stores.getAgentStore('pero', 'social')
  store.insertWithId(1, Array(dimension).fill(0), { type: 'event', content: '一起研究蓝莓' })
  store.insertWithId(2, Array(dimension).fill(0), { type: 'feature', content: '蓝莓' })
  store.indexText(1, '一起研究蓝莓')
  store.indexKeyword(2, '蓝莓')
  store.link(2, 1, 'memory_edge', 1)
  store.buildTextIndex()
  const compiler = new SocialAppCompiler(
    { queryGrants: async () => [] } as never,
    {} as never,
    new MdpEngine(fileURLToPath(new URL('../../../../src/services/mdp/prompts/', import.meta.url))),
    stores,
  )
  const compile = () =>
    compiler.compile({
      instanceId: 'social-test',
      hostAgentId: 'pero',
      history: [],
      userMessage: '蓝莓',
      channelType: 'group',
    })
  return { stores, compile }
}

async function expectMemory(compile: ReturnType<typeof fixture>['compile']) {
  const result = await compile()
  expect(result.manifest.memoryCount).toBe(1)
  expect(result.messages.map((message) => message.content).join('\n')).toContain(
    '<long_term_memory>\n- 一起研究蓝莓',
  )
  expect(result.messages.map((message) => message.content).join('\n')).not.toContain('\n- 蓝莓\n')
}

describe('社交记忆检索的实际库维度', () => {
  it('768 维社交库无需配置或调用 Embedding 即可注入事件摘要', async () => {
    const { compile } = fixture(768)
    await expectMemory(compile)
  })

  it('同维度重建后仍能检索原有事件与关系', async () => {
    const { stores, compile } = fixture(768)
    expect(stores.rebuildSocialStore('pero')).toBe(2)
    await expectMemory(compile)
  })

  it('关闭重开后从主存恢复关键词与文本召回', async () => {
    const { stores, compile } = fixture(768)
    stores.closeAll()
    await expectMemory(compile)
  })

  it('同一编译器跟随 768 → 1536 → 768 的库切换，不复用旧占位数组', async () => {
    const { stores, compile } = fixture(768)
    for (const dimension of [768, 1536, 768]) {
      stores.resetAllForDimension(dimension)
      await expectMemory(compile)
    }
  })
})
