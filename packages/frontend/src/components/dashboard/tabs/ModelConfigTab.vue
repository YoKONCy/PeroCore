<script setup lang="ts">
/**
 * ModelConfigTab — 模型配置 Tab (F1-1)
 *
 * 双面板设计: LLM 模型网格 + 向量模型配置
 * 功能: 模型 CRUD, 主模型指定 + 任务指派, Embedding/Reranker 配置
 *
 * @see 06_FILE_SIZE_LIMITS.md — 逻辑抽到 useModelConfig composable
 */
import {
  PixelIcon,
  PButton,
  PInput,
  PSelect,
  PInputNumber,
  PSlider,
  PSwitch,
  PTooltip,
  PDialog,
  PCheckbox,
  PCard,
} from '../../pixel'
import { watch, computed, type Ref } from 'vue'
import { useModelConfig, TASK_SLOTS } from '../../../composables/dashboard/useModelConfig'
import { useDashboardContext } from '../../../composables/dashboard'
import { useAgentStore } from '../../../stores/useAgentStore'
import { getApiBaseUrl } from '../../../api/transport'

const ctx = useDashboardContext()
const agentStore = useAgentStore()

const {
  models,
  currentTab,
  mainModelId,
  taskAssignments,
  agentAssignments,
  isTaskAssignOpen,
  isAgentAssignOpen,
  providerOptions,
  isEditorOpen,
  editingModel,
  editorForm,
  openEditor,
  saveModel,
  deleteModel,
  setModelToggle,
  setMainModel,
  setTaskAssignment,
  setAgentAssignment,
  fetchAgentAssignments,
  isGlobalOpen,
  globalConfig,
  saveGlobalConfig,
  embeddingProvider,
  embeddingModelId,
  embeddingDimension,
  embeddingApiBase,
  embeddingApiKey,
  rerankerEnabled,
  rerankerModelId,
  rerankerApiBase,
  rerankerApiKey,
  isSavingVector,
  embeddingActivationResult,
  saveVectorConfig,
  fetchModels,
  // 远程模型列表
  remoteModels,
  isFetchingRemote,
  fetchRemoteModels,
  customProviderTypeOptions,
  handleProviderChange,
  providerDefaults,
  // 向量远程模型列表
  remoteEmbeddingModels,
  isFetchingEmbedding,
  fetchRemoteEmbeddingModels,
  remoteRerankerModels,
  isFetchingReranker,
  fetchRemoteRerankerModels,
  relayEnabled,
  relayModelConfigId,
  relayDetail,
  isSavingRelay,
  visionModels,
  saveRelayConfig,
} = useModelConfig()

/** 将 globalConfig 转为 Record<string,...> 供弹窗模板遍历使用，避免 TS 索引类型报错 */
const globalConfigRecord = globalConfig as Ref<Record<string, { apiBase: string; apiKey: string }>>

/** 参数是否应写入 Provider 请求；关闭时统一保存为 null，即完全不传。 */
const sendTemperature = computed({
  get: () => editorForm.value.temperature !== null,
  set: (enabled: boolean) => {
    editorForm.value.temperature = enabled ? 1 : null
  },
})
const sendTopP = computed({
  get: () => editorForm.value.topP !== null,
  set: (enabled: boolean) => {
    editorForm.value.topP = enabled ? 1 : null
  },
})
const sendMaxTokens = computed({
  get: () => editorForm.value.maxTokens !== null,
  set: (enabled: boolean) => {
    editorForm.value.maxTokens = enabled ? 4096 : null
  },
})
const temperatureValue = computed({
  get: () => editorForm.value.temperature ?? 1,
  set: (value: number) => {
    editorForm.value.temperature = value
  },
})
const topPValue = computed({
  get: () => editorForm.value.topP ?? 1,
  set: (value: number) => {
    editorForm.value.topP = value
  },
})
const wireApiOptions = [
  { label: 'Chat Completions', value: 'chat_completions' },
  { label: 'Responses', value: 'responses' },
]
const reasoningDialectOptions = [
  { label: '自动识别', value: 'auto' },
  { label: 'OpenAI官方', value: 'openai' },
  { label: 'DeepSeek兼容', value: 'deepseek' },
  { label: 'OpenRouter兼容', value: 'openrouter' },
  { label: '通用兼容', value: 'generic' },
]
const reasoningEffortOptions = [
  { label: '默认（不传）', value: '' },
  { label: '关闭', value: 'off' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
  { label: 'Max', value: 'max' },
]
const reasoningEffortValue = computed({
  get: () => editorForm.value.reasoningEffort ?? '',
  set: (value: string) => {
    editorForm.value.reasoningEffort = value
      ? (value as NonNullable<typeof editorForm.value.reasoningEffort>)
      : null
  },
})

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => fetchModels(),
)

/** 保存全局配置并关闭弹窗 */
async function handleSaveGlobal() {
  await saveGlobalConfig()
  isGlobalOpen.value = false
}

function avatarUrlOf(avatarUrl?: string): string {
  if (!avatarUrl) return ''
  return /^https?:\/\//i.test(avatarUrl) ? avatarUrl : `${getApiBaseUrl()}${avatarUrl}`
}

async function openAgentAssignment(): Promise<void> {
  if (agentStore.agents.length === 0) await agentStore.fetchAgents()
  await fetchAgentAssignments(agentStore.enabledAgents.map((agent) => agent.id))
  isAgentAssignOpen.value = true
}

function assignedModelName(agentId: string): string {
  const modelId = agentAssignments.value[agentId]
  return models.value.find((model) => model.id === modelId)?.name ?? '跟随主模型'
}

