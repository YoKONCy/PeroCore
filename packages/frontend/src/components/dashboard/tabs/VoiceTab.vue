<script setup lang="ts">
/**
 * VoiceTab — 语音功能 Tab (F1-4)
 *
 * TTS (语音合成) + ASR (语音识别) 配置面板。
 * F3: 已对接 configApi 读写。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton, PCard } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { voiceApi } from '../../../api/modules/voiceApi'
import { modelApi } from '../../../api/modules/modelApi'
import { useDashboardContext } from '../../../composables/dashboard'

const ctx = useDashboardContext()

// ── TTS 配置 (对齐后端 ttsService 默认值) ──
const ttsEnabled = ref(true)
const ttsProvider = ref('edge_tts')
const ttsVoice = ref('zh-CN-XiaoyiNeural')
const ttsSpeed = ref(1.0)
const ttsPitch = ref(1.0)
const ttsRate = ref('+25%') // Edge TTS 语速格式
const ttsEdgePitch = ref('+5Hz') // Edge TTS 音调格式
const ttsApiBase = ref('')
const ttsApiKey = ref('')

const ttsProviderOptions = [
  { label: 'Edge TTS (免费，推荐)', value: 'edge_tts' },
  { label: 'OpenAI TTS', value: 'openai' },
  { label: 'Azure Speech', value: 'azure' },
  { label: '本地 (Piper) — 待实现', value: 'local', disabled: true },
]

// Edge TTS 常用中文音色
const edgeVoiceOptions = [
  { label: '晓伊 (活泼女声，默认)', value: 'zh-CN-XiaoyiNeural' },
  { label: '晓晓 (自然女声)', value: 'zh-CN-XiaoxiaoNeural' },
  { label: '晓萱 (温柔女声)', value: 'zh-CN-XiaoxuanNeural' },
  { label: '晓墨 (甜美女声)', value: 'zh-CN-XiaomoNeural' },
  { label: '晓辰 (活力女声)', value: 'zh-CN-XiaochenNeural' },
  { label: '晓涵 (沉稳女声)', value: 'zh-CN-XiaohanNeural' },
  { label: '云溪 (男声)', value: 'zh-CN-YunxiNeural' },
  { label: '云健 (男声)', value: 'zh-CN-YunjianNeural' },
]

// OpenAI TTS 音色
const openaiVoiceOptions = [
  { label: 'Shimmer (自然女声)', value: 'shimmer' },
  { label: 'Nova (活泼女声)', value: 'nova' },
  { label: 'Alloy (中性)', value: 'alloy' },
  { label: 'Echo (男声)', value: 'echo' },
  { label: 'Fable (英式男声)', value: 'fable' },
  { label: 'Onyx (深沉男声)', value: 'onyx' },
]

// 根据当前 Provider 动态显示对应的音色列表
const ttsVoiceOptions = computed(() => {
  return ttsProvider.value === 'openai' ? openaiVoiceOptions : edgeVoiceOptions
})

// ── ASR 配置 (OpenAI 兼容接口，模型无关) ──
const asrEnabled = ref(false)
const asrApiBase = ref('')
const asrApiKey = ref('')
const asrModel = ref('')
const asrLanguage = ref('zh-CN')
const wakeWord = ref('佩洛')
const asrSensitivity = ref(0.7)

/** ASR 获取远程模型列表 */
const isFetchingAsrModels = ref(false)
const remoteAsrModels = ref<string[]>([])

