/**
 * transferRegistry — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import type {
  KernelExecutionId,
  KernelObjectRef,
  KernelProcessId,
  KernelTransferDirection,
  KernelTransferId,
  KernelTransferObject,
  KernelTransferState,
} from '@infos/shared'
import { createResourceObjectRef } from '@infos/shared'

export interface CreateTransferInput {
  direction: KernelTransferDirection
  principalId: string
  correlationId: string
  sourceRef?: KernelObjectRef
  destinationRef?: KernelObjectRef
  bytesTotal?: number
  processId?: KernelProcessId
  executionId?: KernelExecutionId
}

const TRANSITIONS: Record<KernelTransferState, readonly KernelTransferState[]> = {
  pending: ['running', 'cancelled', 'failed'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

/** Transfer Kernel Object 的合法状态与进度权威。 */
export class TransferRegistry {
  private readonly transfers = new Map<KernelTransferId, KernelTransferObject>()

  create(input: CreateTransferInput): KernelTransferObject {
    if (input.bytesTotal !== undefined && input.bytesTotal < 0) {
      throw new Error('TRANSFER_INVALID_TOTAL: 总字节数不能为负数')
    }
    const transferId = randomUUID() as KernelTransferId
    const transfer: KernelTransferObject = {
      transferId,
      ref: createResourceObjectRef('transfer', transferId, input.principalId),
      direction: input.direction,
      sourceRef: input.sourceRef ? { ...input.sourceRef } : undefined,
      destinationRef: input.destinationRef ? { ...input.destinationRef } : undefined,
      state: 'pending',
      bytesTotal: input.bytesTotal,
      bytesTransferred: 0,
      principalId: input.principalId,
      processId: input.processId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    }
    this.transfers.set(transferId, transfer)
    return structuredClone(transfer)
  }

  get(transferId: KernelTransferId): KernelTransferObject | null {
    const transfer = this.transfers.get(transferId)
    return transfer ? structuredClone(transfer) : null
  }

  list(): KernelTransferObject[] {
    return [...this.transfers.values()].map((transfer) => structuredClone(transfer))
  }

  transition(
    transferId: KernelTransferId,
    state: KernelTransferState,
    input: { error?: string; resultAssetRef?: KernelObjectRef; checksum?: string } = {},
  ): KernelTransferObject {
    const transfer = this.require(transferId)
    if (transfer.state === state) return structuredClone(transfer)
    if (!TRANSITIONS[transfer.state].includes(state)) {
      throw new Error(`TRANSFER_INVALID_TRANSITION: ${transfer.state} → ${state}`)
    }
    if (state === 'completed' && !input.resultAssetRef) {
      throw new Error('TRANSFER_RESULT_REQUIRED: 完成状态必须包含 Asset Ref')
    }
    if (state === 'failed' && !input.error) {
      throw new Error('TRANSFER_ERROR_REQUIRED: 失败状态必须包含错误')
    }
    transfer.state = state
    if (state === 'running' && !transfer.startedAt) transfer.startedAt = new Date().toISOString()
    if (['completed', 'failed', 'cancelled'].includes(state)) {
      transfer.completedAt = new Date().toISOString()
    }
    transfer.error = input.error
    transfer.resultAssetRef = input.resultAssetRef ? { ...input.resultAssetRef } : undefined
    transfer.checksum = input.checksum
    return structuredClone(transfer)
  }

  progress(
    transferId: KernelTransferId,
    bytesTransferred: number,
    bytesTotal?: number,
  ): KernelTransferObject {
    const transfer = this.require(transferId)
    if (transfer.state !== 'running') {
      throw new Error('TRANSFER_NOT_RUNNING: 只有运行中的传输可以更新进度')
    }
    const total = bytesTotal ?? transfer.bytesTotal
    if (bytesTransferred < transfer.bytesTransferred || bytesTransferred < 0) {
      throw new Error('TRANSFER_PROGRESS_REGRESSION: 传输进度不能倒退')
    }
    if (total !== undefined && (total < 0 || bytesTransferred > total)) {
      throw new Error('TRANSFER_PROGRESS_OVERFLOW: 传输进度超过总量')
    }
    transfer.bytesTransferred = bytesTransferred
    transfer.bytesTotal = total
    return structuredClone(transfer)
  }

  private require(transferId: KernelTransferId): KernelTransferObject {
    const transfer = this.transfers.get(transferId)
    if (!transfer) throw new Error('TRANSFER_NOT_FOUND: 传输对象不存在')
    return transfer
  }
}
