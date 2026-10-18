import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue'
import { useSensoryPreferences } from './useSensoryPreferences'

export type SurfaceMotionPhase = 'idle' | 'departing' | 'waiting' | 'entering'

/** 加载与动效并行推进；新意图会打断旧动画，不延迟请求或页面提交。 */
export function useSurfaceMotion(
  element: Ref<HTMLElement | null>,
  identity: Ref<string | number>,
  pending: Ref<boolean>,
  active: Ref<boolean>,
  direction: Ref<number>,
  variant: Ref<'page' | 'conversation' | 'panel'>,
  preserveMaterial: Ref<boolean>,
  ancestorAnimating: Ref<boolean>,
) {
  const { motionLevel } = useSensoryPreferences()
  const systemReduced = ref(false)
  const activated = ref(true)
  const phase = ref<SurfaceMotionPhase>(pending.value ? 'waiting' : 'idle')
  const level = computed(() =>
    motionLevel.value === 'off'
      ? 'off'
      : systemReduced.value || motionLevel.value === 'reduced'
        ? 'reduced'
        : 'full',
  )
  let animation: Animation | undefined
  let revision = 0
  let media: MediaQueryList | undefined
  const syncMedia = () => {
    systemReduced.value = media?.matches ?? false
  }

  function cancel(): void {
    revision++
    animation?.cancel()
    animation = undefined
  }

  watch(
    [identity, pending, active, activated, level, element, preserveMaterial, ancestorAnimating],
    (current, previous) => {
      const [key, busy, visible, alive, preference, target] = current
      const changed = previous && key !== previous[0]
      const restored = previous && ((!previous[2] && visible) || (!previous[3] && alive))
      if (!target || !visible || !alive || preference === 'off') {
        cancel()
        phase.value = busy ? 'waiting' : 'idle'
        return
      }
      // 外层已经在呈现整页过渡，内层不再叠加淡入，避免亮度骤降与连续二次入场。
      if (!busy && ancestorAnimating.value) {
        cancel()
        phase.value = 'idle'
        return
      }
      if (
        busy &&
        previous?.[1] &&
        !changed &&
        !restored &&
        previous[4] === preference &&
        previous[6] === preserveMaterial.value
      )
        return
      if (!busy && !changed && !restored && !previous?.[1]) {
        if (previous?.[4] !== preference || previous?.[6] !== preserveMaterial.value) {
          cancel()
          phase.value = 'idle'
        }
        return
      }
      const style = getComputedStyle(target)
      const from = {
        opacity: style.opacity,
        transform: preference === 'reduced' ? 'none' : style.transform,
      }
      const interrupted = !!animation
      cancel()
      const version = revision
      const distance =
        preference === 'reduced' ? 0 : (variant.value === 'page' ? 12 : 6) * direction.value
      phase.value = busy ? 'departing' : 'entering'
      if (typeof target.animate !== 'function') {
        phase.value = busy ? 'waiting' : 'idle'
        return
      }
      const first =
        busy || interrupted
          ? from
          : {
              opacity: previous?.[1] ? 0.12 : 0.5,
              transform: `translate3d(${distance}px, 0, 0)`,
            }
      // 透明度与 will-change: opacity 会建立新的 backdrop root，破坏子面板透景。
      const frames: Keyframe[] = [
        first,
        {
          opacity: busy ? 0.08 : 1,
          transform: busy ? `translate3d(${-distance}px, 0, 0)` : 'translate3d(0, 0, 0)',
        },
      ]
      if (preserveMaterial.value) for (const frame of frames) delete frame.opacity
      animation = target.animate(frames, {
        duration:
          preference === 'reduced' ? 100 : busy ? 160 : variant.value === 'page' ? 340 : 280,
        easing: busy ? 'cubic-bezier(.4, 0, 1, 1)' : 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })
      animation.onfinish = () => {
        if (version !== revision) return
        phase.value = busy ? 'waiting' : 'idle'
        animation?.cancel()
        animation = undefined
      }
    },
    { flush: 'post' },
  )

  onMounted(() => {
    if (typeof matchMedia !== 'function') return
    media = matchMedia('(prefers-reduced-motion: reduce)')
    syncMedia()
    media.addEventListener('change', syncMedia)
  })
  onActivated(() => {
    activated.value = true
  })
  onDeactivated(() => {
    activated.value = false
    cancel()
  })
  onUnmounted(() => {
    cancel()
    media?.removeEventListener('change', syncMedia)
  })
  return { phase, level }
}
