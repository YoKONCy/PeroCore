import { onUnmounted, readonly, ref, watch } from 'vue'
import {
  resolveCharacterExpression,
  type CharacterExpression,
} from '../../components/avatar/lib/characterExpression'

/** 去抖与最短停留只作用于模型表现，状态文字仍实时更新。 */
export function useCharacterExpression(
  agentId: () => string | undefined,
  mood: () => string | undefined,
  vibe: () => string | undefined,
) {
  const expression = ref<CharacterExpression>('neutral')
  let timer: ReturnType<typeof setTimeout> | undefined
  let heldUntil = 0
  let initialized = false

  watch(
    [agentId, mood, vibe],
    ([identity, nextMood, nextVibe], previous) => {
      clearTimeout(timer)
      const next = resolveCharacterExpression(nextMood, nextVibe)
      if (!initialized || identity !== previous?.[0]) {
        initialized = true
        expression.value = next
        heldUntil = Date.now() + 2200
        return
      }
      if (next === expression.value) return
      timer = setTimeout(
        () => {
          expression.value = next
          heldUntil = Date.now() + 2200
        },
        Math.max(650, heldUntil - Date.now()),
      )
    },
    { immediate: true },
  )

  onUnmounted(() => clearTimeout(timer))
  return readonly(expression)
}
