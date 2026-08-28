import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { AppError } from '../../lib/appError'
import { getDatabasePath } from '../../lib/env'
import type { DrizzleDb } from '../../database'

/** SQLite一致性快照基础设施服务。 */
export class DatabaseSnapshotService {
  constructor(private readonly db: DrizzleDb) {}

  async createCloudSnapshot(): Promise<{ path: string }> {
    const databasePath = getDatabasePath()
    const snapshotPath = path.join(path.dirname(databasePath), 'cloud-cache', 'infos.db')
    await mkdir(path.dirname(snapshotPath), { recursive: true })
    const client = (
      this.db as unknown as { $client?: { backup: (target: string) => Promise<unknown> } }
    ).$client
    if (!client?.backup) {
      throw new AppError('INTERNAL_ERROR', { message: '当前数据库驱动不支持安全快照' })
    }
    await client.backup(snapshotPath)
    return { path: snapshotPath }
  }
}
