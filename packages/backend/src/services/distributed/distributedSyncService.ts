import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import type { DrizzleDb } from '../../database'

const APP_VERSION = '0.9.3'
const BUNDLE_VERSION = 1
const SCHEMA_VERSION = 1
const MAX_FILE_COUNT = 100_000
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
const MACHINE_PATHS = new Set([
  'gateway_token.json',
  'jwt_secret.key',
  'kernel/nodes.json',
  'kernel/node-identity.json',
  'kernel/trust.json',
  'kernel/capability-device-tokens.json',
  'distributed/server-credentials.key',
  'distributed/servers.json',
  'distributed/last-sync.json',
  'electron-node-id.txt',
])
const EXCLUDED_ROOTS = new Set(['logs', 'temp', 'cache', 'cloud-cache', 'sync'])

export interface FullSyncManifest {
  bundleVersion: number
  schemaVersion: number
  snapshotId: string
  sourceServerId: string
  appVersion: string
  createdAt: string
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
  totalBytes: number
}

interface FullSyncBundle {
  manifest: FullSyncManifest
  files: Record<string, string>
}

interface SavedServer {
  serverId: string
  displayName: string
  endpoint: string
  tokenCiphertext: string
  certificateFingerprint?: string
  savedAt: string
  lastConnectedAt?: string
}

export interface PublicServerRecord {
  serverId: string
  displayName: string
  endpoint: string
  certificateFingerprint?: string
  savedAt: string
  lastConnectedAt?: string
}

/** 多 Server 手动全量快照、远程 Server 列表与重启边界原子导入。 */
export class DistributedSyncService {
  private readonly syncRoot: string
  private readonly serversFile: string
  private readonly keyFile: string

  constructor(
    private readonly dataDir: string,
    private readonly db: DrizzleDb,
    private readonly localServerId: string,
  ) {
    this.syncRoot = path.join(path.dirname(dataDir), '.infos-sync')
    this.serversFile = path.join(dataDir, 'distributed', 'servers.json')
    this.keyFile = path.join(dataDir, 'distributed', 'server-credentials.key')
  }

  identity(): { serverId: string; displayName: string; appVersion: string } {
    return {
      serverId: this.localServerId,
      displayName: process.env.INFOS_SERVER_NAME ?? this.localServerId,
      appVersion: APP_VERSION,
    }
  }

  async listServers(): Promise<PublicServerRecord[]> {
    return (await this.loadServers()).map((record) => ({
      serverId: record.serverId,
      displayName: record.displayName,
      endpoint: record.endpoint,
      certificateFingerprint: record.certificateFingerprint,
      savedAt: record.savedAt,
      lastConnectedAt: record.lastConnectedAt,
    }))
  }

  async probe(
    endpoint: string,
    token: string,
  ): Promise<{
    serverId: string
    displayName: string
    endpoint: string
    appVersion: string
    latencyMs: number
  }> {
    const normalized = this.normalizeEndpoint(endpoint)
    const startedAt = Date.now()
    const response = await fetch(`${normalized}/api/distributed/identity`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`REMOTE_SERVER_UNAVAILABLE: HTTP ${response.status}`)
    const body = (await response.json()) as {
      data?: { serverId?: string; displayName?: string; appVersion?: string }
    }
    const data = body.data
    if (!data?.serverId) throw new Error('REMOTE_SERVER_INVALID: 缺少 Server ID')
    return {
      serverId: data.serverId,
      displayName: data.displayName ?? data.serverId,
      endpoint: normalized,
      appVersion: data.appVersion ?? 'unknown',
      latencyMs: Date.now() - startedAt,
    }
  }

