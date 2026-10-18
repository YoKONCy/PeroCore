<script setup lang="ts">
/**
 * SettingsView.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ApplicationSettings from '../components/ApplicationSettings.vue'
import ArcaIcon from '../components/ArcaIcon.vue'
import ArcaSelect from '../components/ArcaSelect.vue'
import ArcaAvatar from '../components/ArcaAvatar.vue'
import { arcaCollaborationClient } from '../services/collaboration'
import { useSelectionIndicator } from '../services/surfaceMotion'
import {
  arcaPreferenceStore,
  type ArcaModelConfig,
  type ArcaPreferences,
} from '../services/settings'
import { useWorkbenchStore } from '../stores/workbench'
import { useApplicationBusy } from '../services/workspaceUi'

const router = useRouter()
const route = useRoute()
const store = useWorkbenchStore()
type SettingsSection = 'models' | 'editor' | 'collaboration' | 'appearance' | 'integration'
const section = ref<SettingsSection>(
  route.query.section === 'integration' ? 'integration' : 'models',
)
const sectionTitles: Record<SettingsSection, string> = {
  models: '模型',
  editor: '编辑',
  collaboration: '协作',
  appearance: '外观',
  integration: '连接',
}
const sectionIcons: Record<SettingsSection, string> = {
  models: 'sparkle',
  editor: 'file',
  collaboration: 'person',
  appearance: 'palette',
  integration: 'connection',
}
const settingsTabs = ref<HTMLElement>()
useSelectionIndicator(settingsTabs, section)
watch(
  () => route.query.section,
  (value) => {
    if (value === 'integration') section.value = 'integration'
  },
)
const models = ref<ArcaModelConfig[]>([])
const preferences = reactive<ArcaPreferences>({
  modelConfigId: '',
  defaultAgentId: '',
  editorWidth: '840',
  motion: 'system',
})
const editor = reactive({
  id: undefined as string | undefined,
  name: '',
  provider: 'openai',
  modelId: '',
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  temperature: 0.7 as number | null,
  maxTokens: 4096 as number | null,
  reasoningEffort: null as string | null,
})
const loading = ref(true)
const saving = ref(false)
const notice = ref('')
const error = ref('')
const testingId = ref<string>()
const modelNameInput = ref<HTMLInputElement>()
const revealKey = ref(false)
const providers = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'siliconflow', label: 'SiliconFlow' },
  { value: 'ollama', label: 'Ollama' },
]
const modelOptions = computed(() =>
  models.value.map((model) => ({ value: model.id, label: model.name, description: model.modelId })),
)
const agentOptions = computed(() => [
  { value: '', label: '自动选择' },
  ...store.collaborationAgents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    agentId: agent.id,
  })),
])
const widthOptions = [
  { value: '760', label: '紧凑' },
  { value: '840', label: '标准' },
  { value: '960', label: '宽' },
]
const themeOptions = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const
const motionOptions = [
  { value: 'system', label: '跟随系统' },
  { value: 'full', label: '标准' },
  { value: 'reduced', label: '减少' },
]
let disposed = false
useApplicationBusy(computed(() => saving.value || !!testingId.value))
watch(section, () => {
  notice.value = ''
  error.value =
    section.value === 'models' && store.connection !== 'ready'
      ? '应用未连接，暂时无法管理模型。'
      : ''
})

function readableError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.startsWith('ARCA_HOST_UNAVAILABLE')) return '应用未连接，暂时无法管理模型。'
  if (message.startsWith('ARCA_MODEL_NOT_CONFIGURED')) return '尚未配置Arca本地模型。'
  if (message.startsWith('ARCA_CREDENTIAL')) return 'Arca本地凭据不可用，请重新保存API Key。'
  return message
}

function editModel(model?: ArcaModelConfig) {
  editor.id = model?.id
  editor.name = model?.name ?? ''
  editor.provider = model?.provider ?? 'openai'
  editor.modelId = model?.modelId ?? ''
  editor.apiKey = ''
  editor.apiBase = model?.apiBase ?? 'https://api.openai.com/v1'
  editor.temperature = model?.temperature ?? 0.7
  editor.maxTokens = model?.maxTokens ?? 4096
  editor.reasoningEffort = model?.reasoningEffort ?? null
  revealKey.value = false
}
async function newModel() {
  editModel()
  await nextTick()
  if (!disposed) modelNameInput.value?.focus({ preventScroll: true })
}
async function loadAgents() {
  if (!arcaCollaborationClient.available()) return
  try {
    const status = await arcaCollaborationClient.status()
    if (!disposed)
      store.collaborationAgents = [
        ...store.collaborationAgents.filter((agent) => agent.id === 'arca-local'),
        ...status.agents.filter((agent) => agent.id !== 'arca-local'),
      ]
  } catch {
    /* 独立运行时保留已知的本地协作者。 */
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = (await store.invokeModelAuthority('model.list')) as {
      models: ArcaModelConfig[]
      selectedModelId: string
    }
    models.value = result.models
    preferences.modelConfigId = result.selectedModelId || preferences.modelConfigId
    if (
      preferences.modelConfigId &&
      !store.collaborationAgents.some((agent) => agent.id === 'arca-local')
    ) {
      store.collaborationAgents = [
        { id: 'arca-local', name: 'Arca 本地模型' },
        ...store.collaborationAgents,
      ]
    }
    arcaPreferenceStore.save({
      ...arcaPreferenceStore.load(),
      modelConfigId: preferences.modelConfigId,
    })
    if (!editor.id && !editor.name.trim() && !editor.modelId.trim() && models.value[0])
      editModel(models.value[0])
  } catch (cause) {
    models.value = []
    if (section.value === 'models') error.value = readableError(cause)
  } finally {
    loading.value = false
  }
}