function formatTokens(tokens: number | null): string {
  if (!tokens) return '不传'
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M'
  return (tokens / 1000).toFixed(0) + 'K'
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  xai: 'xAI (Grok)',
  mistral: 'Mistral',
  groq: 'Groq',
  siliconflow: '硅基流动',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot (Kimi)',
  dashscope: '阿里百炼',
  volcengine: '火山引擎',
  zhipu: '智谱 GLM',
  minimax: 'MiniMax',
  yi: '01.AI 零一万物',
  stepfun: '阶跃星辰',
  hunyuan: '腾讯混元',
  ollama: 'Ollama',
  custom: 'Custom',
}

/** 供应商分组，用于全局弹窗分组展示 */
const providerGroups = [
  {
    label: '国际主流',
    keys: ['openai', 'anthropic', 'gemini', 'xai', 'mistral', 'groq'],
  },
  {
    label: '国内服务商',
    keys: [
      'siliconflow',
      'deepseek',
      'moonshot',
      'dashscope',
      'volcengine',
      'zhipu',
      'minimax',
      'yi',
      'stepfun',
      'hunyuan',
    ],
  },
  {
    label: '本地部署',
    keys: ['ollama'],
  },
]

// providerDefaults 已从 composable 导入供模板直接使用
void providerDefaults
</script>

