/**
 * browserInteractionRuntime — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  KernelCallContext,
  KernelNodeId,
  WebActionIntent,
  WebActionReceipt,
  WebInteractionScene,
} from '@infos/shared'
import type { BoundCapabilityPort } from '../kernel/capabilityDirectory'
import { InteractionSceneBuilder } from '../runtime/interactionSceneBuilder'
import { WebObjectStore } from '../runtime/webObjectStore'
import type { WebElementSnapshot, WebPageSnapshot } from '../runtime/webSnapshot.types'
import { BrowserActionLedger, type BrowserActionEvidence } from './browserActionLedger'
import { WebSiteModelRegistry } from './webSiteModelRegistry'

interface ElectronPageSnapshot {
  snapshotId?: string
  generation?: number
  contentHash?: string
  structureHash?: string
  url?: string
  title?: string
  text?: string
  groundedMarkdown?: string
  hiddenText?: string
  diff?: {
    previousSnapshotId?: string
    contentChanged?: boolean
    structureChanged?: boolean
    addedElementIds?: string[]
    removedElementIds?: string[]
  }
  elements?: Array<{
    handle?: string
    tag?: string
    text?: string
    role?: string
    name?: string
    type?: string
    disabled?: boolean
    checked?: boolean
    value?: string
    required?: boolean
    label?: string
    parentFormHandle?: string
    frameId?: string
    backendNodeId?: number
    bounds?: { x: number; y: number; width: number; height: number }
  }>
  viewport?: { width?: number; height?: number; scrollX?: number; scrollY?: number }
}

const READ_OPERATIONS = new Set([
  'inspect',
  'extract',
  'search',
  'screenshot',
  'elementScreenshot',
  'listTargets',
  'domQuery',
  'frameQuery',
  'sourceSearch',
  'networkQuery',
  'networkBody',
  'runtimeStatus',
])

/** Browser Tool的 Scene、网页注入防护、Receipt和 SiteModel编排层。 */
export class BrowserInteractionRuntime {
  readonly ledger = new BrowserActionLedger()
  readonly sites = new WebSiteModelRegistry()
  private readonly objects: WebObjectStore
  private readonly scenes = new InteractionSceneBuilder()
  private generation = 0

  constructor(
    private readonly port: BoundCapabilityPort,
    providerNodeId?: KernelNodeId,
  ) {
    this.objects = new WebObjectStore('system', providerNodeId)
  }

  async invoke(
    operation: string,
    input: Record<string, unknown>,
    context: KernelCallContext,
  ): Promise<{ result: unknown; scene?: WebInteractionScene; receipt?: WebActionReceipt }> {
    if (READ_OPERATIONS.has(operation)) {
      const result = await this.port.invoke(operation, input, context)
      const scene = operation === 'inspect' ? this.project(result) : undefined
      return { result, scene }
    }
    if (!this.port.offer?.operations.includes('inspect')) {
      return { result: await this.port.invoke(operation, input, context) }
    }

    let before: BrowserActionEvidence
    try {
      before = await this.observe(context, `执行 ${operation}`)
    } catch (error) {
      if (!['open', 'createTarget'].includes(operation)) throw error
      const result = await this.port.invoke(operation, input, context)
      const after = await this.observe(context, `完成 ${operation}`)
      return { result, scene: after.scene }
    }
    if (before.scene.injectionFindings.some((finding) => finding.severity === 'critical')) {
      throw new Error('WEB_INJECTION_BLOCKED: 页面包含 critical不可信指令')
    }
    const result = await this.port.invoke(operation, input, context)
    const after = await this.observe(context, `完成 ${operation}`)
    const target = String(input.handle ?? input.target ?? '')
    const targetObject = before.scene.objects.find(
      (object) => object.handle?.handleId === target || object.objectId === target,
    )
    const intent = this.intent(operation, input, before.scene, targetObject?.objectId)
    const receipt = this.ledger.record({
      actionId: context.correlationId,
      intent,
      targetHandle: targetObject?.handle,
      dispatchedInput: input,
      before,
      after,
    })
    if (receipt.verificationStatus !== 'unverified' && receipt.verificationStatus !== 'failed') {
      this.sites.learn(after.scene, receipt)
    }
    return { result, scene: after.scene, receipt }
  }

