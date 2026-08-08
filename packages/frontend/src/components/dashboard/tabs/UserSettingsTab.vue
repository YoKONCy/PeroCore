<script setup lang="ts">
/**
 * UserSettingsTab — 用户设定 Tab (F1-3)
 *
 * 用户人设 (名称 + 人设描述)、外观 (主题/字体)、高级 (数据目录/日志)
 * F3: 已对接 configApi 读写。
 */
import { ref, onMounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton, PCard } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { logger } from '../../../lib/logger'
import { useNotificationStore } from '../../../stores'

const ctx = useDashboardContext()
const notif = useNotificationStore()

// ── 用户设定 ──
const ownerName = ref('主人')
const ownerPersona = ref('')
const language = ref('zh-CN')

// ── 外观 ──
const theme = ref('dark')
const fontSize = ref(14)
const enableAnimations = ref(true)
const enableSoundEffects = ref(false)

// ── 高级 ──
const dataDir = ref('~/.perocore')
const logLevel = ref('info')
const autoSave = ref(true)
const isSaving = ref(false)

const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
]

const themeOptions = [
  { label: '🌙 暗色模式', value: 'dark' },
  { label: '☀️ 亮色模式', value: 'light' },
  { label: '🖥️ 跟随系统', value: 'system' },
]

const logOptions = [
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
]

/** 从后端加载配置 */
async function loadSettings() {
  try {
    const res = await configApi.batch([
      'owner.name',
      'owner.persona',
      'user.language',
      'ui.theme',
      'ui.fontSize',
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
    if (d['ui.theme']) theme.value = d['ui.theme'] as string
    if (d['ui.fontSize']) fontSize.value = Number(d['ui.fontSize'])
    if (d['ui.animations'] !== undefined) enableAnimations.value = d['ui.animations'] === 'true'
    if (d['ui.soundEffects'] !== undefined)
      enableSoundEffects.value = d['ui.soundEffects'] === 'true'
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
      ['ui.theme', theme.value],
      ['ui.fontSize', String(fontSize.value)],
      ['ui.animations', String(enableAnimations.value)],
      ['ui.soundEffects', String(enableSoundEffects.value)],
      ['system.logLevel', logLevel.value],
      ['system.autoSave', String(autoSave.value)],
    ]
    await Promise.all(pairs.map(([k, v]) => configApi.set(k, v)))
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
      <h2 class="flex items-center gap-3 text-2xl font-black text-slate-800 font-pixel">
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
          class="flex items-center gap-2 text-sm font-black text-slate-800 font-pixel mb-5 pb-3 border-b border-slate-100"
        >
          <PixelIcon name="user" size="sm" />
          用户人设
        </h3>
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-slate-500">你的名字</label>
              <PInput v-model="ownerName" placeholder="主人" />
              <p class="text-[10px] text-slate-400">Pero 会这样称呼你 (对应模板变量 owner_name)</p>
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
              class="w-full p-3 bg-white border-2 border-slate-200 text-sm text-slate-700 resize-y focus:border-sky-400 focus:outline-none transition-colors"
              placeholder="在这里描述你自己的人设，Pero 会在对话时参考这些信息。&#10;&#10;例如：&#10;- 性别：男&#10;- 职业：程序员&#10;- 爱好：动漫、游戏&#10;- 与 Pero 的关系：主人与 AI 助手&#10;- 称呼偏好：希望被叫做「主人」"
            />
            <p class="text-[10px] text-slate-400">
              此内容将注入到系统提示词的 &lt;Owner_Setting&gt; 区域 (对应模板变量 user_persona)
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
          <span class="text-[10px] font-normal text-amber-500 ml-auto">🚧 待实装</span>
        </h3>
        <div class="flex flex-col gap-4 opacity-50 pointer-events-none">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">主题</label>
            <PSelect v-model="theme" :options="themeOptions" disabled />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">字体大小 ({{ fontSize }}px)</label>
            <PSlider v-model="fontSize" :min="12" :max="20" :step="1" />
          </div>
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <label class="text-xs font-bold text-slate-500">动画效果</label>
              <p class="text-[10px] text-slate-400">启用界面微动画和过渡效果</p>
            </div>
            <PSwitch v-model="enableAnimations" />
          </div>
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <label class="text-xs font-bold text-slate-500">音效</label>
              <p class="text-[10px] text-slate-400">消息提示音和操作反馈音</p>
            </div>
            <PSwitch v-model="enableSoundEffects" />
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
  background: #bae6fd;
  border-radius: 0;
}
</style>
