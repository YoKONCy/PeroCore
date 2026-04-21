<script setup lang="ts">
/**
 * UserSettingsTab — 用户设定 Tab (F1-3)
 *
 * 基础设置 (昵称/称呼)、外观 (主题/字体)、高级 (数据目录/日志)
 * F3: 已对接 configApi 读写。
 */
import { ref, onMounted } from 'vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'

const userName = ref('主人')
const ownerTitle = ref('主人')
const language = ref('zh-CN')
const theme = ref('dark')
const fontSize = ref(14)
const enableAnimations = ref(true)
const enableSoundEffects = ref(false)
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
      'user.name',
      'user.ownerTitle',
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
    if (d['user.name']) userName.value = d['user.name'] as string
    if (d['user.ownerTitle']) ownerTitle.value = d['user.ownerTitle'] as string
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
      ['user.name', userName.value],
      ['user.ownerTitle', ownerTitle.value],
      ['user.language', language.value],
      ['ui.theme', theme.value],
      ['ui.fontSize', String(fontSize.value)],
      ['ui.animations', String(enableAnimations.value)],
      ['ui.soundEffects', String(enableSoundEffects.value)],
      ['system.logLevel', logLevel.value],
      ['system.autoSave', String(autoSave.value)],
    ]
    await Promise.all(pairs.map(([k, v]) => configApi.set(k, v)))
  } catch (e) {
    console.error('[UserSettings] 保存失败:', e)
  } finally {
    isSaving.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="tab-settings">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="user" size="md" /><span>用户设定</span></h2>
      <p class="tab-subtitle">USER PREFERENCES</p>
    </div>

    <div class="settings-scroll">
      <!-- 基础设置 -->
      <section class="settings-section">
        <h3 class="section-title"><PixelIcon name="user" size="sm" /> 基础信息</h3>
        <div class="settings-grid">
          <div class="setting-field">
            <label class="setting-label">你的昵称</label>
            <PInput v-model="userName" placeholder="输入你的名字" />
            <p class="setting-desc">Pero 会这样称呼你</p>
          </div>
          <div class="setting-field">
            <label class="setting-label">对 Pero 的称呼</label>
            <PInput v-model="ownerTitle" placeholder="主人 / 大大 / ..." />
          </div>
          <div class="setting-field">
            <label class="setting-label">语言</label>
            <PSelect v-model="language" :options="languageOptions" />
          </div>
        </div>
      </section>

      <!-- 外观设置 -->
      <section class="settings-section">
        <h3 class="section-title"><PixelIcon name="eye" size="sm" /> 外观设置</h3>
        <div class="settings-grid">
          <div class="setting-field">
            <label class="setting-label">主题</label>
            <PSelect v-model="theme" :options="themeOptions" />
          </div>
          <div class="setting-field">
            <label class="setting-label">字体大小 ({{ fontSize }}px)</label>
            <PSlider v-model="fontSize" :min="12" :max="20" :step="1" />
          </div>
          <div class="setting-field setting-row">
            <div class="setting-row-info">
              <label class="setting-label">动画效果</label>
              <p class="setting-desc">启用界面微动画和过渡效果</p>
            </div>
            <PSwitch v-model="enableAnimations" />
          </div>
          <div class="setting-field setting-row">
            <div class="setting-row-info">
              <label class="setting-label">音效</label>
              <p class="setting-desc">消息提示音和操作反馈音</p>
            </div>
            <PSwitch v-model="enableSoundEffects" />
          </div>
        </div>
      </section>

      <!-- 高级设置 -->
      <section class="settings-section">
        <h3 class="section-title"><PixelIcon name="settings" size="sm" /> 高级</h3>
        <div class="settings-grid">
          <div class="setting-field">
            <label class="setting-label">数据目录</label>
            <PInput v-model="dataDir" disabled />
            <p class="setting-desc">重启后生效</p>
          </div>
          <div class="setting-field">
            <label class="setting-label">日志级别</label>
            <PSelect v-model="logLevel" :options="logOptions" />
          </div>
          <div class="setting-field setting-row">
            <div class="setting-row-info">
              <label class="setting-label">自动保存</label>
              <p class="setting-desc">每次修改后自动保存配置</p>
            </div>
            <PSwitch v-model="autoSave" />
          </div>
        </div>
      </section>

      <div class="settings-footer">
        <PButton variant="primary" :loading="isSaving" @click="handleSave">保存设置</PButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-settings {
  padding: 32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tab-header {
  margin-bottom: 24px;
  flex-shrink: 0;
}
.tab-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.tab-subtitle {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  margin-top: 4px;
  margin-left: 36px;
}

.settings-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-right: 4px;
}
.settings-scroll::-webkit-scrollbar {
  width: 4px;
}
.settings-scroll::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.settings-section {
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  padding: 24px;
}
.section-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}
.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.setting-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.setting-desc {
  font-size: 10px;
  color: var(--color-text-muted);
}
.setting-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.setting-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-footer {
  padding-top: 8px;
  display: flex;
  justify-content: flex-end;
}
</style>
