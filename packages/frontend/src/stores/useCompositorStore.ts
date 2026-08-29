/**
 * useCompositorStore — 响应式状态仓储
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { frontendPerformance } from '../compositor/performanceBaseline'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { SurfaceFrame, SurfaceId, SurfaceNode, SurfaceNodeId } from '@infos/shared'

export interface CompositorSurface {
  surfaceId: SurfaceId
  generation: string
  threadId: string
  principalId: string
  executionId?: string
  messageId?: string
  revision: number
  sequence: number
  state: 'open' | 'committed' | 'failed' | 'disposed'
  nodes: SurfaceNode[]
  operationIds: Set<string>
  scopeId?: string
  suspended?: boolean
  windowIds?: ReadonlySet<string>
}

export interface CompositorWindow {
  windowId: string
  nodeId: string
  sessionId: string
  principalId: string
  state: 'open' | 'hidden' | 'closed'
}

export interface CompositorInputSeat {
  seatId: string
  sessionId: string
  principalId: string
  windowId: string
  epoch: number
  capabilities: readonly string[]
}

/** Internal Surface Protocol 的客户端合成状态；不持有业务权威数据。 */
export const useCompositorStore = defineStore('compositor', () => {
  const surfaces = shallowRef<Map<SurfaceId, CompositorSurface>>(new Map())
  const windows = shallowRef<Map<string, CompositorWindow>>(new Map())
  const inputSeats = shallowRef<Map<string, CompositorInputSeat>>(new Map())
  const pending = new Map<SurfaceId, SurfaceFrame[]>()
  const frameArrivals = new Map<string, number>()
  let frameHandle: number | null = null

  function enqueue(frame: SurfaceFrame): void {
    frameArrivals.set(frame.operationId, performance.now())
    frontendPerformance.observe(
      'surface_frame_bytes',
      new TextEncoder().encode(JSON.stringify(frame)).byteLength,
    )
    const queue = pending.get(frame.surfaceId) ?? []
    queue.push(frame)
    pending.set(frame.surfaceId, queue)
    if (frameHandle === null) {
      if (typeof requestAnimationFrame === 'function') frameHandle = requestAnimationFrame(flush)
      else flush()
    }
  }

  function flush(): void {
    const flushStartedAt = performance.now()
    let frameCount = 0
    let rejectedCount = 0
    frameHandle = null
    const next = new Map(surfaces.value)
    for (const [surfaceId, frames] of pending) {
      frames.sort((a, b) => a.sequence - b.sequence)
      let surface = next.get(surfaceId)
      for (const frame of frames) {
        frameCount += 1
        const rejected =
          Boolean(
            surface &&
            surface.generation !== frame.generation &&
            frame.operation.type !== 'surface.open',
          ) ||
          Boolean(surface?.operationIds.has(frame.operationId)) ||
          Boolean(surface && frame.sequence <= surface.sequence) ||
          Boolean(!surface && frame.operation.type !== 'surface.open')
        if (rejected) rejectedCount += 1
        const arrival = frameArrivals.get(frame.operationId)
        if (arrival !== undefined) {
          frontendPerformance.observe('surface_frame_to_flush_ms', performance.now() - arrival)
          frameArrivals.delete(frame.operationId)
        }
        surface = reduceFrame(surface, frame)
      }
      if (surface?.surfaceId !== surfaceId) next.delete(surfaceId)
      if (surface?.state === 'disposed') next.delete(surface.surfaceId)
      else if (surface) next.set(surface.surfaceId, surface)
    }
    pending.clear()
    surfaces.value = next
    frontendPerformance.observe('surface_flush_batch_frames', frameCount)
    frontendPerformance.observe('surface_flush_cpu_ms', performance.now() - flushStartedAt)
    frontendPerformance.observe('surface_rejected_frames', rejectedCount)
  }

  function get(surfaceId?: string): CompositorSurface | undefined {
    return surfaceId ? surfaces.value.get(surfaceId as SurfaceId) : undefined
  }

  function replaceScope(
    scopeId: string,
    descriptors: import('@infos/shared').SurfaceDescriptor[],
  ): void {
    const next = new Map(surfaces.value)
    for (const [surfaceId, surface] of next) {
      if (surface.scopeId === scopeId) next.delete(surfaceId)
    }
    for (const descriptor of descriptors) {
      next.set(descriptor.surfaceId, {
        ...descriptor,
        scopeId,
        suspended: false,
        operationIds: new Set(),
      })
    }
    surfaces.value = next
  }

  function replaceProjection(snapshot: import('@infos/shared').SurfaceProjectionSnapshot): void {
    replaceScope(snapshot.scopeId, snapshot.surfaces)
  }

  function replaceSnapshot(snapshot: import('@infos/shared').ConversationProjectionSnapshot): void {
    replaceScope(`conversation:${snapshot.threadId}`, snapshot.surfaces)
  }

  function mergeSnapshot(snapshot: import('@infos/shared').ConversationProjectionSnapshot): void {
    const scopeId = `conversation:${snapshot.threadId}`
    const next = new Map(surfaces.value)
    for (const descriptor of snapshot.surfaces) {
      const current = next.get(descriptor.surfaceId)
      if (current?.revision === descriptor.revision) continue
      next.set(descriptor.surfaceId, {
        ...descriptor,
        scopeId,
        suspended: current?.suspended ?? false,
        operationIds: current?.operationIds ?? new Set(),
      })
    }
    surfaces.value = next
  }

  function install(surface: import('@infos/shared').ConversationSurfaceDescriptor): void {
    const next = new Map(surfaces.value)
    next.set(surface.surfaceId, { ...surface, operationIds: new Set() })
    surfaces.value = next
  }

  function installLocalMessage(input: {
    localId: string
    threadId: string
    principalId: string
    content: string
    attachments?: import('../api/modules/attachmentsApi').AttachmentInfo[]
  }): string {
    const surfaceId = `local-message:${input.localId}` as SurfaceId
    install({
      surfaceId,
      generation: `local:${input.localId}`,
      messageId: input.localId,
      threadId: input.threadId,
      principalId: input.principalId,
      revision: 1,
      sequence: 0,
      state: 'committed',
      nodes: [
        ...(input.attachments?.map((attachment, index) => ({
          nodeId: `${surfaceId}:attachment:${index}` as SurfaceNodeId,
          kind: 'attachment' as const,
          lifecycle: 'stable' as const,
          revision: 1,
          props: {
            id: attachment.id,
            kind: attachment.kind,
            name: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
        })) ?? []),
        {
          nodeId: `${surfaceId}:markdown` as SurfaceNodeId,
          kind: 'markdown',
          lifecycle: 'stable',
          revision: 1,
          props: { source: input.content, phase: 'committed' },
        },
      ],
    })
    return surfaceId
  }

  function terminateThinking(surfaceId: string): void {
    const current = get(surfaceId)
    if (!current) return
    let changed = false
    const nodes = current.nodes.map((node) => {
      if (node.kind !== 'status') return node
      const props = node.props as import('@infos/shared').StatusSurfaceProps
      if (props.state !== 'thinking') return node
      changed = true
      return {
        ...node,
        revision: node.revision + 1,
        props: { ...props, state: 'cancelled' as const, message: '已终止' },
      }
    })
    const next = new Map(surfaces.value)
    next.set(current.surfaceId, {
      ...current,
      state: changed ? 'committed' : current.state,
      nodes: changed ? nodes : current.nodes,
      suspended: true,
    })
    surfaces.value = next
  }

  function setSuspended(surfaceId: string, suspended: boolean): void {
    const current = get(surfaceId)
    if (!current || current.suspended === suspended) return
    const next = new Map(surfaces.value)
    next.set(current.surfaceId, { ...current, suspended })
    surfaces.value = next
  }

  function setScopeSuspended(scopeId: string, suspended: boolean): void {
    const next = new Map(surfaces.value)
    for (const [surfaceId, surface] of next) {
      if (surface.scopeId === scopeId && surface.suspended !== suspended) {
        next.set(surfaceId, { ...surface, suspended })
      }
    }
    surfaces.value = next
  }

  /** 清理页面Scope中的非运行Surface；进行中的流式Surface跨页面切换继续存活。 */
  function disposeScope(scopeId: string, includeOpen = false): void {
    const next = new Map(surfaces.value)
    for (const [surfaceId, surface] of next) {
      if (surface.scopeId === scopeId && (includeOpen || surface.state !== 'open')) {
        next.delete(surfaceId)
        pending.delete(surfaceId)
      }
    }
    surfaces.value = next
  }

  function dispose(surfaceId: string): void {
    const next = new Map(surfaces.value)
    next.delete(surfaceId as SurfaceId)
    surfaces.value = next
    pending.delete(surfaceId as SurfaceId)
  }

  function registerWindow(window: CompositorWindow): void {
    const next = new Map(windows.value)
    next.set(window.windowId, { ...window })
    windows.value = next
  }

  function bindScopeToWindow(scopeId: string, windowId: string): void {
    const window = windows.value.get(windowId)
    if (!window || window.state === 'closed') throw new Error('COMPOSITOR_WINDOW_UNAVAILABLE')
    const next = new Map(surfaces.value)
    for (const [surfaceId, surface] of next) {
      if (surface.scopeId === scopeId) {
        next.set(surfaceId, {
          ...surface,
          windowIds: new Set([...(surface.windowIds ?? []), windowId]),
        })
      }
    }
    surfaces.value = next
  }

  function installInputSeat(seat: CompositorInputSeat): void {
    const window = windows.value.get(seat.windowId)
    if (
      !window ||
      window.state === 'closed' ||
      window.sessionId !== seat.sessionId ||
      window.principalId !== seat.principalId
    ) {
      throw new Error('COMPOSITOR_INPUT_SEAT_IDENTITY_MISMATCH')
    }
    const next = new Map(inputSeats.value)
    for (const [seatId, existing] of next) {
      if (existing.principalId === seat.principalId) next.delete(seatId)
    }
    next.set(seat.seatId, { ...seat, capabilities: [...seat.capabilities] })
    inputSeats.value = next
  }

  function requireInputSeat(windowId: string, capability: string): CompositorInputSeat {
    const window = windows.value.get(windowId)
    const seat = [...inputSeats.value.values()].find(
      (candidate) =>
        candidate.windowId === windowId &&
        candidate.sessionId === window?.sessionId &&
        candidate.principalId === window?.principalId &&
        candidate.capabilities.includes(capability),
    )
    if (!seat) throw new Error('COMPOSITOR_INPUT_SEAT_REQUIRED')
    return { ...seat, capabilities: [...seat.capabilities] }
  }

  function closeWindow(windowId: string): void {
    const nextWindows = new Map(windows.value)
    const current = nextWindows.get(windowId)
    if (current) nextWindows.set(windowId, { ...current, state: 'closed' })
    windows.value = nextWindows
    const nextSeats = new Map(inputSeats.value)
    for (const [seatId, seat] of nextSeats) if (seat.windowId === windowId) nextSeats.delete(seatId)
    inputSeats.value = nextSeats
    const nextSurfaces = new Map(surfaces.value)
    for (const [surfaceId, surface] of nextSurfaces) {
      if (surface.windowIds?.has(windowId)) {
        const remaining = new Set(surface.windowIds)
        remaining.delete(windowId)
        nextSurfaces.set(surfaceId, { ...surface, windowIds: remaining })
      }
    }
    surfaces.value = nextSurfaces
  }

  function surfacesForWindow(windowId: string): CompositorSurface[] {
    return [...surfaces.value.values()].filter((surface) => surface.windowIds?.has(windowId))
  }

  return {
    surfaces,
    windows,
    inputSeats,
    enqueue,
    flush,
    get,
    replaceScope,
    replaceProjection,
    replaceSnapshot,
    mergeSnapshot,
    install,
    installLocalMessage,
    terminateThinking,
    setSuspended,
    setScopeSuspended,
    disposeScope,
    dispose,
    registerWindow,
    bindScopeToWindow,
    installInputSeat,
    requireInputSeat,
    closeWindow,
    surfacesForWindow,
  }
})

function reduceFrame(
  current: CompositorSurface | undefined,
  frame: SurfaceFrame,
): CompositorSurface | undefined {
  if (current && current.generation !== frame.generation) {
    if (frame.operation.type !== 'surface.open') return current
    current = undefined
  }
  if (current?.operationIds.has(frame.operationId)) return current
  if (current && frame.sequence <= current.sequence) return current
  if (!current && frame.operation.type !== 'surface.open') return undefined

  const operationIds = new Set(current?.operationIds ?? [])
  operationIds.add(frame.operationId)
  if (operationIds.size > 2048) operationIds.delete(operationIds.values().next().value!)

  if (frame.operation.type === 'surface.open') {
    return {
      surfaceId: frame.surfaceId,
      generation: frame.generation,
      threadId: frame.operation.threadId,
      principalId: frame.operation.principalId,
      executionId: frame.executionId,
      revision: frame.revision,
      sequence: frame.sequence,
      state: 'open',
      nodes: frame.operation.nodes ?? [],
      operationIds,
    }
  }

  const surface: CompositorSurface = {
    ...current!,
    revision: frame.revision,
    sequence: frame.sequence,
    operationIds,
    nodes: [...current!.nodes],
  }

  const operation = frame.operation
  switch (operation.type) {
    case 'surface.append-text': {
      const existing = surface.nodes.find((node) => node.nodeId === operation.nodeId)
      const previous = (existing?.props as { source?: string } | undefined)?.source ?? ''
      const node: SurfaceNode = existing
        ? {
            ...existing,
            revision: frame.revision,
            props: { ...existing.props, source: previous + operation.delta },
          }
        : {
            nodeId: operation.nodeId,
            kind: 'markdown',
            lifecycle: 'stable',
            revision: frame.revision,
            props: { source: previous + operation.delta, phase: 'preview' },
          }
      surface.nodes = upsertNode(surface.nodes, node)
      break
    }
    case 'surface.patch-node': {
      const existing = surface.nodes.find((node) => node.nodeId === operation.nodeId)
      if (existing) {
        surface.nodes = upsertNode(surface.nodes, {
          ...existing,
          revision: frame.revision,
          props: { ...existing.props, ...operation.patch },
        })
      }
      break
    }
    case 'surface.upsert-node': {
      const existing = surface.nodes.find((node) => node.nodeId === operation.node.nodeId)
      const node = existing
        ? {
            ...operation.node,
            props: { ...existing.props, ...operation.node.props },
          }
        : operation.node
      surface.nodes = upsertNode(surface.nodes, node)
      break
    }
    case 'surface.commit': {
      return {
        ...operation.surface,
        scopeId: current?.scopeId,
        suspended: current?.suspended ?? false,
        operationIds,
      }
    }
    case 'surface.fail': {
      surface.nodes = upsertNode(
        surface.nodes.filter((item) => item.kind !== 'status'),
        {
          nodeId: `${surface.surfaceId}:error` as SurfaceNodeId,
          kind: 'error',
          lifecycle: 'stable',
          revision: frame.revision,
          props: { code: operation.code, message: operation.message },
        },
      )
      if (operation.content) {
        surface.nodes = upsertNode(surface.nodes, {
          nodeId: `${surface.surfaceId}:markdown` as SurfaceNodeId,
          kind: 'markdown',
          lifecycle: 'stable',
          revision: frame.revision,
          props: { source: operation.content, phase: 'committed' },
        })
      }
      surface.state = 'failed'
      break
    }
    case 'surface.dispose':
      surface.state = 'disposed'
      break
  }
  return surface
}

function upsertNode(nodes: SurfaceNode[], next: SurfaceNode): SurfaceNode[] {
  const index = nodes.findIndex((node) => node.nodeId === next.nodeId)
  if (index === -1) return [...nodes, next]
  const result = [...nodes]
  result[index] = next
  return result
}