<template>
  <div class="p-8 h-full flex flex-col overflow-hidden">
    <!-- 头部 + 子选项卡 -->
    <div class="flex items-start justify-between gap-4 mb-6 flex-shrink-0 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-sky-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-sky-400/15 transition-all duration-1000"
      />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <button
            :class="[
              'flex items-center gap-2 text-xl font-black bg-none border-none cursor-pointer p-0 transition-all',
              currentTab === 'llm'
                ? 'text-slate-800 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-500',
            ]"
            @click="currentTab = 'llm'"
          >
            <PixelIcon name="settings" size="sm" />
            <span class="font-pixel">模型配置</span>
          </button>
          <span class="text-slate-200 text-xl font-light">/</span>
          <button
            :class="[
              'flex items-center gap-2 text-xl font-black bg-none border-none cursor-pointer p-0 transition-all',
              currentTab === 'vector'
                ? 'text-slate-800 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-500',
            ]"
            @click="currentTab = 'vector'"
          >
            <PixelIcon name="brain" size="sm" />
            <span class="font-pixel">向量模型</span>
          </button>
          <span class="text-slate-200 text-xl font-light">/</span>
          <button
            :class="[
              'flex items-center gap-2 text-xl font-black bg-none border-none cursor-pointer p-0 transition-all',
              currentTab === 'multimodal'
                ? 'text-slate-800 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-500',
            ]"
            @click="currentTab = 'multimodal'"
          >
            <PixelIcon name="image" size="sm" />
            <span class="font-pixel">多模态转述</span>
          </button>
        </div>
        <p class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-7 font-pixel">
          {{
            currentTab === 'llm'
              ? 'LLM MODEL MANAGEMENT'
              : currentTab === 'vector'
                ? 'VECTOR CONFIGURATION'
                : 'MULTIMODAL RELAY'
          }}
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <template v-if="currentTab === 'llm'">
          <PButton variant="ghost" @click="isGlobalOpen = true">
            <PixelIcon name="settings" size="xs" />
            <span>全局服务商</span>
          </PButton>
          <PButton variant="ghost" @click="isTaskAssignOpen = true">
            <PixelIcon name="brain" size="xs" />
            <span>任务指派</span>
          </PButton>
          <PButton variant="ghost" class="agent-assign-trigger" @click="openAgentAssignment">
            <PixelIcon name="users" size="xs" />
            <span>角色指派</span>
          </PButton>
          <PButton variant="primary" @click="openEditor(null)">
            <PixelIcon name="plus" size="xs" />
            <span>添加模型</span>
          </PButton>
        </template>
        <template v-else>
          <PButton
            variant="primary"
            :loading="isSavingVector"
            :disabled="isSavingVector"
            @click="saveVectorConfig"
          >
            {{ isSavingVector ? '激活中' : '保存配置' }}
          </PButton>
        </template>
      </div>
    </div>

    <!-- LLM 模型网格 -->
    <div
      v-if="currentTab === 'llm'"
      class="model-card-grid grid grid-cols-[repeat(auto-fill,minmax(520px,1fr))] content-start gap-5 flex-1 overflow-y-auto pr-1 pt-2 model-scrollbar"
    >
      <PCard
        v-for="model in models"
        :key="model.id"
        pixel
        hoverable
        class="model-config-card flex flex-col gap-4"
      >
        <!-- 卡片头部 -->
        <div class="flex justify-between items-start">
          <div class="flex flex-col gap-0.5 min-w-0">
            <h3 class="text-base font-black text-slate-800 truncate">{{ model.name }}</h3>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              {{ providerLabels[model.provider] ?? model.provider }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <!-- 主模型徽章（淡蓝色像素风） -->
            <span
              v-if="mainModelId === model.id"
              class="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-sky-700 bg-sky-100 border-2 border-sky-300 shadow-[1px_1px_0_#7dd3fc] font-pixel"
            >
              <PixelIcon name="star" size="xs" />
              <span>主模型</span>
            </span>
            <div
              v-if="model.enableVision"
              class="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-sky-500 bg-sky-50 border border-sky-200"
            >
              <PixelIcon name="eye" size="xs" />
              <span>VISION</span>
            </div>
            <div
              v-if="model.enableAudioInput"
              class="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-violet-500 bg-violet-50 border border-violet-200"
            >
              <PixelIcon name="volume" size="xs" />
              <span>AUDIO IN</span>
            </div>
          </div>
        </div>

        <!-- 模型详情 -->
        <div class="model-detail-grid">
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">模型 ID</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono max-w-[160px] truncate">
              {{ model.modelId }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">最大输出 Token</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono">
              {{ formatTokens(model.maxTokens) }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">Wire API</span>
            <span class="text-[11px] font-mono text-slate-600">
              {{ model.wireApi === 'responses' ? 'RESPONSES' : 'CHAT' }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">原生思考</span>
            <span class="text-[11px] font-mono text-slate-600">
              {{ model.returnNativeReasoning ? '回传' : '隐藏' }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">思考等级</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono uppercase">
              {{ model.reasoningEffort ?? '不传' }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">温度 / TopP</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono">
              {{ model.temperature }} / {{ model.topP }}
            </span>
          </div>
        </div>

        <!-- 常用能力：横向像素控制条。 -->
        <section class="model-capability-panel">
          <header class="model-capability-panel__header">
            <span>
              <i />
              运行与输入能力
            </span>
            <small>CAPABILITY BUS / 03</small>
          </header>
          <div class="model-capability-list">
            <label class="model-capability-toggle" :class="{ 'is-enabled': model.stream }">
              <span class="model-capability-toggle__topline">
                <em>01 / STREAM</em>
                <i :class="{ 'is-on': model.stream }" />
              </span>
              <span class="model-capability-toggle__copy">
                <strong>流式输出</strong>
                <small>{{ model.stream ? '逐字返回' : '完整返回' }}</small>
              </span>
              <PSwitch
                :model-value="model.stream"
                @update:model-value="(enabled: boolean) => setModelToggle(model, 'stream', enabled)"
              />
            </label>
            <label class="model-capability-toggle" :class="{ 'is-enabled': model.enableVision }">
              <span class="model-capability-toggle__topline">
                <em>02 / VISION</em>
                <i :class="{ 'is-on': model.enableVision }" />
              </span>
              <span class="model-capability-toggle__copy">
                <strong>图片输入</strong>
                <small>{{ model.enableVision ? '允许识图' : '不接收图片' }}</small>
              </span>
              <PSwitch
                :model-value="model.enableVision"
                @update:model-value="
                  (enabled: boolean) => setModelToggle(model, 'enableVision', enabled)
                "
              />
            </label>
            <label
              class="model-capability-toggle model-capability-toggle-audio"
              :class="{ 'is-enabled': model.enableAudioInput }"
            >
              <span class="model-capability-toggle__topline">
                <em>03 / AUDIO</em>
                <i :class="{ 'is-on': model.enableAudioInput }" />
              </span>
              <span class="model-capability-toggle__copy">
                <strong>音频输入</strong>
                <small>{{ model.enableAudioInput ? '允许音频' : '不接收音频' }}</small>
              </span>
              <PSwitch
                :model-value="model.enableAudioInput"
                @update:model-value="
                  (enabled: boolean) => setModelToggle(model, 'enableAudioInput', enabled)
                "
              />
            </label>
          </div>
        </section>

        <!-- 操作按钮 -->
        <div class="flex justify-between items-center pt-3 border-t border-slate-100 mt-auto">
          <!-- 主模型按钮（像素风立体感：3px偏移阴影，按下位移+阴影缩小） -->
          <button
            :class="[
              'main-model-button flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold font-pixel border-2 cursor-pointer select-none transition-all duration-100',
              mainModelId === model.id ? 'main-model-button--active' : '',
            ]"
            @click="setMainModel(model.id)"
          >
            <PixelIcon name="star" size="xs" />
            <span>{{ mainModelId === model.id ? '主模型' : '设为主模型' }}</span>
          </button>
          <div class="flex gap-1">
            <PTooltip content="编辑" placement="top">
              <button
                class="p-1.5 bg-none border-none cursor-pointer text-slate-400 hover:text-sky-500 transition-all"
                @click="openEditor(model)"
              >
                <PixelIcon name="pencil" size="xs" />
              </button>
            </PTooltip>
            <PTooltip content="删除" placement="top">
              <button
                class="p-1.5 bg-none border-none cursor-pointer text-slate-400 hover:text-rose-500 transition-all"
                @click="deleteModel(model.id)"
              >
                <PixelIcon name="trash" size="xs" />
              </button>
            </PTooltip>
          </div>
        </div>
      </PCard>
    </div>

    <!-- 多模态转述配置 -->
    <div v-else-if="currentTab === 'multimodal'" class="flex-1 overflow-y-auto flex flex-col gap-6">
      <PCard pixel padding="lg" overflow-visible>
        <div class="flex items-center gap-4 mb-6">
          <div
            class="w-12 h-12 flex items-center justify-center bg-violet-500 text-white flex-shrink-0"
          >
            <PixelIcon name="image" size="sm" />
          </div>
          <div class="flex-1">
            <h4 class="text-base font-black text-slate-800 font-pixel">多模态转述</h4>
            <p class="text-xs text-slate-400 mt-0.5">
              用专用视觉模型将图片转为文字，帮助无视觉模型理解并保存长期上下文
            </p>
          </div>
          <PSwitch v-model="relayEnabled" />
        </div>
        <div class="grid grid-cols-2 gap-4" :class="{ 'opacity-60': !relayEnabled }">
          <div class="flex flex-col gap-1.5 col-span-2">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              转述模型
            </label>
            <PSelect
              v-model="relayModelConfigId"
              :disabled="!relayEnabled"
              :options="
                visionModels.map((model) => ({
                  label: `${model.name} · ${model.modelId}`,
                  value: model.id,
                }))
              "
              placeholder="选择已启用图片视觉能力的模型"
            />
            <p v-if="!visionModels.length" class="text-xs text-amber-600">
              请先在模型配置中为至少一个模型开启“图片输入”。
            </p>
          </div>
          <div class="flex flex-col gap-1.5 col-span-2">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              转述详细度
            </label>
            <PSelect
              v-model="relayDetail"
              :disabled="!relayEnabled"
              :options="[
                { label: '简洁 · 快速概括', value: 'brief' },
                { label: '标准 · 主体、状态与可见文字', value: 'standard' },
                { label: '详细 · 布局、对象关系与 OCR', value: 'detailed' },
              ]"
            />
          </div>
        </div>
        <div class="flex justify-end mt-6">
          <PButton :loading="isSavingRelay" @click="saveRelayConfig">保存转述配置</PButton>
        </div>
      </PCard>
      <PCard pixel padding="lg">
        <h4 class="text-sm font-black text-slate-800 font-pixel mb-3">运行规则</h4>
        <div class="text-xs leading-6 text-slate-500">
          <p>· 原图只进入当前一次 ReAct 对话，不会在后续上下文中重复发送。</p>
          <p>· 转述文字作为图片理解记录永久保存，后续对话只读取文字。</p>
          <p>· 未配置转述模型时，支持视觉的主模型仍可原生识图，但不会生成文字档案。</p>
        </div>
      </PCard>
    </div>

    <!-- 向量模型配置 -->
    <div v-else class="flex-1 overflow-y-auto flex flex-col gap-6">
      <!-- Embedding -->
      <PCard pixel padding="lg" overflow-visible>
        <div class="flex items-center gap-4 mb-5">
          <div
            class="w-12 h-12 flex items-center justify-center bg-sky-500 text-white flex-shrink-0"
          >
            <PixelIcon name="brain" size="sm" />
          </div>
          <div>
            <h4 class="text-base font-black text-slate-800 font-pixel">Embedding 嵌入模型</h4>
            <p class="text-xs text-slate-400 mt-0.5">将记忆文本转换为数学向量，是 RAG 检索的核心</p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              模型来源 Provider
            </label>
            <PSelect
              v-model="embeddingProvider"
              :options="[
                { label: '本地内置 (BGE-512) — 待实现', value: 'local', disabled: true },
                { label: '在线 API (OpenAI 兼容)', value: 'api' },
              ]"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              向量维度 Dimension
            </label>
            <PInputNumber
              v-model="embeddingDimension"
              :min="1"
              :max="4096"
              :disabled="embeddingProvider === 'local'"
            />
            <p v-if="embeddingProvider === 'local'" class="text-[10px] text-slate-400 italic">
              * 本地模型固定为 512 维
            </p>
          </div>
          <template v-if="embeddingProvider === 'api'">
            <div class="flex flex-col gap-1.5 col-span-2">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel flex items-center justify-between"
              >
                模型 ID
                <PButton
                  variant="ghost"
                  size="sm"
                  :loading="isFetchingEmbedding"
                  @click="fetchRemoteEmbeddingModels"
                >
                  <PixelIcon name="refresh" size="xs" />
                  获取模型列表
                </PButton>
              </label>
              <PSelect
                v-if="remoteEmbeddingModels.length > 0"
                v-model="embeddingModelId"
                :options="remoteEmbeddingModels.map((m) => ({ label: m, value: m }))"
                placeholder="从列表中选择..."
              />
              <PInput
                v-else
                v-model="embeddingModelId"
                placeholder="例如: text-embedding-3-small"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Base URL (可选)
              </label>
              <PInput v-model="embeddingApiBase" placeholder="留空则使用全局配置" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Key (可选)
              </label>
              <PInput v-model="embeddingApiKey" type="password" placeholder="留空则使用全局配置" />
            </div>
          </template>
        </div>
        <div
          v-if="embeddingActivationResult"
          :class="[
            'mt-5 flex items-center gap-2 border-2 px-4 py-3 text-xs font-bold',
            embeddingActivationResult.status === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-rose-300 bg-rose-50 text-rose-700',
          ]"
          role="status"
        >
          <PixelIcon
            :name="embeddingActivationResult.status === 'success' ? 'check' : 'alert'"
            size="xs"
          />
          <span>{{ embeddingActivationResult.message }}</span>
        </div>
      </PCard>

      <!-- Reranker -->
      <PCard pixel padding="lg" overflow-visible :class="{ 'opacity-65': !rerankerEnabled }">
        <div class="flex items-center gap-4 mb-5">
          <div
            :class="[
              'w-12 h-12 flex items-center justify-center text-white flex-shrink-0',
              rerankerEnabled ? 'bg-amber-500' : 'bg-slate-400',
            ]"
          >
            <PixelIcon name="sparkle" size="sm" />
          </div>
          <div class="flex-1">
            <h4 class="text-base font-black text-slate-800 font-pixel">Reranker 重排序模型</h4>
            <p class="text-xs text-slate-400 mt-0.5">对初步检索结果精排，提升检索准确度</p>
          </div>
          <PSwitch v-model="rerankerEnabled" class="flex-shrink-0" />
        </div>
        <template v-if="rerankerEnabled">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5 col-span-2">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel flex items-center justify-between"
              >
                模型 ID
                <PButton
                  variant="ghost"
                  size="sm"
                  :loading="isFetchingReranker"
                  @click="fetchRemoteRerankerModels"
                >
                  <PixelIcon name="refresh" size="xs" />
                  获取模型列表
                </PButton>
              </label>
              <PSelect
                v-if="remoteRerankerModels.length > 0"
                v-model="rerankerModelId"
                :options="remoteRerankerModels.map((m) => ({ label: m, value: m }))"
                placeholder="从列表中选择..."
              />
              <PInput v-else v-model="rerankerModelId" placeholder="例如: bge-reranker-v2-m3" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Base URL (可选)
              </label>
              <PInput v-model="rerankerApiBase" placeholder="留空则使用全局配置" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Key (可选)
              </label>
              <PInput v-model="rerankerApiKey" type="password" placeholder="留空则使用全局配置" />
            </div>
          </div>
        </template>
        <div
          v-else
          class="p-4 bg-slate-50 border border-slate-200 text-center text-[13px] text-slate-400"
        >
          <p>
            Reranker 已关闭。
            <strong class="text-amber-600">建议开启</strong>
            以获得更精准的记忆检索效果。
          </p>
        </div>
      </PCard>
    </div>

    <!-- 模型编辑弹窗 -->
    <PDialog v-model="isEditorOpen" :title="editingModel ? '编辑模型' : '添加模型'" width="560px">
      <div class="model-dialog-body flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            模型名称
          </label>
          <PInput v-model="editorForm.name" placeholder="给模型起个名字" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            Provider
          </label>
          <PSelect
            v-model="editorForm.provider"
            :options="providerOptions"
            @change="(v: string | number) => handleProviderChange(String(v))"
          />
        </div>
        <!-- 自定义 Provider 的协议格式选择 -->
        <div v-if="editorForm.provider === 'custom'" class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            协议格式
          </label>
          <PSelect v-model="editorForm.providerType" :options="customProviderTypeOptions" />
          <p class="text-[10px] text-slate-400 italic">* 选择当前自定义 API 兼容的协议格式</p>
        </div>
        <!-- 自定义 API Base / Key -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            API Base (可选)
          </label>
          <PInput
            v-model="editorForm.apiBase"
            :placeholder="
              editorForm.provider === 'custom' ? 'https://api.example.com/v1' : '留空则使用全局配置'
            "
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            API Key (可选)
          </label>
          <PInput
            v-model="editorForm.apiKey"
            type="password"
            :placeholder="editingModel?.apiKey ? '已载入保存的密钥' : '留空则使用全局配置'"
          />
        </div>
        <!-- 模型 ID + 获取列表 -->
        <div class="flex flex-col gap-1.5">
          <label
            class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel flex items-center justify-between"
          >
            模型 ID
            <PButton
              variant="ghost"
              size="sm"
              :loading="isFetchingRemote"
              @click="fetchRemoteModels"
            >
              <PixelIcon name="refresh" size="xs" />
              获取模型列表
            </PButton>
          </label>
          <PSelect
            v-if="remoteModels.length > 0"
            v-model="editorForm.modelId"
            :options="remoteModels.map((m) => ({ label: m, value: m }))"
            placeholder="从列表中选择..."
          />
          <PInput v-else v-model="editorForm.modelId" placeholder="例如: gpt-4o" />
        </div>
        <!-- 请求参数：每项先决定是否传参，再显示匹配的编辑控件。 -->
        <div class="model-params flex flex-col gap-3 rounded border-2 p-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h4 class="text-[11px] font-bold text-slate-700 font-pixel">请求参数</h4>
              <p class="mt-0.5 text-[10px] text-slate-400">
                关闭项目时不会向 Provider 发送该字段。
              </p>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">OPTIONAL</span>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">流式输出</span>
              <span class="text-[10px] text-slate-400">
                关闭后等待Provider完整响应，再一次性显示正文
              </span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">STREAM</span>
            <div class="model-param-control flex justify-end">
              <PSwitch v-model="editorForm.stream" />
            </div>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">Wire API</span>
              <span class="text-[10px] text-slate-400">
                选择Chat Completions或Responses传输协议
              </span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">ENDPOINT</span>
            <div class="model-param-control">
              <PSelect v-model="editorForm.wireApi" :options="wireApiOptions" />
            </div>
          </div>

          <div v-if="editorForm.wireApi === 'chat_completions'" class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">思考协议方言</span>
              <span class="text-[10px] text-slate-400">
                控制DeepSeek、OpenRouter等请求字段与跨轮重放
              </span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">DIALECT</span>
            <div class="model-param-control">
              <PSelect v-model="editorForm.reasoningDialect" :options="reasoningDialectOptions" />
            </div>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">原生思考回传</span>
              <span class="text-[10px] text-slate-400">
                请求并展示Provider原生思考摘要；不同于正文中的&lt;think&gt;
              </span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">NATIVE</span>
            <div class="model-param-control flex justify-end">
              <PSwitch v-model="editorForm.returnNativeReasoning" />
            </div>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">思考等级</span>
              <span class="text-[10px] text-slate-400">按 Provider 协议映射推理强度</span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">REASONING</span>
            <div class="model-param-control">
              <PSelect v-model="reasoningEffortValue" :options="reasoningEffortOptions" />
            </div>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">温度 Temperature</span>
              <span class="text-[10px] text-slate-400">控制回复随机性，范围 0–2</span>
            </div>
            <PSwitch v-model="sendTemperature" />
            <div v-if="sendTemperature" class="model-param-control">
              <PSlider v-model="temperatureValue" :min="0" :max="2" :step="0.1" show-input />
            </div>
            <span v-else class="model-param-off">不传</span>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">Top P</span>
              <span class="text-[10px] text-slate-400">核采样概率阈值，范围 0–1</span>
            </div>
            <PSwitch v-model="sendTopP" />
            <div v-if="sendTopP" class="model-param-control">
              <PSlider v-model="topPValue" :min="0" :max="1" :step="0.05" show-input />
            </div>
            <span v-else class="model-param-off">不传</span>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">上下文窗口 Token</span>
              <span class="text-[10px] text-slate-400">用于长记忆后台安全容量计算</span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono">CONTEXT</span>
            <div class="model-param-control">
              <PInputNumber
                v-model="editorForm.contextWindowTokens"
                :min="1"
                :max="2000000"
                :step="1024"
              />
            </div>
          </div>

          <div class="model-param-row">
            <div class="model-param-heading">
              <span class="text-xs font-bold text-slate-700">最大输出 Token</span>
              <span class="text-[10px] text-slate-400">限制单次回复长度，不是上下文窗口</span>
            </div>
            <PSwitch v-model="sendMaxTokens" />
            <div v-if="sendMaxTokens" class="model-param-control">
              <PInputNumber v-model="editorForm.maxTokens" :min="1" :max="2000000" :step="256" />
            </div>
            <span v-else class="model-param-off">不传</span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 pt-1">
          <div class="capability-editor rounded border p-3">
            <PCheckbox v-model="editorForm.enableVision" label="图片视觉 (Vision)" />
            <p class="mt-1 text-[10px] leading-relaxed text-slate-400">
              允许聊天将图片作为多模态输入。
            </p>
          </div>
          <div class="capability-editor rounded border p-3">
            <PCheckbox v-model="editorForm.enableAudioInput" label="音频输入 (Audio)" />
            <p class="mt-1 text-[10px] leading-relaxed text-slate-400">
              允许聊天将音频作为多模态输入。
            </p>
          </div>
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isEditorOpen = false">取消</PButton>
        <PButton variant="primary" @click="saveModel">{{ editingModel ? '保存' : '添加' }}</PButton>
      </template>
    </PDialog>

    <!-- 全局服务商弹窗 -->
    <PDialog v-model="isGlobalOpen" title="全局服务商配置" width="640px">
      <div class="model-dialog-body flex flex-col gap-6 max-h-[60vh] overflow-y-auto pr-1">
        <p class="text-xs text-slate-400 -mb-2">
          为各供应商预置全局 API Key。添加模型时若不填写单独 Key，则将使用这里的配置。
        </p>

        <!-- 分组展示 -->
        <div v-for="group in providerGroups" :key="group.label" class="flex flex-col gap-2">
          <h5
            class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 font-pixel pb-1.5 border-b border-slate-100"
          >
            {{ group.label }}
          </h5>
          <div
            v-for="key in group.keys"
            :key="key"
            class="grid grid-cols-[140px_1fr_1fr] items-center gap-2"
          >
            <span class="text-xs font-semibold text-slate-600 truncate">
              {{ providerLabels[key] ?? key }}
            </span>
            <PInput
              v-model="globalConfigRecord[key]!.apiBase"
              placeholder="API Base (optional)"
              class="text-xs h-8"
            />
            <PInput
              v-model="globalConfigRecord[key]!.apiKey"
              type="password"
              placeholder="API Key"
              class="text-xs h-8"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isGlobalOpen = false">关闭</PButton>
        <PButton variant="primary" @click="handleSaveGlobal">保存</PButton>
      </template>
    </PDialog>

    <!-- 任务指派弹窗 -->
    <PDialog v-model="isTaskAssignOpen" title="任务指派" width="560px">
      <div class="model-dialog-body flex flex-col gap-4">
        <p class="text-xs text-slate-400">
          为不同的系统工作选择合适模型；未单独选择时会使用主模型。
        </p>
        <div
          v-for="slot in TASK_SLOTS"
          :key="slot.key"
          class="flex items-center justify-between gap-4"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-bold text-slate-700">{{ slot.label }}</span>
            <span class="text-[10px] text-slate-400">{{ slot.description }}</span>
          </div>
          <PSelect
            :model-value="taskAssignments[slot.key] || ''"
            :options="[
              { label: '使用主模型（默认）', value: '' },
              ...models.map((m) => ({ label: m.name, value: m.id })),
            ]"
            class="w-48"
            @update:model-value="
              (v: string | number) => setTaskAssignment(slot.key, v ? String(v) : null)
            "
          />
        </div>
      </div>
      <template #footer>
        <PButton variant="primary" @click="isTaskAssignOpen = false">完成</PButton>
      </template>
    </PDialog>

    <!-- 角色模型指派弹窗 -->
    <PDialog v-model="isAgentAssignOpen" title="角色指派" width="680px">
      <div class="model-dialog-body agent-assignment-dialog">
        <div class="agent-assignment-intro">
          <div class="agent-assignment-intro__icon">
            <PixelIcon name="sparkles" size="sm" />
          </div>
          <div>
            <strong>让每位角色拥有自己的思考引擎</strong>
            <p>未单独指派的角色会自然跟随主模型，随时可以恢复默认。</p>
          </div>
        </div>

        <div v-if="agentStore.enabledAgents.length" class="agent-assignment-list">
          <article
            v-for="(agent, index) in agentStore.enabledAgents"
            :key="agent.id"
            class="agent-assignment-card"
            :style="{ '--agent-delay': `${index * 45}ms` }"
          >
            <div class="agent-assignment-card__identity">
              <div class="agent-assignment-avatar">
                <img
                  v-if="avatarUrlOf(agent.avatarUrl)"
                  :src="avatarUrlOf(agent.avatarUrl)"
                  :alt="agent.name"
                />
                <span v-else>{{ (agent.name || agent.id).slice(0, 1).toUpperCase() }}</span>
                <i class="agent-assignment-avatar__status" />
              </div>
              <div class="agent-assignment-card__copy">
                <div class="agent-assignment-card__title">
                  <strong>{{ agent.name || agent.id }}</strong>
                  <span>@{{ agent.id }}</span>
                </div>
                <p>{{ assignedModelName(agent.id) }}</p>
              </div>
            </div>

            <div class="agent-assignment-card__selector">
              <span class="agent-assignment-card__label">对话模型</span>
              <PSelect
                teleport
                :model-value="agentAssignments[agent.id] || ''"
                :options="[
                  { label: '跟随主模型', value: '' },
                  ...models.map((model) => ({ label: model.name, value: model.id })),
                ]"
                class="w-56"
                @update:model-value="
                  (value: string | number) =>
                    setAgentAssignment(agent.id, value ? String(value) : null)
                "
              />
            </div>
          </article>
        </div>

        <div v-else class="agent-assignment-empty">
          <PixelIcon name="users" size="md" />
          <strong>还没有可指派的角色</strong>
          <span>请先在角色配置中启用至少一个角色。</span>
        </div>
      </div>
      <template #footer>
        <PButton variant="primary" @click="isAgentAssignOpen = false">完成</PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
