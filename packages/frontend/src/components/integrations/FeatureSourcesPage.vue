<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  INTEGRATION_PROVIDERS,
  type IntegrationFeature,
  type IntegrationSourceInput,
  type IntegrationSourceView,
} from '@infos/shared'
import {
  PCard,
  PButton,
  PDialog,
  PInput,
  PSelect,
  PInputNumber,
  PSwitch,
  PixelIcon,
} from '../pixel'
import { useIntegrations } from '../../composables/tools/useIntegrations'
import IntegrationBrand from './IntegrationBrand.vue'

const props = defineProps<{ kind: IntegrationFeature }>()
const emit = defineEmits<{ back: [] }>()
const { state, busy, updateFeature, saveSource, removeSource } = useIntegrations()
const feature = computed(() => state.value?.features[props.kind])
const providers = computed(() => INTEGRATION_PROVIDERS.filter((item) => item.kind === props.kind))
const title = computed(() => (props.kind === 'pdf' ? 'PDF 解析' : '联网搜索'))
const editing = ref(false)
const deleting = ref<string | null>(null)
const savedKey = ref(false)
const form = ref<
  IntegrationSourceInput & {
    apiKey: string
    clearApiKey: boolean
    options: {
      language: string
      ocr: boolean
      model: 'vlm' | 'pipeline'
      searchDepth: 'basic' | 'advanced'
      maxResults: number
    }
  }
