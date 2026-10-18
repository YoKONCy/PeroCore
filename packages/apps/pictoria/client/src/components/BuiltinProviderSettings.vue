<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { pictoria } from '../services/transport'
import Icon from './PictoriaIcon.vue'
import PictoriaSelect from './PictoriaSelect.vue'
interface Settings {
  revision?: number
  hasCredential: boolean
  defaultModel?: string
  defaultVideoModel?: string
  generateModel?: string
  editModel?: string
  videoModel?: string
  models: Array<{ id: string; name: string; mode: 'generate' | 'edit' | 'video' }>
}
const props = withDefaults(
  defineProps<{ agentId: string; online: boolean; adapterId?: string; name?: string }>(),
  { adapterId: 'atlascloud', name: 'AtlasCloud' },
)
const emit = defineEmits<{ updated: []; error: [message: string] }>()
const profile = ref<Settings>(),
  key = ref(''),
  generateModel = ref('nano-banana-pro'),
  editModel = ref('nano-banana-pro'),
  busy = ref(false),
  message = ref('')
const videoModel = ref('')
let generation = 0,
  disposed = false
async function load() {
  const request = ++generation,
    owner = props.agentId
  key.value = ''
  profile.value = undefined
  message.value = ''
  if (!props.online || !owner) return
  try {
    const value = await pictoria.operation<Settings>(owner, 'provider.settings', {
      adapterId: props.adapterId,
    })
    if (!disposed && request === generation) {
      profile.value = value
      generateModel.value = value.generateModel || value.defaultModel || 'nano-banana-pro'
      editModel.value = value.editModel || value.defaultModel || 'nano-banana-pro'
      videoModel.value = value.videoModel || value.defaultVideoModel || ''
    }
  } catch (error) {
    if (!disposed && request === generation)
      emit('error', error instanceof Error ? error.message : '无法读取服务配置')
  }
}
async function save(clearCredential = false) {
  if (busy.value || !props.online || !profile.value) return
  busy.value = true
  message.value = ''
  const owner = props.agentId,
    request = generation
  try {
    const value = await pictoria.operation<Settings>(owner, 'provider.configure', {
      adapterId: props.adapterId,
      generateModel: generateModel.value,
      editModel: editModel.value,
      ...(videoModel.value ? { videoModel: videoModel.value } : {}),
      expectedRevision: profile.value.revision ?? 0,
      ...(clearCredential
        ? { clearCredential: true }
        : key.value.trim()
          ? { apiKey: key.value.trim() }
          : {}),
    })
    if (disposed || request !== generation) return
    profile.value = value
    key.value = ''
    message.value = clearCredential ? '已移除' : '已保存'
    emit('updated')
  } catch (error) {
    if (!disposed && request === generation)
      emit('error', error instanceof Error ? error.message : '配置保存失败')
  } finally {
    busy.value = false
  }
}
watch(() => [props.agentId, props.online, props.adapterId], load, { immediate: true })
onBeforeUnmount(() => {
  disposed = true
  generation++
  key.value = ''
})
</script>
<template>
  <div class="settings-section provider-settings">
    <div class="provider-title">
      <span class="provider-logo">
        <svg
          v-if="adapterId === 'atlascloud'"
          viewBox="0 0 32 32"
          width="24"
          height="24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4 25 12-20 12 20H4Zm8-7h8M8 25l8-13 8 13"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>
        <Icon v-else name="image" :size="24" />
      </span>
      <div>
        <strong>{{ name }}</strong>
        <small>图片与视频</small>
      </div>
      <span class="provider-state">{{ profile?.hasCredential ? '已配置' : '待配置' }}</span>
    </div>
    <label class="panel-field">
      API Key
      <input
        v-model="key"
        type="password"
        autocomplete="new-password"
        :disabled="busy || !online"
        :placeholder="profile?.hasCredential ? '已保存 · 留空不改' : '输入 API Key'"
      />
    </label>
    <div class="panel-field">
      <span>生成模型</span>
      <PictoriaSelect
        v-model="generateModel"
        :disabled="busy || !profile"
        :options="
          (profile?.models || [])
            .filter((model) => model.mode === 'generate')
            .map((model) => ({ value: model.id, label: `${name} · ${model.name}` }))
        "
        label="生成模型"
      />
    </div>
    <div class="panel-field">
      <span>编辑模型</span>
      <PictoriaSelect
        v-model="editModel"
        :disabled="busy || !profile"
        :options="
          (profile?.models || [])
            .filter((model) => model.mode === 'edit')
            .map((model) => ({ value: model.id, label: `${name} · ${model.name}` }))
        "
        label="编辑模型"
      />
    </div>
    <div class="panel-field">
      <span>视频模型</span>
      <PictoriaSelect
        v-model="videoModel"
        :disabled="busy || !profile"
        :options="
          (profile?.models || [])
            .filter((model) => model.mode === 'video')
            .map((model) => ({ value: model.id, label: `${name} · ${model.name}` }))
        "
        label="视频模型"
      />
    </div>
    <div class="provider-actions">
      <button
        class="create-button"
        :disabled="busy || !profile || (!key.trim() && !profile.hasCredential)"
        @click="save()"
      >
        <Icon name="check" :size="14" />
        {{ busy ? '保存中' : '保存' }}
      </button>
      <button
        v-if="profile?.hasCredential"
        class="text-button danger-button"
        :disabled="busy"
        @click="save(true)"
      >
        移除凭据
      </button>
    </div>
    <Transition name="fade">
      <small v-if="message" class="provider-message">{{ message }}</small>
    </Transition>
  </div>
</template>
