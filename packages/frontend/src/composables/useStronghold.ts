/**
 * useStronghold — 据点管理 composable
 *
 * 将 strongholdApi 封装为响应式状态:
 * - 设施/房间列表加载
 * - 当前选中设施/房间
 * - Agent 状态
 * - 管家配置
 * - 群聊消息轮询
 *
 * @module packages/frontend/src/composables/useStronghold
 */

import { ref, shallowRef, computed, onMounted, onUnmounted } from 'vue'
import { strongholdApi } from '../api/modules/strongholdApi'
import type { Facility, Room, ButlerConfig, GroupMessage } from '../api/modules/strongholdApi'
import { agentApi } from '../api/modules/agentApi'
import { getApiBaseUrl } from '../api/transport'
import { useNotificationStore } from '../stores/useNotificationStore'
import { logger } from '../lib/logger'

/** Agent 档案 (来自 /api/agents，用于把 agentId 映射为真实名字与头像) */
export interface AgentProfileInfo {
  name: string
  avatarUrl?: string
}

/** 档案表：agentId → 档案信息 */
export type AgentProfileMap = Map<string, AgentProfileInfo>

/** Agent 展示状态 (前端扩展) */
export interface AgentDisplayStatus {
  /** 角色 ID (唯一键) */
  agentId: string
  /** 显示名 (档案 name，缺失时回退 agentId) */
  name: string
  /** 头像完整 URL */
  avatarUrl?: string
  roomName: string
  roomId: string
}

/** 轮询间隔 (ms) */
const POLL_INTERVAL_MS = 5000

