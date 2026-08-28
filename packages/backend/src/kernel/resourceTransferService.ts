/**
 * resourceTransferService — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  KernelAssetObject,
  KernelObjectRef,
  KernelRuntimeEvent,
  KernelTransferId,
  KernelTransferObject,
  KernelTransferState,
} from '@infos/shared'
import { AssetFileAuthority } from './assetFileAuthority'
import { KernelAssetRepository } from './kernelAssetRepository'
import { KernelOutboxRepository } from './kernelOutboxRepository'
import { KernelTransferRepository } from './kernelTransferRepository'
import { RuntimeEventChannel } from './runtimeEventChannel'
import { TransferRegistry, type CreateTransferInput } from './transferRegistry'

/** Transfer 状态、持久元数据、Runtime Event 与 Durable Fact 的统一边界。 */
export class ResourceTransferService {
  constructor(
    readonly assets: AssetFileAuthority,
    readonly transfers: TransferRegistry,
    readonly events: RuntimeEventChannel,
    private readonly assetRepository: KernelAssetRepository,
    private readonly transferRepository: KernelTransferRepository,
    private readonly outbox: KernelOutboxRepository,
  ) {}

  async persistAsset(asset: KernelAssetObject, storageRef: string): Promise<void> {
    await this.assetRepository.save(asset, storageRef)
  }

  async create(input: CreateTransferInput): Promise<KernelTransferObject> {
    const transfer = this.transfers.create(input)
    await this.record(transfer, 'kernel.transfer.created')
    return transfer
  }

  async transition(
    transferId: KernelTransferId,
    state: KernelTransferState,
    input: { error?: string; resultAssetRef?: KernelObjectRef; checksum?: string } = {},
  ): Promise<KernelTransferObject> {
    const transfer = this.transfers.transition(transferId, state, input)
    await this.record(transfer, `kernel.transfer.${state}`)
    return transfer
  }

  async progress(
    transferId: KernelTransferId,
    bytesTransferred: number,
    bytesTotal?: number,
  ): Promise<KernelTransferObject> {
    const transfer = this.transfers.progress(transferId, bytesTransferred, bytesTotal)
    await this.transferRepository.save(transfer)
    await this.events.publish({
      runtimeRef: transfer.ref,
      objectRef: transfer.ref,
      eventType: 'kernel.transfer.progress',
      executionId: transfer.executionId,
      processId: transfer.processId,
      correlationId: transfer.correlationId,
      payload: this.publicPayload(transfer),
    })
    return transfer
  }

  private async record(transfer: KernelTransferObject, eventType: string): Promise<void> {
    await this.transferRepository.save(transfer)
    const payload = this.publicPayload(transfer)
    await this.events.publish({
      runtimeRef: transfer.ref,
      objectRef: transfer.ref,
      eventType,
      executionId: transfer.executionId,
      processId: transfer.processId,
      correlationId: transfer.correlationId,
      payload,
    })
    await this.outbox.enqueue({
      protocolVersion: 1,
      type: eventType,
      durability: 'durable',
      principalId: transfer.principalId,
      processId: transfer.processId,
      executionId: transfer.executionId,
      correlationId: transfer.correlationId,
      object: transfer.ref,
      payload,
    })
  }

  private publicPayload(transfer: KernelTransferObject): Record<string, unknown> {
    return {
      transferId: transfer.transferId,
      direction: transfer.direction,
      state: transfer.state,
      bytesTotal: transfer.bytesTotal,
      bytesTransferred: transfer.bytesTransferred,
      checksum: transfer.checksum,
      resultAssetRef: transfer.resultAssetRef,
      error: transfer.error,
    }
  }
}

export type ResourceTransferEvent = KernelRuntimeEvent<Record<string, unknown>>
