import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue'
import type { CanvasItem } from '../types'
import {
  guideBounds,
  snapCanvasMove,
  snapCanvasResize,
  type CanvasGuide,
  type GuideRect,
} from '../services/canvasGuides'

interface NavigationStore {
  project: { items: CanvasItem[] }
  activeItems: Ref<CanvasItem[]>
  selected: Ref<string[]>
  checkpoint(): void
  undo(): void
  redo(): void
  duplicate(): void
  removeSelection(): void
  addText(x: number, y: number): unknown
  retrySave(): Promise<unknown>
  movingItems?(): CanvasItem[]
  beginInteraction?(): void
  endInteraction?(): void
}
export function useCanvasNavigation(
  canvas: NavigationStore,
  surface: Ref<HTMLElement | null>,
  enabled?: Ref<boolean>,
) {
  const viewport = reactive({ x: 0, y: 0, scale: 1 })
  const tool = ref<'free' | 'select' | 'hand'>('free')
  const space = ref(false)
  const shift = ref(false)
  const panActive = computed(() => space.value || (tool.value === 'hand' && !shift.value))
  const boxActive = computed(() => shift.value && !space.value)
  const dragging = ref(false)
  const guides = ref<CanvasGuide[]>([])
  const marquee = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  let frame = 0
  let revealFrame = 0
  let pendingMove: PointerEvent | undefined
  let gesture:
    | {
        kind: 'pan' | 'items' | 'box' | 'resize'
        startX: number
        startY: number
        moved: boolean
        original: GuideRect[]
        fixed: GuideRect[]
        panX: number
        panY: number
        shift: boolean
        before: string[]
        pointerId: number
        clicked?: string
      }
    | undefined
  const bounds = computed(() => {
    const items = canvas.activeItems.value
    if (!items.length) return null
    const x = Math.min(...items.map((item) => item.x)),
      y = Math.min(...items.map((item) => item.y))
    return {
      x,
      y,
      width: Math.max(...items.map((item) => item.x + item.content.width)) - x,
      height: Math.max(...items.map((item) => item.y + item.content.height)) - y,
    }
  })
  const selectionToolbar = computed(() =>
    bounds.value
      ? {
          left: `${Math.max(170, Math.min((surface.value?.clientWidth || 1200) - 170, (bounds.value.x + bounds.value.width / 2) * viewport.scale + viewport.x))}px`,
          top: `${Math.max(82, bounds.value.y * viewport.scale + viewport.y - 48)}px`,
        }
      : {},
  )
  function local(clientX: number, clientY: number) {
    const rect = surface.value?.getBoundingClientRect()
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) }
  }
  function world(clientX: number, clientY: number) {
    const point = local(clientX, clientY)
    return {
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    }
  }
  function center() {
    return {
      x: ((surface.value?.clientWidth || 1200) / 2 - viewport.x) / viewport.scale - 150,
      y: ((surface.value?.clientHeight || 800) / 2 - viewport.y) / viewport.scale - 130,
    }
  }
  function zoom(scale: number, anchor?: { x: number; y: number }) {
    cancelReveal()
    const next = Math.max(0.12, Math.min(3, scale))
    const point = anchor || {
      x: (surface.value?.clientWidth || 1200) / 2,
      y: (surface.value?.clientHeight || 800) / 2,
    }
    viewport.x = point.x - ((point.x - viewport.x) * next) / viewport.scale
    viewport.y = point.y - ((point.y - viewport.y) * next) / viewport.scale
    viewport.scale = next
  }
  function fit(selection = false) {
    cancelReveal()
    const items =
      selection && canvas.activeItems.value.length ? canvas.activeItems.value : canvas.project.items
    if (!items.length) {
      viewport.x = (surface.value?.clientWidth || 1200) / 2
      viewport.y = (surface.value?.clientHeight || 800) / 2
      viewport.scale = 1
      return
    }
    const minX = Math.min(...items.map((item) => item.x)),
      minY = Math.min(...items.map((item) => item.y))
    const maxX = Math.max(...items.map((item) => item.x + item.content.width)),
      maxY = Math.max(...items.map((item) => item.y + item.content.height))
    const width = surface.value?.clientWidth || 1200,
      height = surface.value?.clientHeight || 800
    viewport.scale = Math.max(
      0.12,
      Math.min(
        1,
        (width - 240) / Math.max(1, maxX - minX),
        (height - 340) / Math.max(1, maxY - minY),
      ),
    )
    viewport.x = width / 2 - ((minX + maxX) / 2) * viewport.scale
    viewport.y = (height - 160) / 2 - ((minY + maxY) / 2) * viewport.scale + 40
  }
  function cancelReveal() {
    cancelAnimationFrame(revealFrame)
    revealFrame = 0
  }
  function reveal(item: CanvasItem) {
    cancelReveal()
    const width = surface.value?.clientWidth || 1200,
      height = surface.value?.clientHeight || 800
    const scale = Math.max(
      0.12,
      Math.min(
        Math.max(viewport.scale, 0.7),
        1.25,
        (width - 200) / item.content.width,
        (height - 320) / (item.content.height + 30),
      ),
    )
    const target = {
      scale,
      x: (width + 70) / 2 - (item.x + item.content.width / 2) * scale,
      y: height * 0.4 - (item.y + item.content.height / 2) * scale,
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Object.assign(viewport, target)
      return
    }
    const initial = { ...viewport },
      started = performance.now()
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 280),
        eased = 1 - (1 - progress) ** 3
      viewport.x = initial.x + (target.x - initial.x) * eased
      viewport.y = initial.y + (target.y - initial.y) * eased
      viewport.scale = initial.scale + (target.scale - initial.scale) * eased
      if (progress < 1) revealFrame = requestAnimationFrame(animate)
      else revealFrame = 0
    }
    revealFrame = requestAnimationFrame(animate)
  }
  function capturePointerDown(event: PointerEvent) {
    if (enabled && !enabled.value) return
    if (event.button !== 0 && event.button !== 1) return
    const pan = event.button === 1 || space.value || (tool.value === 'hand' && !event.shiftKey)
    const box = event.button === 0 && event.shiftKey && !space.value
    if (!pan && !box) return
    const target = event.target as Element
    const inWorld = Boolean(target.closest('.canvas-world'))
    if (!inWorld && target.closest('[data-ui],button,input,textarea,select')) return
    if (box && target.closest('input,textarea,select,[contenteditable="true"]')) return
    // 平移与临时框选在捕获阶段接管节点事件，避免同时移动节点、缩放或拉线。
    pointerDown(
      event,
      target.closest<HTMLElement>('[data-canvas-item]')?.dataset.canvasItem,
      false,
      pan ? 'pan' : 'box',
    )
    event.stopImmediatePropagation()
  }
  function captureDoubleClick(event: MouseEvent) {
    if ((panActive.value || event.shiftKey) && (event.target as Element).closest('.canvas-world')) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  function pointerDown(event: PointerEvent, id?: string, resize = false, force?: 'pan' | 'box') {
    if (enabled && !enabled.value) return
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as HTMLElement
    if (!force && target.closest('textarea, input, select, button, video, audio, [data-ui]')) return
    cancelReveal()
    const before = [...canvas.selected.value]
    const box =
      force === 'box' || (event.button === 0 && event.shiftKey && !space.value && force !== 'pan')
    const pan =
      !box &&
      (force === 'pan' ||
        event.button === 1 ||
        tool.value === 'hand' ||
        space.value ||
        (!id && tool.value === 'free'))
    if (id && !pan && !box && !resize && !canvas.selected.value.includes(id))
      canvas.selected.value = [id]
    if (!id && !pan && !event.shiftKey) canvas.selected.value = []
    const moving = pan || box ? [] : canvas.movingItems?.() || canvas.activeItems.value
    const movingIds = new Set(moving.map((item) => item.id))
    const rect = (item: CanvasItem): GuideRect => ({
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.content.width,
      height: item.content.height,
    })
    guides.value = []
    gesture = {
      kind: pan ? 'pan' : box ? 'box' : resize ? 'resize' : id ? 'items' : 'box',
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      original: moving.map(rect),
      fixed: canvas.project.items.filter((item) => !movingIds.has(item.id)).map(rect),
      panX: viewport.x,
      panY: viewport.y,
      shift: event.shiftKey,
      before,
      pointerId: event.pointerId,
      clicked: id,
    }
    // 框选与平移由画布捕获；普通节点操作保留原目标，便签才能正常双击编辑。
    const captureTarget = pan || box ? surface.value : target
    captureTarget?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function applyPointerMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (
      gesture.kind !== 'pan' &&
      gesture.kind !== 'box' &&
      (tool.value === 'hand' || space.value)
    ) {
      gesture.kind = 'pan'
      gesture.startX = event.clientX
      gesture.startY = event.clientY
      gesture.panX = viewport.x
      gesture.panY = viewport.y
      gesture.original = []
      marquee.value = null
      guides.value = []
      return
    }
    const dx = event.clientX - gesture.startX,
      dy = event.clientY - gesture.startY
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return
    if (!gesture.moved && (gesture.kind === 'items' || gesture.kind === 'resize')) {
      canvas.checkpoint()
      canvas.beginInteraction?.()
    }
    gesture.moved = true
    dragging.value = true
    if (gesture.kind === 'pan') {
      viewport.x = gesture.panX + dx
      viewport.y = gesture.panY + dy
    } else if (gesture.kind === 'items' || gesture.kind === 'resize') {
      let worldDx = dx / viewport.scale,
        worldDy = dy / viewport.scale
      guides.value = []
      if (gesture.kind === 'items' && gesture.original.length && !event.altKey) {
        const proposed = guideBounds(gesture.original)
        proposed.x += worldDx
        proposed.y += worldDy
        const snapped = snapCanvasMove(
          proposed,
          gesture.fixed,
          viewport.scale,
          event.ctrlKey || event.metaKey,
        )
        worldDx += snapped.dx
        worldDy += snapped.dy
        guides.value = snapped.guides
      }
      const primary =
        gesture.original.find((item) => item.id === gesture?.clicked) || gesture.original[0]
      if (gesture.kind === 'resize' && primary && !event.altKey) {
        const snapped = snapCanvasResize(
          {
            ...primary,
            width: Math.max(160, Math.min(1600, primary.width + worldDx)),
            height: Math.max(100, Math.min(1600, primary.height + worldDy)),
          },
          gesture.fixed,
          viewport.scale,
        )
        worldDx = snapped.width - primary.width
        worldDy = snapped.height - primary.height
        guides.value = snapped.guides
      }
      for (const original of gesture.original) {
        const item = canvas.project.items.find((candidate) => candidate.id === original.id)
        if (!item) continue
        if (gesture.kind === 'items') {
          item.x = original.x + worldDx
          item.y = original.y + worldDy
        } else {
          item.content.width = Math.max(160, Math.min(1600, original.width + worldDx))
          item.content.height = Math.max(100, Math.min(1600, original.height + worldDy))
        }
      }
    } else {
      const start = world(gesture.startX, gesture.startY),
        current = world(event.clientX, event.clientY)
      const box = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(start.x - current.x),
        height: Math.abs(start.y - current.y),
      }
      marquee.value = box
      const hit = canvas.project.items
        .filter(
          (item) =>
            item.x < box.x + box.width &&
            item.x + item.content.width > box.x &&
            item.y < box.y + box.height &&
            item.y + item.content.height > box.y,
        )
        .map((item) => item.id)
      canvas.selected.value = gesture.shift ? [...new Set([...gesture.before, ...hit])] : hit
    }
  }
  function pointerMove(event: PointerEvent) {
    if (!gesture) return
    pendingMove = event
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pendingMove) applyPointerMove(pendingMove)
        pendingMove = undefined
      })
  }
  function pointerUp(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (pendingMove) applyPointerMove(pendingMove)
    pendingMove = undefined
    if (!gesture.moved && gesture.kind === 'box' && gesture.shift && gesture.clicked) {
      const id = gesture.clicked
      canvas.selected.value = gesture.before.includes(id)
        ? gesture.before.filter((value) => value !== id)
        : [...gesture.before, id]
    } else if (!gesture.moved && !gesture.clicked && !gesture.shift) canvas.selected.value = []
    if (surface.value?.hasPointerCapture(event.pointerId))
      surface.value.releasePointerCapture(event.pointerId)
    gesture = undefined
    dragging.value = false
    canvas.endInteraction?.()
    marquee.value = null
    guides.value = []
  }
  function wheel(event: WheelEvent) {
    if (
      (event.target as HTMLElement).closest(
        '[data-ui], [data-canvas-scroll], textarea, video, audio',
      )
    )
      return
    cancelReveal()
    event.preventDefault()
    if (event.ctrlKey || event.metaKey)
      zoom(viewport.scale * Math.exp(-event.deltaY * 0.008), local(event.clientX, event.clientY))
    else {
      viewport.x -= event.shiftKey ? event.deltaY : event.deltaX
      viewport.y -= event.shiftKey ? 0 : event.deltaY
    }
  }
  const editable = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest('textarea,input,select,[contenteditable="true"]'))
  function keyDown(event: KeyboardEvent) {
    if (enabled && !enabled.value) return
    if (editable(event.target)) return
    if (
      (event.target as HTMLElement | null)?.closest('[role="dialog"],.canvas-panel,.creation-dock')
    )
      return
    if (event.key === 'Shift') shift.value = true
    const modifier = event.ctrlKey || event.metaKey
    if (event.code === 'Space') {
      space.value = true
      event.preventDefault()
    } else if (event.key === 'Escape') canvas.selected.value = []
    else if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) canvas.redo()
      else canvas.undo()
    } else if (modifier && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      canvas.duplicate()
    } else if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      canvas.selected.value = canvas.project.items.map((item) => item.id)
    } else if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void canvas.retrySave()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      canvas.removeSelection()
    } else if (!modifier && event.key.toLowerCase() === 'v') tool.value = 'select'
    else if (!modifier && event.key.toLowerCase() === 'h') tool.value = 'hand'
    else if (!modifier && event.key.toLowerCase() === 'a') tool.value = 'free'
    else if (!modifier && event.key.toLowerCase() === 'n') {
      const point = center()
      canvas.addText(point.x, point.y)
    } else if (event.key === '0') fit()
    else if (event.key === '+' || event.key === '=') zoom(viewport.scale * 1.2)
    else if (event.key === '-') zoom(viewport.scale / 1.2)
  }
  function keyUp(event: KeyboardEvent) {
    if (event.code === 'Space') space.value = false
    if (event.key === 'Shift') shift.value = false
  }
  function blur() {
    cancelReveal()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pendingMove = undefined
    space.value = false
    shift.value = false
    gesture = undefined
    dragging.value = false
    canvas.endInteraction?.()
    marquee.value = null
    guides.value = []
  }
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', blur)
  if (enabled)
    watch(enabled, (value) => {
      if (!value) blur()
    })
  onBeforeUnmount(() => {
    blur()
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    window.removeEventListener('blur', blur)
  })
  return {
    viewport,
    tool,
    space,
    panActive,
    boxActive,
    dragging,
    guides,
    marquee,
    bounds,
    selectionToolbar,
    world,
    center,
    zoom,
    fit,
    reveal,
    capturePointerDown,
    captureDoubleClick,
    pointerDown,
    pointerMove,
    pointerUp,
    wheel,
  }
}