/* 模型配置业务区使用主题语义色，语义色仅承担状态强调。 */
.model-config-tab {
  color: var(--ui-text-primary);
}
.model-config-tab :is(.text-slate-800, .text-slate-700, .text-slate-600) {
  color: var(--ui-text-primary);
}
/* 弹窗内容（Teleport 到 body，不受 .model-config-tab 祖先兜底影响） */
.model-dialog-body :is(.text-slate-800, .text-slate-700, .text-slate-600) {
  color: var(--ui-text-primary);
}
.model-dialog-body :is(.text-slate-500, .text-slate-400) {
  color: var(--ui-text-secondary);
}
.model-dialog-body :is(.text-slate-300) {
  color: var(--ui-text-tertiary);
}
.model-dialog-body [class*='border-slate-'] {
  border-color: var(--ui-border-default);
}
.model-config-tab :is(.text-slate-500, .text-slate-400) {
  color: var(--ui-text-secondary);
}
.capability-group,
.model-params,
.capability-editor,
.reranker-disabled {
  border-color: var(--ui-border-default);
  background: var(--dash-panel-soft);
  color: var(--ui-text-secondary);
}
.main-model-badge {
  border: 2px solid var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  box-shadow: 1px 1px 0 var(--ui-accent-sky);
}
.main-model-button {
  border-color: var(--ui-accent-sky);
  background: var(--dash-panel-soft);
  color: var(--ui-accent-sky);
  box-shadow: 3px 3px 0 var(--ui-border-strong);
}
.main-model-button:hover {
  background: var(--ui-accent-sky-soft);
}
.main-model-button--active {
  background: var(--ui-accent-sky);
  color: var(--ui-text-inverse);
  box-shadow: 3px 3px 0 var(--ui-border-strong);
}
.main-model-button:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--ui-border-strong);
}

