<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { pttVirtualKeys, type PetControlSettings } from '@infos/shared'
import { usePetControls } from '../../composables/pet/usePetControls'
import { invoke, isElectron } from '../../utils/ipcAdapter'
import { petShortcutLabels, recordPetShortcut } from '../../utils/petShortcuts'
import { PCard, PixelIcon } from '../pixel'

type ShortcutKey = keyof Pick<
  PetControlSettings,
  | 'pttBinding'
  | 'toggleVoiceShortcut'
  | 'stopSpeechShortcut'
  | 'openConversationShortcut'
  | 'togglePetShortcut'
>
const { settings, supported, loaded, error, update } = usePetControls()
const desktop = isElectron()
const capturing = ref<ShortcutKey | null>(null)
const captureReady = ref(false)
const captureError = ref('')
const saving = ref(false)
let captureVersion = 0
let disposed = false
const devices = ref<MediaDeviceInfo[]>([])
const deviceError = ref('')
const shortcuts: Array<{
  key: keyof Pick<
    PetControlSettings,
    'toggleVoiceShortcut' | 'stopSpeechShortcut' | 'openConversationShortcut' | 'togglePetShortcut'
  >
  label: string
}> = [
  { key: 'toggleVoiceShortcut', label: '开启 / 关闭语音' },
  { key: 'stopSpeechShortcut', label: '停止朗读' },
  { key: 'openConversationShortcut', label: '查看主应用对话' },
  { key: 'togglePetShortcut', label: '显示 / 隐藏桌宠' },
]
async function setCapturing(active: boolean): Promise<boolean> {
  try {
    await invoke('pet-controls:capture', active)
    return true
  } catch (cause) {
    if (!disposed) captureError.value = cause instanceof Error ? cause.message : '快捷键录入失败'
    return false
  }
}

function cancelCapture() {
  if (!capturing.value) return
  capturing.value = null
  captureReady.value = false
  captureVersion++
  void setCapturing(false)
}

async function beginCapture(key: ShortcutKey, event: MouseEvent) {
  if (!loaded.value || !desktop || saving.value) return
  const wasCapturing = capturing.value === key
  cancelCapture()
  if (wasCapturing) return
  capturing.value = key
  captureReady.value = false
  captureError.value = ''
  const version = ++captureVersion
  ;(event.currentTarget as HTMLButtonElement).focus()
  const ready = await setCapturing(true)
  if (version !== captureVersion) return
  if (ready) captureReady.value = true
  else capturing.value = null
}

async function saveBinding(key: ShortcutKey, binding: string) {
  if (saving.value) return
  saving.value = true
  captureError.value = ''
  // 保存结束前保持主进程暂停，避免刚录入的按键立即触发旧绑定。
  capturing.value = null
  captureReady.value = false
  captureVersion++
  try {
    await update({ [key]: binding })
  } finally {
    await setCapturing(false)
    saving.value = false
  }
}

function captureKey(event: KeyboardEvent, key: ShortcutKey) {
  if (capturing.value !== key) return
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape') {
    cancelCapture()
    return
  }
  if (!captureReady.value || event.repeat || event.isComposing) return
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code)) return
  const binding = recordPetShortcut(event, key === 'pttBinding')
  if (!binding) {
    captureError.value = '这个按键暂不支持，请换一个'
    return
  }
  void saveBinding(key, binding)
}

function captureMouse(event: MouseEvent) {
  if (capturing.value !== 'pttBinding' || ![3, 4].includes(event.button)) return
  event.preventDefault()
  event.stopPropagation()
  if (!captureReady.value) return
  const binding = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
    event.button === 3 ? 'Mouse4' : 'Mouse5',
  ]
    .filter(Boolean)
    .join('+')
  if (!pttVirtualKeys(binding)) {
    captureError.value = '组合键过多，请减少修饰键'
    return
  }
  void saveBinding('pttBinding', binding)
}

function clearBinding(key: ShortcutKey) {
  cancelCapture()
  captureError.value = ''
  void saveBinding(key, '')
}
async function listMicrophones() {
  try {
    deviceError.value = ''
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    devices.value = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    )
  } catch {
    deviceError.value = '无法读取麦克风，请检查系统权限'
  }
}

