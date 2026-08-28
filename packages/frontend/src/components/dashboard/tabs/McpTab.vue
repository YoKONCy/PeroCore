<script setup lang="ts">
/**
 * McpTab — MCP / 技能配置 Tab (F1-5)
 *
 * 编排器：双面板切换 + 弹窗管理。
 * 面板内容委托给 McpPanel / SkillPanel 子组件。
 *
 * @see useMcpConfig composable
 */
import { watch } from 'vue'
import { PixelIcon, PInput, PButton, PDialog, PSelect } from '../../pixel'
import { useMcpConfig } from '../../../composables/dashboard/useMcpConfig'
import { useDashboardContext } from '../../../composables/dashboard'
import McpPanel from './McpPanel.vue'
import SkillPanel from './SkillPanel.vue'

const ctx = useDashboardContext()

const {
  currentSubTab,
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
  skills,
  isSkillLoading,
  expandedSkillId,
  skillContent,
  toggleSkillExpand,
  reloadSkills,
  loadSkills,
  isImportOpen,
  importPath,
  importName,
  importError,
  selectSkillDirectory,
  importSkill,
  deleteSkill,
} = useMcpConfig()

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => {
    loadServers()
    loadSkills()
  },
)
</script>

<template>
  <div class="p-8 h-full flex flex-col overflow-hidden">
    <!-- 头部 + 子选项卡切换 -->
    <div class="flex items-start justify-between gap-4 mb-6 flex-shrink-0 relative group/header">
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-sky-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-sky-400/15 transition-all duration-1000"
      />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <button
            :class="[
              'flex items-center gap-2 text-xl font-black bg-none border-none cursor-pointer p-0 transition-all',
              currentSubTab === 'mcp'
                ? 'text-slate-800 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-500',
            ]"
            @click="currentSubTab = 'mcp'"
          >
            <PixelIcon name="terminal" size="sm" />
            <span class="font-pixel">MCP 服务</span>
          </button>
          <span class="text-[var(--ui-border-strong)] text-xl font-light">/</span>
          <button
            :class="[
              'flex items-center gap-2 text-xl font-black bg-none border-none cursor-pointer p-0 transition-all',
              currentSubTab === 'skill'
                ? 'text-[var(--ui-text-primary)] scale-[1.02]'
                : 'text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)]',
            ]"
            @click="currentSubTab = 'skill'"
          >
            <PixelIcon name="brain" size="sm" />
            <span class="font-pixel">技能管理</span>
          </button>
        </div>
        <p class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-7 font-pixel">
          {{ currentSubTab === 'mcp' ? 'MODEL CONTEXT PROTOCOL' : 'SKILL MANAGEMENT' }}
        </p>
      </div>
      <!-- 右侧操作栏 -->
      <div class="flex gap-2 items-center">
        <template v-if="currentSubTab === 'mcp'">
          <span
            class="text-[11px] font-bold text-slate-400 px-2.5 py-1 border border-slate-200 bg-slate-50"
          >
            {{ servers.length }} 个服务
          </span>
          <span
            class="text-[11px] font-bold px-2.5 py-1 border"
            :class="
              connectedCount > 0
                ? 'text-emerald-500 border-emerald-200 bg-emerald-50'
                : 'text-slate-400 border-slate-200 bg-slate-50'
            "
          >
            {{ connectedCount }} 已连接
          </span>
          <span
            class="text-[11px] font-bold text-sky-500 px-2.5 py-1 border border-sky-200 bg-sky-50"
          >
            {{ totalTools }} 个工具
          </span>
          <PButton variant="ghost" size="sm" :disabled="isLoading" @click="connectAll">
            <PixelIcon :name="isLoading ? 'loader' : 'refresh'" size="xs" />
            全部连接
          </PButton>
          <PButton variant="primary" @click="isAddOpen = true">
            <PixelIcon name="plus" size="xs" />
            添加服务
          </PButton>
        </template>
        <template v-else>
          <span
            class="text-[11px] font-bold text-violet-500 px-2.5 py-1 border border-violet-200 bg-violet-50"
          >
            {{ skills.length }} 个技能
          </span>
          <PButton variant="ghost" size="sm" :disabled="isSkillLoading" @click="reloadSkills">
            <PixelIcon :name="isSkillLoading ? 'loader' : 'refresh'" size="xs" />
            重新扫描
          </PButton>
          <PButton variant="primary" @click="isImportOpen = true">
            <PixelIcon name="plus" size="xs" />
            导入技能
          </PButton>
        </template>
      </div>
    </div>

    <!-- ==================== MCP 面板 ==================== -->
    <McpPanel
      v-if="currentSubTab === 'mcp'"
      :servers="servers"
      :is-loading="isLoading"
      :expanded-id="expandedId"
      :status-meta="statusMeta"
      @toggle-expand="toggleExpand"
      @toggle-enabled="toggleEnabled"
      @reconnect="reconnect"
      @remove="removeServer"
    />

    <!-- ==================== Skill 面板 ==================== -->
    <SkillPanel
      v-else
      :skills="skills"
      :is-skill-loading="isSkillLoading"
      :expanded-skill-id="expandedSkillId"
      :skill-content="skillContent"
      @toggle-expand="toggleSkillExpand"
      @delete="deleteSkill"
    />

    <!-- 添加 MCP 服务弹窗 -->
    <PDialog v-model="isAddOpen" title="添加 MCP 服务" width="520px">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            名称
          </label>
          <PInput v-model="addForm.name" placeholder="服务名称 (如 filesystem)" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            连接类型
          </label>
          <PSelect v-model="addForm.type" :options="typeOptions" />
        </div>
        <div v-if="addForm.type === 'stdio'" class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            命令
          </label>
          <PInput
            v-model="addForm.command"
            placeholder="npx -y @modelcontextprotocol/server-filesystem"
          />
        </div>
        <div v-if="addForm.type === 'stdio'" class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            参数 (JSON 数组 或 空格分隔)
          </label>
          <PInput v-model="addForm.args" placeholder='["/path/to/dir"] 或 /path/to/dir' />
        </div>
        <div v-if="addForm.type === 'sse'" class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            SSE URL
          </label>
          <PInput v-model="addForm.url" placeholder="http://localhost:3001/sse" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            环境变量 (JSON，可选)
          </label>
          <PInput v-model="addForm.env" placeholder='{"API_KEY": "xxx"}' />
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isAddOpen = false">取消</PButton>
        <PButton variant="primary" :disabled="!addForm.name.trim()" @click="addServer">
          添加
        </PButton>
      </template>
    </PDialog>

    <!-- 导入 Skill 弹窗 -->
    <PDialog v-model="isImportOpen" title="导入本地技能" width="520px">
      <div class="flex flex-col gap-4">
        <button
          type="button"
          class="flex min-h-28 flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-bg-surface-soft)] px-5 py-6 text-[var(--ui-text-secondary)] transition-colors hover:border-[var(--ui-accent-sky)] hover:text-[var(--ui-accent-sky)]"
          @click="selectSkillDirectory"
        >
          <PixelIcon name="folder" size="lg" />
          <strong class="font-pixel text-sm">
            {{ importPath ? '重新选择 Skill 文件夹' : '浏览本机 Skill 文件夹' }}
          </strong>
          <span class="text-[10px] text-[var(--ui-text-tertiary)]">
            请选择包含 SKILL.md 的完整文件夹
          </span>
        </button>

        <div
          v-if="importPath"
          class="flex items-center gap-3 border border-[var(--ui-border-default)] bg-[var(--ui-bg-elevated)] px-3 py-3"
        >
          <PixelIcon name="brain" size="sm" class="text-violet-500" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold text-[var(--ui-text-primary)]">
              {{ importName || '已选择 Skill' }}
            </div>
            <div class="truncate text-[10px] text-[var(--ui-text-tertiary)]" :title="importPath">
              {{ importPath }}
            </div>
          </div>
          <PixelIcon name="check" size="sm" class="text-emerald-500" />
        </div>

        <p class="text-[10px] text-slate-400">
          导入后会将整个文件夹复制到用户技能目录，包括 SKILL.md 和引用的脚本、模板及其他资源。
        </p>
        <p
          v-if="importError"
          class="text-[11px] text-[var(--ui-danger)] bg-[var(--ui-danger-soft)] border border-[color:var(--ui-danger)] px-3 py-2"
        >
          ⚠ {{ importError }}
        </p>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isImportOpen = false">取消</PButton>
        <PButton
          variant="primary"
          :disabled="!importPath || isSkillLoading"
          :loading="isSkillLoading"
          @click="importSkill"
        >
          导入
        </PButton>
      </template>
    </PDialog>
  </div>
</template>