.agent-assign-trigger {
  position: relative;
  overflow: hidden;
}
.agent-assign-trigger::after {
  content: '';
  position: absolute;
  inset: -40% auto -40% -35%;
  width: 22%;
  transform: skewX(-18deg);
  background: color-mix(in srgb, var(--ui-accent-sky) 22%, transparent);
  transition: left 360ms ease;
  pointer-events: none;
}
.agent-assign-trigger:hover::after {
  left: 112%;
}
.agent-assignment-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: min(68vh, 620px);
}
.agent-assignment-intro {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 2px solid color-mix(in srgb, var(--ui-accent-sky) 46%, var(--ui-border-default));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--ui-accent-sky-soft) 75%, transparent),
      transparent 68%
    ),
    var(--dash-panel-soft);
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ui-border-strong) 72%, transparent);
}
.agent-assignment-intro__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  color: var(--ui-accent-sky);
  border: 2px solid currentColor;
  background: var(--ui-bg-surface);
  animation: agent-sparkle 2.8s ease-in-out infinite;
}
.agent-assignment-intro strong {
  display: block;
  color: var(--ui-text-primary);
  font-size: 13px;
}
.agent-assignment-intro p {
  margin: 3px 0 0;
  color: var(--ui-text-secondary);
  font-size: 11px;
}
.agent-assignment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 5px 5px 2px;
}
.agent-assignment-card {
  --agent-delay: 0ms;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 14px;
  border: 2px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ui-border-strong) 76%, transparent);
  animation: agent-card-in 320ms steps(4, end) both;
  animation-delay: var(--agent-delay);
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease;
}
.agent-assignment-card::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  background: var(--ui-accent-sky);
  opacity: 0.68;
}
.agent-assignment-card:hover {
  transform: translate(-1px, -2px);
  border-color: color-mix(in srgb, var(--ui-accent-sky) 58%, var(--ui-border-default));
  box-shadow: 5px 5px 0 color-mix(in srgb, var(--ui-accent-sky) 24%, var(--ui-border-strong));
}
.agent-assignment-card__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.agent-assignment-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  overflow: visible;
  color: var(--ui-accent-sky);
  border: 2px solid color-mix(in srgb, var(--ui-accent-sky) 68%, var(--ui-border-strong));
  background: var(--ui-accent-sky-soft);
  box-shadow: 2px 2px 0 var(--ui-border-strong);
}
.agent-assignment-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: auto;
}
.agent-assignment-avatar > span {
  font-family: var(--font-pixel, monospace);
  font-weight: 900;
}
.agent-assignment-avatar__status {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 11px;
  height: 11px;
  border: 2px solid var(--ui-bg-surface);
  background: var(--ui-accent-mint, #34d399);
  box-shadow: 1px 1px 0 var(--ui-border-strong);
}
.agent-assignment-card__copy {
  min-width: 0;
}
.agent-assignment-card__title {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.agent-assignment-card__title strong {
  color: var(--ui-text-primary);
  font-size: 14px;
}
.agent-assignment-card__title span,
.agent-assignment-card__copy p,
.agent-assignment-card__label {
  color: var(--ui-text-secondary);
  font-size: 10px;
}
.agent-assignment-card__copy p {
  margin: 4px 0 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-accent-sky);
  font-weight: 700;
}
.agent-assignment-card__selector {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  flex: 0 0 auto;
}
.agent-assignment-card__label {
  letter-spacing: 0.12em;
  font-family: var(--font-pixel, monospace);
}
.agent-assignment-empty {
  display: grid;
  place-items: center;
  gap: 7px;
  min-height: 180px;
  color: var(--ui-text-secondary);
  border: 2px dashed var(--ui-border-default);
  background: var(--dash-panel-soft);
  text-align: center;
}
.agent-assignment-empty strong {
  color: var(--ui-text-primary);
}
.agent-assignment-empty span {
  font-size: 11px;
}
@keyframes agent-card-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes agent-sparkle {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-2px) rotate(3deg);
  }
}
@media (max-width: 720px) {
  .agent-assignment-card {
    align-items: stretch;
    flex-direction: column;
  }
  .agent-assignment-card__selector {
    align-items: stretch;
  }
  .agent-assignment-card__selector :deep(.p-select) {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-assignment-card,
  .agent-assignment-intro__icon {
    animation: none;
  }
  .agent-assign-trigger::after {
    display: none;
  }
}

/* 横向模型卡：以信息密度和微像素控制条为主。 */
.model-card-grid {
  scroll-padding-top: 8px;
}

.model-config-card {
  min-height: 0;
  border-color: color-mix(in srgb, var(--ui-border-strong) 82%, transparent);
  background:
    linear-gradient(90deg, var(--ui-accent-sky) 0 34px, transparent 34px) top left / 72px 2px
      no-repeat,
    var(--ui-bg-surface);
  box-shadow:
    3px 3px 0 color-mix(in srgb, var(--ui-border-strong) 88%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--ui-text-inverse) 5%, transparent);
}

