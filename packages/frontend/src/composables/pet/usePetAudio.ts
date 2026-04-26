/**
 * usePetAudio — TTS 音频播放 + 唇同步 composable
 *
 * 管理 TTS 音频的播放、队列、唇同步信号输出。
 * usePetAudio.ts (音频播放 + 唇同步 + 队列)。
 *
 * 架构：
 * - TTS 音频 → HTTP 下载 / Gateway 推送 → AudioBuffer → Web Audio 播放
 * - 唇同步：从音频时域数据计算嘴巴张合度 (mouthOpen 0~1)
 * - 队列：逐条消息按序播放，支持跳过/停止
 *
 * @see 06_FILE_SIZE_LIMITS.md — composable 拆分规范
 * @module packages/frontend/src/composables/pet/usePetAudio
 */

import { ref, onUnmounted } from 'vue'
import { voiceApi } from '../../api/modules/voiceApi'
import { logger } from '../../lib/logger'

/** TTS 播放请求 */
export interface TtsRequest {
  /** 唯一标识 (通常是消息 ID) */
  id: string
  /** 要朗读的文本 */
  text: string
  /** 预先获取的音频 URL (如果后端返回 URL 而非推流) */
  audioUrl?: string
  /** 预先获取的音频 ArrayBuffer */
  audioBuffer?: ArrayBuffer
}

/**
 * TTS 音频播放 composable
 */
