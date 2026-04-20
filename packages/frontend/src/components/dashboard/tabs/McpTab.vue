<script setup lang="ts">
/**
 * McpTab — MCP 配置 Tab (F1-5)
 *
 * 管理 MCP (Model Context Protocol) 服务连接和工具浏览。
 */
import { ref, computed } from 'vue'
import { PixelIcon, PInput, PButton, PDialog, PEmpty, PSelect } from '../../pixel'

// ── 类型 ──

interface McpServer {
  id: string
  name: string
  type: 'stdio' | 'ws'
  command?: string
  url?: string
  status: 'connected' | 'disconnected' | 'error'
  tools: Array<{ name: string; description: string }>
}

// ── Mock ──

const servers = ref<McpServer[]>([
  {
    id: 'mcp1', name: 'Filesystem', type: 'stdio', command: 'npx @modelcontextprotocol/server-filesystem',
    status: 'connected',
    tools: [
      { name: 'read_file', description: '读取文件内容' },
      { name: 'write_file', description: '写入文件' },
      { name: 'list_directory', description: '列出目录内容' },
    ],
  },
  {
    id: 'mcp2', name: 'Web Search', type: 'stdio', command: 'npx @modelcontextprotocol/server-brave-search',
    status: 'disconnected',
    tools: [
      { name: 'brave_search', description: '使用 Brave 搜索引擎搜索' },
    ],
  },
])

const isAddOpen = ref(false)
const addForm = ref({ name: '', type: 'stdio' as 'stdio' | 'ws', command: '', url: '' })
const expandedId = ref<string | null>(null)

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

function toggleExpand(id: string) { expandedId.value = expandedId.value === id ? null : id }

function addServer() {
  servers.value.push({
    id: 'mcp-' + Date.now(),
    name: addForm.value.name || '未命名',
    type: addForm.value.type,
    command: addForm.value.command,
    url: addForm.value.url,
    status: 'disconnected',
    tools: [],
  })
  isAddOpen.value = false
  addForm.value = { name: '', type: 'stdio', command: '', url: '' }
}

function removeServer(id: string) {
  servers.value = servers.value.filter((s) => s.id !== id)
}

function reconnect(id: string) {
  const s = servers.value.find((s) => s.id === id)
  if (s) {
    s.status = 'connected'
  }
}
</script>