async function saveModel() {
  if (saving.value || !editor.name.trim() || !editor.modelId.trim()) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = (await store.invokeModelAuthority('model.save', {
      ...editor,
      name: editor.name.trim(),
      modelId: editor.modelId.trim(),
      apiBase: editor.apiBase.trim() || undefined,
      apiKey: editor.apiKey.trim() || undefined,
    })) as ArcaModelConfig
    await store.invokeModelAuthority('model.select', { modelId: saved.id })
    preferences.modelConfigId = saved.id
    arcaPreferenceStore.save({ ...preferences })
    await load()
    editModel(saved)
    notice.value = '已保存'
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    saving.value = false
  }
}

async function savePreferences() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    if (section.value === 'models' && preferences.modelConfigId) {
      await store.invokeModelAuthority('model.select', { modelId: preferences.modelConfigId })
    }
    arcaPreferenceStore.save({ ...preferences })
    localStorage.setItem('arca-editor-width', preferences.editorWidth)
    localStorage.setItem('arca-default-agent', preferences.defaultAgentId)
    localStorage.setItem('arca-motion', preferences.motion)
    document.documentElement.dataset.motion = preferences.motion
    localStorage.setItem('arca-theme-preference', store.themePreference)
    store.applyTheme()
    notice.value = '已保存'
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    saving.value = false
  }
}

async function testModel(model: ArcaModelConfig) {
  testingId.value = model.id
  error.value = ''
  notice.value = ''
  try {
    const result = (await store.invokeModelAuthority('model.test', { modelId: model.id })) as {
      success: boolean
      durationMs: number
      error?: string
    }
    if (result.success) notice.value = `连接成功 · ${result.durationMs}ms`
    else error.value = result.error ?? '连接失败'
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    testingId.value = undefined
  }
}

function applyLocalAppearance() {
  try {
    localStorage.setItem('arca-theme-preference', store.themePreference)
    localStorage.setItem('arca-motion', preferences.motion)
    document.documentElement.dataset.motion = preferences.motion
    store.applyTheme()
    arcaPreferenceStore.save({ ...arcaPreferenceStore.load(), motion: preferences.motion })
    error.value = ''
    notice.value = '已应用'
  } catch {
    error.value = '外观设置未能保存'
    notice.value = ''
  }
}

function testSelectedModel() {
  const model = models.value.find((item) => item.id === editor.id)
  if (model) void testModel(model)
}

function leave() {
  const id = store.activeDocumentId
  void router.push(id ? { name: 'workbench', params: { documentId: id } } : { name: 'home' })
}

