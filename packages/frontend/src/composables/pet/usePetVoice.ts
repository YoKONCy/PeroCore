/**
 * usePetVoice — 桌宠语音交互 composable
 *
 * 管理 VAD (语音活动检测) + PTT (按键说话) + 音频采集编码。
 * usePetVoice.ts (VAD + PTT + 音频编码 + Gateway 交互)。
 *
 * 架构：
 * - 麦克风采集 → MediaRecorder (opus) → ArrayBuffer → Gateway.sendStream()
 * - VAD 模式：持续监听，检测到语音时自动录制
 * - PTT 模式：按住空格录制
 *
 * @see 06_FILE_SIZE_LIMITS.md — composable 拆分规范
 * @module packages/frontend/src/composables/pet/usePetVoice
 */

import { ref, onUnmounted } from 'vue'
import { logger } from '../../lib/logger'

/** 语音输入模式 */
export type VoiceInputMode = 'vad' | 'ptt' | 'off'

/** VAD 配置 */
export interface VadOptions {
  /** 静音阈值 (0~1)，低于此值视为静音 */
  silenceThreshold?: number
  /** 连续静音多久后停止录制 (ms) */
  silenceTimeoutMs?: number
}

const DEFAULT_VAD: Required<VadOptions> = {
  silenceThreshold: 0.015,
  silenceTimeoutMs: 1000, // 对齐 v1: 1000ms 静音超时
}

/**
 * 桌宠语音交互 composable
 *
 * @param sendStreamFn - Gateway.sendStream 的引用
 * @param isSpeakingRef - TTS 播放状态 ref，为 true 时忽略录音输入（
 */
export function usePetVoice(
  sendStreamFn: (data: ArrayBuffer) => void,
  isSpeakingRef?: { readonly value: boolean },
) {
  const mode = ref<VoiceInputMode>('off')
  const isRecording = ref(false)
  const isListening = ref(false)
  const audioLevel = ref(0)

  let mediaStream: MediaStream | null = null
  let mediaRecorder: MediaRecorder | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let vadTimer: ReturnType<typeof setTimeout> | null = null
  let levelRafId: number | null = null

  // ═══ 麦克风管理 ═══

  /** 获取麦克风权限并创建音频流 */
  async function acquireMicrophone(): Promise<boolean> {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // 创建 AudioContext 用于 VAD 音量检测
      audioContext = new AudioContext({ sampleRate: 16000 })
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      const source = audioContext.createMediaStreamSource(mediaStream)
      source.connect(analyser)

      return true
    } catch (e) {
      logger.error('PetVoice', '麦克风权限获取失败', e)
      return false
    }
  }

  /** 释放麦克风资源 */
  function releaseMicrophone(): void {
    stopRecording()
    cancelLevelMonitor()

    mediaStream?.getTracks().forEach((t) => t.stop())
    mediaStream = null

    void audioContext?.close()
    audioContext = null
    analyser = null
  }

  // ═══ 录制 ═══

  /** 开始录制 */
  function startRecording(): void {
    if (!mediaStream || isRecording.value) return
    // isSpeaking 互斥：TTS 播放时忽略新的录音（
    if (isSpeakingRef?.value) return

    const chunks: Blob[] = []
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: getSupportedMimeType(),
    })

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data)
      }
    }

    mediaRecorder.onstop = async () => {
      isRecording.value = false
      if (chunks.length === 0) return

      // 合并 chunks 为 ArrayBuffer → 发送到 Gateway
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType })
      const buffer = await blob.arrayBuffer()

      if (buffer.byteLength > 0) {
        sendStreamFn(buffer)
        logger.info('PetVoice', `音频已发送 (${(buffer.byteLength / 1024).toFixed(1)}KB)`)
      }
    }

    mediaRecorder.start(250) // 每 250ms 一个 chunk
    isRecording.value = true
  }

  /** 停止录制 */
  function stopRecording(): void {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop()
    }
    mediaRecorder = null
  }

  // ═══ VAD (语音活动检测) ═══

  /** 启动 VAD 监听 */
  function startVadListening(options?: VadOptions): void {
    const { silenceThreshold, silenceTimeoutMs } = { ...DEFAULT_VAD, ...options }

    if (!analyser) return
    isListening.value = true

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    let silenceStart: number | null = null

    function checkLevel() {
      if (!analyser || !isListening.value) return

      analyser.getByteTimeDomainData(dataArray)

      // 计算 RMS 音量
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const val = dataArray[i] ?? 128
        const normalized = (val - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / dataArray.length)
      audioLevel.value = rms

      if (rms > silenceThreshold) {
        // 检测到语音
        silenceStart = null
        if (!isRecording.value) {
          startRecording()
        }
      } else if (isRecording.value) {
        // 静音中
        if (!silenceStart) {
          silenceStart = Date.now()
        } else if (Date.now() - silenceStart > silenceTimeoutMs) {
          // 静音超时 → 停止录制
          stopRecording()
          silenceStart = null
        }
      }

      levelRafId = requestAnimationFrame(checkLevel)
    }

    levelRafId = requestAnimationFrame(checkLevel)
  }

  /** 停止 VAD 监听 */
  function stopVadListening(): void {
    isListening.value = false
    cancelLevelMonitor()
    stopRecording()
  }

  function cancelLevelMonitor(): void {
    if (levelRafId !== null) {
      cancelAnimationFrame(levelRafId)
      levelRafId = null
    }
    if (vadTimer) {
      clearTimeout(vadTimer)
      vadTimer = null
    }
    audioLevel.value = 0
  }

  // ═══ 模式切换 ═══

  /** 切换语音输入模式 */
  async function setMode(newMode: VoiceInputMode): Promise<void> {
    // 清理当前模式
    if (mode.value === 'vad') stopVadListening()
    if (mode.value !== 'off') releaseMicrophone()

    mode.value = newMode

    if (newMode === 'off') return

    // 获取麦克风
    const ok = await acquireMicrophone()
    if (!ok) {
      mode.value = 'off'
      return
    }

    // VAD 模式自动开始监听
    if (newMode === 'vad') {
      startVadListening()
    }
  }

  // ═══ PTT (按键说话) ═══

  /** PTT 按下 */
  function pttDown(): void {
    if (mode.value !== 'ptt' || !mediaStream) return
    // isSpeaking 互斥（ L634）
    if (isSpeakingRef?.value) return
    startRecording()
  }

  /** PTT 松开 */
  function pttUp(): void {
    if (mode.value !== 'ptt') return
    stopRecording()
  }

  // ═══ 工具 ═══

  /** 获取浏览器支持的音频 MIME 类型 */
  function getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return 'audio/webm' // fallback
  }

  // ═══ 清理 ═══

  onUnmounted(() => {
    releaseMicrophone()
  })

  return {
    /** 当前模式 */
    mode,
    /** 是否正在录制 */
    isRecording,
    /** VAD 是否正在监听 */
    isListening,
    /** 实时音量 (0~1) */
    audioLevel,
    /** 切换模式 */
    setMode,
    /** PTT 按下 */
    pttDown,
    /** PTT 松开 */
    pttUp,
  }
}
