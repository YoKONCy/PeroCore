<script setup lang="ts">
/**
 * UserSettingsTab — 用户设定 Tab (F1-3)
 *
 * 用户人设 (名称 + 人设描述)、外观 (主题/字体)、高级 (数据目录/日志)
 * F3: 已对接 configApi 读写。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton, PCard } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { useMainNav } from '../../../composables/main/useMainNav'
import {
  useSensoryPreferences,
  type MotionLevel,
} from '../../../composables/ui/useSensoryPreferences'
import { uiSound } from '../../../services/ui/uiSound'
import { logger } from '../../../lib/logger'
import { useNotificationStore } from '../../../stores'

const ctx = useDashboardContext()
const notif = useNotificationStore()

// ── 用户设定 ──
const ownerName = ref('主人')
const ownerPersona = ref('')
const language = ref('zh-CN')

// ── 外观 ──
// 主题直接复用 app 侧边栏的 useMainNav 单例状态，不额外维护第二份偏好。
const mainNav = useMainNav()
/** PSelect 的字符串模型代理，直接读写唯一的 mainNav.theme 状态。 */
const themeBinding = computed({
  get: () => mainNav.theme.value,
  set: (value: string | number) => {
    if (value === 'light' || value === 'dark') mainNav.setTheme(value)
  },
})
const fontSize = ref(14)
const sensory = useSensoryPreferences()
const motionBinding = computed({
  get: () => sensory.motionLevel.value,
  set: (value: string | number) => {
    if (value === 'full' || value === 'reduced' || value === 'off')
      sensory.motionLevel.value = value
  },
})
const soundEffectsBinding = computed({
  get: () => sensory.soundEffects.value,
  set: (value: boolean) => {
    sensory.soundEffects.value = value
    if (value) void uiSound.play('action.confirmed')
  },
})

// ── 高级 ──
const dataDir = ref('~/.infos')
const logLevel = ref('info')
const autoSave = ref(true)
const isSaving = ref(false)

const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
]

const themeOptions = [
  { label: '暗色模式', value: 'dark' },
  { label: '亮色模式', value: 'light' },
]

const motionOptions: Array<{ label: string; value: MotionLevel }> = [
  { label: '完整动效', value: 'full' },
  { label: '轻量动效', value: 'reduced' },
  { label: '关闭动效', value: 'off' },
]

const logOptions = [
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
]

// ── 主题联动 ──
// mainNav.theme 是唯一主题状态；v-model 直接读写它，侧边栏与设定页天然同步。

/** 从后端加载配置 */
async function loadSettings() {
  try {
    const res = await configApi.batch([
      'owner.name',
      'owner.persona',
      'user.language',
      'ui.fontSize',
      'ui.motionLevel',
      'ui.animations',
      'ui.soundEffects',
      'system.dataDir',
      'system.logLevel',
      'system.autoSave',
    ])
    const d = res.data ?? {}
    if (d['owner.name']) ownerName.value = d['owner.name'] as string
    if (d['owner.persona']) ownerPersona.value = d['owner.persona'] as string
    if (d['user.language']) language.value = d['user.language'] as string
    if (d['ui.fontSize']) fontSize.value = Number(d['ui.fontSize'])
    const savedMotion = d['ui.motionLevel']
    if (savedMotion === 'full' || savedMotion === 'reduced' || savedMotion === 'off') {
      sensory.motionLevel.value = savedMotion
    } else if (d['ui.animations'] !== undefined) {
      sensory.motionLevel.value = d['ui.animations'] === 'true' ? 'full' : 'off'
    }
    if (d['ui.soundEffects'] !== undefined)
      sensory.soundEffects.value = d['ui.soundEffects'] === 'true'
    if (d['system.dataDir']) dataDir.value = d['system.dataDir'] as string
    if (d['system.logLevel']) logLevel.value = d['system.logLevel'] as string
    if (d['system.autoSave'] !== undefined) autoSave.value = d['system.autoSave'] !== 'false'
  } catch {
    // 首次使用，保持默认值
  }
}

/** 保存配置到后端 */
async function handleSave() {
  isSaving.value = true
  try {
    const pairs: Array<[string, string]> = [
      ['owner.name', ownerName.value],
      ['owner.persona', ownerPersona.value],
      ['user.language', language.value],
      ['ui.theme', mainNav.theme.value],
      ['ui.fontSize', String(fontSize.value)],
      ['ui.motionLevel', sensory.motionLevel.value],
      ['ui.animations', String(sensory.motionLevel.value !== 'off')],
      ['ui.soundEffects', String(sensory.soundEffects.value)],
      ['system.logLevel', logLevel.value],
      ['system.autoSave', String(autoSave.value)],
    ]
    await Promise.all(pairs.map(([k, v]) => configApi.set(k, v)))
    void uiSound.play('action.confirmed')
    notif.toast('设置已保存', { type: 'success', title: '用户设置' })
  } catch (e) {
    logger.error('UserSettings', '保存失败', e)
    notif.toast('保存失败，请稍后重试', { type: 'error', title: '用户设置' })
  } finally {
    isSaving.value = false
  }
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => loadSettings(),
)

