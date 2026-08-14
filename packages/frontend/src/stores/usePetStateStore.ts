import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { agentApi } from '../api/modules/agentApi'

export interface PetStatusState {
  mood: string
  vibe: string
  mind: string
}

const DEFAULT_PET_STATUS: PetStatusState = {
  mood: '开心',
  vibe: '轻松',
  mind: '发呆',
}

/**
 * 角色三状态的唯一前端权威源。
 * 初始值来自 pet_states，Gateway state_update 直接写入这里。
 */
export const usePetStateStore = defineStore('petState', () => {
  const states = ref<Record<string, PetStatusState>>({})
  const activeAgentId = ref('pero')
  let loadGeneration = 0

  function stateFor(agentId: string): PetStatusState {
    return states.value[agentId] ?? DEFAULT_PET_STATUS
  }

  const activeState = computed(() => stateFor(activeAgentId.value))

  function apply(agentId: string, update: Partial<PetStatusState>): void {
    const current = stateFor(agentId)
    states.value = {
      ...states.value,
      [agentId]: {
        mood: update.mood ?? current.mood,
        vibe: update.vibe ?? current.vibe,
        mind: update.mind ?? current.mind,
      },
    }
  }

  async function load(agentId: string): Promise<void> {
    activeAgentId.value = agentId
    const generation = ++loadGeneration
    try {
      const response = await agentApi.getPetState(agentId)
      if (generation !== loadGeneration || activeAgentId.value !== agentId || !response.data) return
      apply(agentId, response.data)
    } catch {
      // 读取失败时保留已有状态或默认状态，避免无意义地清空三状态栏。
    }
  }

  return {
    activeAgentId,
    activeState,
    stateFor,
    apply,
    load,
  }
})
