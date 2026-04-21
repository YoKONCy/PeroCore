/**
 * useMcpConfig — MCP 配置管理 composable
 *
 * 通过 configApi KV 存储管理 MCP 服务器配置。
 * 后端暂无独立 MCP service，配置以 JSON 序列化存储在 config KV 中。
 *
 * @module packages/frontend/src/composables/dashboard/useMcpConfig
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { configApi } from '../../api/modules/configApi'

// ── 类型 ──

export interface McpServerConfig {
  id: string
  name: string
  type: 'stdio' | 'ws'
  command?: string
  url?: string
  enabled: boolean
}

export interface McpTool {
  name: string
  description: string
}

export interface McpServer extends McpServerConfig {
  /** 运行时状态（前端本地管理，不持久化） */
  status: 'connected' | 'disconnected' | 'error'
  tools: McpTool[]
}

/** configApi 存储的 KV key */
const CONFIG_KEY = 'mcp_servers'

// ── Composable ──

export function useMcpConfig() {
  const servers = shallowRef<McpServer[]>([])
  const isLoading = ref(false)
  const isAddOpen = ref(false)
  const expandedId = ref<string | null>(null)

  const addForm = ref({
    name: '',
    type: 'stdio' as 'stdio' | 'ws',
    command: '',
    url: '',
  })

  const typeOptions = [
    { label: 'stdio (命令行)', value: 'stdio' },
    { label: 'WebSocket', value: 'ws' },
  ]

  const statusMeta: Record<string, { label: string; class: string }> = {
    connected: { label: '已连接', class: 'st-connected' },
    disconnected: { label: '未连接', class: 'st-disconnected' },
    error: { label: '错误', class: 'st-error' },
  }

  const totalTools = computed(() => servers.value.reduce((sum, s) => sum + s.tools.length, 0))

  // ── 持久化 ──

  /** 从 configApi 加载 MCP 配置 */
  async function loadServers() {
    isLoading.value = true
    try {
      const res = await configApi.get<{ key: string; value: string }>(CONFIG_KEY)
      if (res.data?.value) {
        const configs: McpServerConfig[] = JSON.parse(res.data.value)
        servers.value = configs.map((c) => ({
          ...c,
          status: 'disconnected' as const,
          tools: [],
        }))
      }
    } catch {
      // key 不存在时返回 404，属正常初始状态
      servers.value = []
    } finally {
      isLoading.value = false
    }
  }

  /** 保存当前配置到 configApi */
  async function saveServers() {
    const configs: McpServerConfig[] = servers.value.map(
      ({ id, name, type, command, url, enabled }) => ({
        id,
        name,
        type,
        command,
        url,
        enabled,
      }),
    )
    await configApi.set(CONFIG_KEY, JSON.stringify(configs))
  }

  // ── 操作 ──

  function toggleExpand(id: string) {
    expandedId.value = expandedId.value === id ? null : id
  }

  async function addServer() {
    const newServer: McpServer = {
      id: `mcp-${Date.now()}`,
      name: addForm.value.name || '未命名',
      type: addForm.value.type,
      command: addForm.value.command || undefined,
      url: addForm.value.url || undefined,
      enabled: true,
      status: 'disconnected',
      tools: [],
    }
    servers.value = [...servers.value, newServer]
    isAddOpen.value = false
    addForm.value = { name: '', type: 'stdio', command: '', url: '' }
    await saveServers()
  }

  async function removeServer(id: string) {
    servers.value = servers.value.filter((s) => s.id !== id)
    await saveServers()
  }

  async function toggleEnabled(id: string) {
    const srv = servers.value.find((s) => s.id === id)
    if (srv) {
      srv.enabled = !srv.enabled
      // 触发响应性
      servers.value = [...servers.value]
      await saveServers()
    }
  }

  function reconnect(id: string) {
    const srv = servers.value.find((s) => s.id === id)
    if (srv) {
      // TODO: 后端实现 MCP 服务重连后对接
      srv.status = 'connected'
      servers.value = [...servers.value]
    }
  }

  // ── 初始化 ──

  onMounted(loadServers)

  return {
    servers,
    isLoading,
    isAddOpen,
    expandedId,
    addForm,
    typeOptions,
    statusMeta,
    totalTools,
    toggleExpand,
    addServer,
    removeServer,
    toggleEnabled,
    reconnect,
    loadServers,
  }
}