export function useStronghold() {
  const notify = useNotificationStore()
  // ── 状态 ──

  const facilities = shallowRef<Facility[]>([])
  const rooms = shallowRef<Room[]>([])
  const currentFacility = ref<Facility | null>(null)
  const currentRoom = ref<Room | null>(null)
  const isLoading = ref(false)

  const agentsStatus = shallowRef<AgentDisplayStatus[]>([])
  const butlerConfig = ref<ButlerConfig | null>(null)

  /** 角色档案表：将 agentId 映射为真实名字与头像 URL */
  const agentProfiles = shallowRef<AgentProfileMap>(new Map())

  // 群聊消息
  const messages = shallowRef<GroupMessage[]>([])
  const isLoadingMessages = ref(false)
  const isSendingMessage = ref(false)
  /** 已完成调度，正在等待后台 Agent 回写回复。 */
  const isAwaitingReply = ref(false)
  /** 给聊天区展示的可读调度状态。 */
  const replyStatus = ref('')
  let messageRequestId = 0
  let replyWaitId = 0

  /** 错误信息 */
  const error = ref<string | null>(null)

  // ── 当前房间成员 ──

  const currentRoomAgents = computed(() => {
    if (!currentRoom.value) return []
    return agentsStatus.value.filter((agent) => agent.roomId === currentRoom.value!.id)
  })

  // ── 设施操作 ──

  /** 加载设施列表 */
  async function fetchFacilities(): Promise<void> {
    try {
      isLoading.value = true
      const res = await strongholdApi.listFacilities()
      facilities.value = res.data ?? []
      // 默认选中第一个设施
      if (!currentFacility.value && facilities.value.length > 0) {
        currentFacility.value = facilities.value[0]!
      }
    } catch (e) {
      error.value = `加载设施失败: ${(e as Error).message}`
      logger.error('Stronghold', error.value)
    } finally {
      isLoading.value = false
    }
  }

  /** 选择设施 */
  async function selectFacility(fac: Facility): Promise<void> {
    currentFacility.value = fac
    currentRoom.value = null
    messages.value = []
    cancelReplyWait()
    await fetchRooms(fac.id)
  }

  // ── 房间操作 ──

  /** 加载房间列表 (按设施过滤) */
  async function fetchRooms(facilityId?: number): Promise<void> {
    try {
      const res = await strongholdApi.listRooms(facilityId)
      rooms.value = res.data ?? []

      // 从 rooms 中提取所有 agents 的展示信息
      rebuildAgentStatus()
    } catch (e) {
      error.value = `加载房间失败: ${(e as Error).message}`
      logger.error('Stronghold', error.value)
    }
  }

  /** 选择房间 */
  async function selectRoom(room: Room): Promise<void> {
    if (currentRoom.value?.id === room.id) return
    cancelReplyWait()
    currentRoom.value = room
    messages.value = []
    await fetchMessages(room.id)
  }

  // ── Agent 状态重建 ──

  /** 加载角色档案 (名字/头像)，然后重建成员展示状态 */
  async function fetchAgentProfiles(): Promise<void> {
    try {
      const res = await agentApi.list()
      const map: AgentProfileMap = new Map()
      for (const agent of res.data ?? []) {
        map.set(agent.id, {
          name: agent.name,
          avatarUrl: agent.avatarUrl ? `${getApiBaseUrl()}${agent.avatarUrl}` : undefined,
        })
      }
      agentProfiles.value = map
      // 档案可能改变了已有成员的展示信息，重建一次
      rebuildAgentStatus()
    } catch (e) {
      // 档案加载失败不阻塞据点功能：回退为显示 agentId
      logger.error('Stronghold', '加载角色档案失败', e)
    }
  }

  /** 从 rooms 的 agents 字段提取全局 Agent 状态（合并档案信息） */
  function rebuildAgentStatus(): void {
    const statusList: AgentDisplayStatus[] = []
    for (const room of rooms.value) {
      if (!room.agents) continue
      for (const agentId of room.agents) {
        const profile = agentProfiles.value.get(agentId)
        statusList.push({
          agentId,
          name: profile?.name ?? agentId,
          avatarUrl: profile?.avatarUrl,
          roomName: room.name,
          roomId: room.id,
        })
      }
    }
    agentsStatus.value = statusList
  }

  // ── 群聊消息 ──

  /** 加载房间消息，并返回本次服务端快照供回复等待状态机判断。 */
  async function fetchMessages(roomId: string): Promise<GroupMessage[]> {
    const requestId = ++messageRequestId
    try {
      isLoadingMessages.value = true
      const res = await strongholdApi.getMessages(roomId, 50)
      const snapshot = res.data ?? []
      if (requestId === messageRequestId && currentRoom.value?.id === roomId) {
        messages.value = snapshot
      }
      return snapshot
    } catch (e) {
      logger.error('Stronghold', '加载消息失败', e)
      return []
    } finally {
      if (requestId === messageRequestId) isLoadingMessages.value = false
    }
  }

  /** 取消当前房间的回复等待，防止切房后旧轮询继续更新状态。 */
  function cancelReplyWait(): void {
    replyWaitId++
    isAwaitingReply.value = false
    replyStatus.value = ''
  }

  /**
   * 主动等待 Agent 的 assistant 回复或 system 失败消息。
   * 后端生成是异步的，因此这里以 1 秒间隔快速拉取，避免依赖常规 5 秒轮询。
   * @param expectedReplies 需要等待的回复条数（@全体成员 时为成员数）。
   */
  async function waitForAgentReply(
    roomId: string,
    afterMessageId: number,
    agentId?: string,
    expectedReplies = 1,
  ): Promise<void> {
    const waitId = ++replyWaitId
    isAwaitingReply.value = true
    const displayName = agentId
      ? agentId === '@all'
        ? '房间里的所有成员'
        : (agentProfiles.value.get(agentId)?.name ?? agentId)
      : '房间里的角色'
    replyStatus.value = `${displayName} 已接到消息，正在准备回复...`

    let foundReplies = 0
    for (let attempt = 0; attempt < 45; attempt++) {
      if (waitId !== replyWaitId || currentRoom.value?.id !== roomId) return
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const snapshot = await fetchMessages(roomId)
      foundReplies = snapshot.filter(
        (message) =>
          message.id > afterMessageId &&
          (message.role === 'assistant' || message.role === 'system'),
      ).length
      if (foundReplies >= expectedReplies) {
        if (waitId === replyWaitId) {
          isAwaitingReply.value = false
          replyStatus.value = ''
        }
        return
      }
    }

    if (waitId === replyWaitId) {
      isAwaitingReply.value = false
      replyStatus.value = ''
      notify.toast('角色回复等待超时；消息已保存，可稍后刷新房间查看', { type: 'warning' })
    }
  }

  /** 发送消息；complete 用于与共用 CHAR OPS 输入组件握手。 */
  async function sendMessage(
    content: string,
    mentions: string[] = [],
    complete?: (success: boolean) => void,
  ): Promise<boolean> {
    const roomId = currentRoom.value?.id
    const trimmed = content.trim()
    if (!roomId || !trimmed || isSendingMessage.value || isAwaitingReply.value) {
      complete?.(false)
      return false
    }
    try {
      isSendingMessage.value = true
      const response = await strongholdApi.sendMessage(roomId, trimmed, {
        senderId: 'user',
        role: 'user',
        mentions,
      })
      const dispatch = response.data
      if (!dispatch) throw new Error('服务端未返回群聊调度结果')

      // 立即显示服务端确认保存的用户消息，无需等待下一次轮询。
      messages.value = [
        ...messages.value.filter((item) => item.id !== dispatch.message.id),
        dispatch.message,
      ]
      complete?.(true)

      if (dispatch.replyQueued) {
        // @全体成员 时等待与成员数一致的回复条数全部落库。
        const expectedReplies =
          dispatch.agentId === '@all' ? (dispatch.allAgentIds?.length ?? 1) : 1
        void waitForAgentReply(roomId, dispatch.message.id, dispatch.agentId, expectedReplies)
      } else {
        notify.toast(`消息已发送；${dispatch.reason}`, { type: 'info' })
      }
      return true
    } catch (e) {
      complete?.(false)
      notify.toast('发送消息失败: ' + (e as Error).message, { type: 'error' })
      logger.error('Stronghold', '发送消息失败', e)
      return false
    } finally {
      isSendingMessage.value = false
    }
  }

  /**
   * 级联删除本轮群聊消息，并按服务端返回的权威 ID 即时更新本地列表。
   * 旧消息没有 pairId 时服务端会保守地仅删除目标消息。
   */
  async function deleteMessage(messageId: number): Promise<boolean> {
    const roomId = currentRoom.value?.id
    if (!roomId) return false
    try {
      const response = await strongholdApi.deleteMessage(roomId, messageId)
      const deleted = new Set(response.data?.deletedMessageIds ?? [messageId])
      messages.value = messages.value.filter((item) => !deleted.has(item.id))
      const deletedCount = response.data?.deletedCount ?? deleted.size
      notify.toast(deletedCount > 1 ? `已删除 ${deletedCount} 条关联消息` : '消息已删除', {
        type: 'success',
      })
      return true
    } catch (e) {
      notify.toast('删除消息失败: ' + (e as Error).message, { type: 'error' })
      logger.error('Stronghold', '删除消息失败', e)
      return false
    }
  }

  // ── 管家 ──

  /** 加载管家配置 */
  async function fetchButlerConfig(): Promise<void> {
    try {
      const res = await strongholdApi.getButlerConfig()
      butlerConfig.value = (res.data as ButlerConfig) ?? null
    } catch {
      // 管家不存在时静默
      butlerConfig.value = null
    }
  }

  /** 调用管家专用执行入口 */
  async function callButler(query: string): Promise<void> {
    const roomId = currentRoom.value?.id
    if (!roomId) return
    try {
      const res = await strongholdApi.callButler(roomId, query)
      // 管家执行结果（含 LLM 旁白/动作汇总）以 toast 反馈
      notify.toast(res.data?.message || '管家已执行', { type: 'success' })
      await Promise.all([fetchMessages(roomId), fetchRooms(currentFacility.value?.id)])
    } catch (e) {
      notify.toast('管家调用失败: ' + (e as Error).message, 'error')
      logger.error('Stronghold', '管家调用失败', e)
    }
  }

  // ── 轮询 ──

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling(): void {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      // 仅在有选中房间时轮询消息
      if (currentRoom.value) {
        await fetchMessages(currentRoom.value.id)
      }
    }, POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ── 生命周期 ──

  onMounted(async () => {
    // 档案与设施并行加载，互不阻塞；rebuildAgentStatus 会在两者完成后自动合并
    await Promise.all([fetchFacilities(), fetchAgentProfiles()])
    if (currentFacility.value) {
      await fetchRooms(currentFacility.value.id)
    }
    await fetchButlerConfig()
    startPolling()
  })

  onUnmounted(() => {
    messageRequestId++
    cancelReplyWait()
    stopPolling()
  })

  return {
    // 状态
    facilities,
    rooms,
    currentFacility,
    currentRoom,
    isLoading,
    agentsStatus,
    agentProfiles,
    butlerConfig,
    messages,
    isLoadingMessages,
    isSendingMessage,
    isAwaitingReply,
    replyStatus,
    error,

    // 计算属性
    currentRoomAgents,

    // 操作
    selectFacility,
    selectRoom,
    fetchFacilities,
    fetchRooms,
    fetchAgentProfiles,
    sendMessage,
    deleteMessage,
    callButler,
    fetchButlerConfig,
  }
}
