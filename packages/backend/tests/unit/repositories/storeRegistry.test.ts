import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('MemoryStoreRegistry维度联动', () => {
  it('应使用配置的768维创建Store并接受768维向量', () => {
    const root = join(tmpdir(), `infos-store-dimension-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const resolver = {
      resolve(alias: string) {
        if (alias === '@data') return root
        if (alias.startsWith('@data/')) return join(root, alias.slice('@data/'.length))
        throw new Error(`未处理路径: ${alias}`)
      },
    }
    const registry = new MemoryStoreRegistry(resolver as never, 768)
    const store = registry.getAgentStore('pero')

    expect(() => store.insertWithId(1, new Array(768).fill(0), { content: '测试' })).not.toThrow()
    expect(registry.getDimension()).toBe(768)
    registry.closeAll()
  })

  it('应统计现有Agent与共享Store的真实节点总数且不创建缺失Store', () => {
    const root = join(tmpdir(), `infos-store-stats-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const resolver = {
      resolve(alias: string) {
        if (alias === '@data') return root
        if (alias.startsWith('@data/')) return join(root, alias.slice('@data/'.length))
        throw new Error(`未处理路径: ${alias}`)
      },
    }
    const registry = new MemoryStoreRegistry(resolver as never, 4)
    registry.getAgentStore('pero').insertWithId(1, [1, 0, 0, 0], { kind: 'event_note' })
    registry.getAgentStore('pero').insertWithId(2, [0, 1, 0, 0], { kind: 'event_entity' })
    registry.getSharedStore('facts').insertWithId(3, [0, 0, 1, 0], { kind: 'fact' })

    expect(registry.countExistingNodes(['pero', 'nana'])).toBe(3)
    expect(existsSync(registry.resolveAgentStorePath('nana', 'main'))).toBe(false)
    registry.closeAll()
  })

  it('重置Store时应清理TriviumDB 0.8.1的全部持久化文件', () => {
    const root = join(tmpdir(), `infos-store-reset-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const resolver = {
      resolve(alias: string) {
        if (alias === '@data') return root
        if (alias.startsWith('@data/')) return join(root, alias.slice('@data/'.length))
        throw new Error(`未处理路径: ${alias}`)
      },
    }
    const registry = new MemoryStoreRegistry(resolver as never, 4)
    const storePath = registry.resolveAgentStorePath('pero', 'main')
    mkdirSync(join(root, 'agent_pero'), { recursive: true })
    const suffixes = [
      '',
      '.vec',
      '.wal',
      '.lock',
      '.flush_ok',
      '.quiver',
      '.quiver.meta',
      '.text',
      '.text.meta',
      '.dimension',
    ]
    for (const suffix of suffixes) writeFileSync(`${storePath}${suffix}`, '测试')

    registry.resetAgentStore('pero', 'main')

    for (const suffix of suffixes) expect(existsSync(`${storePath}${suffix}`)).toBe(false)
  })
})