<template>
  <div class="tab-mcp">
    <div class="tab-header">
      <div class="tab-header-left">
        <h2 class="tab-title">
          <PixelIcon name="terminal" size="md" />
          <span>MCP 配置</span>
        </h2>
        <p class="tab-subtitle">MODEL CONTEXT PROTOCOL</p>
      </div>
      <div class="mcp-header-stats">
        <span class="mcp-stat">{{ servers.length }} 个服务</span>
        <span class="mcp-stat">{{ totalTools }} 个工具</span>
        <PButton variant="primary" @click="isAddOpen = true">
          <PixelIcon name="plus" size="xs" />
          添加服务
        </PButton>
      </div>
    </div>

    <!-- 服务列表 -->
    <div v-if="servers.length === 0" class="mcp-empty">
      <PEmpty description="还没有配置 MCP 服务" />
    </div>
    <div v-else class="mcp-list">
      <div v-for="srv in servers" :key="srv.id" class="mcp-server" @click="toggleExpand(srv.id)">
        <div class="mcp-server-main">
          <div :class="['mcp-status-dot', statusMeta[srv.status].class]" />
          <div class="mcp-server-info">
            <div class="mcp-server-name-row">
              <h4 class="mcp-server-name">{{ srv.name }}</h4>
              <span :class="['mcp-server-status', statusMeta[srv.status].class]">{{ statusMeta[srv.status].label }}</span>
              <span class="mcp-server-type">{{ srv.type.toUpperCase() }}</span>
            </div>
            <p class="mcp-server-cmd">{{ srv.type === 'stdio' ? srv.command : srv.url }}</p>
          </div>
          <div class="mcp-server-actions">
            <PButton variant="ghost" size="sm" @click.stop="reconnect(srv.id)">
              <PixelIcon name="refresh" size="xs" />
            </PButton>
            <PButton variant="ghost" size="sm" @click.stop="removeServer(srv.id)">
              <PixelIcon name="trash" size="xs" />
            </PButton>
          </div>
        </div>

        <!-- 工具列表 -->
        <div v-if="expandedId === srv.id && srv.tools.length > 0" class="mcp-tools">
          <h5 class="mcp-tools-title">可用工具 ({{ srv.tools.length }})</h5>
          <div v-for="tool in srv.tools" :key="tool.name" class="mcp-tool">
            <span class="mcp-tool-name">{{ tool.name }}</span>
            <span class="mcp-tool-desc">{{ tool.description }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加弹窗 -->
    <PDialog v-model="isAddOpen" title="添加 MCP 服务" width="480px">
      <div class="mcp-add-form">
        <div class="mcp-field"><label class="mcp-label">名称</label><PInput v-model="addForm.name" placeholder="服务名称" /></div>
        <div class="mcp-field"><label class="mcp-label">连接类型</label><PSelect v-model="addForm.type" :options="typeOptions" /></div>
        <div v-if="addForm.type === 'stdio'" class="mcp-field">
          <label class="mcp-label">命令</label><PInput v-model="addForm.command" placeholder="npx @modelcontextprotocol/server-xxx" />
        </div>
        <div v-else class="mcp-field">
          <label class="mcp-label">WebSocket URL</label><PInput v-model="addForm.url" placeholder="ws://localhost:8080" />
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isAddOpen = false">取消</PButton>
        <PButton variant="primary" @click="addServer">添加</PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
.tab-mcp { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tab-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-shrink: 0; }
.tab-header-left { display: flex; flex-direction: column; gap: 4px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-left: 36px; }
.mcp-header-stats { display: flex; gap: 12px; align-items: center; }
.mcp-stat { font-size: 11px; font-weight: 700; color: var(--color-text-muted); padding: 4px 10px; border: 1px solid var(--color-border); background: var(--color-bg-secondary); }

.mcp-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.mcp-list::-webkit-scrollbar { width: 4px; }
.mcp-list::-webkit-scrollbar-thumb { background: var(--color-blue-200); }
.mcp-empty { flex: 1; display: flex; align-items: center; justify-content: center; }

.mcp-server { border: 2px solid var(--color-border); background: var(--color-bg-primary); padding: 16px; cursor: pointer; transition: all 0.2s; }
.mcp-server:hover { border-color: var(--color-blue-200); }
.mcp-server-main { display: flex; align-items: center; gap: 12px; }
.mcp-status-dot { width: 8px; height: 8px; flex-shrink: 0; }
.st-connected { background: var(--color-green-500, #22c55e); color: var(--color-green-600, #16a34a); }
.st-disconnected { background: var(--color-text-muted); color: var(--color-text-muted); }
.st-error { background: var(--color-red-500, #ef4444); color: var(--color-red-500, #ef4444); }
.mcp-server-info { flex: 1; min-width: 0; }
.mcp-server-name-row { display: flex; align-items: center; gap: 8px; }
.mcp-server-name { font-size: 14px; font-weight: 800; color: var(--color-text-primary); }
.mcp-server-status { font-size: 9px; font-weight: 700; padding: 1px 6px; border: 1px solid; }
.mcp-server-type { font-size: 9px; font-weight: 700; color: var(--color-text-muted); padding: 1px 6px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); }
.mcp-server-cmd { font-size: 11px; color: var(--color-text-muted); font-family: monospace; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mcp-server-actions { display: flex; gap: 4px; flex-shrink: 0; }

.mcp-tools { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); }
.mcp-tools-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-text-muted); margin-bottom: 8px; }
.mcp-tool { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border: 1px solid var(--color-border); margin-bottom: 4px; }
.mcp-tool-name { font-size: 12px; font-weight: 700; color: var(--color-blue-600); font-family: monospace; }
.mcp-tool-desc { font-size: 11px; color: var(--color-text-muted); }

.mcp-add-form { display: flex; flex-direction: column; gap: 16px; }
.mcp-field { display: flex; flex-direction: column; gap: 6px; }
.mcp-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-text-muted); }
</style>
