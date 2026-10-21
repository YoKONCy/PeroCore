import { computed, shallowRef } from 'vue'
import type { SurfaceNode, ToolCallSurfaceProps, ToolResultSurfaceProps } from '@infos/shared'

export interface PetToolStep {
  id: string
  parentId?: string
  name: string
  state: 'pending' | 'running' | 'completed' | 'failed'
}
export interface PetActivity {
  phase: 'idle' | 'thinking' | 'generating' | 'tools' | 'retrying' | 'failed'
  steps: PetToolStep[]
  nit: boolean
}
export interface PetUiRect {
  left: number
  right: number
  top: number
  bottom: number
}

/** 只保存轻量轨迹，不在桌宠复制思考正文、工具参数与执行结果。 */
export function usePetActivity() {
  const phase = shallowRef<PetActivity['phase']>('idle')
  const tools = shallowRef<PetToolStep[]>([])
  const nodeCalls = new Map<string, string>()
  const nodeKinds = new Map<string, SurfaceNode['kind']>()
  const results = new Map<string, boolean>()
  const activity = computed<PetActivity>(() => {
    const last = [...tools.value].reverse().find((step) => !step.parentId)
    const ids = new Set(last ? [last.id] : [])
    const children = last
      ? tools.value.filter((step) => {
          if (!step.parentId || !ids.has(step.parentId)) return false
          ids.add(step.id)
          return true
        })
      : []
    const nit = last?.name === 'run_script' || children.length > 0
    return {
      phase: phase.value,
      steps: nit ? children : last ? [last] : tools.value,
      nit,
    }
  })
  function reset(active = false) {
    phase.value = active ? 'thinking' : 'idle'
    tools.value = []
    nodeCalls.clear()
    nodeKinds.clear()
    results.clear()
  }
  function node(node: SurfaceNode) {
    nodeKinds.set(node.nodeId, node.kind)
    if (node.kind === 'tool-call') {
      const value = node.props as ToolCallSurfaceProps
      if (!value.callId) return
      nodeCalls.set(node.nodeId, value.callId)
      const previous = tools.value.find((step) => step.id === value.callId)
      const done = results.get(value.callId)
      const step: PetToolStep = {
        id: value.callId,
        parentId: value.parentCallId || previous?.parentId,
        name: value.name || previous?.name || '',
        state:
          done !== undefined
            ? done
              ? 'failed'
              : 'completed'
            : value.state === 'assembling'
              ? 'pending'
              : value.state === 'calling'
                ? 'running'
                : value.state,
      }
      tools.value = previous
        ? tools.value.map((item) => (item.id === step.id ? step : item))
        : [...tools.value, step]
      phase.value = 'tools'
    } else if (node.kind === 'tool-result') {
      const value = node.props as ToolResultSurfaceProps
      results.set(value.callId, value.isError)
      tools.value = tools.value.map((step) =>
        step.id === value.callId
          ? { ...step, state: value.isError ? 'failed' : 'completed' }
          : step,
      )
    } else if (node.kind === 'status') {
      const state = (node.props as { state?: string }).state
      if (['completed', 'cancelled', 'paused', 'waiting_input', 'blocked'].includes(state || ''))
        phase.value = 'idle'
      else if (state === 'failed') phase.value = 'failed'
      else if (state === 'generating') phase.value = 'generating'
      else if (state === 'thinking') phase.value = 'thinking'
      else if (state === 'calling' || state === 'assembling') phase.value = 'tools'
    } else if (node.kind === 'model-retry') {
      const state = (node.props as { state?: string }).state
      if (state === 'waiting' || state === 'retrying') phase.value = 'retrying'
    } else if (node.kind === 'thinking' || node.kind === 'native-reasoning')
      phase.value = 'thinking'
    else if (node.kind === 'markdown') phase.value = 'generating'
  }
  function patch(nodeId: string, value: Record<string, unknown>) {
    if (nodeKinds.get(nodeId) === 'status') {
      node({
        nodeId: nodeId as SurfaceNode['nodeId'],
        kind: 'status',
        revision: 0,
        lifecycle: 'transient',
        props: value,
      })
      return
    }
    const callId = nodeCalls.get(nodeId)
    if (!callId) return
    tools.value = tools.value.map((step) =>
      step.id === callId
        ? {
            ...step,
            name: typeof value.name === 'string' ? value.name : step.name,
            state:
              value.state === 'calling'
                ? 'running'
                : value.state === 'completed'
                  ? 'completed'
                  : value.state === 'failed'
                    ? 'failed'
                    : step.state,
          }
        : step,
    )
  }
  return {
    activity,
    reset,
    node,
    patch,
    finish: () => {
      phase.value = 'idle'
    },
  }
}