onMounted(() => {
  Object.assign(preferences, arcaPreferenceStore.load())
  void loadAgents()
  if (store.connection === 'ready') void load()
  else {
    loading.value =
      store.connection === 'connecting' ||
      store.connection === 'discovering' ||
      store.connection === 'reconnecting'
    if (!loading.value && section.value === 'models') error.value = '应用未连接，请前往连接设置。'
  }
})
onBeforeUnmount(() => {
  disposed = true
})
watch(
  () => store.connection,
  (connection) => {
    if (connection === 'ready') void load()
    else if (connection === 'offline' || connection === 'error') {
      loading.value = false
      if (section.value === 'models') error.value = '应用未连接，暂时无法管理模型。'
    }
  },
)
</script>

<template>
  <main class="settings-studio">
    <div class="settings-shell">
      <header class="settings-masthead">
        <div>
          <span class="settings-eyebrow">Arca</span>
          <h1>偏好设置</h1>
        </div>
        <button class="settings-return" type="button" @click="leave">
          <ArcaIcon name="back" :size="16" />
          返回文稿
        </button>
      </header>
      <nav ref="settingsTabs" class="settings-tabs" aria-label="设置分类">
        <button
          v-for="(label, key) in sectionTitles"
          :key="key"
          type="button"
          :class="{ active: section === key }"
          :aria-current="section === key ? 'page' : undefined"
          :disabled="saving || !!testingId"
          @click="section = key"
        >
          <ArcaIcon :name="sectionIcons[key]" :size="17" />
          {{ label }}
        </button>
        <span class="active-indicator" aria-hidden="true" />
      </nav>
      <div class="settings-feedback" aria-live="polite">
        <p v-if="error" class="settings-notice is-error" role="alert">
          <ArcaIcon name="close" :size="15" />
          {{ error }}
        </p>
        <p v-else-if="notice" class="settings-notice">
          <ArcaIcon name="check" :size="15" />
          {{ notice }}
        </p>
      </div>
      <section :key="section" class="settings-section" :aria-label="sectionTitles[section]">
        <ApplicationSettings v-if="section === 'integration'" />
        <template v-else-if="section === 'models'">
          <div class="settings-current-model">
            <div class="settings-section-title">
              <span class="settings-symbol"><ArcaIcon name="sparkle" :size="21" /></span>
              <div>
                <h2>当前模型</h2>
                <small>{{ models.length }} 个配置</small>
              </div>
            </div>
            <ArcaSelect
              v-model="preferences.modelConfigId"
              aria-label="当前模型"
              placeholder="选择模型"
              :options="modelOptions"
              :disabled="loading || saving || store.connection !== 'ready'"
              @change="savePreferences"
            />
            <button
              class="icon-button"
              type="button"
              title="刷新模型"
              aria-label="刷新模型"
              :disabled="loading || saving || !!testingId"
              @click="load"
            >
              <ArcaIcon name="refresh" :size="17" :class="{ 'is-spinning': loading }" />
            </button>
          </div>
          <div class="settings-model-workspace">
            <aside class="settings-models">
              <header>
                <h2>配置</h2>
                <button
                  class="icon-button"
                  type="button"
                  title="新建配置"
                  aria-label="新建配置"
                  :disabled="saving || !!testingId"
                  @click="newModel"
                >
                  <ArcaIcon name="plus" :size="17" />
                </button>
              </header>
              <div class="settings-model-items">
                <button
                  v-for="model in models"
                  :key="model.id"
                  class="settings-model-item"
                  type="button"
                  :class="{ active: editor.id === model.id }"
                  :disabled="saving || !!testingId"
                  @click="editModel(model)"
                >
                  <span class="model-monogram">{{ model.name.slice(0, 1).toUpperCase() }}</span>
                  <span>
                    <strong>{{ model.name }}</strong>
                    <small>{{ model.modelId }}</small>
                  </span>
                  <i
                    v-if="preferences.modelConfigId === model.id"
                    class="model-in-use"
                    title="使用中"
                    aria-label="使用中"
                  />
                </button>
                <p v-if="!models.length" class="settings-model-empty">
                  {{ loading ? '读取中…' : '暂无配置' }}
                </p>
              </div>
            </aside>
            <form
              class="settings-card settings-model-editor"
              :aria-busy="saving"
              :inert="saving"
              @submit.prevent="saveModel"
            >
              <header class="settings-card-heading">
                <div>
                  <span class="settings-eyebrow">
                    {{
                      providers.find((item) => item.value === editor.provider)?.label ??
                      editor.provider
                    }}
                  </span>
                  <h2>{{ editor.id ? editor.name || '模型配置' : '新建配置' }}</h2>
                </div>
                <span
                  v-if="editor.id"
                  class="settings-pill"
                  :class="{
                    'is-ready': models.find((model) => model.id === editor.id)
                      ?.credentialConfigured,
                  }"
                >
                  {{
                    models.find((model) => model.id === editor.id)?.credentialConfigured
                      ? '密钥已配置'
                      : '未配置密钥'
                  }}
                </span>
              </header>
              <div class="settings-fields">
                <label>
                  名称
                  <input
                    ref="modelNameInput"
                    v-model="editor.name"
                    required
                    maxlength="120"
                    placeholder="模型名称"
                  />
                </label>
                <label>
                  供应商
                  <ArcaSelect v-model="editor.provider" aria-label="供应商" :options="providers" />
                </label>
                <label class="field-wide">
                  模型 ID
                  <input
                    v-model="editor.modelId"
                    required
                    placeholder="模型 ID"
                    spellcheck="false"
                  />
                </label>
                <label class="field-wide">
                  API 地址
                  <input v-model="editor.apiBase" type="url" spellcheck="false" />
                </label>
                <label class="field-wide">
                  API Key
                  <span class="settings-secret">
                    <input
                      v-model="editor.apiKey"
                      :type="revealKey ? 'text' : 'password'"
                      autocomplete="new-password"
                      :placeholder="editor.id ? '留空保留原密钥' : '输入密钥'"
                    />
                    <button type="button" :aria-pressed="revealKey" @click="revealKey = !revealKey">
                      {{ revealKey ? '隐藏' : '显示' }}
                    </button>
                  </span>
                </label>
              </div>
              <details class="settings-advanced">
                <summary>
                  <ArcaIcon name="sliders" :size="16" />
                  高级设置
                  <ArcaIcon name="chevronDown" :size="13" />
                </summary>
                <div class="settings-fields">
                  <label>
                    温度
                    <input
                      v-model.number="editor.temperature"
                      type="number"
                      min="0"
                      max="2"
                      step=".1"
                    />
                  </label>
                  <label>
                    最大输出
                    <input v-model.number="editor.maxTokens" type="number" min="1" step="256" />
                  </label>
                  <label class="field-wide">
                    思考强度
                    <ArcaSelect
                      v-model="editor.reasoningEffort"
                      aria-label="思考强度"
                      :options="[
                        { value: null, label: '跟随模型' },
                        { value: 'low', label: '低' },
                        { value: 'medium', label: '中' },
                        { value: 'high', label: '高' },
                        { value: 'max', label: '最大' },
                      ]"
                    />
                  </label>
                </div>
              </details>
              <footer class="settings-card-footer">
                <button
                  v-if="editor.id"
                  type="button"
                  :disabled="
                    !!testingId || saving || !models.some((model) => model.id === editor.id)
                  "
                  @click="testSelectedModel"
                >
                  <ArcaIcon name="connection" :size="16" />
                  {{ testingId ? '测试中…' : '测试连接' }}
                </button>
                <span class="toolbar-spacer" />
                <button
                  class="primary-button"
                  type="submit"
                  :disabled="saving || loading || !!testingId || store.connection !== 'ready'"
                >
                  {{ saving ? '保存中…' : '保存并使用' }}
                  <ArcaIcon name="check" :size="16" />
                </button>
              </footer>
            </form>
          </div>
        </template>
        <form
          v-else-if="section === 'editor'"
          class="settings-preferences"
          @submit.prevent="savePreferences"
        >
          <section class="settings-card">
            <header class="settings-card-heading">
              <div>
                <span class="settings-eyebrow">文稿</span>
                <h2>编辑视图</h2>
              </div>
              <span class="settings-pill is-ready">自动保存已开启</span>
            </header>
            <div class="settings-card-body">
              <h3>连续视图宽度</h3>
              <div class="settings-choice-grid" role="group" aria-label="连续视图宽度">
                <button
                  v-for="(option, index) in widthOptions"
                  :key="option.value"
                  class="settings-choice"
                  type="button"
                  :aria-pressed="preferences.editorWidth === option.value"
                  @click="preferences.editorWidth = option.value"
                >
                  <span class="width-preview" aria-hidden="true">
                    <i :style="{ width: 45 + index * 18 + '%' }">
                      <b />
                      <b />
                      <b />
                      <b />
                    </i>
                  </span>
                  <span>
                    {{ option.label }}
                    <ArcaIcon
                      v-if="preferences.editorWidth === option.value"
                      name="check"
                      :size="14"
                    />
                  </span>
                </button>
              </div>
            </div>
            <footer class="settings-card-footer">
              <span class="toolbar-spacer" />
              <button class="primary-button" :disabled="saving">
                {{ saving ? '保存中…' : '保存设置' }}
              </button>
            </footer>
          </section>
        </form>
        <form
          v-else-if="section === 'collaboration'"
          class="settings-preferences"
          @submit.prevent="savePreferences"
        >
          <section class="settings-card">
            <header class="settings-card-heading">
              <div>
                <span class="settings-eyebrow">角色</span>
                <h2>协作偏好</h2>
              </div>
              <ArcaAvatar
                v-if="preferences.defaultAgentId"
                :agent-id="preferences.defaultAgentId"
              />
            </header>
            <div class="settings-card-body">
              <label class="settings-field">
                默认协作者
                <ArcaSelect
                  v-model="preferences.defaultAgentId"
                  aria-label="默认协作者"
                  :options="agentOptions"
                />
              </label>
              <div class="settings-assurance">
                <ArcaIcon name="check" :size="17" />
                <span>接受前审阅</span>
                <span class="settings-pill is-ready">已开启</span>
              </div>
            </div>
            <footer class="settings-card-footer">
              <span class="toolbar-spacer" />
              <button class="primary-button" :disabled="saving">
                {{ saving ? '保存中…' : '保存设置' }}
              </button>
            </footer>
          </section>
        </form>
        <div v-else class="settings-preferences">
          <section class="settings-card">
            <header class="settings-card-heading">
              <div>
                <span class="settings-eyebrow">工作台</span>
                <h2>外观</h2>
              </div>
              <span
                v-if="store.hostTheme && store.themePreference === 'system'"
                class="settings-pill"
              >
                跟随主窗口
              </span>
            </header>
            <div class="settings-card-body">
              <h3>主题</h3>
              <div class="settings-choice-grid" role="group" aria-label="主题">
                <button
                  v-for="option in themeOptions"
                  :key="option.value"
                  class="settings-choice"
                  type="button"
                  :aria-pressed="store.themePreference === option.value"
                  @click="
                    () => {
                      store.themePreference = option.value
                      applyLocalAppearance()
                    }
                  "
                >
                  <span
                    class="theme-preview"
                    :class="'theme-preview-' + option.value"
                    aria-hidden="true"
                  >
                    <i />
                    <b>
                      <em />
                      <em />
                      <em />
                    </b>
                  </span>
                  <span>
                    {{ option.value === 'system' && store.hostTheme ? '跟随主窗口' : option.label }}
                    <ArcaIcon
                      v-if="store.themePreference === option.value"
                      name="check"
                      :size="14"
                    />
                  </span>
                </button>
              </div>
              <h3 class="settings-subheading">动效</h3>
              <div class="settings-motion-options" role="group" aria-label="动效">
                <button
                  v-for="option in motionOptions"
                  :key="option.value"
                  type="button"
                  :aria-pressed="preferences.motion === option.value"
                  @click="
                    () => {
                      preferences.motion = option.value
                      applyLocalAppearance()
                    }
                  "
                >
                  <i :class="'motion-sample-' + option.value" aria-hidden="true" />
                  {{ option.label }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </main>
</template>