.model-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 22px;
  padding: 9px 10px;
  border-left: 2px solid var(--ui-border-default);
  background: color-mix(in srgb, var(--ui-bg-hover) 48%, transparent);
}

/* 模型卡片内的横向能力总线。 */
.model-capability-panel {
  overflow: hidden;
  border: 1px solid var(--ui-border-strong);
  border-radius: 0;
  background: var(--ui-bg-surface);
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-border-strong) 76%, transparent);
}

.model-capability-panel__header {
  display: flex;
  min-height: 27px;
  align-items: center;
  justify-content: space-between;
  padding: 5px 9px;
  border-bottom: 1px solid var(--ui-border-strong);
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0 7px,
      color-mix(in srgb, var(--ui-border-default) 35%, transparent) 7px 8px
    ),
    color-mix(in srgb, var(--ui-bg-hover) 76%, transparent);
}

.model-capability-panel__header span {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.model-capability-panel__header span i {
  width: 5px;
  height: 5px;
  background: var(--ui-accent-sky);
  box-shadow: 6px 0 0 color-mix(in srgb, var(--ui-accent-sky) 38%, transparent);
}

.model-capability-panel__header small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono), monospace;
  font-size: 7px;
  letter-spacing: 0.1em;
}

.model-capability-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.model-capability-toggle {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto 1fr;
  gap: 5px 8px;
  padding: 8px 9px 9px;
  cursor: pointer;
  transition:
    background-color 0.12s steps(2, end),
    box-shadow 0.12s steps(2, end);
}