  async saveServer(input: {
    endpoint: string
    token: string
    displayName?: string
  }): Promise<PublicServerRecord> {
    const probe = await this.probe(input.endpoint, input.token)
    if (probe.serverId === this.localServerId) {
      throw new Error('REMOTE_SERVER_SELF: 不能把当前 Server 保存为远程来源')
    }
    const records = await this.loadServers()
    const record: SavedServer = {
      serverId: probe.serverId,
      displayName: input.displayName?.trim() || probe.displayName,
      endpoint: probe.endpoint,
      tokenCiphertext: await this.encryptLocal(input.token),
      savedAt:
        records.find((item) => item.serverId === probe.serverId)?.savedAt ??
        new Date().toISOString(),
      lastConnectedAt: new Date().toISOString(),
    }
    const next = records.filter((item) => item.serverId !== record.serverId)
    next.push(record)
    await this.saveServers(next)
    return {
      serverId: record.serverId,
      displayName: record.displayName,
      endpoint: record.endpoint,
      certificateFingerprint: record.certificateFingerprint,
      savedAt: record.savedAt,
      lastConnectedAt: record.lastConnectedAt,
    }
  }

  async removeServer(serverId: string): Promise<boolean> {
    const records = await this.loadServers()
    const next = records.filter((item) => item.serverId !== serverId)
    if (next.length === records.length) return false
    await this.saveServers(next)
    return true
  }

  async createEncryptedSnapshot(transferKeyBase64: string): Promise<Buffer> {
    const transferKey = Buffer.from(transferKeyBase64, 'base64')
    if (transferKey.length !== 32) throw new Error('SYNC_TRANSFER_KEY_INVALID')
    const bundle = await this.createBundle()
    return this.encrypt(Buffer.from(JSON.stringify(bundle)), transferKey)
  }

  async stageEncryptedSnapshot(
    encrypted: Buffer,
    transferKeyBase64: string,
    expectedSourceServerId?: string,
  ): Promise<FullSyncManifest> {
    const transferKey = Buffer.from(transferKeyBase64, 'base64')
    if (transferKey.length !== 32) throw new Error('SYNC_TRANSFER_KEY_INVALID')
    const bundle = JSON.parse(
      this.decrypt(encrypted, transferKey).toString('utf8'),
    ) as FullSyncBundle
    this.validateBundle(bundle, expectedSourceServerId ?? bundle.manifest.sourceServerId)
    await mkdir(this.syncRoot, { recursive: true })
    const localKey = await this.getLocalKey()
    await writeFile(
      path.join(this.syncRoot, 'pending.bundle'),
      this.encrypt(Buffer.from(JSON.stringify(bundle)), localKey),
      { mode: 0o600 },
    )
    await writeFile(
      path.join(this.syncRoot, 'pending.json'),
      JSON.stringify({
        snapshotId: bundle.manifest.snapshotId,
        sourceServerId: bundle.manifest.sourceServerId,
      }),
      'utf8',
    )
    return bundle.manifest
  }

