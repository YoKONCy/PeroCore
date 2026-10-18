<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ModelProvider, ProviderDirectory } from '../types'
import { pictoria } from '../services/transport'
import BuiltinProviderSettings from './BuiltinProviderSettings.vue'
import PictoriaSelect from './PictoriaSelect.vue'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{ agentId: string; online: boolean }>()
const emit = defineEmits<{ updated: []; error: [message: string] }>()
// 内置配置组件按编辑器类型注册，新增供应商无需修改画布页面。
const editors = { atlascloud: BuiltinProviderSettings, apimodels: BuiltinProviderSettings }
const directory = ref<ProviderDirectory>({ adapters: [], providers: [] }),
  selected = ref('atlascloud'),
  busy = ref(false),
  message = ref('')
const models = ref<Array<{ id: string; name: string }>>([]),
  fetching = ref(false)
const form = reactive({
  id: '',
  revision: 0,
  name: '',
  baseUrl: '',
  protocol: 'http',
  defaultModel: '',
  modelsPath: 'models',
  enabled: true,
  requiresCredential: true,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  credential: '',
  hasCredential: false,
})
const adapter = computed(() => directory.value.adapters.find((item) => item.id === selected.value))
const editor = computed(() => editors[adapter.value?.editor as keyof typeof editors])
let generation = 0,
  disposed = false