.model-capability-toggle + .model-capability-toggle {
  border-left: 1px solid var(--ui-border-default);
}

.model-capability-toggle::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--ui-border-default);
  content: '';
}

.model-capability-toggle:hover {
  background: color-mix(in srgb, var(--ui-accent-sky-soft) 38%, transparent);
}

.model-capability-toggle.is-enabled {
  background: color-mix(in srgb, var(--ui-accent-sky-soft) 23%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-accent-sky) 16%, transparent);
}

.model-capability-toggle.is-enabled::after {
  background: var(--ui-accent-sky);
}

.model-capability-toggle-audio.is-enabled::after {
  background: var(--ui-accent-purple);
}

.model-capability-toggle__topline {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
}

.model-capability-toggle__topline em {
  color: var(--ui-text-muted);
  font-family: var(--font-mono), monospace;
  font-size: 7px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.model-capability-toggle__topline i {
  width: 5px;
  height: 5px;
  border: 1px solid var(--ui-text-muted);
  background: transparent;
}

.model-capability-toggle__topline i.is-on {
  border-color: var(--ui-accent-sky);
  background: var(--ui-accent-sky);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent-sky) 18%, transparent);
}

.model-capability-toggle-audio .model-capability-toggle__topline i.is-on {
  border-color: var(--ui-accent-purple);
  background: var(--ui-accent-purple);
}