async function fetchRemoteAsrModels() {
  if (!asrApiBase.value && !asrApiKey.value) return
  isFetchingAsrModels.value = true
  try {
    const res = await modelApi.listRemote({
      provider: 'openai',
      apiKey: asrApiKey.value,
      apiBase: asrApiBase.value || undefined,
    })
    remoteAsrModels.value = res.data ?? []
  } catch {
    remoteAsrModels.value = []
  } finally {
    isFetchingAsrModels.value = false
  }
}

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
      'tts.rate',
      'tts.edgePitch',
      'tts.apiBase',
      'tts.apiKey',
      'asr.enabled',
      'asr.apiBase',
      'asr.apiKey',
      'asr.model',
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
    if (d['tts.rate']) ttsRate.value = d['tts.rate'] as string
    if (d['tts.edgePitch']) ttsEdgePitch.value = d['tts.edgePitch'] as string
    if (d['asr.enabled'] !== undefined) asrEnabled.value = d['asr.enabled'] === 'true'
    if (d['asr.apiBase']) asrApiBase.value = d['asr.apiBase'] as string
    if (d['asr.apiKey']) asrApiKey.value = d['asr.apiKey'] as string
    if (d['asr.model']) asrModel.value = d['asr.model'] as string
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
watch(ttsRate, (v) => debouncedSave('tts.rate', v))
watch(ttsEdgePitch, (v) => debouncedSave('tts.edgePitch', v))
watch(asrEnabled, (v) => debouncedSave('asr.enabled', String(v)))
watch(asrApiBase, (v) => debouncedSave('asr.apiBase', v))
watch(asrApiKey, (v) => debouncedSave('asr.apiKey', v))
watch(asrModel, (v) => debouncedSave('asr.model', v))
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

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => loadVoiceConfig(),
)

onMounted(loadVoiceConfig)
</script>

