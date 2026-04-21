<script setup lang="ts">
/**
 * VoiceTab — 语音功能 Tab (F1-4)
 *
 * TTS (语音合成) + ASR (语音识别) 配置面板。
 * F3: 已对接 configApi 读写。
 */
import { ref, onMounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { voiceApi } from '../../../api/modules/voiceApi'

// ── TTS 配置 ──
const ttsEnabled = ref(true)
const ttsProvider = ref('openai')
const ttsVoice = ref('shimmer')
const ttsSpeed = ref(1.0)
const ttsPitch = ref(1.0)
const ttsApiBase = ref('')
const ttsApiKey = ref('')

const ttsProviderOptions = [
  { label: 'OpenAI TTS', value: 'openai' },
  { label: 'Azure Speech', value: 'azure' },
  { label: '本地 (Piper)', value: 'local' },
]

const ttsVoiceOptions = [
  { label: 'Shimmer (自然女声)', value: 'shimmer' },
  { label: 'Nova (活泼女声)', value: 'nova' },
  { label: 'Alloy (中性)', value: 'alloy' },
  { label: 'Echo (男声)', value: 'echo' },
  { label: 'Fable (英式男声)', value: 'fable' },
  { label: 'Onyx (深沉男声)', value: 'onyx' },
]

// ── ASR 配置 ──
const asrEnabled = ref(false)
const asrLanguage = ref('zh-CN')
const wakeWord = ref('佩洛')
const asrSensitivity = ref(0.7)

const asrLanguageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
  { label: '自动检测', value: 'auto' },
]

// ── 加载 / 自动保存 ──

async function loadVoiceConfig() {
  try {
    const res = await configApi.batch([
      'tts.enabled',
      'tts.provider',
      'tts.voice',
      'tts.speed',
      'tts.pitch',
      'tts.apiBase',
      'tts.apiKey',
      'asr.enabled',
      'asr.language',
      'asr.wakeWord',
      'asr.sensitivity',
    ])
    const d = res.data ?? {}
    if (d['tts.enabled'] !== undefined) ttsEnabled.value = d['tts.enabled'] !== 'false'
    if (d['tts.provider']) ttsProvider.value = d['tts.provider'] as string
    if (d['tts.voice']) ttsVoice.value = d['tts.voice'] as string
    if (d['tts.speed']) ttsSpeed.value = Number(d['tts.speed'])
    if (d['tts.pitch']) ttsPitch.value = Number(d['tts.pitch'])
    if (d['tts.apiBase']) ttsApiBase.value = d['tts.apiBase'] as string
    if (d['tts.apiKey']) ttsApiKey.value = d['tts.apiKey'] as string
    if (d['asr.enabled'] !== undefined) asrEnabled.value = d['asr.enabled'] === 'true'
    if (d['asr.language']) asrLanguage.value = d['asr.language'] as string
    if (d['asr.wakeWord']) wakeWord.value = d['asr.wakeWord'] as string
    if (d['asr.sensitivity']) asrSensitivity.value = Number(d['asr.sensitivity'])
  } catch {
    // 默认值
  }
}

