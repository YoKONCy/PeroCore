/**
 * Voice 模块 — TTS + ASR + 语音编排服务导出
 *
 * @module packages/backend/src/services/voice
 */

export { TtsService } from './ttsService'
export type { TtsRequest, TtsResult, TtsConfig } from './ttsService'

export { AsrService } from './asrService'
export type { AsrRequest, AsrResult, AsrConfig } from './asrService'

export { RealtimeSessionManager, cleanTextForTts } from './realtimeSessionManager'
export type {
  VoiceSessionConfig,
  VoicePipelineResult,
  RealtimeSessionDeps,
} from './realtimeSessionManager'
