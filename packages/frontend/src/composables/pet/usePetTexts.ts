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
import { listen } from '../../utils/ipcAdapter'
import { useGateway } from '../gateway/useGateway'

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
  const fallbackLocalTexts = { ...localTexts.value }

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
  const fallbackIdleMessages = [...idleMessages.value]

  // ── 空闲消息定时器 ──
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let unlistenAgentChanged: (() => void) | null = null
  let textLoadSeq = 0

  // ── Gateway: 监听 state_update 实时热更新台词 (finish_task 写入 pet_states 后即时生效) ──
  const { connect: gwConnect, disconnect: gwDisconnect, onPush, offPush } = useGateway()

  /** 将 state_update 广播里的 click/idle/back 台词热更新到本地台词库 */
  function applyStateTexts(payload: Record<string, unknown>): void {
    // 仅接受当前活跃 agent 的台词更新 (广播带 agentId，缺省时兼容旧逻辑放行)
    const updateAgentId = payload.agentId
    if (typeof updateAgentId === 'string' && updateAgentId !== activeAgentId.value) return
    const click = payload.click_messages as Record<string, unknown> | undefined
    if (click && typeof click === 'object') {
      for (const [part, lines] of Object.entries(click)) {
        if (Array.isArray(lines) && lines.length > 0) {
          localTexts.value[`click_${part}_01`] = String(lines[0])
          localTexts.value[`click_${part}_all`] = JSON.stringify(lines)
        }
      }
    }
    const idle = payload.idle_messages
    if (Array.isArray(idle) && idle.length > 0) {
      idleMessages.value = idle.map(String)
    }
    const back = payload.back_messages
    if (Array.isArray(back) && back.length > 0) {
      localTexts.value['visibilityBack_all'] = JSON.stringify(back)
    }
  }

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
      // 优先从 finish_task 写入的回归台词池 (backMessages) 随机选取，回退单条 visibilityBack
      let backMsg = localTexts.value['visibilityBack']
      const backAll = localTexts.value['visibilityBack_all']
      if (backAll) {
        try {
          const arr = JSON.parse(backAll) as string[]
          if (arr.length > 0) backMsg = arr[Math.floor(Math.random() * arr.length)] ?? backMsg
        } catch {
          /* JSON 解析失败用单条 */
        }
      }
      if (backMsg) {
        showBubble(backMsg, 5000)
      }
      startIdleTimer()
    }
  }

  // ── 动态台词加载 ──
  async function loadDynamicTexts(options: { agentId?: string; showWelcome?: boolean } = {}) {
    const { agentId: agentIdOverride, showWelcome = true } = options
    const currentSeq = ++textLoadSeq

    try {
      const activeRes = agentIdOverride ? null : await agentApi.getActive()
      const agentId = agentIdOverride ?? activeRes?.data?.agentId ?? 'pero'
      if (currentSeq !== textLoadSeq) return
      activeAgentId.value = agentId
      localTexts.value = { ...fallbackLocalTexts }
      idleMessages.value = [...fallbackIdleMessages]

      try {
        const listRes = await agentApi.list()
        const agents = (listRes?.data ?? []) as Array<{ id: string; name?: string }>
        const matched = agents.find((a) => a.id === agentId)
        agentName.value = matched?.name ?? ''
      } catch {
        agentName.value = ''
      }

      const result = await agentApi.getTexts(agentId)
      if (currentSeq !== textLoadSeq) return
      const texts = result?.data as Record<string, unknown> | undefined
      if (!texts || typeof texts !== 'object') return

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

      if (Array.isArray(texts.idleMessages) && texts.idleMessages.length > 0) {
        idleMessages.value = texts.idleMessages as string[]
      }

      if (typeof texts.visibilityBack === 'string') {
        localTexts.value['visibilityBack'] = texts.visibilityBack
      }

      // backMessages: finish_task 写入 pet_states 的回归台词池 (合并自后端 getWaifuTexts)
      if (Array.isArray(texts.backMessages) && texts.backMessages.length > 0) {
        localTexts.value['visibilityBack_all'] = JSON.stringify(texts.backMessages)
      }

      const welcome = texts.welcome as Record<string, string> | undefined
      if (welcome) {
        for (const [time, msg] of Object.entries(welcome)) {
          localTexts.value[`welcome_${time}`] = msg
        }
      }

      if (Array.isArray(texts.lateNight)) {
        localTexts.value['lateNight'] = JSON.stringify(texts.lateNight)
      }

      const rt = texts.randTextures as Record<string, string> | undefined
      if (rt) {
        if (rt.noClothes) localTexts.value['randTextures_noClothes'] = rt.noClothes
        if (rt.success) localTexts.value['randTextures_success'] = rt.success
      }

      if (showWelcome) {
        showTimeBasedWelcome()
      }
    } catch {
      if (currentSeq !== textLoadSeq) return
      localTexts.value = { ...fallbackLocalTexts }
      idleMessages.value = [...fallbackIdleMessages]
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
    listen('agent_changed', (payload) => {
      const agentId = (payload as { agentId?: unknown } | null)?.agentId
      if (typeof agentId === 'string' && agentId && agentId !== activeAgentId.value) {
        loadDynamicTexts({ agentId, showWelcome: false })
      }
    }).then((unlisten) => {
      unlistenAgentChanged = unlisten
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // 监听 state_update 实时热更新台词 (无需重启即可生效)
    gwConnect()
    onPush('state_update', applyStateTexts)
  })

  onUnmounted(() => {
    if (idleTimer) clearTimeout(idleTimer)
    unlistenAgentChanged?.()
    unlistenAgentChanged = null
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    offPush('state_update', applyStateTexts)
    gwDisconnect()
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