/** 防抖自动保存 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSave(key: string, value: string) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    configApi.set(key, value).catch(() => {})
  }, 500)
}

// 监听关键字段变化，自动保存
watch(ttsEnabled, (v) => debouncedSave('tts.enabled', String(v)))
watch(ttsProvider, (v) => debouncedSave('tts.provider', v))
watch(ttsVoice, (v) => debouncedSave('tts.voice', v))
watch(ttsSpeed, (v) => debouncedSave('tts.speed', String(v)))
watch(asrEnabled, (v) => debouncedSave('asr.enabled', String(v)))
watch(asrLanguage, (v) => debouncedSave('asr.language', v))

// ── 测试 ──
const isTestPlaying = ref(false)
const testError = ref('')
async function testTts() {
  isTestPlaying.value = true
  testError.value = ''
  try {
    // 调用后端 /api/voice/tts 合成
    const audioBuffer = await voiceApi.synthesize({
      text: '主人你好呀！这是佩洛的语音测试喵~',
      voice: ttsVoice.value,
      speed: ttsSpeed.value,
    })

    // 使用 Web Audio API 播放
    const audioCtx = new AudioContext()
    const decoded = await audioCtx.decodeAudioData(audioBuffer)
    const source = audioCtx.createBufferSource()
    source.buffer = decoded
    source.connect(audioCtx.destination)
    source.onended = () => {
      isTestPlaying.value = false
      audioCtx.close()
    }
    source.start()
  } catch (e) {
    testError.value = (e as Error).message
    isTestPlaying.value = false
  }
}

onMounted(loadVoiceConfig)
</script>

<template>
  <div class="tab-voice">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="mic" size="md" /><span>语音功能</span></h2>
      <p class="tab-subtitle">VOICE CONFIGURATION</p>
    </div>

    <div class="voice-scroll">
      <!-- TTS -->
      <section class="voice-section">
        <div class="voice-section-header">
          <div class="voice-section-left">
            <div class="voice-icon voice-icon-blue"><PixelIcon name="mic" size="sm" /></div>
            <div>
              <h3 class="voice-section-title">语音合成 TTS</h3>
              <p class="voice-section-desc">让 Pero 用声音回复你</p>
            </div>
          </div>
          <PSwitch v-model="ttsEnabled" />
        </div>

        <template v-if="ttsEnabled">
          <div class="voice-grid">
            <div class="voice-field">
              <label class="voice-label">Provider</label>
              <PSelect v-model="ttsProvider" :options="ttsProviderOptions" />
            </div>
            <div class="voice-field">
              <label class="voice-label">声音</label>
              <PSelect v-model="ttsVoice" :options="ttsVoiceOptions" />
            </div>
            <div class="voice-field">
              <label class="voice-label">语速 ({{ ttsSpeed.toFixed(1) }}x)</label>
              <PSlider v-model="ttsSpeed" :min="0.5" :max="2.0" :step="0.1" />
            </div>
            <div class="voice-field">
              <label class="voice-label">音调 ({{ ttsPitch.toFixed(1) }}x)</label>
              <PSlider v-model="ttsPitch" :min="0.5" :max="2.0" :step="0.1" />
            </div>
            <template v-if="ttsProvider !== 'local'">
              <div class="voice-field">
                <label class="voice-label">API Base (可选)</label>
                <PInput v-model="ttsApiBase" placeholder="留空则使用全局配置" />
              </div>
              <div class="voice-field">
                <label class="voice-label">API Key (可选)</label>
                <PInput v-model="ttsApiKey" type="password" placeholder="留空则使用全局配置" />
              </div>
            </template>
          </div>

          <!-- 试听 -->
          <div class="voice-test">
            <PButton variant="ghost" :loading="isTestPlaying" @click="testTts">
              <PixelIcon :name="isTestPlaying ? 'refresh' : 'mic'" size="xs" />
              {{ isTestPlaying ? '播放中...' : '试听效果' }}
            </PButton>
            <span v-if="testError" class="voice-test-error">{{ testError }}</span>
          </div>
        </template>
      </section>

      <!-- ASR -->
      <section class="voice-section">
        <div class="voice-section-header">
          <div class="voice-section-left">
            <div :class="['voice-icon', asrEnabled ? 'voice-icon-green' : 'voice-icon-muted']">
              <PixelIcon name="mic" size="sm" />
            </div>
            <div>
              <h3 class="voice-section-title">语音识别 ASR</h3>
              <p class="voice-section-desc">用语音与 Pero 对话</p>
            </div>
          </div>
          <PSwitch v-model="asrEnabled" />
        </div>

        <template v-if="asrEnabled">
          <div class="voice-grid">
            <div class="voice-field">
              <label class="voice-label">识别语言</label>
              <PSelect v-model="asrLanguage" :options="asrLanguageOptions" />
            </div>
            <div class="voice-field">
              <label class="voice-label">唤醒词</label>
              <PInput v-model="wakeWord" placeholder="例如: 佩洛" />
              <p class="voice-hint">说出唤醒词后开始语音输入</p>
            </div>
            <div class="voice-field voice-field-full">
              <label class="voice-label">灵敏度 ({{ (asrSensitivity * 100).toFixed(0) }}%)</label>
              <PSlider v-model="asrSensitivity" :min="0.1" :max="1.0" :step="0.05" />
            </div>
          </div>
        </template>

        <div v-if="!asrEnabled" class="voice-disabled-hint">
          <p>语音识别已关闭。开启后可以用声音与 Pero 对话喵~</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tab-voice {
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

.voice-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.voice-scroll::-webkit-scrollbar {
  width: 4px;
}
.voice-scroll::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.voice-section {
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  padding: 24px;
}
.voice-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.voice-section-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.voice-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}
.voice-icon-blue {
  background: var(--color-sky-500);
}
.voice-icon-green {
  background: var(--color-emerald-face, #22c55e);
}
.voice-icon-muted {
  background: var(--color-text-muted);
}
.voice-section-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.voice-section-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.voice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.voice-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.voice-field-full {
  grid-column: 1 / -1;
}
.voice-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-text-muted);
}
.voice-hint {
  font-size: 10px;
  color: var(--color-text-muted);
  font-style: italic;
}

.voice-test {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.voice-disabled-hint {
  padding: 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
}
</style>
