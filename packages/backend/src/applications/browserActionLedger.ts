/**
 * browserActionLedger — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import type {
  WebActionIntent,
  WebActionReceipt,
  WebInteractionHandle,
  WebInteractionScene,
  WebObservedEffect,
} from '@infos/shared'

export interface BrowserActionEvidence {
  scene: WebInteractionScene
  contentHash: string
  structureHash: string
  networkRequestIds: string[]
  dialogOpen: boolean
  transferIds: string[]
}

/** 保存可证明 Browser 动作及前后证据。 */
export class BrowserActionLedger {
  private readonly receipts = new Map<string, WebActionReceipt>()

  record(input: {
    actionId: string
    intent: WebActionIntent
    targetHandle?: WebInteractionHandle
    dispatchedInput: Record<string, unknown>
    before: BrowserActionEvidence
    after: BrowserActionEvidence
  }): WebActionReceipt {
    const observedEffects = this.effects(input.before, input.after)
    const required = input.intent.expectedEffects.filter((effect) => effect.required)
    const matchedRequired = required.filter((expected) =>
      observedEffects.some(
        (observed) =>
          observed.kind === expected.kind &&
          observed.matched &&
          (!expected.matcher || observed.summary.includes(expected.matcher)),
      ),
    )
    const matchedExpected = input.intent.expectedEffects.filter((expected) =>
      observedEffects.some(
        (observed) =>
          observed.kind === expected.kind &&
          observed.matched &&
          (!expected.matcher || observed.summary.includes(expected.matcher)),
      ),
    )
    const verificationStatus: WebActionReceipt['verificationStatus'] =
      (required.length > 0 && matchedRequired.length === required.length) ||
      (required.length === 0 && matchedExpected.length > 0)
        ? 'verified'
        : observedEffects.some((effect) => effect.matched)
          ? 'partially_verified'
          : 'unverified'
    const receipt: WebActionReceipt = {
      receiptId: `receipt:${randomUUID()}`,
      actionId: input.actionId,
      intent: structuredClone(input.intent),
      targetHandle: input.targetHandle ? structuredClone(input.targetHandle) : undefined,
      preSnapshotId: input.before.scene.snapshotId,
      postSnapshotId: input.after.scene.snapshotId,
      dispatchedInput: this.sanitize(input.dispatchedInput),
      observedEffects,
      verificationStatus,
      evidenceRefs: [input.before.scene.sceneId, input.after.scene.sceneId],
      createdAt: new Date().toISOString(),
      rollbackHint: input.intent.reversible ? '可通过重新观察并执行反向局部操作恢复' : undefined,
    }
    this.receipts.set(receipt.receiptId, receipt)
    return structuredClone(receipt)
  }

  get(receiptId: string): WebActionReceipt | null {
    const receipt = this.receipts.get(receiptId)
    return receipt ? structuredClone(receipt) : null
  }

  list(): WebActionReceipt[] {
    return [...this.receipts.values()].map((receipt) => structuredClone(receipt))
  }

  private effects(
    before: BrowserActionEvidence,
    after: BrowserActionEvidence,
  ): WebObservedEffect[] {
    return [
      {
        kind: 'url',
        summary: `${before.scene.url} → ${after.scene.url}`,
        matched: before.scene.url !== after.scene.url,
      },
      {
        kind: 'content',
        summary: before.contentHash === after.contentHash ? '正文未变化' : '正文已变化',
        matched: before.contentHash !== after.contentHash,
      },
      {
        kind: 'structure',
        summary: before.structureHash === after.structureHash ? '结构未变化' : '交互结构已变化',
        matched: before.structureHash !== after.structureHash,
      },
      {
        kind: 'network',
        summary: `新增网络请求 ${after.networkRequestIds.filter((id) => !before.networkRequestIds.includes(id)).length} 个`,
        matched: after.networkRequestIds.some((id) => !before.networkRequestIds.includes(id)),
      },
      {
        kind: 'dialog',
        summary: after.dialogOpen ? '出现 Dialog' : '未出现 Dialog',
        matched: !before.dialogOpen && after.dialogOpen,
      },
      {
        kind: 'download',
        summary: `新增 Transfer ${after.transferIds.filter((id) => !before.transferIds.includes(id)).length} 个`,
        matched: after.transferIds.some((id) => !before.transferIds.includes(id)),
      },
      {
        kind: 'object-state',
        summary:
          JSON.stringify(before.scene.objects.map((object) => object.state)) ===
          JSON.stringify(after.scene.objects.map((object) => object.state))
            ? '对象状态未变化'
            : '对象状态已变化',
        matched:
          JSON.stringify(before.scene.objects.map((object) => object.state)) !==
          JSON.stringify(after.scene.objects.map((object) => object.state)),
      },
    ]
  }

  private sanitize(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        /credential|secret|token|cookie|authorization|filePath/i.test(key) ? '[已隐藏]' : value,
      ]),
    )
  }
}