.model-capability-toggle__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.model-capability-toggle strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-capability-toggle__copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 8px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-capability-toggle :deep(.p-switch-wrapper) {
  align-self: center;
  justify-self: end;
}

.model-capability-toggle :deep(.p-switch-track) {
  width: 31px;
  height: 17px;
  border-width: 1px;
  border-radius: 0;
}

.model-capability-toggle :deep(.p-switch-thumb) {
  width: 11px;
  height: 11px;
  border-radius: 0;
}

.model-capability-toggle :deep(.p-switch-thumb-on) {
  transform: translateX(14px);
}

@media (max-width: 900px) {
  .model-card-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 620px) {
  .model-detail-grid,
  .model-capability-list {
    grid-template-columns: 1fr;
  }

  .model-capability-toggle + .model-capability-toggle {
    border-top: 1px solid var(--ui-border-default);
    border-left: 0;
  }
}

/* 模型参数卡：开关决定字段是否进入请求，控件仅在启用后可见。 */
.model-param-row {
  display: grid;
  grid-template-columns: minmax(144px, 1fr) auto minmax(220px, 1.6fr);
  align-items: center;
  gap: 12px;
  min-height: 48px;
}

.model-param-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-param-control {
  min-width: 0;
}

.model-param-off {
  justify-self: end;
  color: var(--ui-text-tertiary);
  font-family: var(--font-pixel), monospace;
  font-size: 10px;
}

@media (max-width: 620px) {
  .model-param-row {
    grid-template-columns: 1fr auto;
  }

  .model-param-control {
    grid-column: 1 / -1;
  }
}

/* 像素风滚动条 */
.model-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.model-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
  border-radius: 0;
}
</style>