  async stageFromServer(serverId: string): Promise<FullSyncManifest> {
    const record = (await this.loadServers()).find((item) => item.serverId === serverId)
    if (!record) throw new Error('REMOTE_SERVER_NOT_FOUND')
    const token = await this.decryptLocal(record.tokenCiphertext)
    const transferKey = randomBytes(32)
    const response = await fetch(`${record.endpoint}/api/distributed/snapshot`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Sync-Transfer-Key': transferKey.toString('base64'),
      },
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!response.ok) throw new Error(`SYNC_DOWNLOAD_FAILED: HTTP ${response.status}`)
    const encrypted = Buffer.from(await response.arrayBuffer())
    return this.stageEncryptedSnapshot(encrypted, transferKey.toString('base64'), serverId)
  }

  async pending(): Promise<{ snapshotId: string; sourceServerId: string } | null> {
    try {
      return JSON.parse(await readFile(path.join(this.syncRoot, 'pending.json'), 'utf8')) as {
        snapshotId: string
        sourceServerId: string
      }
    } catch {
      return null
    }
  }

  async lastSync(): Promise<(FullSyncManifest & { backupPath: string }) | null> {
    try {
      return JSON.parse(
        await readFile(path.join(this.dataDir, 'distributed', 'last-sync.json'), 'utf8'),
      ) as FullSyncManifest & { backupPath: string }
    } catch {
      return null
    }
  }

  async stageRollback(): Promise<boolean> {
    const lastSync = await this.lastSync()
    if (!lastSync?.backupPath) return false
    const backupPath = path.resolve(lastSync.backupPath)
    const relative = path.relative(path.resolve(this.syncRoot), backupPath)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(backupPath)) {
      throw new Error('SYNC_BACKUP_INVALID')
    }
    await mkdir(this.syncRoot, { recursive: true })
    await writeFile(
      path.join(this.syncRoot, 'rollback.json'),
      JSON.stringify({ backupPath, requestedAt: new Date().toISOString() }),
      { mode: 0o600 },
    )
    return true
  }

  private async createBundle(): Promise<FullSyncBundle> {
    const snapshotId = randomUUID()
    const snapshotRoot = path.join(this.syncRoot, `export-${snapshotId}`)
    const databaseSnapshot = path.join(snapshotRoot, 'infos.db')
    await mkdir(snapshotRoot, { recursive: true })
    const client = (
      this.db as unknown as { $client?: { backup(target: string): Promise<unknown> } }
    ).$client
    if (!client?.backup) throw new Error('SYNC_DATABASE_BACKUP_UNAVAILABLE')
    await client.backup(databaseSnapshot)

    const files: Record<string, string> = {}
    const descriptors: FullSyncManifest['files'] = []
    let totalBytes = 0
    const add = async (relativePath: string, physicalPath: string) => {
      if (descriptors.length >= MAX_FILE_COUNT) throw new Error('SYNC_FILE_COUNT_LIMIT_EXCEEDED')
      const bytes = await readFile(physicalPath)
      if (bytes.length > MAX_FILE_BYTES)
        throw new Error(`SYNC_FILE_SIZE_LIMIT_EXCEEDED: ${relativePath}`)
      if (totalBytes + bytes.length > MAX_TOTAL_BYTES)
        throw new Error('SYNC_TOTAL_SIZE_LIMIT_EXCEEDED')
      files[relativePath] = bytes.toString('base64')
      descriptors.push({
        path: relativePath,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      totalBytes += bytes.length
    }
    await add('infos.db', databaseSnapshot)
    await this.walkData(this.dataDir, '', async (relativePath, physicalPath) => {
      if (relativePath === 'infos.db') return
      await add(relativePath, physicalPath)
    })
    await rm(snapshotRoot, { recursive: true, force: true })
    return {
      manifest: {
        bundleVersion: BUNDLE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        snapshotId,
        sourceServerId: this.localServerId,
        appVersion: APP_VERSION,
        createdAt: new Date().toISOString(),
        files: descriptors.sort((left, right) => left.path.localeCompare(right.path)),
        totalBytes,
      },
      files,
    }
  }

  private async walkData(
    root: string,
    relative: string,
    visit: (relativePath: string, physicalPath: string) => Promise<void>,
  ): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name
      const normalized = next.replaceAll('\\', '/')
      if (MACHINE_PATHS.has(normalized)) continue
      if (!relative && EXCLUDED_ROOTS.has(entry.name)) continue
      if (entry.name.endsWith('-wal') || entry.name.endsWith('-shm') || entry.isSymbolicLink())
        continue
      if (entry.isDirectory()) await this.walkData(root, normalized, visit)
      else if (entry.isFile()) await visit(normalized, path.join(root, normalized))
    }
  }

  private validateBundle(bundle: FullSyncBundle, sourceServerId: string): void {
    if (!bundle?.manifest || !bundle.files || typeof bundle.files !== 'object') {
      throw new Error('SYNC_BUNDLE_INVALID')
    }
    if (bundle.manifest.bundleVersion !== BUNDLE_VERSION)
      throw new Error('SYNC_BUNDLE_VERSION_UNSUPPORTED')
    if (bundle.manifest.schemaVersion !== SCHEMA_VERSION)
      throw new Error('SYNC_SCHEMA_VERSION_UNSUPPORTED')
    if (bundle.manifest.files.length > MAX_FILE_COUNT)
      throw new Error('SYNC_FILE_COUNT_LIMIT_EXCEEDED')
    if (bundle.manifest.totalBytes > MAX_TOTAL_BYTES)
      throw new Error('SYNC_TOTAL_SIZE_LIMIT_EXCEEDED')
    if (bundle.manifest.sourceServerId !== sourceServerId)
      throw new Error('SYNC_SOURCE_ID_MISMATCH')
    const uniquePaths = new Set<string>()
    let totalBytes = 0
    for (const descriptor of bundle.manifest.files) {
      const safePath = this.safeRelative(descriptor.path)
      if (uniquePaths.has(safePath)) throw new Error(`SYNC_FILE_DUPLICATED: ${safePath}`)
      uniquePaths.add(safePath)
      if (descriptor.sizeBytes > MAX_FILE_BYTES)
        throw new Error(`SYNC_FILE_SIZE_LIMIT_EXCEEDED: ${safePath}`)
      totalBytes += descriptor.sizeBytes
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('SYNC_TOTAL_SIZE_LIMIT_EXCEEDED')
      const encoded = bundle.files[safePath]
      if (!encoded) throw new Error(`SYNC_FILE_MISSING: ${safePath}`)
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length !== descriptor.sizeBytes)
        throw new Error(`SYNC_FILE_SIZE_MISMATCH: ${safePath}`)
      if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
        throw new Error(`SYNC_FILE_CHECKSUM_MISMATCH: ${safePath}`)
      }
    }
    if (totalBytes !== bundle.manifest.totalBytes) throw new Error('SYNC_TOTAL_SIZE_MISMATCH')
  }

  private safeRelative(value: string): string {
    const normalized = value.replaceAll('\\', '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      path.isAbsolute(normalized)
    ) {
      throw new Error(`SYNC_PATH_INVALID: ${value}`)
    }
    return normalized
  }

  private normalizeEndpoint(value: string): string {
    const url = new URL(value.includes('://') ? value : `http://${value}`)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('REMOTE_ENDPOINT_INVALID')
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  }

  private async loadServers(): Promise<SavedServer[]> {
    try {
      const parsed = JSON.parse(await readFile(this.serversFile, 'utf8')) as {
        version: 1
        servers: SavedServer[]
      }
      return parsed.version === 1 && Array.isArray(parsed.servers) ? parsed.servers : []
    } catch {
      return []
    }
  }

  private async saveServers(servers: SavedServer[]): Promise<void> {
    await mkdir(path.dirname(this.serversFile), { recursive: true })
    await writeFile(this.serversFile, JSON.stringify({ version: 1, servers }, null, 2), {
      mode: 0o600,
    })
  }

  private async getLocalKey(): Promise<Buffer> {
    await mkdir(path.dirname(this.keyFile), { recursive: true })
    if (existsSync(this.keyFile)) return Buffer.from(await readFile(this.keyFile, 'utf8'), 'base64')
    const key = randomBytes(32)
    await writeFile(this.keyFile, key.toString('base64'), { mode: 0o600 })
    return key
  }

  private async encryptLocal(value: string): Promise<string> {
    return this.encrypt(Buffer.from(value), await this.getLocalKey()).toString('base64')
  }

  private async decryptLocal(value: string): Promise<string> {
    return this.decrypt(Buffer.from(value, 'base64'), await this.getLocalKey()).toString('utf8')
  }

  private encrypt(value: Buffer, key: Buffer): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  }

  private decrypt(value: Buffer, key: Buffer): Buffer {
    if (value.length < 28) throw new Error('SYNC_CIPHERTEXT_INVALID')
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
    decipher.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()])
  }

  /** 数据库打开前应用暂存包，保留当前机器身份并生成完整回滚目录。 */
  static async applyPending(dataDir: string): Promise<boolean> {
    const syncRoot = path.join(path.dirname(dataDir), '.infos-sync')
    const rollbackInfo = path.join(syncRoot, 'rollback.json')
    if (existsSync(rollbackInfo)) {
      const rollback = JSON.parse(await readFile(rollbackInfo, 'utf8')) as { backupPath?: string }
      const backupPath = rollback.backupPath ? path.resolve(rollback.backupPath) : ''
      const relative = backupPath ? path.relative(path.resolve(syncRoot), backupPath) : '..'
      if (
        !backupPath ||
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !existsSync(backupPath)
      ) {
        throw new Error('SYNC_BACKUP_INVALID')
      }
      const replaced = path.join(
        syncRoot,
        `replaced-${new Date().toISOString().replaceAll(':', '-')}`,
      )
      if (existsSync(dataDir)) await rename(dataDir, replaced)
      try {
        await rename(backupPath, dataDir)
        await rm(rollbackInfo, { force: true })
        return true
      } catch (error) {
        if (existsSync(dataDir)) await rename(dataDir, backupPath)
        if (existsSync(replaced)) await rename(replaced, dataDir)
        throw error
      }
    }
    const pendingBundle = path.join(syncRoot, 'pending.bundle')
    const pendingInfo = path.join(syncRoot, 'pending.json')
    if (!existsSync(pendingBundle) || !existsSync(pendingInfo)) return false
    const keyFile = path.join(dataDir, 'distributed', 'server-credentials.key')
    if (!existsSync(keyFile)) throw new Error('SYNC_LOCAL_KEY_MISSING')
    const key = Buffer.from(await readFile(keyFile, 'utf8'), 'base64')
    const encrypted = await readFile(pendingBundle)
    const iv = encrypted.subarray(0, 12)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(encrypted.subarray(12, 28))
    const bundle = JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8'),
    ) as FullSyncBundle

    const incoming = path.join(syncRoot, `incoming-${bundle.manifest.snapshotId}`)
    const backup = path.join(syncRoot, `backup-${new Date().toISOString().replaceAll(':', '-')}`)
    await rm(incoming, { recursive: true, force: true })
    await mkdir(incoming, { recursive: true })
    for (const descriptor of bundle.manifest.files) {
      const normalized = descriptor.path.replaceAll('\\', '/')
      if (
        !normalized ||
        normalized.startsWith('/') ||
        normalized.includes('../') ||
        path.isAbsolute(normalized)
      ) {
        throw new Error(`SYNC_PATH_INVALID: ${descriptor.path}`)
      }
      const bytes = Buffer.from(bundle.files[normalized] ?? '', 'base64')
      if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
        throw new Error(`SYNC_FILE_CHECKSUM_MISMATCH: ${normalized}`)
      }
      const target = path.join(incoming, normalized)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, bytes)
    }
    for (const machinePath of MACHINE_PATHS) {
      const source = path.join(dataDir, machinePath)
      if (!existsSync(source)) continue
      const target = path.join(incoming, machinePath)
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(source, target)
    }
    await mkdir(path.dirname(backup), { recursive: true })
    if (existsSync(dataDir)) await rename(dataDir, backup)
    try {
      await rename(incoming, dataDir)
      await rm(pendingBundle, { force: true })
      await rm(pendingInfo, { force: true })
      await mkdir(path.join(dataDir, 'distributed'), { recursive: true })
      await writeFile(
        path.join(dataDir, 'distributed', 'last-sync.json'),
        JSON.stringify({ ...bundle.manifest, backupPath: backup }, null, 2),
        'utf8',
      )
      return true
    } catch (error) {
      if (existsSync(dataDir)) await rm(dataDir, { recursive: true, force: true })
      if (existsSync(backup)) await rename(backup, dataDir)
      throw error
    }
  }
}
