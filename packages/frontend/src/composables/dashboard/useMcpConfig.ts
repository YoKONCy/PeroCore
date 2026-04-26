/**
 * useMcpConfig — MCP / Skill 配置管理 composable
 *
 * 通过后端 /api/mcp/* REST API 管理:
 * 1. MCP 服务器配置（CRUD + 连接管理 + 工具查询）
 * 2. Skill 技能清单（列表 + 内容查看 + 重新加载）
 *
 * @module packages/frontend/src/composables/dashboard/useMcpConfig
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { mcpApi } from '../../api/modules/mcpApi'
import type {
  McpConfigItem,
  McpConnectionStatus,
  McpToolItem,
  SkillManifestItem,
} from '../../api/modules/mcpApi'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { logger } from '../../lib/logger'

// ── 运行时类型 ──

/** 前端展示用的 MCP Server 视图模型 */
export interface McpServerView {
  /** 配置 ID (DB) */
  id: number
  /** 服务名称 */
  name: string
  /** 连接类型 */
  type: 'stdio' | 'sse'
  /** stdio 命令 */
  command?: string
  /** SSE URL */
  url?: string
  /** 命令行参数 */
  args: string[]
  /** 环境变量 */
  env: Record<string, string>
  /** 是否启用 */
  enabled: boolean
  /** 运行时连接状态 (来自 /api/mcp/status) */
  status: 'connected' | 'disconnected' | 'error' | 'unknown'
  /** 已发现的工具列表 */
  tools: McpToolItem[]
  /** 错误信息 */
  error?: string
}

// ── Composable ──