>({
  name: '',
  provider: 'tavily',
  endpoint: '',
  apiKey: '',
  clearApiKey: false,
  options: { language: 'ch', ocr: false, model: 'vlm', searchDepth: 'basic', maxResults: 5 },
})
const currentProvider = computed(() =>
  providers.value.find((item) => item.id === form.value.provider),
)
const providerBinding = computed({
  get: () => form.value.provider,
  set: (value: string | number) => {
    const provider = providers.value.find((item) => item.id === value)
    if (provider) form.value.provider = provider.id
  },
})
const depthBinding = computed({
  get: () => form.value.options.searchDepth,
  set: (value: string | number) => {
    if (value === 'basic' || value === 'advanced') form.value.options.searchDepth = value
  },
})
const modelBinding = computed({
  get: () => form.value.options.model,
  set: (value: string | number) => {
    if (value === 'vlm' || value === 'pipeline') form.value.options.model = value
  },
})
watch(
  () => form.value.provider,
  (value, previous) => {
    if (!editing.value || value === previous) return
    const provider = providers.value.find((item) => item.id === value)
    if (!provider) return
    if (form.value.name === INTEGRATION_PROVIDERS.find((item) => item.id === previous)?.name)
      form.value.name = provider.name
    form.value.endpoint = provider.endpoint
    form.value.apiKey = ''
    form.value.clearApiKey = true
    savedKey.value = false
  },
)
function open(source?: IntegrationSourceView): void {
  editing.value = false
  const provider = providers.value[0]!
  form.value = {
    id: source?.id,
    name: source?.name ?? provider.name,
    provider: source?.provider ?? provider.id,
    endpoint: source?.endpoint ?? provider.endpoint,
    apiKey: '',
    clearApiKey: false,
    options: {
      language: 'ch',
      ocr: false,
      model: 'vlm',
      searchDepth: 'basic',
      maxResults: 5,
      ...source?.options,
    },
  }
  savedKey.value = source?.hasApiKey ?? false
  // 打开时不触发切换来源类型的重置逻辑。
  queueMicrotask(() => {
    editing.value = true
  })
}
async function save(): Promise<void> {
  if (await saveSource(props.kind, form.value)) editing.value = false
}
async function choose(id: string): Promise<void> {
  await updateFeature(props.kind, true, id)
}
async function disable(): Promise<void> {
  if (feature.value) await updateFeature(props.kind, false, feature.value.selectedSourceId)
}
async function remove(): Promise<void> {
  if (deleting.value && (await removeSource(props.kind, deleting.value))) deleting.value = null
}
</script>
<template>
  <section>
    <div class="integration-page-heading">
      <div>
        <button type="button" class="integration-back" @click="emit('back')">
          <PixelIcon name="chevron-left" size="xs" />
          拓展功能
        </button>
        <h2>{{ title }}</h2>
      </div>
      <div class="integration-heading-actions">
        <PButton
          v-if="feature?.enabled"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="disable"
        >
          停用
        </PButton>
        <PButton type="button" :disabled="busy || !feature" @click="open()">添加来源</PButton>
      </div>
    </div>
    <p class="integration-description">
      {{
        kind === 'pdf'
          ? '选择一个解析来源，开启 PDF 附件上传。文件上传后自动解析。'
          : '保存多个搜索来源，选择其中一个供联网搜索工具使用。'
      }}
    </p>
    <p v-if="!feature?.sources.length" class="integration-empty">尚未添加来源。</p>
    <div class="integration-source-list">
      <PCard
        v-for="source in feature?.sources"
        :key="source.id"
        pixel
        padding="md"
        class="integration-source-card"
      >
        <IntegrationBrand
          :brand="INTEGRATION_PROVIDERS.find((item) => item.id === source.provider)?.logo"
          :fallback="kind === 'pdf' ? 'file' : 'search'"
        />
        <div class="integration-source-copy">
          <h3>
            {{ source.name }}
            <span
              v-if="feature?.enabled && feature.selectedSourceId === source.id"
              class="integration-selected"
            >
              当前使用
            </span>
          </h3>
          <p>
            {{ INTEGRATION_PROVIDERS.find((item) => item.id === source.provider)?.name }} ·
            {{ source.configured ? '已配置' : '待配置' }}
          </p>
          <small>{{ source.endpoint || '尚未设置服务地址' }}</small>
        </div>
        <div class="integration-source-actions">
          <PButton
            type="button"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="open(source)"
          >
            配置
          </PButton>
          <PButton
            v-if="!feature?.enabled || feature.selectedSourceId !== source.id"
            type="button"
            size="sm"
            :disabled="busy || !source.configured"
            @click="choose(source.id)"
          >
            使用
          </PButton>
          <button
            type="button"
            class="integration-remove"
            title="移除来源"
            :disabled="busy"
            @click="deleting = source.id"
          >
            <PixelIcon name="trash" size="sm" />
          </button>
        </div>
      </PCard>
    </div>
    <PDialog v-model="editing" :title="form.id ? '配置来源' : '添加来源'" width="560px">
      <div class="integration-form">
        <label>
          来源类型
          <PSelect
            v-model="providerBinding"
            :options="providers.map((item) => ({ label: item.name, value: item.id }))"
            :disabled="busy"
          />
        </label>
        <label>
          名称
          <PInput v-model="form.name" maxlength="80" :disabled="busy" />
        </label>
        <label>
          {{ form.provider === 'pdf-http' ? '解析接口地址' : '服务地址' }}
          <PInput v-model="form.endpoint" placeholder="https://…" :disabled="busy" />
        </label>
        <label v-if="currentProvider?.needsKey || form.provider === 'pdf-http'">
          API Key
          <PInput
            v-model="form.apiKey"
            type="password"
            autocomplete="new-password"
            :placeholder="
              savedKey ? '已设置，留空保留' : currentProvider?.needsKey ? '输入 API Key' : '可选'
            "
            :disabled="busy"
          />
        </label>
        <label v-if="savedKey" class="integration-switch">
          <span>清除已保存的 Key</span>
          <PSwitch v-model="form.clearApiKey" :disabled="busy" />
        </label>
        <template v-if="kind === 'search'">
          <label>
            默认结果数
            <PInputNumber
              :model-value="form.options.maxResults"
              :min="1"
              :max="10"
              :disabled="busy"
              @update:model-value="
                (value) => {
                  if (value !== null) form.options.maxResults = value
                }
              "
            />
          </label>
          <label v-if="form.provider === 'tavily'">
            检索深度
            <PSelect
              v-model="depthBinding"
              :options="[
                { label: '常规', value: 'basic' },
                { label: '深入', value: 'advanced' },
              ]"
              :disabled="busy"
            />
          </label>
          <p v-if="form.provider === 'searxng'" class="integration-form-help">
            SearXNG 实例需要允许 JSON 搜索结果。
          </p>
        </template>
        <template v-else>
          <label>
            文档语言
            <PInput
              v-model="form.options.language"
              placeholder="ch / en"
              maxlength="20"
              :disabled="busy"
            />
          </label>
          <label class="integration-switch">
            <span>启用 OCR</span>
            <PSwitch v-model="form.options.ocr" :disabled="busy" />
          </label>
          <label v-if="form.provider === 'mineru'">
            解析模型
            <PSelect
              v-model="modelBinding"
              :options="[
                { label: 'VLM', value: 'vlm' },
                { label: 'Pipeline', value: 'pipeline' },
              ]"
              :disabled="busy"
            />
          </label>
          <p v-if="form.provider === 'mineru-light'" class="integration-form-help">
            轻量模式无需 Key，支持最多 10MB；页数与调用额度由 MinerU 限制。
          </p>
          <p v-if="form.provider === 'pdf-http'" class="integration-form-help">
            接口接收 multipart 的 file、language、ocr，返回 JSON 的 markdown 或 text 字段。
          </p>
        </template>
      </div>
      <template #footer>
        <PButton type="button" variant="ghost" :disabled="busy" @click="editing = false">
          取消
        </PButton>
        <PButton type="button" :loading="busy" :disabled="!form.name.trim()" @click="save">
          保存
        </PButton>
      </template>
    </PDialog>
    <PDialog
      :model-value="Boolean(deleting)"
      title="移除来源"
      width="400px"
      @update:model-value="
        (value) => {
          if (!value) deleting = null
        }
      "
    >
      <p>移除这个来源？如果正在使用它，对应功能会停用。</p>
      <template #footer>
        <PButton type="button" variant="ghost" :disabled="busy" @click="deleting = null">
          取消
        </PButton>
        <PButton type="button" variant="danger" :loading="busy" @click="remove">移除</PButton>
      </template>
    </PDialog>
  </section>
</template>
