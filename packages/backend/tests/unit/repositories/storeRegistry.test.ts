import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'
import { triviumFiles, upgradeBackupPath } from '@infos/backend/repositories/triviumFiles'

const roots: string[] = []
const temporaryRoot = fileURLToPath(new URL('../../../../../TEMP/', import.meta.url))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('MemoryStoreRegistry维度联动', () => {
  function fixture(dimension: number) {
    const root = join(temporaryRoot, `infos-index-rebuild-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const resolver = {
      resolve: (alias: string) =>
        alias === '@data' ? root : join(root, alias.slice('@data/'.length)),
    }
    return new MemoryStoreRegistry(resolver as never, dimension)
  }

  it('切换维度保留社交摘要、关键词和关系，并重建零向量', () => {
    const registry = fixture(768)
    try {
      const store = registry.getAgentStore('pero', 'social')
      store.insertWithId(1, Array(768).fill(0), {
        type: 'event',
        content: '一起研究蓝莓',
        timestamp: 10,
      })
      store.insertWithId(2, Array(768).fill(0), { type: 'feature', content: '蓝莓' })
      store.indexText(1, '一起研究蓝莓')
      store.indexKeyword(2, '蓝莓')
      store.link(2, 1, 'memory_edge', 0.8)
      expect(registry.listStoredAgentIds()).toContain('pero')
      registry.resetAllForDimension(1536)
      const rebuilt = registry.getAgentStore('pero', 'social')
      expect(rebuilt.dim()).toBe(1536)
      expect(rebuilt.nodeCount()).toBe(2)
      expect(rebuilt.get(1)?.payload).toMatchObject({ content: '一起研究蓝莓', timestamp: 10 })
      expect(rebuilt.get(1)?.vector).toHaveLength(1536)
      expect(rebuilt.getEdge(2, 1, 'memory_edge')?.weight).toBeCloseTo(0.8)
      expect(
        rebuilt.searchHybrid(Array(1536).fill(0), '蓝莓', 5, 1, 0, 0).map((hit) => hit.id),
      ).toContain(1)
    } finally {
      registry.closeAll()
    }
  })

  it('新库构建失败时保留原有图谱', () => {
    const registry = fixture(4)
    try {
      registry
        .getAgentStore('pero', 'social')
        .insertWithId(1, [0, 0, 0, 0], { content: '保留的记忆' })
      expect(() =>
        registry.replaceAgentStore('pero', 'social', () => {
          throw new Error('模拟构建失败')
        }),
      ).toThrow('模拟构建失败')
      expect(registry.getAgentStore('pero', 'social').get(1)?.payload).toEqual({
        content: '保留的记忆',
      })
      expect(() => registry.rebuildSocialStore('../outside')).toThrow('角色 ID 格式无效')
    } finally {
      registry.closeAll()
    }
  })

  it('启动配置已变更时仍能读取旧维度社交库并迁移', () => {
    const registry = fixture(768)
    registry
      .getAgentStore('pero', 'social')
      .insertWithId(1, Array(768).fill(0), { type: 'event', content: '旧摘要' })
    const target = registry.resolveAgentStorePath('pero', 'social')
    registry.closeAll()
    const resolver = {
      resolve: (alias: string) =>
        alias === '@data'
          ? join(target, '../..')
          : join(target, '../..', alias.slice('@data/'.length)),
    }
    const upgraded = new MemoryStoreRegistry(resolver as never, 1536)
    try {
      expect(upgraded.rebuildSocialStore('pero')).toBe(1)
      expect(upgraded.getAgentStore('pero', 'social').get(1)?.payload).toMatchObject({
        content: '旧摘要',
      })
    } finally {
      upgraded.closeAll()
    }
  })

  it('应使用配置的768维创建Store并接受768维向量', () => {
    const root = join(temporaryRoot, `infos-store-dimension-${Date.now()}-${Math.random()}`)
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
    const root = join(temporaryRoot, `infos-store-stats-${Date.now()}-${Math.random()}`)
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

  it('重置 Store 时清理 0.8.9 的全部文件组和升级备份，保留相邻文件', () => {
    const root = join(temporaryRoot, `infos-store-reset-${Date.now()}-${Math.random()}`)
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
      '.pidx',
      '.gidx',
      '.manifest.json',
      '.pld.1792345678900',
      '.pld.1792345678901',
      '.pld.1792345678901.tmp',
    ]
    for (const suffix of suffixes) writeFileSync(`${storePath}${suffix}`, '测试')
    writeFileSync(`${storePath}.notes.md`, '用户文档')
    const social = registry.resolveAgentStorePath('pero', 'social')
    writeFileSync(`${social}.pld.123`, '其他库')
    const backup = upgradeBackupPath(root, storePath)
    mkdirSync(backup, { recursive: true })
    writeFileSync(join(backup, '旧正文'), '待删除')
    const recovery = join(root, 'agent_pero', `.index-${randomUUID()}`, '.previous')
    mkdirSync(recovery, { recursive: true })
    writeFileSync(join(recovery, 'memory.tdb.pld.456'), '重建失败留下的正文')
    writeFileSync(join(recovery, 'social.tdb.pld.456'), '其他库的恢复文件')
    const removedAgentBackup = upgradeBackupPath(root, join(root, 'agent_removed', 'memory.tdb'))
    mkdirSync(removedAgentBackup, { recursive: true })
    expect(registry.listStoredAgentIds()).toContain('removed')

    registry.resetAgentStore('pero', 'main')

    for (const suffix of suffixes) expect(existsSync(`${storePath}${suffix}`)).toBe(false)
    expect(existsSync(backup)).toBe(false)
    expect(readFileSync(`${storePath}.notes.md`, 'utf8')).toBe('用户文档')
    expect(existsSync(`${social}.pld.123`)).toBe(true)
    expect(existsSync(join(recovery, 'memory.tdb.pld.456'))).toBe(false)
    expect(readFileSync(join(recovery, 'social.tdb.pld.456'), 'utf8')).toBe('其他库的恢复文件')
  })

  it('同步快照复制已刷新 Payload 文件组、冷 Store 与 SQLite，并允许继续写入', () => {
    const registry = fixture(4)
    const source = registry.resolveAgentStorePath('pero', 'main')
    const root = join(source, '../..')
    const snapshot = `${root}-snapshot`
    roots.push(snapshot)
    const clone = new MemoryStoreRegistry(
      {
        resolve: (alias: string) =>
          alias === '@data' ? snapshot : join(snapshot, alias.slice('@data/'.length)),
      } as never,
      4,
    )
    try {
      registry
        .getAgentStore('pero', 'social')
        .insertWithId(2, [0, 0, 0, 0], { content: '社交主存' })
      registry.closeAll()
      const store = registry.getAgentStore('pero', 'main')
      store.insertWithId(1, [1, 0, 0, 0], { content: '快照正文' })
      registry.captureSnapshot(snapshot, () => {
        mkdirSync(snapshot, { recursive: true })
        writeFileSync(join(snapshot, 'infos.db'), 'SQLite 同步副本')
      })
      expect(clone.getAgentStore('pero', 'main').get(1)?.payload).toEqual({ content: '快照正文' })
      expect(clone.getAgentStore('pero', 'social').get(2)?.payload).toEqual({ content: '社交主存' })
      const clonedPath = clone.resolveAgentStorePath('pero', 'main')
      expect(triviumFiles(clonedPath).some((file) => /\.pld\.\d+$/.test(file))).toBe(true)
      expect(readFileSync(join(snapshot, 'infos.db'), 'utf8')).toBe('SQLite 同步副本')
      store.insertWithId(3, [0, 1, 0, 0], { content: '快照后的写入' })
      expect(clone.getAgentStore('pero', 'main').get(3)).toBeNull()
      expect(() => registry.captureSnapshot(join(root, 'nested'), () => {})).toThrow('独立暂存目录')
    } finally {
      clone.closeAll()
      registry.closeAll()
    }
  })

  it('维度重置不递归删除工作区内同名数据库，并清理受管新版旁路文件', () => {
    const registry = fixture(4)
    const source = registry.resolveAgentStorePath('pero', 'main')
    const root = join(source, '../..')
    const userDirectory = join(root, 'principals', 'pero', 'workspace', 'agent_pero')
    mkdirSync(userDirectory, { recursive: true })
    writeFileSync(join(userDirectory, 'memory.tdb.pld.123'), '用户自己的数据')
    mkdirSync(join(root, 'agent_pero'), { recursive: true })
    writeFileSync(`${source}.pld.123`, '孤立的旧正文')
    try {
      registry.resetAllForDimension(8)
      expect(existsSync(`${source}.pld.123`)).toBe(false)
      expect(readFileSync(join(userDirectory, 'memory.tdb.pld.123'), 'utf8')).toBe('用户自己的数据')
      expect(readdirSync(join(root, 'agent_pero'))).toEqual([])
    } finally {
      registry.closeAll()
    }
  })
})
