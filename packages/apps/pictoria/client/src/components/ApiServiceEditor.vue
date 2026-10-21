<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { FieldSchema, ProviderDirectory, ServiceProfile } from '../types'
import { pictoria } from '../services/transport'
import PictoriaSelect from './PictoriaSelect.vue'
const props = defineProps<{
  owner: string
  serviceId?: string
  name?: string
  inputSchema?: FieldSchema
  outputSchema?: FieldSchema
  localLlm?: boolean
}>()
const source = ref<ServiceProfile>(),
  services = ref<ServiceProfile[]>([]),
  directory = ref<ProviderDirectory>({ adapters: [], providers: [] })
const selected = ref(''),
  loading = ref(true),
  error = ref(''),
  loadFailed = ref(false),
  busy = ref(false)
const draftId = crypto.randomUUID(),
  pendingService = ref<ServiceProfile>()
let disposed = false
const inputFields: Record<string, FieldSchema> = props.inputSchema?.properties || {
  prompt: { type: 'string' },
}
const fields = Object.fromEntries(
  Object.entries(inputFields).map(([name, schema]) => [
    name,
    {
      from: name,
      format:
        schema.properties?.assetId || schema.items?.properties?.assetId ? 'data_url' : 'value',
    },
  ]),
)
const outputs = Object.fromEntries(
  Object.entries(props.outputSchema?.properties || { images: { type: 'array' } }).map(
    ([name, schema]) => [
      name,
      {
        path: schema.type === 'string' ? 'choices.0.message.content' : 'data.outputs',
        kind:
          schema.type === 'string'
            ? 'text'
            : /video|视频/i.test(name)
              ? 'video'
              : /audio|音频/i.test(name)
                ? 'audio'
                : 'image',
      },
    ],
  ),
)
const api = reactive({
  name: props.name || 'API',
  providerId: '',
  baseUrl: '',
  path: props.localLlm ? 'chat/completions' : '',
  apiKey: '',
  model: '',
  method: 'POST',
  bodyFormat: 'json',
  requiresCredential: true,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  headers: '{}',
  body: props.localLlm
    ? JSON.stringify(
        {
          messages: [
            { role: 'system', content: '按用户要求处理输入，仅返回结果。' },
            { role: 'user', content: '' },
          ],
        },
        null,
        2,
      )
    : '{}',
  fields: JSON.stringify(
    props.localLlm ? { 'messages.1.content': { from: 'prompt', format: 'text' } } : fields,
    null,
    2,
  ),
  outputs: JSON.stringify(outputs, null, 2),
  async: false,
  taskId: 'data.id',
  pollPath: '/tasks/{id}',
  stateField: 'status',
  success: 'completed',
  failed: 'failed,cancelled',
})
const provider = computed(() =>
  directory.value.providers.find((item) => item.id === api.providerId),
)
const adapter = ref('')
const keepCredential = computed(() => {
  if (!source.value?.hasCredential || source.value.providerId || api.providerId) return false
  try {
    return (
      new URL(api.baseUrl).origin === new URL(source.value.baseUrl).origin &&
      adapter.value === (source.value.adapter || '') &&
      api.authHeader.toLowerCase() === source.value.authHeader.toLowerCase() &&
      api.authPrefix === source.value.authPrefix
    )
  } catch {
    return false
  }
})
function hydrate(service?: ServiceProfile) {
  source.value = service
  selected.value = service?.id || ''
  error.value = service?.credentialError || ''
  api.apiKey = ''
  adapter.value = service?.adapter || ''
  if (!service) return
  const body = { ...service.submit.body }
  api.model = typeof body.model === 'string' ? body.model : ''
  delete body.model
  api.headers = JSON.stringify(service.headers || {}, null, 2)
  Object.assign(api, {
    name: service.name,
    providerId: service.providerId || '',
    baseUrl: service.baseUrl,
    path: service.submit.path,
    method: service.submit.method,
    bodyFormat: service.submit.bodyFormat || 'json',
    requiresCredential: service.requiresCredential,
    authHeader: service.authHeader,
    authPrefix: service.authPrefix,
    body: JSON.stringify(body, null, 2),
    fields: JSON.stringify(service.submit.fields, null, 2),
    outputs: JSON.stringify(service.submit.outputs, null, 2),
    async: Boolean(service.poll),
    taskId: service.submit.taskIdField || 'data.id',
    pollPath: service.poll?.path || '/tasks/{id}',
    stateField: service.poll?.stateField || 'status',
    success: service.poll?.success.join(',') || 'completed',
    failed: service.poll?.failed.join(',') || 'failed,cancelled',
  })
}
function choose(id: string) {
  hydrate(services.value.find((item) => item.id === id))
}
watch(
  () => [api.providerId, adapter.value, api.baseUrl, api.authHeader, api.authPrefix],
  () => {
    api.apiKey = ''
  },
  { flush: 'sync' },
)
onMounted(async () => {
  try {
    const [profiles, providers] = await Promise.all([
      pictoria.operation<ServiceProfile[]>(props.owner, 'service.list'),
      pictoria.operation<ProviderDirectory>(props.owner, 'provider.list'),
    ])
    let current = profiles.find((item) => item.id === props.serviceId)
    if (props.serviceId && !current)
      current = await pictoria.operation<ServiceProfile>(props.owner, 'service.get', {
        id: props.serviceId,
      })
    if (disposed) return
    services.value =
      current && !profiles.some((item) => item.id === current?.id)
        ? [current, ...profiles]
        : profiles
    directory.value = providers
    hydrate(current)
  } catch (failure) {
    if (!disposed) {
      loadFailed.value = true
      error.value = failure instanceof Error ? failure.message : 'API 配置读取失败'
    }
  } finally {
    loading.value = false
  }
})
async function save(): Promise<ServiceProfile> {
  if (loading.value || busy.value) throw new Error('API 配置尚未就绪')
  if (loadFailed.value) throw new Error(error.value || 'API 配置读取失败，请重新打开')
  busy.value = true
  error.value = ''
  try {
    const body = JSON.parse(api.body)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('请求主体必须为 JSON 对象')
    if (api.model.trim()) body.model = api.model.trim()
    else if (body.model === undefined && provider.value?.defaultModel)
      body.model = provider.value.defaultModel
    if (!provider.value && api.requiresCredential && !api.apiKey.trim() && !keepCredential.value)
      throw new Error('请填写 API Key；更换 API 域名后需要重新填写')
    const definition = {
      id: draftId,
      name: api.name.trim() || props.name || 'API',
      enabled: true,
      baseUrl: provider.value?.baseUrl || api.baseUrl.trim(),
      ...(api.providerId ? { providerId: api.providerId } : {}),
      ...(adapter.value ? { adapter: adapter.value } : {}),
      requiresCredential: provider.value?.requiresCredential ?? api.requiresCredential,
      authHeader: provider.value?.authHeader || api.authHeader,
      authPrefix: provider.value?.authPrefix ?? api.authPrefix,
      ...(api.apiKey.trim() && !api.providerId
        ? { credential: api.apiKey.trim() }
        : source.value && keepCredential.value
          ? {
              credentialId: source.value.credentialId || source.value.id,
              credentialSourceId: source.value.id,
            }
          : {}),
      headers: JSON.parse(api.headers),
      submit: {
        path: api.path.trim(),
        method: api.method,
        bodyFormat: api.bodyFormat,
        body,
        fields: JSON.parse(api.fields),
        outputs: JSON.parse(api.outputs),
        ...(api.async ? { taskIdField: api.taskId.trim() } : {}),
      },
      ...(api.async
        ? {
            poll: {
              path: api.pollPath.trim(),
              stateField: api.stateField.trim(),
              success: api.success
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              failed: api.failed
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              intervalMs: source.value?.poll?.intervalMs || 3000,
            },
          }
        : {}),
      timeoutMs: source.value?.timeoutMs || 1200000,
      requestTimeoutMs: source.value?.requestTimeoutMs || 90000,
      recoveryWindowMs: source.value?.recoveryWindowMs || 21600000,
      concurrency: source.value?.concurrency || 2,
      ...(source.value?.idempotencyHeader
        ? {
            idempotencyHeader: source.value.idempotencyHeader,
            idempotencyWindowMs: source.value.idempotencyWindowMs,
          }
        : {}),
      ...(source.value?.cancel ? { cancel: source.value.cancel } : {}),
    }
    if (!definition.baseUrl || !definition.submit.path) throw new Error('请填写 API 地址和请求路径')
    const saved = await pictoria.operation<ServiceProfile>(props.owner, 'service.save', {
      expectedRevision: pendingService.value?.revision ?? 0,
      definition,
    })
    if (!disposed) {
      api.apiKey = ''
      source.value = saved
      pendingService.value = saved
      selected.value = saved.id
      services.value = [saved, ...services.value.filter((item) => item.id !== saved.id)]
    }
    return saved
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'API 配置保存失败'
    throw failure
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => {
  disposed = true
  api.apiKey = ''
})
defineExpose({ save })
</script>
<template>
  <div class="workflow-api-fields">
    <label v-if="services.length" class="panel-field">
      {{ __t('apps.pictoria.ui', '复制已有 API') }}
      <PictoriaSelect
        :model-value="selected"
        :disabled="loading || busy"
        :options="[
          { value: '', label: __t('apps.pictoria.ui', '自定义') },
          ...services.map((service) => ({ value: service.id, label: service.name })),
        ]"
        @update:model-value="choose"
      />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '供应商') }}
      <PictoriaSelect
        v-model="api.providerId"
        :disabled="loading || busy"
        :options="[
          { value: '', label: __t('apps.pictoria.ui', '独立 API') },
          ...directory.providers.map((item) => ({
            value: item.id,
            label: item.name,
            disabled: !item.enabled,
          })),
        ]"
      />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '适配器') }}
      <PictoriaSelect
        v-model="adapter"
        :options="[
          { value: '', label: __t('apps.pictoria.ui', '通用 HTTP') },
          ...directory.adapters.map((item) => ({ value: item.id, label: item.name })),
        ]"
      />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', 'API 名称') }}
      <input v-model="api.name" maxlength="100" />
    </label>
    <label class="panel-field">
      Base URL
      <input v-if="provider" :value="provider.baseUrl" readonly />
      <input v-else v-model="api.baseUrl" placeholder="https://…/v1/" />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '请求路径') }}
      <input v-model="api.path" placeholder="images/generations" />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '模型') }}
      <input
        v-model="api.model"
        :placeholder="provider?.defaultModel || __t('apps.pictoria.ui', 'API 模型名（可选）')"
        maxlength="200"
      />
    </label>
    <template v-if="!provider">
      <label class="panel-field">
        API Key
        <input
          v-model="api.apiKey"
          type="password"
          autocomplete="new-password"
          :placeholder="
            keepCredential
              ? __t('apps.pictoria.ui', '已保存 · 留空不改')
              : __t('apps.pictoria.ui', '输入 API Key')
          "
        />
      </label>
      <label class="workflow-checkbox">
        <input v-model="api.requiresCredential" type="checkbox" />
        {{ __t('apps.pictoria.ui', '需要认证') }}
      </label>
    </template>
    <details class="workflow-advanced">
      <summary>{{ __t('apps.pictoria.ui', '请求配置') }}</summary>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '方法') }}
        <PictoriaSelect
          v-model="api.method"
          :options="['POST', 'GET', 'PUT'].map((value) => ({ value, label: value }))"
        />
      </label>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '传输') }}
        <PictoriaSelect
          v-model="api.bodyFormat"
          :options="[
            { value: 'json', label: 'JSON' },
            { value: 'multipart', label: __t('apps.pictoria.ui', '表单') },
          ]"
        />
      </label>
      <template v-if="!provider">
        <label class="panel-field">
          {{ __t('apps.pictoria.ui', '认证 Header') }}
          <input v-model="api.authHeader" />
        </label>
        <label class="panel-field">
          {{ __t('apps.pictoria.ui', '认证前缀') }}
          <input v-model="api.authPrefix" />
        </label>
      </template>
      <label class="panel-field">
        Headers
        <textarea v-model="api.headers" rows="3" spellcheck="false" />
      </label>
    </details>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '请求主体') }}
      <textarea v-model="api.body" rows="4" spellcheck="false" />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '输入映射') }}
      <textarea v-model="api.fields" rows="4" spellcheck="false" />
    </label>
    <label class="panel-field">
      {{ __t('apps.pictoria.ui', '输出映射') }}
      <textarea v-model="api.outputs" rows="4" spellcheck="false" />
    </label>
    <label class="workflow-checkbox">
      <input v-model="api.async" type="checkbox" />
      {{ __t('apps.pictoria.ui', '异步任务') }}
    </label>
    <template v-if="api.async">
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '任务 ID') }}
        <input v-model="api.taskId" />
      </label>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '查询路径') }}
        <input v-model="api.pollPath" />
      </label>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '状态字段') }}
        <input v-model="api.stateField" />
      </label>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '成功状态') }}
        <input v-model="api.success" />
      </label>
      <label class="panel-field">
        {{ __t('apps.pictoria.ui', '失败状态') }}
        <input v-model="api.failed" />
      </label>
    </template>
    <p v-if="loading || loadFailed" class="workflow-field-error" role="status">
      {{ error || __t('apps.pictoria.ui', '读取配置…') }}
    </p>
  </div>
</template>
