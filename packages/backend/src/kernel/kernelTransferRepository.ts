import type {
  KernelExecutionId,
  KernelObjectId,
  KernelObjectRef,
  KernelProcessId,
  KernelTransferId,
  KernelTransferObject,
} from '@infos/shared'
import { eq } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { kernelTransfers } from '../database/schema'

/** Transfer Kernel Object 的持久元数据 Repository。 */
export class KernelTransferRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(transfer: KernelTransferObject): Promise<void> {
    const values = {
      transferId: transfer.transferId,
      objectGeneration: transfer.ref.generation,
      direction: transfer.direction,
      state: transfer.state,
      sourceRefJson: transfer.sourceRef ? JSON.stringify(transfer.sourceRef) : null,
      destinationRefJson: transfer.destinationRef ? JSON.stringify(transfer.destinationRef) : null,
      bytesTotal: transfer.bytesTotal ?? null,
      bytesTransferred: transfer.bytesTransferred,
      checksum: transfer.checksum ?? null,
      resultAssetRefJson: transfer.resultAssetRef ? JSON.stringify(transfer.resultAssetRef) : null,
      principalId: transfer.principalId,
      processId: transfer.processId ?? null,
      executionId: transfer.executionId ?? null,
      correlationId: transfer.correlationId,
      error: transfer.error ?? null,
      createdAt: transfer.createdAt,
      startedAt: transfer.startedAt ?? null,
      completedAt: transfer.completedAt ?? null,
    }
    await this.db
      .insert(kernelTransfers)
      .values(values)
      .onConflictDoUpdate({ target: kernelTransfers.transferId, set: values })
  }

  async find(transferId: KernelTransferId): Promise<KernelTransferObject | null> {
    const rows = await this.db
      .select()
      .from(kernelTransfers)
      .where(eq(kernelTransfers.transferId, transferId))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      transferId: row.transferId as KernelTransferId,
      ref: {
        objectType: 'transfer',
        objectId: row.transferId as KernelObjectId,
        generation: row.objectGeneration,
        ownerPrincipalId: row.principalId,
      },
      direction: row.direction as KernelTransferObject['direction'],
      state: row.state as KernelTransferObject['state'],
      sourceRef: this.parseRef(row.sourceRefJson),
      destinationRef: this.parseRef(row.destinationRefJson),
      bytesTotal: row.bytesTotal ?? undefined,
      bytesTransferred: row.bytesTransferred,
      checksum: row.checksum ?? undefined,
      resultAssetRef: this.parseRef(row.resultAssetRefJson),
      principalId: row.principalId,
      processId: row.processId ? (row.processId as KernelProcessId) : undefined,
      executionId: row.executionId ? (row.executionId as KernelExecutionId) : undefined,
      correlationId: row.correlationId,
      error: row.error ?? undefined,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    }
  }

  private parseRef(value: string | null): KernelObjectRef | undefined {
    return value ? (JSON.parse(value) as KernelObjectRef) : undefined
  }
}
