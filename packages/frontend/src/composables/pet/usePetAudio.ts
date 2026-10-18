import { ref, onUnmounted, watch } from 'vue'
import { useWindowVisibility } from '../main/useWindowVisibility'
import { createAvatarFrameLoop } from '../../components/avatar/lib/avatarPerformance'

/** 只播放定向 Audio Asset；取消会覆盖下载、解码与播放三个阶段。 */
export function usePetAudio() {
  const windowVisible = useWindowVisibility()
  const isPlaying = ref(false)
  const currentId = ref<string | null>(null)
  const mouthOpen = ref(0)
  const progress = ref(0)
  let context: AudioContext | undefined
  let source: AudioBufferSourceNode | undefined
  let request: AbortController | undefined
  let sequence = 0
  let playbackLoop: ReturnType<typeof createAvatarFrameLoop> | undefined
  let rejectPlayback: ((error: Error) => void) | undefined

  function stopAll(playbackId?: string) {
    if (playbackId && currentId.value !== playbackId) return
    sequence++
    request?.abort()
    request = undefined
    rejectPlayback?.(new Error('播放已取消'))
    rejectPlayback = undefined
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* 已结束的音频无需重复停止。 */
      }
      source.disconnect()
      source = undefined
    }
    playbackLoop?.stop()
    playbackLoop = undefined
    currentId.value = null
    isPlaying.value = false
    mouthOpen.value = 0
    progress.value = 0
  }

  async function playAsset(playbackId: string, assetUrl: string, volume = 1): Promise<void> {
    stopAll()
    const active = sequence
    currentId.value = playbackId
    const controller = new AbortController()
    request = controller
    try {
      context ??= new AudioContext()
      await context.resume()
      const response = await fetch(assetUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('语音音频读取失败')
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (active !== sequence) throw new Error('播放已取消')
      const ctx = context
      const node = ctx.createBufferSource()
      source = node
      node.buffer = buffer
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      const gain = ctx.createGain()
      gain.gain.value = Math.min(1, Math.max(0, volume))
      node.connect(analyser)
      analyser.connect(gain)
      gain.connect(ctx.destination)
      const started = ctx.currentTime
      const data = new Uint8Array(analyser.frequencyBinCount)
      const loop = createAvatarFrameLoop(
        () => {
          if (active !== sequence) return
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let index = 2; index < 32; index++) sum += data[index] ?? 0
          mouthOpen.value = Math.round(Math.min(1, (sum / 30 / 255) * 3) * 4) / 4
          progress.value = Math.min(
            1,
            (ctx.currentTime - started) / Math.max(buffer.duration, 0.01),
          )
        },
        () => 30,
      )
      playbackLoop = loop
      isPlaying.value = true
      if (windowVisible.value) loop.start()
      try {
        await new Promise<void>((resolve, reject) => {
          rejectPlayback = reject
          node.onended = () => resolve()
          node.start()
        })
      } finally {
        loop.stop()
        node.disconnect()
        analyser.disconnect()
        gain.disconnect()
      }
    } finally {
      if (active === sequence) {
        playbackLoop?.stop()
        playbackLoop = undefined
        rejectPlayback = undefined
        source = undefined
        request = undefined
        currentId.value = null
        isPlaying.value = false
        mouthOpen.value = 0
        progress.value = 0
      }
    }
  }
  watch(windowVisible, (visible) => {
    // 隐藏时仅暂停口型和字幕采样，AudioContext 中的语音正常播放。
    if (visible && isPlaying.value) playbackLoop?.start()
    else playbackLoop?.stop()
  })
  onUnmounted(() => {
    stopAll()
    void context?.close()
    context = undefined
  })
  return { isPlaying, currentId, mouthOpen, progress, playAsset, stopAll }
}
