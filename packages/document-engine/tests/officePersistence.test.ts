import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteDocumentEngine, asKernelNodeId } from '../src/index'

describe('办公文稿存储升级', () => {
  it('修改旧版数据库标记前写入完整 checkpoint 备份，升级后正文不变', () => {
    const path = mkdtempSync(join(tmpdir(), 'arca-office-migration-')),
      file = join(path, 'arca.sqlite')
    let engine: SqliteDocumentEngine | undefined
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep + 'arca-office-migration-'))
      throw new Error('测试临时目录不符合清理范围')
    try {
      engine = new SqliteDocumentEngine(file)
      const snapshot = engine.createDocument({
        title: '升级前的文稿',
        authorityNodeId: asKernelNodeId('arca'),
        ownerPrincipalId: 'owner',
      })
      engine.close()
      const raw = new Database(file)
      raw
        .prepare("UPDATE document_store_metadata SET value = '1' WHERE key = 'schema_version'")
        .run()
      raw.close()
      engine = new SqliteDocumentEngine(file)
      const backup = readdirSync(path).find(
        (name) => name.includes('.schema-1.') && name.endsWith('.backup.json'),
      )!
      expect(backup).toBeTruthy()
      const data = JSON.parse(readFileSync(join(path, backup), 'utf8'))
      expect(data.schemaVersion).toBe(1)
      expect(data.checkpoint.authorities[0].document.documentId).toBe(snapshot.documentId)
      expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
    } finally {
      engine?.close()
      rmSync(path, { recursive: true, force: true })
    }
  })
})