<template>
  <div class="p-8 h-full flex flex-col overflow-hidden">
    <div class="mb-6 flex-shrink-0 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-purple-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-purple-400/15 transition-all duration-1000"
      />
      <h2 class="flex items-center gap-3 text-2xl font-black text-slate-800 font-pixel">
        <span
          class="group-hover/header:scale-110 group-hover/header:rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="mic" size="md" />
        </span>
        <span>语音功能</span>
        <span class="opacity-0 group-hover/header:opacity-100 transition-opacity duration-500">
          <PixelIcon name="sparkle" size="xs" />
        </span>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        VOICE CONFIGURATION
      </p>
    </div>

    <div class="flex-1 overflow-y-auto flex flex-col gap-6 voice-scrollbar">
      <!-- TTS -->
      <PCard pixel padding="lg" overflow-visible>
        <div class="flex justify-between items-center mb-5">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 flex items-center justify-center bg-sky-500 text-white flex-shrink-0"
            >
              <PixelIcon name="mic" size="sm" />
            </div>
            <div>
              <h3 class="text-base font-black text-slate-800 font-pixel">语音合成 TTS</h3>
              <p class="text-xs text-slate-400 mt-0.5">让 Pero 用声音回复你</p>
            </div>
          </div>
          <PSwitch v-model="ttsEnabled" />
        </div>

        <template v-if="ttsEnabled">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                Provider
              </label>
              <PSelect v-model="ttsProvider" :options="ttsProviderOptions" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                声音
              </label>
              <PSelect v-model="ttsVoice" :options="ttsVoiceOptions" />
            </div>
            <!-- Edge TTS 特有参数 -->
            <template v-if="ttsProvider === 'edge_tts'">
              <div class="flex flex-col gap-1.5">
                <label
                  class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
                >
                  语速 Rate
                </label>
                <PInput v-model="ttsRate" placeholder="+25%" />
                <span class="text-[10px] text-slate-400">如 +25%, -10%, +0%</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <label
                  class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
                >
                  音调 Pitch
                </label>
                <PInput v-model="ttsEdgePitch" placeholder="+5Hz" />
                <span class="text-[10px] text-slate-400">如 +5Hz, -2Hz, +0Hz</span>
              </div>
            </template>

            <!-- OpenAI TTS 特有参数 -->
            <template v-if="ttsProvider === 'openai'">
              <div class="flex flex-col gap-1.5">
                <label
                  class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
                >
                  语速 ({{ ttsSpeed.toFixed(1) }}x)
                </label>
                <PSlider v-model="ttsSpeed" :min="0.5" :max="2.0" :step="0.1" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label
                  class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
                >
                  API Base
                </label>
                <PInput v-model="ttsApiBase" placeholder="留空则使用全局配置" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label
                  class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
                >
                  API Key
                </label>
                <PInput v-model="ttsApiKey" type="password" placeholder="留空则使用全局配置" />
              </div>
            </template>
          </div>

          <!-- 试听 -->
          <div class="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
            <PButton variant="ghost" :loading="isTestPlaying" @click="testTts">
              <PixelIcon :name="isTestPlaying ? 'refresh' : 'mic'" size="xs" />
              {{ isTestPlaying ? '播放中...' : '试听效果' }}
            </PButton>
            <span v-if="testError" class="text-xs text-rose-500">{{ testError }}</span>
          </div>
        </template>
      </PCard>

      <!-- ASR -->
      <PCard pixel padding="lg" overflow-visible>
        <div class="flex justify-between items-center mb-5">
          <div class="flex items-center gap-4">
            <div
              :class="[
                'w-12 h-12 flex items-center justify-center text-white flex-shrink-0',
                asrEnabled ? 'bg-emerald-500' : 'bg-slate-400',
              ]"
            >
              <PixelIcon name="mic" size="sm" />
            </div>
            <div>
              <h3 class="text-base font-black text-slate-800 font-pixel">语音识别 ASR</h3>
              <p class="text-xs text-slate-400 mt-0.5">用语音与 Pero 对话</p>
            </div>
          </div>
          <PSwitch v-model="asrEnabled" />
        </div>

        <template v-if="asrEnabled">
          <div class="grid grid-cols-2 gap-4">
            <!-- API Base -->
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Base
              </label>
              <PInput v-model="asrApiBase" placeholder="https://api.siliconflow.cn/v1" />
              <p class="text-[10px] text-slate-400 italic">
                * 任何兼容 /audio/transcriptions 的接口均可
              </p>
            </div>
            <!-- API Key -->
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                API Key
              </label>
              <PInput v-model="asrApiKey" type="password" placeholder="sk-..." />
            </div>
            <!-- 模型 + 获取列表 -->
            <div class="flex flex-col gap-1.5 col-span-2">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel flex items-center justify-between"
              >
                模型
                <PButton
                  variant="ghost"
                  size="sm"
                  :loading="isFetchingAsrModels"
                  @click="fetchRemoteAsrModels"
                >
                  <PixelIcon name="refresh" size="xs" />
                  获取模型列表
                </PButton>
              </label>
              <PSelect
                v-if="remoteAsrModels.length > 0"
                v-model="asrModel"
                :options="remoteAsrModels.map((m) => ({ label: m, value: m }))"
                placeholder="从列表中选择..."
              />
              <PInput v-else v-model="asrModel" placeholder="例如: FunAudioLLM/SenseVoiceSmall" />
            </div>
            <!-- 识别语言 -->
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                识别语言
              </label>
              <PSelect v-model="asrLanguage" :options="asrLanguageOptions" />
            </div>
            <!-- 唤醒词 -->
            <div class="flex flex-col gap-1.5">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                唤醒词
              </label>
              <PInput v-model="wakeWord" placeholder="例如: 佩洛" />
              <p class="text-[10px] text-slate-400 italic">说出唤醒词后开始语音输入</p>
            </div>
            <!-- 灵敏度 -->
            <div class="flex flex-col gap-1.5 col-span-2">
              <label
                class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-pixel"
              >
                灵敏度 ({{ (asrSensitivity * 100).toFixed(0) }}%)
              </label>
              <PSlider v-model="asrSensitivity" :min="0.1" :max="1.0" :step="0.05" />
            </div>
          </div>
        </template>

        <div
          v-if="!asrEnabled"
          class="p-4 bg-slate-50 border border-slate-200 text-center text-[13px] text-slate-400"
        >
          <p>语音识别已关闭。开启后可以用声音与 Pero 对话喵~</p>
        </div>
      </PCard>
    </div>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.voice-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.voice-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
