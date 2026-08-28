import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelAssetId, KernelTransferId } from '@infos/shared'
import { createResourceObjectRef } from '@infos/shared'
import { kernelAssets, kernelTransfers } from '@infos/backend/database/schema'
import { KernelAssetRepository, KernelTransferRepository } from '@infos/backend/kernel'

let sqlite: Database.Database | undefined

afterEach(() => {
  sqlite?.close()
  sqlite = undefined
})

function createDb() {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE kernel_assets (
      asset_id TEXT PRIMARY KEY, object_type TEXT NOT NULL, object_generation INTEGER NOT NULL,
      owner_principal_id TEXT NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, source TEXT NOT NULL,
      storage_ref TEXT NOT NULL, retention TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE kernel_transfers (
      transfer_id TEXT PRIMARY KEY, object_generation INTEGER NOT NULL, direction TEXT NOT NULL,
      state TEXT NOT NULL, source_ref_json TEXT, destination_ref_json TEXT, bytes_total INTEGER,
      bytes_transferred INTEGER NOT NULL, checksum TEXT, result_asset_ref_json TEXT,
      principal_id TEXT NOT NULL, process_id TEXT, execution_id TEXT, correlation_id TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
    );
  `)
  return drizzle(sqlite, { schema: { kernelAssets, kernelTransfers } }) as never
}

describe('Resource Foundation 持久元数据', () => {
  it('Asset Repository 应往返元数据与受信任 Storage Ref', async () => {
    const repository = new KernelAssetRepository(createDb())
    const assetId = 'asset-1' as KernelAssetId
    const asset = {
      assetId,
      ref: createResourceObjectRef('asset', assetId, 'pero'),
      kind: 'document',
      mimeType: 'text/plain',
      sizeBytes: 12,
      sha256: 'abc',
      source: 'user' as const,
      retention: 'persistent' as const,
      createdAt: new Date().toISOString(),
    }
    await repository.save(asset, 'asset-store://asset-1')
    await expect(repository.find(assetId)).resolves.toEqual({
      asset,
      storageRef: 'asset-store://asset-1',
    })
  })

  it('Transfer Repository 应往返状态、进度与 Asset 结果', async () => {
    const repository = new KernelTransferRepository(createDb())
    const transferId = 'transfer-1' as KernelTransferId
    const resultAssetRef = createResourceObjectRef('asset', 'asset-result', 'pero')
    const transfer = {
      transferId,
      ref: createResourceObjectRef('transfer', transferId, 'pero', 3),
      direction: 'download' as const,
      state: 'completed' as const,
      bytesTotal: 20,
      bytesTransferred: 20,
      checksum: 'hash',
      resultAssetRef,
      principalId: 'pero',
      correlationId: 'download-1',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    await repository.save(transfer)
    await expect(repository.find(transferId)).resolves.toEqual(transfer)
  })
})
