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

import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue'
import { strongholdApi } from '../api/modules/strongholdApi'
import type { Facility, Room, ButlerConfig, GroupMessage } from '../api/modules/strongholdApi'
import { useNotificationStore } from '../stores/useNotificationStore'
import { logger } from '../lib/logger'

/** Agent 展示状态 (前端扩展) */
export interface AgentDisplayStatus {
  name: string
  avatar?: string
  room_name: string
  room_id: number
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

  // 群聊消息
  const messages = shallowRef<GroupMessage[]>([])
  const isLoadingMessages = ref(false)

  /** 错误信息 */
  const error = ref<string | null>(null)

  // ── 当前房间成员 ──

  const currentRoomAgents = computed(() => {
    if (!currentRoom.value) return []
    return agentsStatus.value.filter((a) => a.room_id === currentRoom.value!.id)
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
    currentRoom.value = room
    await fetchMessages(String(room.id))
  }

  // ── Agent 状态重建 ──

  /** 从 rooms 的 agents 字段提取全局 Agent 状态 */
  function rebuildAgentStatus(): void {
    const statusList: AgentDisplayStatus[] = []
    for (const room of rooms.value) {
      if (!room.agents) continue
      for (const agent of room.agents) {
        statusList.push({
          name: agent.agentId,
          avatar: agent.agentId[0]?.toUpperCase(),
          room_name: room.name,
          room_id: room.id,
        })
      }
    }
    agentsStatus.value = statusList
  }

  // ── 群聊消息 ──

  /** 加载房间消息 */
  async function fetchMessages(roomId: string): Promise<void> {
    try {
      isLoadingMessages.value = true
      const res = await strongholdApi.getMessages(roomId, 50)
      messages.value = res.data ?? []
    } catch (e) {
      logger.error('Stronghold', '加载消息失败', e)
    } finally {
      isLoadingMessages.value = false
    }
  }

  /** 发送消息 */
  async function sendMessage(content: string): Promise<void> {
    if (!currentRoom.value) return
    const roomId = String(currentRoom.value.id)
    try {
      await strongholdApi.sendMessage(roomId, content)
      // 发送后重新拉取消息 (包含 Agent 回复)
      await fetchMessages(roomId)
    } catch (e) {
      notify.toast('发送消息失败: ' + (e as Error).message, 'error')
      logger.error('Stronghold', '发送消息失败', e)
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

  /** 调用管家 (通过群聊发送指令) */
  async function callButler(query: string): Promise<void> {
    if (!currentRoom.value) return
    const roomId = String(currentRoom.value.id)
    try {
      // 以 system 角色发送管家指令
      await strongholdApi.sendMessage(roomId, query, 'Butler')
      await fetchMessages(roomId)
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
        await fetchMessages(String(currentRoom.value.id))
      }
    }, POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ── 监听房间切换 → 自动刷新 ──

  watch(
    () => currentRoom.value,
    (room) => {
      if (room) {
        fetchMessages(String(room.id))
      }
    },
  )

  // ── 生命周期 ──

  onMounted(async () => {
    await fetchFacilities()
    if (currentFacility.value) {
      await fetchRooms(currentFacility.value.id)
    }
    await fetchButlerConfig()
    startPolling()
  })

  onUnmounted(() => {
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
    butlerConfig,
    messages,
    isLoadingMessages,
    error,

    // 计算属性
    currentRoomAgents,

    // 操作
    selectFacility,
    selectRoom,
    fetchFacilities,
    fetchRooms,
    sendMessage,
    callButler,
    fetchButlerConfig,
  }
}
