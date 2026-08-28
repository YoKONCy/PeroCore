import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDrizzleConnection, createDrizzleConnection } from '@infos/backend/database'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'
import type { PathResolver } from '@infos/backend/core/pathResolver'

const projectRoot = resolve(import.meta.dirname, '../../../../../..')
const temporaryPaths: string[] = []

function source(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8')
}

function resolver(root: string): PathResolver {
  return {
    resolve: (alias: string) => join(root, alias.replace(/^@data\/?/, '')),
  } as PathResolver
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('旧长记忆链路清理', () => {
  it('生产入口、工具注册、前端 API 与基线不得重新引用旧体系', () => {
    const combined = [
      source('packages/backend/src/container.ts'),
      source('packages/backend/src/services/context/contextCompiler.ts'),
      source('packages/backend/src/tools/index.ts'),
      source('packages/backend/src/capabilities/capabilityGate.ts'),
      source('packages/frontend/src/api/modules/memoryApi.ts'),
      source('packages/backend/src/database/migrations/0000_baseline.sql'),
    ].join('\n')

    for (const forbidden of [
      'search_diary',
      'MemoryGate',
      'CanonicalMemory',
      'LocalMemoryProvider',
      'DiaryEngine',
      'memory_nodes',
      'canonical_memories',
      'memory_candidates',
    ]) {
      expect(combined).not.toContain(forbidden)
    }
    expect(source('packages/frontend/src/api/modules/memoryApi.ts')).not.toMatch(
      /\b(search|remove|importStory)\s*[:(]/,
    )
  })

  it('既有 SQLite 连接时应物理删除全部旧记忆表', () => {
    const root = join(tmpdir(), `infos-legacy-db-${Date.now()}-${Math.random()}`)
    temporaryPaths.push(root)
    mkdirSync(root, { recursive: true })
    const databasePath = join(root, 'infos.db')

    const initialized = createDrizzleConnection(databasePath)
    closeDrizzleConnection(initialized)

    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TABLE memory_nodes (id INTEGER PRIMARY KEY);
      CREATE TABLE canonical_memories (id TEXT PRIMARY KEY);
      CREATE TABLE memory_candidates (id TEXT PRIMARY KEY);
      CREATE TABLE entity_cooccurrences (id INTEGER PRIMARY KEY);
      CREATE TABLE maintenance_records (id INTEGER PRIMARY KEY);
      CREATE TABLE trivium_sync_tasks (id INTEGER PRIMARY KEY);
    `)
    sqlite.close()

    const db = createDrizzleConnection(databasePath)
    try {
      const client = (db as unknown as { $client: Database.Database }).$client
      const oldTables = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memory_nodes','canonical_memories','memory_candidates','entity_cooccurrences','maintenance_records','trivium_sync_tasks')",
        )
        .all()

      expect(oldTables).toEqual([])
    } finally {
      closeDrizzleConnection(db)
    }
  })

  it('升级清理应删除旧 main/diary TDB 及旁路文件并保留新版库', () => {
    const root = join(tmpdir(), `infos-legacy-tdb-${Date.now()}-${Math.random()}`)
    temporaryPaths.push(root)
    const agentRoot = resolver(root).resolve('@data/agent_pero')
    mkdirSync(agentRoot, { recursive: true })
    for (const file of ['main.tdb', 'main.tdb.wal', 'diary.tdb', 'diary.tdb.text', 'memory.tdb']) {
      writeFileSync(join(agentRoot, file), file)
    }

    new MemoryStoreRegistry(resolver(root), 8).removeLegacyStores()

    expect(existsSync(join(agentRoot, 'memory.tdb'))).toBe(true)
    for (const file of ['main.tdb', 'main.tdb.wal', 'diary.tdb', 'diary.tdb.text']) {
      expect(existsSync(join(agentRoot, file))).toBe(false)
    }
  })
})