function choose(id: string) {
  generation++
  selected.value = id
  message.value = ''
  form.credential = ''
  models.value = []
  const value = directory.value.providers.find((item) => item.id === id)
  Object.assign(
    form,
    {
      id: '',
      revision: 0,
      name: '',
      baseUrl: '',
      protocol: 'http',
      defaultModel: '',
      modelsPath: 'models',
      enabled: true,
      requiresCredential: true,
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      hasCredential: false,
    },
    value || {},
  )
}
async function fetchModels() {
  if (fetching.value || busy.value || !props.online) return
  const request = generation,
    stamp = JSON.stringify([
      form.baseUrl,
      form.modelsPath,
      form.authHeader,
      form.authPrefix,
      form.credential,
    ]),
    owner = props.agentId
  const { revision: _revision, hasCredential: _hasCredential, credential, ...value } = form
  fetching.value = true
  message.value = ''
  try {
    const result = await pictoria.operation<{ models: Array<{ id: string; name: string }> }>(
      owner,
      'provider.models',
      {
        definition: {
          ...value,
          id: value.id || 'model-discovery',
          name: value.name.trim() || '自定义供应商',
          ...(credential.trim() ? { credential: credential.trim() } : {}),
        },
      },
    )
    if (
      disposed ||
      request !== generation ||
      stamp !==
        JSON.stringify([
          form.baseUrl,
          form.modelsPath,
          form.authHeader,
          form.authPrefix,
          form.credential,
        ])
    )
      return
    models.value = result.models
    message.value = result.models.length ? `${result.models.length} 个模型` : '暂无模型'
  } catch (failure) {
    if (!disposed && request === generation)
      emit('error', failure instanceof Error ? failure.message : '模型列表获取失败')
  } finally {
    fetching.value = false
  }
}
async function load() {
  const request = ++generation
  form.credential = ''
  if (!props.online || !props.agentId) return
  try {
    const value = await pictoria.operation<ProviderDirectory>(props.agentId, 'provider.list')
    if (!disposed && request === generation) {
      directory.value = value
      choose(selected.value)
    }
  } catch (failure) {
    if (!disposed && request === generation)
      emit('error', failure instanceof Error ? failure.message : '供应商读取失败')
  }
}
async function save(clearCredential = false) {
  if (busy.value || !props.online) return
  const request = generation,
    owner = props.agentId
  busy.value = true
  message.value = ''
  try {
    const { revision, hasCredential: _hasCredential, credential, ...value } = form
    const saved = await pictoria.operation<ModelProvider>(owner, 'provider.save', {
      expectedRevision: revision,
      definition: {
        ...value,
        id: value.id || crypto.randomUUID(),
        ...(clearCredential
          ? { clearCredential: true }
          : credential.trim()
            ? { credential: credential.trim() }
            : {}),
      },
    })
    if (disposed || request !== generation) return
    directory.value.providers = [
      saved,
      ...directory.value.providers.filter((item) => item.id !== saved.id),
    ]
    choose(saved.id)
    message.value = '已保存'
    emit('updated')
  } catch (failure) {
    if (!disposed && request === generation)
      emit('error', failure instanceof Error ? failure.message : '供应商保存失败')
  } finally {
    busy.value = false
  }
}
watch(() => [props.agentId, props.online], load, { immediate: true })
watch(
  () => [form.baseUrl, form.modelsPath, form.authHeader, form.authPrefix, form.credential],
  () => {
    models.value = []
    message.value = ''
  },
)
onBeforeUnmount(() => {
  disposed = true
  generation++
  form.credential = ''
})
</script>
<template>
  <div class="provider-directory">
    <nav class="provider-directory-list" aria-label="模型供应商">
      <button
        v-for="item in directory.adapters"
        :key="item.id"
        :class="{ active: selected === item.id }"
        :disabled="busy"
        @click="choose(item.id)"
      >
        <Icon name="sparkle" :size="17" />
        <span>{{ item.name }}</span>
      </button>
      <button
        v-for="item in directory.providers"
        :key="item.id"
        :class="{ active: selected === item.id }"
        :disabled="busy"
        @click="choose(item.id)"
      >
        <Icon name="link" :size="17" />
        <span>{{ item.name }}</span>
      </button>
      <button :class="{ active: selected === 'new' }" :disabled="busy" @click="choose('new')">
        <Icon name="plus" :size="17" />
        添加供应商
      </button>
    </nav>
    <component
      :is="editor"
      v-if="editor"
      :key="adapter?.id"
      :adapter-id="adapter?.id"
      :name="adapter?.name"
      :agent-id="agentId"
      :online="online"
      @updated="emit('updated')"
      @error="emit('error', $event)"
    />
    <form v-else class="settings-section provider-settings" @submit.prevent="save()">
      <label class="panel-field">
        名称
        <input v-model="form.name" required maxlength="100" />
      </label>
      <label class="panel-field">
        协议
        <PictoriaSelect
          v-model="form.protocol"
          :options="[
            { value: 'http', label: '通用 HTTP' },
            { value: 'openai', label: 'OpenAI 兼容' },
          ]"
        />
      </label>
      <label class="panel-field">
        Base URL
        <input v-model="form.baseUrl" required type="url" placeholder="https://…/v1/" />
      </label>
      <div class="panel-field">
        <div class="provider-model-heading">
          <span>默认模型</span>
          <button
            type="button"
            class="quiet-button"
            :disabled="fetching || busy || !online || !form.baseUrl.trim()"
            @click="fetchModels"
          >
            <Icon name="refresh" :size="14" :class="{ 'provider-model-loading': fetching }" />
            {{ fetching ? '获取中' : '获取模型' }}
          </button>
        </div>
        <input v-model="form.defaultModel" maxlength="200" placeholder="模型 ID · 可选" />
        <Transition name="float">
          <PictoriaSelect
            v-if="models.length"
            v-model="form.defaultModel"
            :options="
              models.map((model) => ({
                value: model.id,
                label: model.name === model.id ? model.id : `${model.name} · ${model.id}`,
              }))
            "
            placeholder="选择模型"
            label="模型列表"
          />
        </Transition>
      </div>
      <label class="panel-field">
        API Key
        <input
          v-model="form.credential"
          type="password"
          autocomplete="new-password"
          :placeholder="form.hasCredential ? '已保存 · 留空不改' : '输入 API Key'"
        />
      </label>
      <label class="workflow-checkbox">
        <input v-model="form.enabled" type="checkbox" />
        启用
      </label>
      <label class="workflow-checkbox">
        <input v-model="form.requiresCredential" type="checkbox" />
        需要认证
      </label>
      <details class="workflow-advanced">
        <summary>接口与认证</summary>
        <label class="panel-field">
          模型列表路径
          <input v-model="form.modelsPath" placeholder="models 或 /v1/models" maxlength="500" />
        </label>
        <label class="panel-field">
          Header
          <input v-model="form.authHeader" />
        </label>
        <label class="panel-field">
          前缀
          <input v-model="form.authPrefix" />
        </label>
      </details>
      <div class="provider-actions">
        <button
          type="submit"
          class="create-button"
          :disabled="busy || !online || !form.name.trim() || !form.baseUrl.trim()"
        >
          {{ busy ? '保存中' : '保存' }}
        </button>
        <button
          v-if="form.hasCredential"
          type="button"
          class="text-button danger-button"
          :disabled="busy"
          @click="save(true)"
        >
          移除凭据
        </button>
      </div>
      <small v-if="message" class="provider-message">{{ message }}</small>
    </form>
  </div>
</template>
