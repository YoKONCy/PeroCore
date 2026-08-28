import { createHash } from 'node:crypto'
import type {
  KernelNodeId,
  KernelObjectId,
  KernelObjectRef,
  WebInteractionHandle,
  WebInteractionScene,
} from '@infos/shared'
import type { KernelObjectAdapter, KernelObjectRegistry } from '../kernel/kernelObjectRegistry'
import type { WebElementSnapshot, WebPageSnapshot } from './webSnapshot.types'

export interface WebObjectSnapshot {
  runtime: KernelObjectRef
  session: KernelObjectRef
  page: KernelObjectRef
  pageState: WebPageSnapshot
  diff: { contentChanged: boolean; structureChanged: boolean; previousSnapshotId?: string }
  scene?: WebInteractionScene
  elements: Array<{ ref: KernelObjectRef; state: WebElementSnapshot; handle: WebInteractionHandle }>
}

/** Web Runtime 的对象身份、代次与稳定元素句柄目录。 */
export class WebObjectStore implements KernelObjectAdapter {
  readonly objectType = 'web-page'
  readonly runtime: KernelObjectRef
  readonly session: KernelObjectRef
  private page: KernelObjectRef
  private pageState: WebPageSnapshot = {
    snapshotId: 'initial',
    contentHash: '',
    structureHash: '',
    url: 'about:blank',
    title: '',
    text: '',
    markdown: '',
    elements: [],
    frames: [],
    accessibility: [],
    viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 },
  }
  private readonly elementStates = new Map<string, WebElementSnapshot>()
  private readonly interactionHandles = new Map<string, WebInteractionHandle>()
  private scene?: WebInteractionScene
  private diff: WebObjectSnapshot['diff'] = {
    contentChanged: false,
    structureChanged: false,
  }

  constructor(
    ownerPrincipalId = 'system',
    private readonly authorityNodeId?: KernelNodeId,
  ) {
    this.runtime = this.ref('web-runtime', 'infos.browser/runtime', 1, ownerPrincipalId)
    this.session = this.ref('web-session', 'infos.browser/session/default', 1, ownerPrincipalId)
    this.page = this.ref('web-page', 'infos.browser/page/main', 1, ownerPrincipalId)
  }

  register(registry: KernelObjectRegistry): () => void {
    const removers = [
      registry.register(this),
      registry.register({ objectType: 'web-runtime', inspect: async () => this.snapshot() }),
      registry.register({ objectType: 'web-session', inspect: async () => this.snapshot() }),
      registry.register({ objectType: 'web-element', inspect: (ref) => this.inspectElement(ref) }),
    ]
    return () => removers.reverse().forEach((remove) => remove())
  }

  update(state: WebPageSnapshot, navigation: boolean): WebObjectSnapshot {
    if (navigation) this.page = { ...this.page, generation: this.page.generation + 1 }
    this.diff = {
      previousSnapshotId:
        this.pageState.snapshotId === 'initial' ? undefined : this.pageState.snapshotId,
      contentChanged: this.pageState.contentHash !== state.contentHash,
      structureChanged: this.pageState.structureHash !== state.structureHash,
    }
    this.pageState = state
    this.elementStates.clear()
    this.interactionHandles.clear()
    for (const element of state.elements) {
      this.elementStates.set(element.handle, element)
      this.interactionHandles.set(element.handle, this.createInteractionHandle(element))
    }
    return this.snapshot()
  }

  setScene(scene: WebInteractionScene): void {
    if (scene.snapshotId !== this.pageState.snapshotId) {
      throw new Error('WEB_SCENE_STALE: Scene 与当前页面快照不一致')
    }
    this.scene = structuredClone(scene)
  }

  rebind(handle: WebInteractionHandle): WebInteractionHandle {
    if (handle.documentGeneration !== this.page.generation) {
      throw new Error('RUNTIME_STALE_HANDLE: 不允许跨页面 generation 重绑定')
    }
    if (handle.backendNodeId !== undefined) {
      const exact = [...this.interactionHandles.values()].find(
        (candidate) => candidate.backendNodeId === handle.backendNodeId,
      )
      if (exact) return structuredClone(exact)
    }
    const candidates = [...this.interactionHandles.values()].map((candidate) => ({
      candidate,
      score:
        (candidate.semanticFingerprint === handle.semanticFingerprint ? 0.55 : 0) +
        (candidate.accessibleFingerprint === handle.accessibleFingerprint ? 0.3 : 0) +
        (candidate.geometryFingerprint === handle.geometryFingerprint ? 0.15 : 0),
    }))
    candidates.sort((left, right) => right.score - left.score)
    if (
      !candidates[0] ||
      candidates[0].score < 0.7 ||
      candidates[0].score === candidates[1]?.score
    ) {
      throw new Error('WEB_REBIND_AMBIGUOUS: 无法安全重绑定交互对象')
    }
    return structuredClone(candidates[0].candidate)
  }

  get pageRef(): KernelObjectRef {
    return { ...this.page }
  }

  resolveElement(handle: string): KernelObjectRef {
    if (!this.elementStates.has(handle)) throw new Error(`WEB_ELEMENT_NOT_FOUND: ${handle}`)
    return this.ref(
      'web-element',
      `infos.browser/page/main/element/${handle}`,
      this.page.generation,
      this.page.ownerPrincipalId,
    )
  }

  assertElement(ref: KernelObjectRef): WebElementSnapshot {
    if (ref.objectType !== 'web-element' || ref.generation !== this.page.generation) {
      throw new Error('RUNTIME_STALE_HANDLE: 元素句柄已因页面代次变化失效')
    }
    const handle = String(ref.objectId).split('/').pop() ?? ''
    const state = this.elementStates.get(handle)
    if (!state) throw new Error(`WEB_ELEMENT_NOT_FOUND: ${handle}`)
    return state
  }

  async inspect(ref: KernelObjectRef): Promise<WebObjectSnapshot> {
    if (ref.objectId !== this.page.objectId || ref.generation !== this.page.generation) {
      throw new Error('RUNTIME_STALE_HANDLE: 页面对象已失效')
    }
    return this.snapshot()
  }

  private snapshot(): WebObjectSnapshot {
    return {
      runtime: { ...this.runtime },
      session: { ...this.session },
      page: { ...this.page },
      pageState: structuredClone(this.pageState),
      diff: { ...this.diff },
      scene: this.scene ? structuredClone(this.scene) : undefined,
      elements: this.pageState.elements.map((state) => ({
        ref: this.resolveElement(state.handle),
        state: structuredClone(state),
        handle: structuredClone(this.interactionHandles.get(state.handle)!),
      })),
    }
  }

  private async inspectElement(ref: KernelObjectRef): Promise<WebElementSnapshot> {
    return structuredClone(this.assertElement(ref))
  }

  private createInteractionHandle(element: WebElementSnapshot): WebInteractionHandle {
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    return {
      handleId: element.handle,
      runtimeRef: { ...this.runtime },
      pageRef: { ...this.page },
      frameId: element.frameId,
      backendNodeId: element.backendNodeId,
      documentGeneration: this.page.generation,
      snapshotId: this.pageState.snapshotId,
      semanticFingerprint: hash(
        `${element.role}|${element.name}|${element.tag}|${element.value ?? ''}`,
      ),
      accessibleFingerprint: hash(`${element.role}|${element.name}`),
      geometryFingerprint: element.bounds ? hash(JSON.stringify(element.bounds)) : undefined,
      selectorHint: `[data-infos-handle="${element.handle}"]`,
    }
  }

  private ref(
    objectType: string,
    objectId: string,
    generation: number,
    ownerPrincipalId: string,
  ): KernelObjectRef {
    return {
      objectType,
      objectId: objectId as KernelObjectId,
      generation,
      ownerPrincipalId,
      authorityNodeId: this.authorityNodeId,
      authorityEpoch: this.authorityNodeId ? 1 : undefined,
    }
  }
}
