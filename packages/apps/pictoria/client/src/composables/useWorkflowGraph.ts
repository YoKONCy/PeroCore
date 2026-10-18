import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CanvasItem, FieldSchema, OutputPort, InputPort } from '../types'
import type { Binding } from '../workflowTypes'
import { leaves } from '../workflowTypes'
import type { WorkflowStore } from './useWorkflow'
import { curve } from './useCanvasLinks'

interface Connection {
  source: string
  field: string
  port: OutputPort
  x: number
  y: number
}
interface Edge {
  id: string
  source: string
  output: string
  target: string
  field: string
  trail: Array<string | number>
  path: string
}
function references(
  binding: Binding,
  trail: Array<string | number> = [],
): Array<{
  binding: Exclude<Binding, { array: Binding[] } | { select: Binding }>
  trail: Array<string | number>
}> {
  return 'array' in binding
    ? binding.array.flatMap((item, index) => references(item, [...trail, 'array', index]))
    : 'select' in binding
      ? references(binding.select, [...trail, 'select'])
      : [{ binding, trail }]
}
function removeAt(binding: Binding, trail: Array<string | number>): Binding | undefined {
  if (!trail.length) return undefined
  if ('array' in binding && trail[0] === 'array')
    return {
      ...binding,
      array: binding.array.flatMap((item, index) =>
        index === trail[1]
          ? (() => {
              const next = removeAt(item, trail.slice(2))
              return next ? [next] : []
            })()
          : [item],
      ),
    }
  if ('select' in binding && trail[0] === 'select') {
    const next = removeAt(binding.select, trail.slice(1))
    return next ? { ...binding, select: next } : undefined
  }
  return binding
}
export function useWorkflowGraph(
  store: WorkflowStore,
  world: (x: number, y: number) => { x: number; y: number },
) {
  const connecting = ref<Connection>(),
    selectedEdge = ref(''),
    arranging = ref(false)
  let frame = 0,
    animation: Array<{ item: CanvasItem; fromX: number; fromY: number; x: number; y: number }> = []
  const fields = (id: string, output: boolean): Record<string, FieldSchema> =>
    id === '__input'
      ? store.doc.inputSchema.properties || {}
      : id === '__output'
        ? store.doc.outputSchema.properties || {}
        : (output
            ? store.stepFor(store.doc.nodes.find((node) => node.id === id))?.outputSchema
            : store.stepFor(store.doc.nodes.find((node) => node.id === id))?.inputSchema
          )?.properties || {}
  const anchor = (id: string, field: string, output: boolean, port: OutputPort | InputPort) => {
    const item = store.items.value.find((item) => item.id === id),
      index = Object.keys(fields(id, output)).indexOf(field)
    if (!item) return { x: 0, y: 0 }
    if (port === 'top' || port === 'bottom')
      return {
        x:
          item.x +
          (item.content.width * (Math.max(0, index) + 1)) /
            (Object.keys(fields(id, output)).length + 1),
        y: item.y + (port === 'bottom' ? item.content.height : 0),
      }
    return {
      x: item.x + (output ? item.content.width : 0),
      y: item.y + 73 + Math.max(0, index) * 34,
    }
  }
  const edges = computed<Edge[]>(() =>
    [
      ...store.doc.nodes.map((node) => ({ target: node.id, values: node.inputs })),
      { target: '__output', values: store.doc.outputs },
    ].flatMap(({ target, values }) =>
      Object.entries(values).flatMap(([field, binding]) =>
        references(binding).flatMap(({ binding: leaf, trail }) => {
          if ('literal' in leaf) return []
          const source = 'input' in leaf ? '__input' : leaf.node,
            output = 'input' in leaf ? leaf.input : leaf.output
          if (!store.items.value.some((item) => item.id === source)) return []
          const id = JSON.stringify([target, field, source, output, trail]),
            route = store.doc.routes[id] || {
              sourcePort: 'bottom' as const,
              targetPort: 'top' as const,
            }
          return [
            {
              id,
              source,
              output,
              target,
              field,
              trail,
              path: curve(
                anchor(source, output, true, route.sourcePort),
                anchor(target, field, false, route.targetPort),
                route.sourcePort,
                route.targetPort,
              ),
            },
          ]
        }),
      ),
    ),
  )
  const pendingPath = computed(() =>
    connecting.value
      ? curve(
          anchor(connecting.value.source, connecting.value.field, true, connecting.value.port),
          connecting.value,
          connecting.value.port,
          connecting.value.port === 'bottom' ? 'top' : 'left',
        )
      : '',
  )
  function finishArrangement() {
    cancelAnimationFrame(frame)
    frame = 0
    for (const value of animation) {
      value.item.x = value.x
      value.item.y = value.y
    }
    animation = []
    arranging.value = false
  }
  function begin(event: PointerEvent, source: string, field: string, port: OutputPort = 'bottom') {
    if (event.button !== 0 || store.busy.value) return
    finishArrangement()
    event.preventDefault()
    const point = world(event.clientX, event.clientY)
    connecting.value = { source, field, port, ...point }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', cancel, { once: true })
  }
  function cancel() {
    connecting.value = undefined
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', cancel)
  }
  function move(event: PointerEvent) {
    if (connecting.value) Object.assign(connecting.value, world(event.clientX, event.clientY))
  }
  function end(event: PointerEvent) {
    const source = connecting.value,
      target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-workflow-target]')
    if (source && target?.dataset.workflowTarget && target.dataset.workflowField)
      connect(
        source,
        target.dataset.workflowTarget,
        target.dataset.workflowField,
        target.dataset.workflowPort === 'top' ? 'top' : 'left',
      )
    cancel()
  }
  function connect(source: Connection, target: string, field: string, targetPort: InputPort) {
    const node = store.doc.nodes.find((node) => node.id === target)
    if (target !== '__output' && !node) return
    if (source.source !== '__input') {
      const upstream = (id: string, seen = new Set<string>()): boolean => {
        if (id === target) return true
        if (seen.has(id)) return false
        seen.add(id)
        return Object.values(store.doc.nodes.find((node) => node.id === id)?.inputs || {})
          .flatMap(leaves)
          .some((binding) => 'node' in binding && upstream(binding.node, seen))
      }
      if (upstream(source.source)) {
        store.error.value = '连线形成循环'
        return
      }
    }
    const values = node?.inputs || store.doc.outputs,
      binding: Binding =
        source.source === '__input'
          ? { input: source.field }
          : { node: source.source, output: source.field }
    const multiple = fields(target, false)[field]?.type === 'array',
      previous = values[field]
    if (multiple && previous && 'array' in previous && previous.array.length >= 64) {
      store.error.value = '最多 64 项引用'
      return
    }
    store.checkpoint()
    if (
      multiple &&
      previous &&
      !leaves(previous).some((value) => JSON.stringify(value) === JSON.stringify(binding))
    )
      values[field] =
        'array' in previous
          ? { ...previous, array: [...previous.array, binding] }
          : { array: [previous, binding], flatten: true }
    else if (!previous || !multiple) values[field] = binding
    const edge = [...edges.value]
      .reverse()
      .find(
        (edge) =>
          edge.target === target &&
          edge.field === field &&
          edge.source === source.source &&
          edge.output === source.field,
      )
    if (edge) store.doc.routes[edge.id] = { sourcePort: source.port, targetPort }
    store.error.value = ''
    selectedEdge.value = ''
  }
  function disconnect(id = selectedEdge.value) {
    const edge = edges.value.find((edge) => edge.id === id)
    if (!edge) return
    store.checkpoint()
    const values =
      edge.target === '__output'
        ? store.doc.outputs
        : store.doc.nodes.find((node) => node.id === edge.target)?.inputs
    if (values?.[edge.field]) {
      const next = removeAt(values[edge.field]!, edge.trail)
      if (next) values[edge.field] = next
      else delete values[edge.field]
    }
    delete store.doc.routes[id]
    selectedEdge.value = ''
  }
  function organize() {
    finishArrangement()
    store.checkpoint()
    const selected = store.selected.value,
      items = store.items.value.filter(
        (item) =>
          !item.id.startsWith('__note:') && (!selected.length || selected.includes(item.id)),
      )
    if (!items.length) return
    const levels = new Map<string, number>([['__input', 0]])
    for (let round = 0; round <= store.doc.nodes.length; round++)
      for (const node of store.doc.nodes) {
        const parents = Object.values(node.inputs)
          .flatMap(leaves)
          .flatMap((binding) =>
            'node' in binding ? [binding.node] : 'input' in binding ? ['__input'] : [],
          )
        if (parents.every((id) => levels.has(id)))
          levels.set(
            node.id,
            parents.length ? Math.max(...parents.map((id) => levels.get(id)!)) + 1 : 1,
          )
      }
    levels.set('__output', Math.max(1, ...levels.values()) + 1)
    // 每层纵向推进，兄弟节点横向分列；按父节点位置排序，减少交叉连线。
    const layers = new Map<number, CanvasItem[]>()
    for (const item of items) {
      const level = levels.get(item.id) ?? 1
      layers.set(level, [...(layers.get(level) || []), item])
    }
    const positions = new Map<string, number>()
    animation = []
    let y = selected.length ? Math.min(...items.map((item) => item.y)) : 0
    const centerX =
      selected.length && items.length
        ? (Math.min(...items.map((item) => item.x)) +
            Math.max(...items.map((item) => item.x + item.content.width))) /
          2
        : 140
    for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
      const parentCenter = (item: CanvasItem) => {
        const parents = edges.value
          .filter((edge) => edge.target === item.id)
          .map((edge) => positions.get(edge.source))
          .filter((x): x is number => x !== undefined)
        return parents.length ? parents.reduce((sum, x) => sum + x, 0) / parents.length : item.x
      }
      layer.sort((a, b) => parentCenter(a) - parentCenter(b) || a.x - b.x)
      const extents = layer.map((item) => {
        const notes = store.doc.notes
          .filter((note) => note.anchor === item.id)
          .map((note) => ({
            ...note,
            box: store.items.value.find((value) => value.id === `__note:${note.id}`),
          }))
        return {
          left: Math.min(0, ...notes.map((note) => note.x)),
          right: Math.max(
            item.content.width,
            ...notes.map((note) => note.x + (note.box?.content.width || 300)),
          ),
          top: Math.min(0, ...notes.map((note) => note.y)),
          bottom: Math.max(
            item.content.height,
            ...notes.map((note) => note.y + (note.box?.content.height || 200)),
          ),
        }
      })
      const widths = extents.map((value) => value.right - value.left + 100)
      let x = centerX - widths.reduce((sum, width) => sum + width, 0) / 2
      const top = Math.min(0, ...extents.map((value) => value.top)),
        bottom = Math.max(0, ...extents.map((value) => value.bottom))
      for (const [index, item] of layer.entries()) {
        const nodeX = x - extents[index]!.left
        animation.push({ item, fromX: item.x, fromY: item.y, x: nodeX, y: y - top })
        positions.set(item.id, nodeX + item.content.width / 2)
        x += widths[index]!
      }
      y += bottom - top + 120
    }
    for (const edge of edges.value)
      if (!selected.length || selected.includes(edge.source) || selected.includes(edge.target))
        store.doc.routes[edge.id] = { sourcePort: 'bottom', targetPort: 'top' }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishArrangement()
      return
    }
    arranging.value = true
    const started = performance.now()
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 420),
        eased = 1 - (1 - progress) ** 3
      for (const value of animation) {
        value.item.x = value.fromX + (value.x - value.fromX) * eased
        value.item.y = value.fromY + (value.y - value.fromY) * eased
      }
      if (progress < 1) frame = requestAnimationFrame(animate)
      else finishArrangement()
    }
    frame = requestAnimationFrame(animate)
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancel()
      selectedEdge.value = ''
    }
  }
  window.addEventListener('keydown', key)
  watch(
    () => store.doc.id,
    () => {
      cancel()
      finishArrangement()
      selectedEdge.value = ''
    },
  )
  onBeforeUnmount(() => {
    cancel()
    finishArrangement()
    window.removeEventListener('keydown', key)
  })
  const portStyle = (id: string, field: string, output: boolean) => ({
    left: `calc(${(100 * (Math.max(0, Object.keys(fields(id, output)).indexOf(field)) + 1)) / (Object.keys(fields(id, output)).length + 1)}% - 7px)`,
  })
  return {
    edges,
    connecting,
    pendingPath,
    selectedEdge,
    arranging,
    fields,
    portStyle,
    begin,
    disconnect,
    organize,
    finishArrangement,
  }
}
