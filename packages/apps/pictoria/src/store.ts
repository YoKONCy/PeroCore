import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { migrate } from './database/migrate'
import type { Asset, Run } from './domain'
import { persistenceError } from './requestSafety'

export class Store {
  readonly db: Database.Database
  private readonly key: Buffer
  constructor(
    readonly root: string,
    migrationRoot: string,
  ) {
    mkdirSync(root, { recursive: true })
    const keyPath = path.join(root, 'credentials.key')
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    this.key = readFileSync(keyPath)
    if (this.key.length !== 32) throw new Error('凭据密钥损坏')
    this.db = new Database(path.join(root, 'pictoria.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    try {
      migrate(this.db, migrationRoot)
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  get<T>(owner: string, kind: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT value_json FROM entities WHERE owner=? AND kind=? AND id=?')
      .get(owner, kind, id) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as T) : undefined
  }
  list<T>(owner: string, kind: string, limit = 100, offset = 0): T[] {
    return (
      this.db
        .prepare(
          'SELECT value_json FROM entities WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
        )
        .all(owner, kind, Math.min(200, limit), offset) as Array<{ value_json: string }>
    ).map((r) => JSON.parse(r.value_json) as T)
  }
  put<T extends { id: string; revision?: number }>(
    owner: string,
    kind: string,
    value: T,
    expected?: number,
  ): T & { revision: number } {
    return this.db.transaction(() => {
      const previous = this.get<T>(owner, kind, value.id)
      if (previous && expected !== previous.revision) throw new Error('版本冲突，请刷新后重试')
      if (!previous && expected !== undefined && expected !== 0)
        throw new Error('对象不存在或版本已变化')
      const next = { ...value, revision: (previous?.revision ?? 0) + 1 }
      this.db
        .prepare(
          'INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner,kind,id) DO UPDATE SET revision=excluded.revision,value_json=excluded.value_json,updated_at=excluded.updated_at',
        )
        .run(owner, kind, value.id, next.revision, JSON.stringify(next), new Date().toISOString())
      return next
    })()
  }
  remove(owner: string, kind: string, id: string, expected: number): void {
    const result = this.db
      .prepare('DELETE FROM entities WHERE owner=? AND kind=? AND id=? AND revision=?')
      .run(owner, kind, id, expected)
    if (result.changes !== 1) throw new Error('对象不存在或版本已变化')
  }
  secret(owner: string, id: string, value?: string | null): string | undefined {
    if (value === null) {
      this.db.prepare('DELETE FROM secrets WHERE owner=? AND id=?').run(owner, id)
      return undefined
    }
    if (value !== undefined) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      this.db
        .prepare('INSERT OR REPLACE INTO secrets VALUES (?, ?, ?)')
        .run(owner, id, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'))
      return value
    }
    const row = this.db
      .prepare('SELECT encrypted FROM secrets WHERE owner=? AND id=?')
      .get(owner, id) as { encrypted: string } | undefined
    if (!row) return undefined
    const bytes = Buffer.from(row.encrypted, 'base64')
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
  }
  run(id: string, owner?: string): Run | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM runs WHERE id=?${owner ? ' AND owner=?' : ''}`)
      .get(...(owner ? [id, owner] : [id])) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as Run) : undefined
  }
  runs(owner?: string, active = false): Run[] {
    const filters = [
      ...(owner ? ['owner=?'] : []),
      ...(active ? ["state IN ('queued','running')"] : []),
    ]
    return (
      this.db
        .prepare(
          `SELECT value_json FROM runs${filters.length ? ' WHERE ' + filters.join(' AND ') : ''} ORDER BY updated_at ${active ? 'ASC' : 'DESC LIMIT 200'}`,
        )
        .all(...(owner ? [owner] : [])) as Array<{ value_json: string }>
    ).map((r) => JSON.parse(r.value_json) as Run)
  }
  recoveryRuns(): Run[] {
    return (
      this.db
        .prepare(
          "SELECT value_json FROM runs WHERE state IN ('queued','running','waiting') ORDER BY updated_at",
        )
        .all() as Array<{ value_json: string }>
    ).map((row) => JSON.parse(row.value_json) as Run)
  }
  saveRun(run: Run): void {
    const next = { ...run, revision: run.revision + 1, updatedAt: new Date().toISOString() }
    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,value_json=excluded.value_json,updated_at=excluded.updated_at',
          )
          .run(run.id, run.owner, run.projectId, run.state, JSON.stringify(next), next.updatedAt)
        const eventId = `${run.id}:${next.revision}`
        this.db
          .prepare('INSERT INTO outbox(event_id,owner,run_id,value_json) VALUES (?, ?, ?, ?)')
          .run(
            eventId,
            run.owner,
            run.id,
            JSON.stringify({ eventId, runId: run.id, state: run.state, revision: next.revision }),
          )
      })()
    } catch (error) {
      throw persistenceError(error)
    }
    run.revision = next.revision
    run.updatedAt = next.updatedAt
  }
  accept(owner: string, requestKey: string, value: unknown, run: Run): Run {
    return this.db.transaction(() => {
      const fingerprint = requestFingerprint(value)
      const previous = this.db
        .prepare('SELECT fingerprint,run_id FROM requests WHERE owner=? AND request_key=?')
        .get(owner, requestKey) as { fingerprint: string; run_id: string } | undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('幂等键已经用于不同请求')
        return this.run(previous.run_id, owner)!
      }
      this.saveRun(run)
      this.db
        .prepare('INSERT INTO requests VALUES (?, ?, ?, ?)')
        .run(owner, requestKey, fingerprint, run.id)
      return run
    })()
  }
  request(owner: string, requestKey: string, value: unknown): Run | undefined {
    const previous = this.db
      .prepare('SELECT fingerprint,run_id FROM requests WHERE owner=? AND request_key=?')
      .get(owner, requestKey) as { fingerprint: string; run_id: string } | undefined
    if (!previous) return undefined
    if (previous.fingerprint !== requestFingerprint(value))
      throw new Error('幂等键已经用于不同请求')
    return this.run(previous.run_id, owner)
  }
  asset(id: string, owner: string): Asset {
    const row = this.db
      .prepare('SELECT value_json FROM assets WHERE id=? AND owner=?')
      .get(id, owner) as { value_json: string } | undefined
    if (!row) throw new Error('资源不存在或不属于当前使用者')
    return JSON.parse(row.value_json) as Asset
  }
  saveAsset(asset: Asset): void {
    this.db
      .prepare('INSERT INTO assets VALUES (?, ?, ?)')
      .run(asset.id, asset.owner, JSON.stringify(asset))
  }
  events(after = 0) {
    return this.db
      .prepare(
        'SELECT sequence,event_id AS eventId,run_id AS runId,owner,value_json AS payload FROM outbox WHERE acknowledged=0 AND sequence>? ORDER BY sequence LIMIT 100',
      )
      .all(after) as Array<{
      sequence: number
      eventId: string
      runId: string
      owner: string
      payload: string
    }>
  }
  acknowledge(eventId: string): void {
    this.db.prepare('UPDATE outbox SET acknowledged=1 WHERE event_id=?').run(eventId)
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
  close(): void {
    this.key.fill(0)
    this.db.close()
  }
}

export function newId(): string {
  return randomUUID()
}

export function requestFingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, normalize(value)]),
    )
  }
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex')
}