  private async observe(
    context: KernelCallContext,
    intent?: string,
  ): Promise<BrowserActionEvidence> {
    const raw = await this.port.invoke<Record<string, never>, ElectronPageSnapshot>(
      'inspect',
      {},
      context,
    )
    const scene = this.project(raw, intent)
    const network = await this.optional<Record<string, unknown>[]>('networkQuery', {}, context, [])
    const status = await this.optional<{
      pendingDialog?: unknown
      downloads?: Array<{ id?: string }>
    }>('runtimeStatus', {}, context, {})
    return {
      scene,
      contentHash: raw.contentHash ?? '',
      structureHash: raw.structureHash ?? '',
      networkRequestIds: network.map((entry) => String(entry.requestId ?? '')).filter(Boolean),
      dialogOpen: Boolean(status.pendingDialog),
      transferIds: (status.downloads ?? [])
        .map((download) => String(download.id ?? ''))
        .filter(Boolean),
    }
  }

  private project(raw: unknown, intent?: string): WebInteractionScene {
    const value = raw as ElectronPageSnapshot
    const generation = Math.max(1, Number(value.generation ?? 1))
    const page = this.pageSnapshot(value)
    const snapshot = this.objects.update(
      page,
      this.generation !== 0 && generation !== this.generation,
    )
    this.generation = generation
    const scene = this.scenes.build(snapshot, intent)
    this.objects.setScene(scene)
    return scene
  }

  private pageSnapshot(value: ElectronPageSnapshot): WebPageSnapshot {
    const elements: WebElementSnapshot[] = (value.elements ?? []).map((element) => ({
      handle: String(element.handle ?? ''),
      role: String(element.role ?? element.tag ?? 'generic'),
      name: String(element.name ?? element.text ?? ''),
      tag: String(element.tag ?? 'div'),
      disabled: Boolean(element.disabled),
      checked: element.checked,
      value: element.value,
      inputType: element.type,
      required: element.required,
      parentFormHandle: element.parentFormHandle,
      label: element.label,
      frameId: element.frameId,
      backendNodeId: element.backendNodeId,
      bounds: element.bounds,
    }))
    return {
      snapshotId: String(value.snapshotId ?? `snapshot:${value.generation ?? 1}`),
      contentHash: String(value.contentHash ?? ''),
      structureHash: String(value.structureHash ?? ''),
      url: String(value.url ?? 'about:blank'),
      title: String(value.title ?? ''),
      text: String(value.text ?? ''),
      hiddenText: String(value.hiddenText ?? ''),
      markdown: String(value.groundedMarkdown ?? value.text ?? ''),
      elements,
      frames: [],
      accessibility: elements.map((element) => ({
        role: element.role,
        name: element.name,
        value: element.value,
        disabled: element.disabled,
      })),
      viewport: {
        width: Number(value.viewport?.width ?? 0),
        height: Number(value.viewport?.height ?? 0),
        scrollX: Number(value.viewport?.scrollX ?? 0),
        scrollY: Number(value.viewport?.scrollY ?? 0),
      },
    }
  }

  private intent(
    operation: string,
    input: Record<string, unknown>,
    scene: WebInteractionScene,
    targetObjectId?: string,
  ): WebActionIntent {
    const sideEffect = ['open', 'back', 'createTarget', 'switchTarget', 'closeTarget'].includes(
      operation,
    )
      ? 'external-change'
      : ['click', 'nativeClick', 'handleDialog', 'uploadFile', 'downloadConfigure'].includes(
            operation,
          )
        ? 'commit'
        : 'local-change'
    return {
      summary: String(input.intent ?? `${operation}网页操作`),
      targetObjectId,
      origin: new URL(scene.url).origin,
      sideEffect,
      reversible: !['uploadFile', 'downloadConfigure'].includes(operation),
      expectedEffects:
        sideEffect === 'external-change'
          ? [{ kind: 'url', required: false }]
          : operation === 'downloadConfigure'
            ? [{ kind: 'download', required: false }]
            : ['click', 'nativeClick'].includes(operation)
              ? [
                  { kind: 'url', required: false },
                  { kind: 'structure', required: false },
                  { kind: 'object-state', required: false },
                ]
              : [{ kind: 'object-state', required: false }],
    }
  }

  private async optional<T>(
    operation: string,
    input: Record<string, unknown>,
    context: KernelCallContext,
    fallback: T,
  ): Promise<T> {
    if (!this.port.offer.operations.includes(operation)) return fallback
    try {
      return await this.port.invoke<Record<string, unknown>, T>(operation, input, context)
    } catch {
      return fallback
    }
  }
}
