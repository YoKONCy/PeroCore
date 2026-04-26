/**
 * 桌宠台词系统 Composable
 *
 * 管理台词相关功能:
 * - 从后端加载 Agent waifu_texts (静态 + 动态合并)
 * - 点击台词 (按部位随机选取)
 * - 空闲消息 (30-60s 定时随机)
 * - 分时段欢迎语 (morning/midnight/afternoon 等)
 * - visibilitychange 切回欢迎语
 *
 * @module packages/frontend/src/composables/pet/usePetTexts
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { agentApi } from '../../api/modules/agentApi'

/** 台词系统初始化参数 */
interface UsePetTextsOptions {
  /** showBubble 函数引用 (由 usePetBubble 提供) */
  showBubble: (text: string, duration?: number) => void
  /** 是否正在思考 (由 usePetGateway 提供) */
  isThinking: Ref<boolean>
  /** 是否正在播放语音 (由 usePetAudio 提供) */
  isSpeaking: Ref<boolean>
}

export function usePetTexts(opts: UsePetTextsOptions) {
  const { showBubble, isThinking, isSpeaking } = opts

  // ── 动态 Agent ──
  const activeAgentId = ref('pero')
  const agentName = ref('')

  // ── 台词库 ──
  const localTexts = ref<Record<string, string>>({
    click_head_01: '嘿嘿，摸摸好舒服喵~ ☺️',
    click_body_01: '唔…不要乱摸啦！///> _<///',
    click_arm_01: '牵手…好害羞…🫣',
    click_leg_01: '哇！不要碰那里啦！😳',
    click_messages_01: '嗯？怎么了喵？',
  })

  // ── 空闲消息池 ──
  const idleMessages = ref([
    '主人？你还在吗~？',
    '无聊…想找主人玩',
    '*伸懒腰*',
    '今天天气真好呢~',
    '*打了个哈欠*',
    '主人，要不要聊聊天？',
    '我在等你呢喵~',
    '*戳戳* 注意到我了吗？',
    '嗯~今天做了什么有趣的事？',
    '主人工作辛苦了！要休息一下吗？',
  ])

  // ── 空闲消息定时器 ──
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function startIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    const delay = 30000 + Math.random() * 30000
    idleTimer = setTimeout(() => {
      if (!isThinking.value && !isSpeaking.value) {
        const pool = idleMessages.value
        const msg = pool[Math.floor(Math.random() * pool.length)] ?? ''
        if (msg) showBubble(msg, 6000)
      }
      startIdleTimer()
    }, delay)
  }

  // ── 分时段欢迎语 ──
  function getTimeSlot(): string {
    const hour = new Date().getHours()
    if (hour >= 0 && hour < 4) return 'midnight'
    if (hour >= 4 && hour < 7) return 'morningEarly'
    if (hour >= 7 && hour < 11) return 'morning'
    if (hour >= 11 && hour < 13) return 'noon'
    if (hour >= 13 && hour < 17) return 'afternoon'
    if (hour >= 17 && hour < 19) return 'eveningSunset'
    if (hour >= 19 && hour < 22) return 'night'
    return 'midnight'
  }

  function showTimeBasedWelcome() {
    const slot = getTimeSlot()
    const msg = localTexts.value[`welcome_${slot}`]
    if (msg) {
      showBubble(msg, 6000)
    }
  }

  // ── visibilitychange ──
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      const backMsg = localTexts.value['visibilityBack']
      if (backMsg) {
        showBubble(backMsg, 5000)
      }
      startIdleTimer()
    }
  }

  // ── 动态台词加载 ──
  async function loadDynamicTexts() {
    try {
      const activeRes = await agentApi.getActive()
      const agentId = (activeRes?.data as { agentId?: string })?.agentId ?? 'pero'
      activeAgentId.value = agentId

      // 获取 Agent 名称 (用于 UI 显示)
      try {
        const listRes = await agentApi.list()
        const agents = (listRes?.data ?? []) as Array<{ id: string; name?: string }>
        const matched = agents.find((a) => a.id === agentId)
        if (matched?.name) agentName.value = matched.name
      } catch {
        // 获取名称失败不影响核心功能
      }

      const result = await agentApi.getTexts(agentId)
      const texts = result?.data as Record<string, unknown> | undefined
      if (!texts || typeof texts !== 'object') return

      // click 台词
      const click = texts.click as Record<string, unknown> | undefined
      if (click) {
        for (const [part, lines] of Object.entries(click)) {
          if (Array.isArray(lines) && lines.length > 0) {
            localTexts.value[`click_${part}_01`] = lines[0] as string
            localTexts.value[`click_${part}_all`] = JSON.stringify(lines)
          } else if (typeof lines === 'string') {
            localTexts.value[`click_${part}_01`] = lines
          }
        }
      }

      // idleMessages
      if (Array.isArray(texts.idleMessages) && texts.idleMessages.length > 0) {
        idleMessages.value = texts.idleMessages as string[]
      }

      // visibilityBack
      if (typeof texts.visibilityBack === 'string') {
        localTexts.value['visibilityBack'] = texts.visibilityBack
      }

      // welcome 分时段
      const welcome = texts.welcome as Record<string, string> | undefined
      if (welcome) {
        for (const [time, msg] of Object.entries(welcome)) {
          localTexts.value[`welcome_${time}`] = msg
        }
      }

      // lateNight
      if (Array.isArray(texts.lateNight)) {
        localTexts.value['lateNight'] = JSON.stringify(texts.lateNight)
      }

      // 换装台词
      const rt = texts.randTextures as Record<string, string> | undefined
      if (rt) {
        if (rt.noClothes) localTexts.value['randTextures_noClothes'] = rt.noClothes
        if (rt.success) localTexts.value['randTextures_success'] = rt.success
      }

      // 台词加载完成后显示分时段欢迎语
      showTimeBasedWelcome()
    } catch {
      // 台词加载失败不影响核心功能
    }
  }

  /**
   * 根据点击部位获取随机台词
   */
  function getClickText(partType: string): string {
    let text = '嘿嘿~'
    const allKey = `click_${partType}_all`
    const allJson = localTexts.value[allKey] || localTexts.value['click_default_all']
    if (allJson) {
      try {
        const arr = JSON.parse(allJson) as string[]
        if (arr.length > 0) {
          text = arr[Math.floor(Math.random() * arr.length)] ?? text
        }
      } catch {
        // JSON 解析失败用默认值
      }
    } else {
      text =
        localTexts.value[`click_${partType}_01`] || localTexts.value['click_default_01'] || '嘿嘿~'
    }
    return text
  }

  // ── 生命周期 ──
  startIdleTimer()

  onMounted(() => {
    loadDynamicTexts()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    if (idleTimer) clearTimeout(idleTimer)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    activeAgentId,
    agentName,
    localTexts,
    idleMessages,
    startIdleTimer,
    getClickText,
  }
}