export function useMcpConfig() {
  const notify = useNotificationStore()
  // ── 子 Tab 切换 (MCP / Skill) ──
  const currentSubTab = ref<'mcp' | 'skill'>('mcp')

  // ── MCP 状态 ──
  const servers = shallowRef<McpServerView[]>([])
  const isLoading = ref(false)
  const isAddOpen = ref(false)
  const expandedId = ref<number | null>(null)

  // ── Skill 状态 ──
  const skills = shallowRef<SkillManifestItem[]>([])
  const isSkillLoading = ref(false)
  const expandedSkillId = ref<string | null>(null)
  const skillContent = ref<string>('')

  const addForm = ref({
    name: '',
    type: 'stdio' as 'stdio' | 'sse',
    command: '',
    url: '',
    args: '',
    env: '',
  })

  const typeOptions = [
    { label: 'stdio (命令行)', value: 'stdio' },
    { label: 'SSE (远程)', value: 'sse' },
  ]

  const statusMeta: Record<string, { label: string; dotClass: string; badgeClass: string }> = {
    connected: {
      label: '已连接',
      dotClass: 'bg-emerald-500',
      badgeClass: 'text-emerald-600 border-emerald-300 bg-emerald-50',
    },
    disconnected: {
      label: '未连接',
      dotClass: 'bg-slate-400',
      badgeClass: 'text-slate-400 border-slate-300 bg-slate-50',
    },
    error: {
      label: '错误',
      dotClass: 'bg-red-500',
      badgeClass: 'text-red-500 border-red-300 bg-red-50',
    },
    unknown: {
      label: '未知',
      dotClass: 'bg-slate-400',
      badgeClass: 'text-slate-400 border-slate-300 bg-slate-50',
    },
  }

  const totalTools = computed(() => servers.value.reduce((sum, s) => sum + s.tools.length, 0))
  const connectedCount = computed(
    () => servers.value.filter((s) => s.status === 'connected').length,
  )

  // ── 数据加载 ──

  /** 加载配置 + 连接状态 + 工具信息 (三合一) */
  async function loadServers() {
    isLoading.value = true
    try {
      // 并行获取配置和状态
      const [configsRes, statusRes, toolsRes] = await Promise.all([
        mcpApi.getConfigs(),
        mcpApi.getStatus(),
        mcpApi.getTools(),
      ])

      const configs = configsRes.data ?? []
      const statusData = statusRes.data
      const allTools = toolsRes.data ?? []

      // 构建状态映射 (name → connection status)
      const statusMap = new Map<string, McpConnectionStatus>()
      if (statusData?.connections) {
        for (const conn of statusData.connections) {
          statusMap.set(conn.name, conn)
        }
      }

      // 构建工具映射 (serverName → tools[])
      const toolsMap = new Map<string, McpToolItem[]>()
      for (const tool of allTools) {
        const list = toolsMap.get(tool.serverName) ?? []
        list.push(tool)
        toolsMap.set(tool.serverName, list)
      }

      // 合并视图模型
      servers.value = configs.map((cfg: McpConfigItem): McpServerView => {
        const connStatus = statusMap.get(cfg.name)
        return {
          id: cfg.id,
          name: cfg.name,
          type: (cfg.type as 'stdio' | 'sse') ?? 'stdio',
          command: cfg.command ?? undefined,
          url: cfg.url ?? undefined,
          args: cfg.args ?? [],
          env: cfg.env ?? {},
          enabled: cfg.enabled,
          status: connStatus?.status ?? (cfg.enabled ? 'disconnected' : 'unknown'),
          tools: toolsMap.get(cfg.name) ?? [],
          error: connStatus?.error,
        }
      })
    } catch (err) {
      notify.toast('加载 MCP 配置失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '加载 MCP 配置失败', err)
      servers.value = []
    } finally {
      isLoading.value = false
    }
  }

  // ── CRUD 操作 ──

  function toggleExpand(id: number) {
    expandedId.value = expandedId.value === id ? null : id
  }

  /** 添加新 MCP 服务 */
  async function addServer() {
    const name = addForm.value.name.trim()
    if (!name) return

    try {
      // 解析 args 和 env
      let args: string[] = []
      let env: Record<string, string> = {}

      if (addForm.value.args.trim()) {
        try {
          args = JSON.parse(addForm.value.args)
        } catch {
          // 按空格分割作为 fallback
          args = addForm.value.args.split(/\s+/).filter(Boolean)
        }
      }

      if (addForm.value.env.trim()) {
        try {
          env = JSON.parse(addForm.value.env)
        } catch {
          logger.warn('McpConfig', '环境变量 JSON 解析失败，已忽略')
        }
      }

      await mcpApi.createConfig({
        name,
        type: addForm.value.type,
        command: addForm.value.type === 'stdio' ? addForm.value.command : undefined,
        url: addForm.value.type === 'sse' ? addForm.value.url : undefined,
        args,
        env,
        enabled: true,
      })

      isAddOpen.value = false
      addForm.value = { name: '', type: 'stdio', command: '', url: '', args: '', env: '' }
      await loadServers()
      notify.toast(`MCP 服务 "${name}" 已创建`, 'success')
      logger.info('McpConfig', `MCP 服务 "${name}" 已创建`)
    } catch (err) {
      notify.toast('创建 MCP 服务失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '创建 MCP 服务失败', err)
    }
  }

  /** 删除 MCP 服务 */
  async function removeServer(id: number) {
    try {
      await mcpApi.deleteConfig(id)
      await loadServers()
      notify.toast('MCP 服务已删除', 'success')
      logger.info('McpConfig', `MCP 配置 #${id} 已删除`)
    } catch (err) {
      notify.toast('删除 MCP 服务失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '删除 MCP 服务失败', err)
    }
  }

  /** 切换启用/禁用 */
  async function toggleEnabled(id: number) {
    try {
      await mcpApi.toggleEnabled(id)
      await loadServers()
    } catch (err) {
      notify.toast('切换 MCP 启用状态失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '切换 MCP 启用状态失败', err)
    }
  }

  /** 重新连接单个 MCP Server */
  async function reconnect(id: number) {
    const srv = servers.value.find((s) => s.id === id)
    if (!srv) return

    try {
      // 临时标记为加载中
      servers.value = servers.value.map((s) =>
        s.id === id ? { ...s, status: 'unknown' as const, error: undefined } : s,
      )

      await mcpApi.reconnect(srv.name)
      await loadServers()
      notify.toast(`MCP 服务 "${srv.name}" 已重新连接`, 'success')
      logger.info('McpConfig', `MCP 服务 "${srv.name}" 已重新连接`)
    } catch (err) {
      notify.toast(`重连 MCP 服务 "${srv.name}" 失败: ${(err as Error).message}`, 'error')
      logger.error('McpConfig', `重连 MCP 服务 "${srv.name}" 失败`, err)
      // 刷新获取真实状态
      await loadServers()
    }
  }

  /** 连接所有已启用的 MCP 服务器 */
  async function connectAll() {
    try {
      await mcpApi.connectAll()
      await loadServers()
      notify.toast('所有 MCP 服务已连接', 'success')
      logger.info('McpConfig', '所有 MCP 服务已连接')
    } catch (err) {
      notify.toast('批量连接 MCP 服务失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '批量连接 MCP 服务失败', err)
    }
  }

  // ── Skill 操作 ──

  /** 加载所有 Skill 清单 */
  async function loadSkills() {
    isSkillLoading.value = true
    try {
      const res = await mcpApi.getSkills()
      skills.value = res.data ?? []
    } catch (err) {
      notify.toast('加载 Skill 列表失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', '加载 Skill 列表失败', err)
      skills.value = []
    } finally {
      isSkillLoading.value = false
    }
  }

  /** 展开/折叠 Skill 详情 (懒加载 L2 内容) */
  async function toggleSkillExpand(id: string) {
    if (expandedSkillId.value === id) {
      expandedSkillId.value = null
      skillContent.value = ''
      return
    }

    expandedSkillId.value = id
    skillContent.value = '加载中...'

    try {
      const res = await mcpApi.getSkillContent(id)
      skillContent.value = res.data?.content ?? '(无内容)'
    } catch (err) {
      logger.error('McpConfig', `加载 Skill "${id}" 内容失败`, err)
      skillContent.value = '加载失败'
    }
  }

  /** 重新扫描所有 Skill 目录 */
  async function reloadSkills() {
    isSkillLoading.value = true
    try {
      const res = await mcpApi.reloadSkills()
      skills.value = res.data ?? []
      notify.toast(`Skill 已重新加载: ${skills.value.length} 个`, 'success')
      logger.info('McpConfig', `Skill 已重新加载: ${skills.value.length} 个`)
    } catch (err) {
      notify.toast('Skill 重新加载失败: ' + (err as Error).message, 'error')
      logger.error('McpConfig', 'Skill 重新加载失败', err)
    } finally {
      isSkillLoading.value = false
    }
  }

  // ── Skill 导入 / 删除 ──

  const isImportOpen = ref(false)
  const importPath = ref('')
  const importError = ref('')

  /** 导入本地 Skill 文件夹 */
  async function importSkill() {
    const sourcePath = importPath.value.trim()
    if (!sourcePath) return

    importError.value = ''
    isSkillLoading.value = true

    try {
      const res = await mcpApi.importSkill(sourcePath)
      skills.value = res.data ?? []
      isImportOpen.value = false
      importPath.value = ''
      notify.toast(`Skill 导入成功: ${sourcePath}`, 'success')
      logger.info('McpConfig', `Skill 导入成功: ${sourcePath}`)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '导入失败'
      importError.value = msg
      notify.toast('Skill 导入失败: ' + msg, 'error')
      logger.error('McpConfig', 'Skill 导入失败', err)
    } finally {
      isSkillLoading.value = false
    }
  }

  /** 删除用户 Skill */
  async function deleteSkill(id: string) {
    try {
      await mcpApi.deleteSkill(id)
      await loadSkills()
      notify.toast(`Skill "${id}" 已删除`, 'success')
      logger.info('McpConfig', `Skill "${id}" 已删除`)
    } catch (err) {
      notify.toast(`删除 Skill "${id}" 失败: ${(err as Error).message}`, 'error')
      logger.error('McpConfig', `删除 Skill "${id}" 失败`, err)
    }
  }

  // ── 初始化 ──

  onMounted(() => {
    loadServers()
    loadSkills()
  })

  return {
    // 子 Tab
    currentSubTab,
    // MCP
    servers,
    isLoading,
    isAddOpen,
    expandedId,
    addForm,
    typeOptions,
    statusMeta,
    totalTools,
    connectedCount,
    toggleExpand,
    addServer,
    removeServer,
    toggleEnabled,
    reconnect,
    connectAll,
    loadServers,
    // Skill
    skills,
    isSkillLoading,
    expandedSkillId,
    skillContent,
    loadSkills,
    toggleSkillExpand,
    reloadSkills,
    // Skill 导入/删除
    isImportOpen,
    importPath,
    importError,
    importSkill,
    deleteSkill,
  }
}
