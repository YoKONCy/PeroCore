/**
 * usePetState — 宠物状态管理 composable
 *
 * 管理宠物的心情、好感度、能量等状态值。
 * F1 阶段: mock 数据，F3 替换为 API。
 */
import { ref, computed } from 'vue'

export type PetMood = 'happy' | 'neutral' | 'sleepy' | 'excited' | 'curious'
export type PetAction = 'idle' | 'wave' | 'dance' | 'sleep' | 'think'

export interface PetStats {
  affection: number   // 0-100 好感度
  energy: number      // 0-100 能量
  mood: PetMood
  currentAction: PetAction
}

const moodLabels: Record<PetMood, string> = {
  happy: '开心 ☺️',
  neutral: '平静 😐',
  sleepy: '困了 😴',
  excited: '兴奋 ✨',
  curious: '好奇 🤔',
}

const moodEmoji: Record<PetMood, string> = {
  happy: '☺️', neutral: '😐', sleepy: '😴', excited: '✨', curious: '🤔',
}

const actionLabels: Record<PetAction, string> = {
  idle: '站着', wave: '挥手', dance: '跳舞', sleep: '睡觉', think: '思考中',
}

export function usePetState() {
  const stats = ref<PetStats>({
    affection: 78,
    energy: 65,
    mood: 'happy',
    currentAction: 'idle',
  })

  const petName = ref('Pero')
  const lastInteraction = ref('刚刚一起完成了 F1 Dashboard 实装')

  const affectionLevel = computed(() => {
    if (stats.value.affection >= 80) return '亲密'
    if (stats.value.affection >= 50) return '友好'
    if (stats.value.affection >= 20) return '普通'
    return '生疏'
  })

  function setAction(action: PetAction) {
    stats.value.currentAction = action
  }

  function pat() {
    stats.value.affection = Math.min(100, stats.value.affection + 2)
    stats.value.mood = 'happy'
    stats.value.currentAction = 'wave'
    setTimeout(() => { stats.value.currentAction = 'idle' }, 2000)
  }

  function feed() {
    stats.value.energy = Math.min(100, stats.value.energy + 15)
    stats.value.mood = 'excited'
    stats.value.currentAction = 'dance'
    setTimeout(() => { stats.value.currentAction = 'idle' }, 3000)
  }

  return {
    stats, petName, lastInteraction,
    moodLabels, moodEmoji, actionLabels,
    affectionLevel,
    setAction, pat, feed,
  }
}