onMounted(() => window.addEventListener('blur', cancelCapture))
onDeactivated(cancelCapture)
onBeforeUnmount(() => {
  disposed = true
  cancelCapture()
  window.removeEventListener('blur', cancelCapture)
})
</script>

<template>
  <PCard class="pet-control-settings" padding="lg" pixel>
    <h3>
      <PixelIcon name="mic" size="sm" />
      桌宠语音与快捷键
    </h3>
    <p class="intro">按住说话，松开发送。完整回复留在主应用，桌宠只播报独立的简短口语答复。</p>
    <div class="settings-grid">
      <label>
        输入方式
        <select
          :value="settings.voiceMode"
          :disabled="!loaded"
          @change="
            update({
              voiceMode: ($event.target as HTMLSelectElement)
                .value as PetControlSettings['voiceMode'],
            })
          "
        >
          <option value="off">关闭麦克风</option>
          <option value="ptt">按住说话</option>
          <option value="vad">自动感应</option>
        </select>
      </label>
      <div class="shortcut-field">
        <span id="pet-ptt-label">按住说话绑定</span>
        <button
          type="button"
          class="shortcut-record"
          :class="{ capturing: capturing === 'pttBinding' }"
          :disabled="!loaded || !desktop || saving"
          :aria-pressed="capturing === 'pttBinding'"
          aria-labelledby="pet-ptt-label"
          @click="beginCapture('pttBinding', $event)"
          @keydown="captureKey($event, 'pttBinding')"
          @mousedown="captureMouse"
          @auxclick.prevent
          @blur="cancelCapture"
        >
          <span v-if="capturing === 'pttBinding'" class="record-prompt" role="status">
            {{ captureReady ? '按下按键或侧键 · Esc 取消' : '准备录入…' }}
          </span>
          <span v-else class="shortcut-keys">
            <kbd v-for="(key, index) in petShortcutLabels(settings.pttBinding)" :key="index">
              {{ key }}
            </kbd>
          </span>
          <PixelIcon name="edit" size="xs" aria-hidden="true" />
        </button>
      </div>
      <label>
        麦克风
        <select
          :value="settings.microphoneId"
          @change="update({ microphoneId: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">系统默认设备</option>
          <option v-for="device in devices" :key="device.deviceId" :value="device.deviceId">
            {{ device.label || '麦克风' }}
          </option>
          <option
            v-if="
              settings.microphoneId && !devices.some((d) => d.deviceId === settings.microphoneId)
            "
            :value="settings.microphoneId"
          >
            已选择的麦克风
          </option>
        </select>
      </label>
      <button class="device-refresh" type="button" @click="listMicrophones">
        授权并刷新麦克风
      </button>
      <div v-for="shortcut in shortcuts" :key="shortcut.key" class="shortcut-field">
        <span :id="`pet-${shortcut.key}-label`">{{ shortcut.label }}</span>
        <div class="shortcut-row">
          <button
            type="button"
            class="shortcut-record"
            :class="{ capturing: capturing === shortcut.key }"
            :disabled="!loaded || !desktop || saving"
            :aria-pressed="capturing === shortcut.key"
            :aria-labelledby="`pet-${shortcut.key}-label`"
            @click="beginCapture(shortcut.key, $event)"
            @keydown="captureKey($event, shortcut.key)"
            @blur="cancelCapture"
          >
            <span v-if="capturing === shortcut.key" class="record-prompt" role="status">
              {{ captureReady ? '按下组合键 · Esc 取消' : '准备录入…' }}
            </span>
            <span v-else-if="settings[shortcut.key]" class="shortcut-keys">
              <kbd v-for="(key, index) in petShortcutLabels(settings[shortcut.key])" :key="index">
                {{ key }}
              </kbd>
            </span>
            <span v-else class="shortcut-empty">未设置 · 点击录入</span>
            <PixelIcon name="edit" size="xs" aria-hidden="true" />
          </button>
          <button
            v-if="settings[shortcut.key]"
            type="button"
            class="shortcut-clear"
            :disabled="!loaded || !desktop || saving"
            :aria-label="`清除${shortcut.label}快捷键`"
            title="清除快捷键"
            @click="clearBinding(shortcut.key)"
          >
            <PixelIcon name="close" size="xs" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
    <p class="hint shortcut-hint">点击绑定后按下按键，Esc 取消；清除快捷键可禁用对应操作。</p>
    <div class="switches">
      <label>
        <input
          type="checkbox"
          :checked="settings.speechEnabled"
          @change="update({ speechEnabled: ($event.target as HTMLInputElement).checked })"
        />
        播报口语答复
      </label>
      <label>
        <input
          type="checkbox"
          :checked="settings.subtitlesEnabled"
          @change="update({ subtitlesEnabled: ($event.target as HTMLInputElement).checked })"
        />
        显示短句字幕
      </label>
    </div>
    <p class="hint">
      Windows 桌面端支持失焦时按住说话和鼠标侧键。语音开启后麦克风保持就绪；录音时可按 Esc
      丢弃。自动感应会持续监听。
    </p>
    <p v-if="loaded && !supported" class="warning">
      当前环境不支持全局按住说话，仍可使用桌宠面板的按住按钮。
    </p>
    <p v-if="captureError || error || deviceError" class="warning" role="alert">
      {{ captureError || error || deviceError }}
    </p>
  </PCard>