onMounted(loadSettings)
</script>

<template>
  <div class="p-8 h-full overflow-y-auto settings-scrollbar">
    <div class="mb-6 flex-shrink-0 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-sky-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-sky-400/15 transition-all duration-1000"
      />
      <h2
        class="flex items-center gap-3 text-2xl font-black text-[var(--ui-text-primary)] font-pixel"
      >
        <span
          class="group-hover/header:scale-110 group-hover/header:-rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="user" size="md" />
        </span>
        <span>用户设定</span>
        <span class="opacity-0 group-hover/header:opacity-100 transition-opacity duration-500">
          <PixelIcon name="paw" size="xs" />
        </span>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        USER PREFERENCES
      </p>
    </div>

    <div class="flex flex-col gap-6 pr-1">
      <!-- 用户人设 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-[var(--ui-text-primary)] font-pixel mb-5 pb-3 border-b border-[var(--ui-border-subtle)]"
        >
          <PixelIcon name="user" size="sm" />
          用户人设
        </h3>
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-slate-500">你的名字</label>
              <PInput v-model="ownerName" placeholder="你的名字" />
              <p class="text-[10px] text-slate-400">助手会记住你的名字</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-slate-500">语言</label>
              <PSelect v-model="language" :options="languageOptions" />
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">人设描述</label>
            <textarea
              v-model="ownerPersona"
              rows="5"
              class="w-full p-3 bg-[var(--dash-input-bg)] border-2 border-[var(--dash-input-border)] text-sm text-[var(--ui-text-secondary)] resize-y focus:border-[var(--ui-accent-sky)] focus:outline-none transition-colors"
              placeholder="在这里描述你自己，助手会在对话时参考这些信息。&#10;&#10;例如：&#10;- 性别：男&#10;- 职业：程序员&#10;- 爱好：动漫、游戏&#10;- 与助手的关系：朋友与 AI 助手"
            />
            <p class="text-[10px] text-slate-400">
              这些信息会帮助助手更懂你，让每次对话都更自然、更贴心。
            </p>
          </div>
        </div>
      </PCard>

      <!-- 外观设置 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-slate-800 font-pixel mb-5 pb-3 border-b border-slate-100"
        >
          <PixelIcon name="eye" size="sm" />
          外观设置
        </h3>
        <div class="flex flex-col gap-4">
          <!-- 主题：与 app 侧边栏深色/浅色按钮实时联动 -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">主题</label>
            <PSelect v-model="themeBinding" :options="themeOptions" />
            <p class="text-[10px] text-slate-400">与侧边栏的深色/浅色切换按钮实时联动</p>
          </div>

          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5 opacity-50 pointer-events-none">
              <label class="text-xs font-bold text-slate-500">字体大小 ({{ fontSize }}px)</label>
              <PSlider v-model="fontSize" :min="12" :max="20" :step="1" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-[var(--ui-text-secondary)]">动态效果</label>
              <PSelect v-model="motionBinding" :options="motionOptions" />
              <p class="text-[10px] text-[var(--ui-text-tertiary)]">
                完整、轻量和关闭三档；首次默认完整动效，可在设置中调整
              </p>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                  关键事件音效
                </label>
                <p class="text-[10px] text-[var(--ui-text-tertiary)]">
                  任务完成、失败、审批和重要确认使用客户端合成音
                </p>
              </div>
              <PSwitch v-model="soundEffectsBinding" />
            </div>
          </div>
        </div>
      </PCard>

      <!-- 高级设置 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-slate-800 font-pixel mb-5 pb-3 border-b border-slate-100"
        >
          <PixelIcon name="settings" size="sm" />
          高级
        </h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">数据目录</label>
            <PInput v-model="dataDir" disabled />
            <p class="text-[10px] text-slate-400">重启后生效</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">日志级别</label>
            <PSelect v-model="logLevel" :options="logOptions" />
          </div>
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <label class="text-xs font-bold text-slate-500">自动保存</label>
              <p class="text-[10px] text-slate-400">每次修改后自动保存配置</p>
            </div>
            <PSwitch v-model="autoSave" />
          </div>
        </div>
      </PCard>

      <div class="pt-2 flex justify-end">
        <PButton variant="primary" :loading="isSaving" @click="handleSave">保存设置</PButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.settings-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.settings-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
  border-radius: 0;
}
</style>
