<script setup lang="ts">
/**
 * SettingsView.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  arcaPreferenceStore,
  type ArcaModelConfig,
  type ArcaPreferences,
} from '../services/settings'
import { useWorkbenchStore } from '../stores/workbench'

const router = useRouter()
const store = useWorkbenchStore()
const section = ref<'models' | 'editor' | 'collaboration' | 'appearance'>('models')
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

function readableError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.startsWith('ARCA_HOST_UNAVAILABLE'))
    return 'Arca自治Host未连接，模型配置保存在Host中，连接恢复后即可管理。'
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
}

async function load() {
  loading.value = true
  error.value = ''
  Object.assign(preferences, arcaPreferenceStore.load())
  try {
    const result = (await store.invokeModelAuthority('model.list')) as {
      models: ArcaModelConfig[]
      selectedModelId: string
    }
    models.value = result.models
    preferences.modelConfigId = result.selectedModelId || preferences.modelConfigId
    if (!editor.id && models.value[0]) editModel(models.value[0])
  } catch (cause) {
    models.value = []
    error.value = readableError(cause)
  } finally {
    loading.value = false
  }
}

async function saveModel() {
  if (!editor.name.trim() || !editor.modelId.trim()) return
  saving.value = true
  error.value = ''
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
    notice.value = '模型配置与加密凭据已保存到Arca本地Authority'
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    saving.value = false
  }
}

async function savePreferences() {
  saving.value = true
  error.value = ''
  try {
    if (preferences.modelConfigId) {
      await store.invokeModelAuthority('model.select', { modelId: preferences.modelConfigId })
    }
    arcaPreferenceStore.save({ ...preferences })
    localStorage.setItem('arca-editor-width', preferences.editorWidth)
    localStorage.setItem('arca-default-agent', preferences.defaultAgentId)
    localStorage.setItem('arca-motion', preferences.motion)
    document.documentElement.dataset.motion = preferences.motion
    localStorage.setItem('arca-theme-preference', store.themePreference)
    store.applyTheme()
    notice.value = 'Arca本地设置已保存'
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    saving.value = false
  }
}

async function testModel(model: ArcaModelConfig) {
  testingId.value = model.id
  error.value = ''
  try {
    const result = (await store.invokeModelAuthority('model.test', { modelId: model.id })) as {
      success: boolean
      durationMs: number
      error?: string
    }
    notice.value = result.success
      ? `Arca本地连接成功 · ${result.durationMs}ms`
      : (result.error ?? '连接失败')
  } catch (cause) {
    error.value = readableError(cause)
  } finally {
    testingId.value = undefined
  }
}

function applyLocalAppearance() {
  localStorage.setItem('arca-theme-preference', store.themePreference)
  localStorage.setItem('arca-motion', preferences.motion)
  document.documentElement.dataset.motion = preferences.motion
  store.applyTheme()
}

function leave() {
  const id = store.activeDocumentId
  void router.push(id ? { name: 'workbench', params: { documentId: id } } : { name: 'home' })
}

onMounted(() => {
  Object.assign(preferences, arcaPreferenceStore.load())
  if (store.connection === 'ready') void load()
  else loading.value = true
})
watch(
  () => store.connection,
  (connection) => {
    if (connection === 'ready') void load()
    else if (connection === 'offline' || connection === 'error') {
      loading.value = false
      error.value = 'Arca自治Host未连接，模型配置保存在Host中，连接恢复后即可管理。'
    }
  },
)
</script>

<template>
  <main class="property-settings">
    <aside class="property-nav">
      <button class="settings-brand" type="button" @click="leave">
        <span class="brand-fold brand-fold--star" />
        <span>
          <strong>Arca</strong>
          <small>应用属性 / SETTINGS</small>
        </span>
      </button>
      <div class="property-nav-label">分类索引</div>
      <button :class="{ active: section === 'models' }" @click="section = 'models'">
        <i />
        模型运行
        <small>MODEL</small>
      </button>
      <button :class="{ active: section === 'editor' }" @click="section = 'editor'">
        <i />
        编辑体验
        <small>EDITOR</small>
      </button>
      <button :class="{ active: section === 'collaboration' }" @click="section = 'collaboration'">
        <i />
        协作审阅
        <small>REVIEW</small>
      </button>
      <button :class="{ active: section === 'appearance' }" @click="section = 'appearance'">
        <i />
        外观动效
        <small>DISPLAY</small>
      </button>
      <span class="property-nav-spacer" />
      <button class="property-back" @click="leave">← 返回工作站</button>
    </aside>

    <section class="property-surface">
      <header class="property-header">
        <div>
          <p class="pixel-label">
            应用Realm
            <span class="pixel-en">INFOS.ARCA</span>
          </p>
          <h1>
            {{
              section === 'models'
                ? '模型运行'
                : section === 'editor'
                  ? '编辑体验'
                  : section === 'collaboration'
                    ? '协作审阅'
                    : '外观动效'
            }}
          </h1>
        </div>
        <span class="property-realm">
          <i :class="{ online: store.hostOnline }" />
          {{
            store.hostOnline
              ? store.kernelOnline
                ? 'FEDERATED READY'
                : 'STANDALONE READY'
              : 'HOST OFFLINE'
          }}
        </span>
      </header>
      <div v-if="error" class="property-message error">{{ error }}</div>
      <div v-else-if="notice" class="property-message">{{ notice }}</div>
      <div v-if="loading" class="property-message">正在读取Arca Realm设置……</div>

      <template v-else-if="section === 'models'">
        <section class="property-group">
          <header>
            <span>运行绑定</span>
            <code>MODEL BINDING</code>
          </header>
          <label class="property-row">
            <span>
              <strong>Arca当前模型</strong>
              <small>Arca自治Host执行协作任务时使用的本地模型</small>
            </span>
            <select v-model="preferences.modelConfigId" @change="savePreferences">
              <option value="">尚未选择本地模型</option>
              <option v-for="model in models" :key="model.id" :value="model.id">
                {{ model.name }} · {{ model.modelId }}
              </option>
            </select>
          </label>
          <div class="property-note">
            <i>■</i>
            API Key由Arca本地Secret Store加密持有；配置仓库只保存credentialRef。
          </div>
        </section>

        <section class="property-group model-index-group">
          <header>
            <span>模型索引</span>
            <code>{{ models.length }} CONFIGS</code>
            <button @click="editModel()">＋ 新建配置</button>
          </header>
          <div class="model-index-head">
            <span>ID</span>
            <span>名称</span>
            <span>供应商</span>
            <span>模型</span>
            <span>凭据</span>
          </div>
          <button
            v-for="model in models"
            :key="model.id"
            class="model-index-row"
            :class="{ active: editor.id === model.id }"
            @click="editModel(model)"
          >
            <code>{{ model.id }}</code>
            <strong>{{ model.name }}</strong>
            <span>{{ model.provider }}</span>
            <code>{{ model.modelId }}</code>
            <span class="square-state">
              <i :class="{ ready: model.credentialConfigured }" />
              {{ model.credentialConfigured ? 'READY' : 'EMPTY' }}
            </span>
          </button>
          <div v-if="!models.length" class="property-empty">索引中还没有模型配置。</div>
        </section>

        <form class="property-group property-form" @submit.prevent="saveModel">
          <header>
            <span>{{ editor.id ? '模型参数' : '接入模型' }}</span>
            <code>{{ editor.id ? `CONFIG ${editor.id}` : 'NEW CONFIG' }}</code>
            <button
              v-if="editor.id"
              type="button"
              :disabled="testingId === editor.id"
              @click="testModel(models.find((item) => item.id === editor.id)!)"
            >
              {{ testingId === editor.id ? '测试中…' : '测试连接' }}
            </button>
          </header>
          <label class="property-row">
            <span>
              <strong>配置名称</strong>
              <small>仅用于Arca与Kernel界面识别</small>
            </span>
            <input v-model="editor.name" required placeholder="Arca写作模型" />
          </label>
          <label class="property-row">
            <span>
              <strong>供应商</strong>
              <small>模型协议适配器</small>
            </span>
            <select v-model="editor.provider">
              <option>openai</option>
              <option>anthropic</option>
              <option>gemini</option>
              <option>deepseek</option>
              <option>siliconflow</option>
              <option>ollama</option>
            </select>
          </label>
          <label class="property-row">
            <span>
              <strong>模型ID</strong>
              <small>供应商侧精确模型标识，由Arca本地配置</small>
            </span>
            <input v-model="editor.modelId" required placeholder="gpt-4.1" />
          </label>
          <label class="property-row">
            <span>
              <strong>API地址</strong>
              <small>留空使用供应商默认地址</small>
            </span>
            <input v-model="editor.apiBase" />
          </label>
          <label class="property-row">
            <span>
              <strong>API Key</strong>
              <small>仅经本机认证Loopback交给Arca Host，并加密落盘</small>
            </span>
            <input
              v-model="editor.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="editor.id ? '留空保留原密钥' : '输入供应商密钥'"
            />
          </label>
          <div class="property-row property-pair">
            <span>
              <strong>采样参数</strong>
              <small>温度与最大输出</small>
            </span>
            <label>
              温度
              <input v-model.number="editor.temperature" type="number" min="0" max="2" step="0.1" />
            </label>
            <label>
              最大输出
              <input v-model.number="editor.maxTokens" type="number" min="1" step="256" />
            </label>
          </div>
          <label class="property-row">
            <span>
              <strong>推理强度</strong>
              <small>仅支持推理模型</small>
            </span>
            <select v-model="editor.reasoningEffort">
              <option :value="null">跟随模型</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="max">最大</option>
            </select>
          </label>
          <footer class="property-actions">
            <small>
              密钥只进入Arca Secret Store，不进入工程包、Document Authority或浏览器存储。
            </small>
            <button class="primary-button" type="submit" :disabled="saving">
              {{ saving ? '保存中…' : '保存模型参数' }}
            </button>
          </footer>
        </form>
      </template>

      <form v-else class="property-group" @submit.prevent="savePreferences">
        <header>
          <span>
            {{
              section === 'editor'
                ? '编辑属性'
                : section === 'collaboration'
                  ? '协作约束'
                  : '显示属性'
            }}
          </span>
          <code>{{ section.toUpperCase() }}</code>
        </header>
        <template v-if="section === 'editor'">
          <div class="property-row">
            <span>
              <strong>草稿与Revision</strong>
              <small>输入即时保存Draft；失焦或Ctrl+Enter提交Revision</small>
            </span>
            <span class="square-lock">
              <i />
              强制保护
            </span>
          </div>
          <label class="property-row">
            <span>
              <strong>文稿版心宽度</strong>
              <small>控制连续绢纸工作面内的正文宽度</small>
            </span>
            <select v-model="preferences.editorWidth">
              <option value="760">紧凑 · 760px</option>
              <option value="840">标准 · 840px</option>
              <option value="960">宽阔 · 960px</option>
            </select>
          </label>
        </template>
        <template v-else-if="section === 'collaboration'">
          <label class="property-row">
            <span>
              <strong>默认协作者</strong>
              <small>创建任务时优先选择</small>
            </span>
            <select v-model="preferences.defaultAgentId">
              <option value="">自动选择</option>
              <option v-for="agent in store.collaborationAgents" :key="agent.id" :value="agent.id">
                {{ agent.name }}
              </option>
            </select>
          </label>
          <div class="property-row">
            <span>
              <strong>ChangeSet人工审阅</strong>
              <small>批准与Commit永远属于Human Surface权限</small>
            </span>
            <span class="square-lock">
              <i />
              强制启用
            </span>
          </div>
        </template>
        <template v-else>
          <label class="property-row">
            <span>
              <strong>主题</strong>
              <small>独立于infOS主应用</small>
            </span>
            <select v-model="store.themePreference" @change="applyLocalAppearance">
              <option value="system">跟随系统</option>
              <option value="light">柔光 · 暖灰台/现代绢纸</option>
              <option value="dark">夜航 · 石墨台/墨紫绢布</option>
            </select>
          </label>
          <label class="property-row">
            <span>
              <strong>界面动效</strong>
              <small>控制断线扫描、像素切换与面板位移</small>
            </span>
            <select v-model="preferences.motion" @change="applyLocalAppearance">
              <option value="system">跟随系统</option>
              <option value="full">完整</option>
              <option value="reduced">减少</option>
            </select>
          </label>
        </template>
        <footer class="property-actions">
          <span />
          <button class="primary-button" type="submit" :disabled="saving">保存属性</button>
        </footer>
      </form>
    </section>
  </main>
</template>