export function usePetAudio() {
  /** 当前是否正在播放 */
  const isPlaying = ref(false)
  /** 当前播放的消息 ID */
  const currentId = ref<string | null>(null)
  /** 唇同步张合度 (0~1) */
  const mouthOpen = ref(0)
  /** 播放队列长度 */
  const queueLength = ref(0)

  let audioContext: AudioContext | null = null
  let currentSource: AudioBufferSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let lipSyncRafId: number | null = null
  const queue: TtsRequest[] = []

  // ═══ AudioContext ═══

  function getAudioContext(): AudioContext {
    if (!audioContext) {
      audioContext = new AudioContext()
    }
    return audioContext
  }

  // ═══ 播放 ═══

  /**
   * 将 TTS 请求加入队列
   *
   * 如果当前空闲则立即播放，否则排队。
   */
  function enqueue(request: TtsRequest): void {
    queue.push(request)
    queueLength.value = queue.length

    if (!isPlaying.value) {
      void playNext()
    }
  }

  /** 播放队列中下一个 */
  async function playNext(): Promise<void> {
    if (queue.length === 0) {
      isPlaying.value = false
      currentId.value = null
      queueLength.value = 0
      return
    }

    const item = queue.shift()!
    queueLength.value = queue.length
    isPlaying.value = true
    currentId.value = item.id

    try {
      let buffer: AudioBuffer

      if (item.audioBuffer) {
        // 已有 ArrayBuffer → 直接解码
        buffer = await getAudioContext().decodeAudioData(item.audioBuffer)
      } else if (item.audioUrl) {
        // 从 URL 下载
        const response = await fetch(item.audioUrl)
        const arrayBuffer = await response.arrayBuffer()
        buffer = await getAudioContext().decodeAudioData(arrayBuffer)
      } else {
        // 需要先请求后端 TTS API
        const arrayBuffer = await fetchTtsAudio(item.text)
        if (!arrayBuffer) {
          logger.warn('PetAudio', `TTS 获取失败: ${item.id}`)
          await playNext()
          return
        }
        buffer = await getAudioContext().decodeAudioData(arrayBuffer)
      }

      await playBuffer(buffer)
    } catch (e) {
      logger.error('PetAudio', `播放失败: ${item.id}`, e)
    }

    // 播放完成 → 下一个
    await playNext()
  }

  /** 播放 AudioBuffer */
  function playBuffer(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const ctx = getAudioContext()

      // 创建播放源
      currentSource = ctx.createBufferSource()
      currentSource.buffer = buffer

      // 创建分析器用于唇同步
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256

      currentSource.connect(analyser)
      analyser.connect(ctx.destination)

      // 启动唇同步
      startLipSync()

      currentSource.onended = () => {
        stopLipSync()
        currentSource = null
        resolve()
      }

      currentSource.start()
    })
  }

  // ═══ 唇同步 ═══

  /** 启动唇同步监测 */
  function startLipSync(): void {
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    function updateLipSync() {
      if (!analyser) return

      // 使用频域数据（），而非时域
      analyser.getByteFrequencyData(dataArray)

      // 计算人声频段 (bin 2~32, 约 0~2.7kHz) 的平均音量
      // 对齐 v1: startBin=2 跳过极低频, endBin=32
      let sum = 0
      const startBin = 2
      const endBin = 32
      for (let i = startBin; i < endBin; i++) {
        sum += dataArray[i] ?? 0
      }
      const average = sum / (endBin - startBin)

      // 归一化 (0~255 → 0~1) 并应用增益 (对齐 v1: *3.0)
      const raw = Math.min(1.0, (average / 255) * 3.0)
      // 量化为 4 级 (0, 0.25, 0.5, 0.75, 1) — 像素风步进效果
      mouthOpen.value = Math.round(raw * 4) / 4

      lipSyncRafId = requestAnimationFrame(updateLipSync)
    }

    lipSyncRafId = requestAnimationFrame(updateLipSync)
  }

  /** 停止唇同步 */
  function stopLipSync(): void {
    if (lipSyncRafId !== null) {
      cancelAnimationFrame(lipSyncRafId)
      lipSyncRafId = null
    }
    mouthOpen.value = 0
    analyser = null
  }

  /**
   * 从后端获取 TTS 音频
   *
   * 委托给 voiceApi.synthesize()，避免直接 fetch 绕过 Transport 层。
   */
  async function fetchTtsAudio(text: string): Promise<ArrayBuffer | null> {
    try {
      return await voiceApi.synthesize({ text })
    } catch (e) {
      logger.error('PetAudio', 'TTS 请求失败', e)
      return null
    }
  }

  // ═══ 控制 ═══

  /** 跳过当前正在播放的音频 */
  function skip(): void {
    if (currentSource) {
      currentSource.stop()
      currentSource = null
    }
  }

  /** 停止播放并清空队列 */
  function stopAll(): void {
    skip()
    queue.length = 0
    queueLength.value = 0
    isPlaying.value = false
    currentId.value = null
  }

  /**
   * 从 Gateway 推送接收音频 chunk (实时 TTS 流)
   *
   * 支持多种格式（ processAudioQueue）:
   * - ArrayBuffer
   * - Uint8Array
   * - string
   */
  async function receiveAudioChunk(data: ArrayBuffer | Uint8Array | string): Promise<void> {
    try {
      let arrayBuffer: ArrayBuffer

      if (typeof data === 'string') {
        // Base64 解码（对齐 v1: L904-912）
        const binaryString = window.atob(data)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        arrayBuffer = bytes.buffer
      } else if (data instanceof Uint8Array) {
        // Uint8Array → ArrayBuffer
        arrayBuffer = new Uint8Array(data).buffer
      } else {
        // ArrayBuffer
        arrayBuffer = data.slice(0)
      }

      const buffer = await getAudioContext().decodeAudioData(arrayBuffer)
      await playBuffer(buffer)
    } catch {
      // 音频解码失败静默处理
    }
  }

  // ═══ 清理 ═══

  onUnmounted(() => {
    stopAll()
    stopLipSync()
    void audioContext?.close()
    audioContext = null
  })

  return {
    /** 是否正在播放 */
    isPlaying,
    /** 当前播放的消息 ID */
    currentId,
    /** 唇同步张合度 (0~1, 量化为 4 级) */
    mouthOpen,
    /** 队列长度 */
    queueLength,
    /** 加入播放队列 */
    enqueue,
    /** 跳过当前 */
    skip,
    /** 停止并清空 */
    stopAll,
    /** 接收 Gateway 推送的音频 chunk */
    receiveAudioChunk,
  }
}
