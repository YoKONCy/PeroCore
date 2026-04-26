<script setup lang="ts">
/**
 * SkillPanel — 技能管理面板
 *
 * 接收 useMcpConfig 提供的数据，渲染 Skill 列表、导入/删除操作。
 * 由 McpTab 组件编排使用。
 */
import { PixelIcon, PButton, PCard, PEmpty } from '../../pixel'
import type { SkillManifestItem } from '../../../api/modules/mcpApi'

defineProps<{
  skills: SkillManifestItem[]
  isSkillLoading: boolean
  expandedSkillId: string | null
  skillContent: string
}>()

const emit = defineEmits<{
  (e: 'toggle-expand', id: string): void
  (e: 'delete', id: string): void
}>()

/** 格式化参数占位符 (避免模板中双花括号冲突) */
function formatParam(key: string | number): string {
  return `{{${key}}}`
}
</script>

<template>
  <!-- 加载状态 -->
  <div v-if="isSkillLoading && skills.length === 0" class="flex-1 flex items-center justify-center">
    <div class="flex flex-col items-center gap-3 text-slate-400">
      <PixelIcon name="loader" size="lg" />
      <span class="text-sm font-bold">正在扫描技能目录...</span>
    </div>
  </div>

  <!-- 空状态 -->
  <div v-else-if="skills.length === 0" class="flex-1 flex items-center justify-center">
    <PEmpty description="暂未发现任何 Skill，请在 Extension 中添加 SKILL.md 文件" />
  </div>

  <!-- 技能列表 -->
  <div v-else class="flex-1 overflow-y-auto flex flex-col gap-2 mcp-scrollbar">
    <PCard
      v-for="skill in skills"
      :key="skill.id"
      pixel
      hoverable
      padding="sm"
      class="cursor-pointer"
      @click="emit('toggle-expand', skill.id)"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 bg-violet-50 border border-violet-200 flex items-center justify-center flex-shrink-0"
        >
          <PixelIcon name="sparkle" size="xs" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm font-black text-slate-800">{{ skill.name }}</h4>
            <span
              class="text-[9px] font-bold text-violet-500 px-1.5 py-0.5 bg-violet-50 border border-violet-200"
            >
              {{ skill.id }}
            </span>
            <span
              class="text-[9px] font-bold text-amber-600 px-1.5 py-0.5 bg-amber-50 border border-amber-200"
            >
              {{ skill.category }}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1 truncate">
            {{ skill.description || '(无描述)' }}
          </p>
          <div v-if="skill.tags.length > 0" class="flex flex-wrap gap-1 mt-1">
            <span
              v-for="tag in skill.tags"
              :key="tag"
              class="text-[9px] font-bold text-slate-500 px-1.5 py-0.5 bg-slate-50 border border-slate-200"
            >
              #{{ tag }}
            </span>
          </div>
        </div>
        <!-- requiredTools 计数 + 删除按钮 -->
        <div class="flex gap-1 items-center flex-shrink-0">
          <span
            v-if="skill.requiredTools.length > 0"
            class="text-[10px] font-bold text-sky-500 px-2 py-0.5 border border-sky-200 bg-sky-50"
          >
            {{ skill.requiredTools.length }} 个依赖工具
          </span>
          <PButton
            variant="ghost"
            size="sm"
            title="删除技能"
            @click.stop="emit('delete', skill.id)"
          >
            <PixelIcon name="trash" size="xs" />
          </PButton>
          <PixelIcon
            :name="expandedSkillId === skill.id ? 'chevron-up' : 'chevron-down'"
            size="xs"
          />
        </div>
      </div>

      <!-- 展开详情 -->
      <div v-if="expandedSkillId === skill.id" class="mt-3 pt-3 border-t border-slate-100">
        <!-- 可接收参数 -->
        <div v-if="Object.keys(skill.parameters).length > 0" class="mb-3">
          <h5 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-pixel">
            可接收参数
          </h5>
          <div class="flex flex-col gap-1">
            <div
              v-for="(desc, key) in skill.parameters"
              :key="key"
              class="flex items-center gap-2 px-2 py-1 border border-teal-200 bg-teal-50"
            >
              <span class="text-[11px] font-mono font-bold text-teal-700">
                {{ formatParam(key) }}
              </span>
              <span class="text-[11px] text-slate-400">{{ desc }}</span>
            </div>
          </div>
        </div>

        <!-- 依赖子 Skill -->
        <div v-if="skill.dependsOnSkills.length > 0" class="mb-3">
          <h5 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-pixel">
            依赖子技能
          </h5>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="dep in skill.dependsOnSkills"
              :key="dep"
              class="text-[11px] font-mono font-bold text-violet-600 px-2 py-0.5 bg-violet-50 border border-violet-200"
            >
              {{ dep }}
            </span>
          </div>
        </div>

        <!-- 依赖工具列表 -->
        <div v-if="skill.requiredTools.length > 0" class="mb-3">
          <h5 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-pixel">
            依赖工具
          </h5>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="tool in skill.requiredTools"
              :key="tool"
              class="text-[11px] font-mono font-bold text-sky-600 px-2 py-0.5 bg-sky-50 border border-sky-200"
            >
              {{ tool }}
            </span>
          </div>
        </div>

        <!-- SKILL.md 内容 -->
        <div>
          <h5 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-pixel">
            技能指令内容
          </h5>
          <pre
            class="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 p-3 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed font-mono"
            >{{ skillContent }}</pre
          >
        </div>
      </div>
    </PCard>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.mcp-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.mcp-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