</template>

<style scoped>
.pet-control-settings {
  flex-shrink: 0;
  color: var(--ui-text-primary);
}
.pet-control-settings.p-card-pixel {
  border-width: 1px;
  border-color: var(--ui-border-strong);
  box-shadow:
    inset 1px 1px 0 var(--ui-bg-hover),
    inset -1px -1px 0 var(--ui-border-subtle),
    2px 2px 0 var(--ui-border-subtle);
}
h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ui-font-pixel);
  font-size: 14px;
  font-weight: 400;
  font-synthesis: none;
}
.intro,
.hint {
  font-size: 12px;
  color: var(--ui-text-secondary);
  line-height: 1.7;
  margin: 10px 0 18px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
label,
.shortcut-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  font-family: var(--ui-font-pixel);
  font-synthesis: none;
  min-width: 0;
}
select,
button {
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-default);
  border-radius: 0;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
  text-align: left;
  min-width: 0;
  width: 100%;
  font-family: var(--ui-font-sans);
  font-size: 13px;
}
select {
  box-shadow: inset 1px 1px 0 var(--ui-border-subtle);
}
button {
  cursor: pointer;
  font-family: var(--ui-font-pixel);
  box-shadow:
    inset 1px 1px 0 var(--ui-bg-hover),
    inset -1px -1px 0 var(--ui-border-subtle),
    0 2px 0 var(--ui-border-subtle);
}
button:not(:disabled):hover {
  border-color: var(--ui-accent-purple);
}
button:not(:disabled):active {
  transform: translateY(1px);
  box-shadow: inset 1px 1px 0 var(--ui-border-subtle);
}
.capturing {
  outline: 1px solid var(--ui-accent-purple);
  outline-offset: 2px;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
button:focus-visible {
  outline: 1px solid var(--ui-accent-purple);
  outline-offset: 2px;
}
.shortcut-row {
  display: flex;
  gap: 6px;
  min-width: 0;
}
.shortcut-record {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 40px;
}
.shortcut-record > .pixel-icon {
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
}
.shortcut-keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
kbd {
  padding: 2px 5px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
  box-shadow: 0 1px 0 var(--ui-border-strong);
  font-family: var(--ui-font-pixel);
  font-size: 11px;
  line-height: 1.4;
}
.shortcut-clear {
  display: grid;
  place-items: center;
  width: 36px;
  flex-shrink: 0;
  padding: 8px;
  color: var(--ui-text-secondary);
}
.shortcut-empty {
  color: var(--ui-text-tertiary);
}
.record-prompt {
  color: var(--ui-accent-purple);
  font-size: 12px;
  line-height: 1.6;
}
.shortcut-hint {
  margin-bottom: 0;
}
.device-refresh {
  align-self: end;
}
.switches {
  display: flex;
  gap: 24px;
  margin: 20px 0 12px;
}
.switches label {
  flex-direction: row;
  align-items: center;
}
.warning {
  font-size: 12px;
  color: var(--ui-warning);
  margin-top: 10px;
}
@media (max-width: 680px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
