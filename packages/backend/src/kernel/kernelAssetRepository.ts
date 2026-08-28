import type {
  KernelAssetId,
  KernelAssetObject,
  KernelObjectId,
  KernelObjectRef,
} from '@infos/shared'
import { eq } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { kernelAssets } from '../database/schema'

/** Asset 元数据持久化；storageRef 只对受信任 Authority 可见。 */
export class KernelAssetRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(asset: KernelAssetObject, storageRef: string): Promise<void> {
    await this.db
      .insert(kernelAssets)
      .values({
        assetId: asset.assetId,
        objectType: asset.ref.objectType,
        objectGeneration: asset.ref.generation,
        ownerPrincipalId: asset.ref.ownerPrincipalId,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        source: asset.source,
        storageRef,
        retention: asset.retention,
        createdAt: asset.createdAt,
      })
      .onConflictDoUpdate({
        target: kernelAssets.assetId,
        set: {
          objectGeneration: asset.ref.generation,
          kind: asset.kind,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256,
          storageRef,
          retention: asset.retention,
        },
      })
  }

  async find(
    assetId: KernelAssetId,
  ): Promise<{ asset: KernelAssetObject; storageRef: string } | null> {
    const rows = await this.db
      .select()
      .from(kernelAssets)
      .where(eq(kernelAssets.assetId, assetId))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    const ref: KernelObjectRef = {
      objectType: row.objectType,
      objectId: row.assetId as KernelObjectId,
      generation: row.objectGeneration,
      ownerPrincipalId: row.ownerPrincipalId,
    }
    return {
      asset: {
        assetId: row.assetId as KernelAssetId,
        ref,
        kind: row.kind,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        source: row.source as KernelAssetObject['source'],
        retention: row.retention as KernelAssetObject['retention'],
        createdAt: row.createdAt,
      },
      storageRef: row.storageRef,
    }
  }
}
