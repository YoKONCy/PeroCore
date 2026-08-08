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
  PSwitch,
  PTooltip,
  PDialog,
  PCheckbox,
  PCard,
} from '../../pixel'
import { watch, type Ref } from 'vue'
import { useModelConfig, TASK_SLOTS } from '../../../composables/dashboard/useModelConfig'
import { useDashboardContext } from '../../../composables/dashboard'

const ctx = useDashboardContext()

const {
  models,
  currentTab,
  mainModelId,
  taskAssignments,
  isTaskAssignOpen,
  providerOptions,
  isEditorOpen,
  editingModel,
  editorForm,
  openEditor,
  saveModel,
  deleteModel,
  setMainModel,
  setTaskAssignment,
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
} = useModelConfig()

/** 将 globalConfig 转为 Record<string,...> 供弹窗模板遍历使用，避免 TS 索引类型报错 */
const globalConfigRecord = globalConfig as Ref<Record<string, { apiBase: string; apiKey: string }>>

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

function formatTokens(tokens: number | null): string {
  if (!tokens) return '自动'
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
        </div>
        <p class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-7 font-pixel">
          {{ currentTab === 'llm' ? 'LLM MODEL MANAGEMENT' : 'VECTOR CONFIGURATION' }}
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
          <PButton variant="primary" @click="openEditor(null)">
            <PixelIcon name="plus" size="xs" />
            <span>添加模型</span>
          </PButton>
        </template>
        <template v-else>
          <PButton variant="primary" :loading="isSavingVector" @click="saveVectorConfig">
            保存配置
          </PButton>
        </template>
      </div>
    </div>

    <!-- LLM 模型网格 -->
    <div
      v-if="currentTab === 'llm'"
      class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-4 flex-1 overflow-y-auto pr-1 model-scrollbar"
    >
      <PCard v-for="model in models" :key="model.id" pixel hoverable class="flex flex-col gap-3">
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
          </div>
        </div>

        <!-- 模型详情 -->
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">模型 ID</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono max-w-[160px] truncate">
              {{ model.modelId }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">上下文窗口</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono">
              {{ formatTokens(model.maxTokens) }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[11px] text-slate-400">温度 / TopP</span>
            <span class="text-[11px] font-bold text-slate-500 font-mono">
              {{ model.temperature }} / {{ model.topP }}
            </span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-between items-center pt-3 border-t border-slate-100 mt-auto">
          <!-- 主模型按钮（像素风立体感：3px偏移阴影，按下位移+阴影缩小） -->
          <button
            :class="[
              'flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold font-pixel border-2 cursor-pointer select-none transition-all duration-100',
              mainModelId === model.id
                ? 'bg-sky-500 text-white border-sky-600 shadow-[3px_3px_0_#0369a1] hover:bg-sky-600 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0369a1]'
                : 'bg-sky-50 text-sky-600 border-sky-300 shadow-[3px_3px_0_#bae6fd] hover:bg-sky-100 hover:border-sky-400 hover:shadow-[3px_3px_0_#7dd3fc] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#7dd3fc]',
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
      <div class="flex flex-col gap-4">
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
          <PInput v-model="editorForm.apiKey" type="password" placeholder="留空则使用全局配置" />
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
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              温度
            </label>
            <PInputNumber v-model="editorForm.temperature" :min="0" :max="2" :step="0.1" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
              Top P
            </label>
            <PInputNumber v-model="editorForm.topP" :min="0" :max="1" :step="0.1" />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel">
            最大 Token 数
          </label>
          <PInputNumber v-model="editorForm.maxTokens" :min="1024" :max="2000000" :step="1024" />
        </div>
        <div class="pt-1">
          <PCheckbox v-model="editorForm.enableVision" label="启用视觉能力 (Vision)" />
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isEditorOpen = false">取消</PButton>
        <PButton variant="primary" @click="saveModel">{{ editingModel ? '保存' : '添加' }}</PButton>
      </template>
    </PDialog>

    <!-- 全局服务商弹窗 -->
    <PDialog v-model="isGlobalOpen" title="全局服务商配置" width="640px">
      <div class="flex flex-col gap-6 max-h-[60vh] overflow-y-auto pr-1">
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
      <div class="flex flex-col gap-4">
        <p class="text-xs text-slate-400">为系统内的各项任务指派模型。未指派的任务将使用主模型。</p>
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
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.model-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.model-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
