import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DistributedSyncService } from '../../../src/services/distributed/distributedSyncService'

const roots: string[] = []

function root() {
  const value = path.join(tmpdir(), `infos-distributed-${randomUUID()}`)
  roots.push(value)
  return value
}

function decryptBundle(bytes: Buffer, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
  ) as {
    manifest: { snapshotId: string; sourceServerId: string; files: Array<{ path: string }> }
    files: Record<string, string>
  }
}

afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true })
})

describe('DistributedSyncService 完整快照', () => {
  it('应同步全部用户数据并排除机器身份和运行时瞬态', async () => {
    const dataDir = path.join(root(), 'data')
    await mkdir(path.join(dataDir, 'principals', 'pero', 'workspace'), { recursive: true })
    await mkdir(path.join(dataDir, 'skills', 'demo'), { recursive: true })
    await mkdir(path.join(dataDir, 'logs'), { recursive: true })
    await mkdir(path.join(dataDir, 'kernel'), { recursive: true })
    await writeFile(path.join(dataDir, 'principals', 'pero', 'workspace', 'note.md'), '工作区')
    await writeFile(path.join(dataDir, 'skills', 'demo', 'skill.md'), '技能')
    await writeFile(path.join(dataDir, 'config.json'), '{"apiKey":"secret"}')
    await writeFile(path.join(dataDir, 'gateway_token.json'), 'machine-token')
    await writeFile(path.join(dataDir, 'kernel', 'nodes.json'), 'machine-node')
    await writeFile(path.join(dataDir, 'logs', 'runtime.log'), 'log')
    const backup = vi.fn(async (target: string) => writeFile(target, 'sqlite-snapshot'))
    const service = new DistributedSyncService(
      dataDir,
      { $client: { backup } } as never,
      'server-a',
    )
    const key = randomBytes(32)

    const bundle = decryptBundle(await service.createEncryptedSnapshot(key.toString('base64')), key)
    const paths = bundle.manifest.files.map((item) => item.path)

    expect(paths).toContain('infos.db')
    expect(paths).toContain('config.json')
    expect(paths).toContain('skills/demo/skill.md')
    expect(paths).toContain('principals/pero/workspace/note.md')
    expect(paths).not.toContain('gateway_token.json')
    expect(paths).not.toContain('kernel/nodes.json')
    expect(paths).not.toContain('logs/runtime.log')
  })

  it('应在重启边界原子应用并保留当前机器身份', async () => {
    const base = root()
    const sourceDir = path.join(base, 'source')
    const targetDir = path.join(base, 'target')
    await mkdir(path.join(sourceDir, 'skills'), { recursive: true })
    await writeFile(path.join(sourceDir, 'skills', 'source.md'), '来源数据')
    const backup = vi.fn(async (target: string) => writeFile(target, 'source-db'))
    const source = new DistributedSyncService(
      sourceDir,
      { $client: { backup } } as never,
      'server-source',
    )
    const key = randomBytes(32)
    const encrypted = await source.createEncryptedSnapshot(key.toString('base64'))
    const bundle = decryptBundle(encrypted, key)

    await mkdir(path.join(targetDir, 'distributed'), { recursive: true })
    await mkdir(path.join(targetDir, 'kernel'), { recursive: true })
    await writeFile(path.join(targetDir, 'gateway_token.json'), 'target-token')
    await writeFile(path.join(targetDir, 'kernel', 'nodes.json'), 'target-node')
    await writeFile(
      path.join(targetDir, 'distributed', 'server-credentials.key'),
      key.toString('base64'),
    )
    const syncRoot = path.join(base, '.infos-sync')
    await mkdir(syncRoot, { recursive: true })
    await writeFile(path.join(syncRoot, 'pending.bundle'), encrypted)
    await writeFile(
      path.join(syncRoot, 'pending.json'),
      JSON.stringify({ snapshotId: bundle.manifest.snapshotId, sourceServerId: 'server-source' }),
    )

    await expect(DistributedSyncService.applyPending(targetDir)).resolves.toBe(true)
    await expect(readFile(path.join(targetDir, 'skills', 'source.md'), 'utf8')).resolves.toBe(
      '来源数据',
    )
    await expect(readFile(path.join(targetDir, 'gateway_token.json'), 'utf8')).resolves.toBe(
      'target-token',
    )
    await expect(readFile(path.join(targetDir, 'kernel', 'nodes.json'), 'utf8')).resolves.toBe(
      'target-node',
    )

    const target = new DistributedSyncService(
      targetDir,
      { $client: { backup } } as never,
      'server-target',
    )
    await writeFile(path.join(targetDir, 'skills', 'source.md'), '同步后修改')
    await expect(target.stageRollback()).resolves.toBe(true)
    await expect(DistributedSyncService.applyPending(targetDir)).resolves.toBe(true)
    await expect(readFile(path.join(targetDir, 'gateway_token.json'), 'utf8')).resolves.toBe(
      'target-token',
    )
    await expect(readFile(path.join(targetDir, 'skills', 'source.md'), 'utf8')).rejects.toThrow()
  })
})
