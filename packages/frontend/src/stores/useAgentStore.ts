/**
 * useAgentStore — Agent 全局状态
 *
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { agentApi } from '../api/modules/agentApi'
import type { AgentListItem } from '../api/modules/agentApi'

export const useAgentStore = defineStore('agent', () => {
  // ── 状态 ──
  const agents = ref<AgentListItem[]>([])
  const activeAgentId = ref<string>('pero')
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ── 计算属性 ──
  const currentAgent = computed(
    () => agents.value.find((a) => a.id === activeAgentId.value) ?? null,
  )

  const enabledAgents = computed(() => agents.value.filter((a) => a.isEnabled))

  // ── 动作 ──

  /** 拉取所有 Agent 列表 */
  async function fetchAgents() {
    isLoading.value = true
    error.value = null
    try {
      const res = await agentApi.list()
      agents.value = res.data ?? []
      // 同步 activeAgentId
      const active = agents.value.find((a) => a.isActive)
      if (active) activeAgentId.value = active.id
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      isLoading.value = false
    }
  }

  /** 切换活跃 Agent */
  async function switchAgent(agentId: string) {
    try {
      await agentApi.setActive(agentId)
      activeAgentId.value = agentId
      // 刷新列表以同步 isActive 标志
      await fetchAgents()
    } catch (err) {
      error.value = (err as Error).message
    }
  }

  return {
    agents,
    activeAgentId,
    isLoading,
    error,
    currentAgent,
    enabledAgents,
    fetchAgents,
    switchAgent,
  }
})
