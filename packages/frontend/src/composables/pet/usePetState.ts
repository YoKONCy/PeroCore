/**
 * usePetState — 宠物状态管理 composable
 *
 * 管理宠物的心情、好感度、能量等状态值。
 * F3: 通过 useGateway 接收后端实时推送，通过 configApi 持久化。
 *
 * @module packages/frontend/src/composables/pet/usePetState
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGateway } from '../gateway/useGateway'
import { configApi } from '../../api/modules/configApi'
import type { StateUpdatePayload, NotificationPayload, TaskProgressPayload } from '@perocore/shared'

export type PetMood = 'happy' | 'neutral' | 'sleepy' | 'excited' | 'curious'
export type PetAction = 'idle' | 'wave' | 'dance' | 'sleep' | 'think'

export interface PetStats {
  affection: number // 0-100 好感度
  energy: number // 0-100 能量
  mood: PetMood
  currentAction: PetAction
}

const moodLabels: Record<PetMood, string> = {
  happy: '开心',
  neutral: '平静',
  sleepy: '困了',
  excited: '兴奋',
  curious: '好奇',
}

const moodEmoji: Record<PetMood, string> = {
  happy: '☺️',
  neutral: '😐',
  sleepy: '😴',
  excited: '✨',
  curious: '🤔',
}

const actionLabels: Record<PetAction, string> = {
  idle: '站着',
  wave: '挥手',
  dance: '跳舞',
  sleep: '睡觉',
  think: '思考中',
}

export function usePetState() {
  const stats = ref<PetStats>({
    affection: 50,
    energy: 50,
    mood: 'neutral',
    currentAction: 'idle',
  })

  const petName = ref('Pero')
  const lastInteraction = ref('')

  // ── Gateway 实时推送 (使用 shared 强类型) ──
  const {
    connect,
    disconnect,
    state: wsState,
  } = useGateway({
    onStateUpdate: (data) => {
      // 后端推送宠物状态变更 (StateUpdatePayload)
      const payload = data as unknown as StateUpdatePayload
      if (payload.affection !== undefined) stats.value.affection = payload.affection
      if (payload.energy !== undefined) stats.value.energy = payload.energy
      if (payload.mood !== undefined) stats.value.mood = payload.mood as PetMood
    },
    onNotification: (notif) => {
      // 来自 Agent 的通知 → 更新最近互动 (NotificationPayload)
      const payload = notif as unknown as NotificationPayload
      lastInteraction.value = payload.body ?? payload.title
    },
    onTaskProgress: (progress) => {
      // 任务进度推送 → 宠物响应 (TaskProgressPayload)
      const payload = progress as unknown as TaskProgressPayload
      if (payload.state === 'running') {
        stats.value.currentAction = 'think'
      } else if (payload.state === 'completed') {
        stats.value.currentAction = 'dance'
        stats.value.mood = 'excited'
        lastInteraction.value = payload.message ?? '任务完成了！'
        setTimeout(() => {
          stats.value.currentAction = 'idle'
          stats.value.mood = 'happy'
        }, 3000)
      } else if (payload.state === 'error') {
        stats.value.mood = 'neutral'
        stats.value.currentAction = 'idle'
        lastInteraction.value = `任务出错了: ${payload.message ?? '未知错误'}`
      }
    },
  })

  // ── 计算属性 ──
  const affectionLevel = computed(() => {
    if (stats.value.affection >= 80) return '亲密'
    if (stats.value.affection >= 50) return '友好'
    if (stats.value.affection >= 20) return '普通'
    return '生疏'
  })

  // ── 从后端加载持久化状态 ──
  async function loadState() {
    try {
      const res = await configApi.batch(['pet.affection', 'pet.energy', 'pet.mood', 'pet.name'])
      const d = res.data ?? {}
      if (d['pet.affection']) stats.value.affection = Number(d['pet.affection'])
      if (d['pet.energy']) stats.value.energy = Number(d['pet.energy'])
      if (d['pet.mood']) stats.value.mood = d['pet.mood'] as PetMood
      if (d['pet.name']) petName.value = d['pet.name'] as string
    } catch {
      // 首次使用，保持默认值
    }
  }

  /** 保存状态（防抖，变化后 2 秒写入） */
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        await configApi.set('pet.affection', String(stats.value.affection))
        await configApi.set('pet.energy', String(stats.value.energy))
        await configApi.set('pet.mood', stats.value.mood)
      } catch {
        // 静默
      }
    }, 2000)
  }

  // ── 交互动作 ──

  function setAction(action: PetAction) {
    stats.value.currentAction = action
  }

  function pat() {
    stats.value.affection = Math.min(100, stats.value.affection + 2)
    stats.value.mood = 'happy'
    stats.value.currentAction = 'wave'
    lastInteraction.value = '被主人摸了~'
    scheduleSave()
    setTimeout(() => {
      stats.value.currentAction = 'idle'
    }, 2000)
  }

  function feed() {
    stats.value.energy = Math.min(100, stats.value.energy + 15)
    stats.value.mood = 'excited'
    stats.value.currentAction = 'dance'
    lastInteraction.value = '被主人投喂了~ ✨'
    scheduleSave()
    setTimeout(() => {
      stats.value.currentAction = 'idle'
    }, 3000)
  }

  // ── 生命周期 ──
  onMounted(() => {
    void loadState()
    connect()
  })

  onUnmounted(() => {
    disconnect()
    if (saveTimer) clearTimeout(saveTimer)
  })

  return {
    stats,
    petName,
    lastInteraction,
    moodLabels,
    moodEmoji,
    actionLabels,
    affectionLevel,
    wsState,
    setAction,
    pat,
    feed,
  }
}
