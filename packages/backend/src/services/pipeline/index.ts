/**
 * Pipeline 模块导出
 *
 * @module packages/backend/src/services/pipeline
 */

export type {
  ChatRequest,
  ChatMessage,
  MultimodalContent,
  IngressResult,
  Enricher,
  EnrichmentInput,
  EnrichedContext,
  AssembledPrompt,
  ToolDefinition,
  EgressInput,
  EgressResult,
  ToolCallRecord,
} from './types'

export { runIngress, convertSocialToChat, shouldReplyInGroup } from './ingress'
export { runEgress, EgressService } from './egress'
export {
  runSynthesis,
  runSynthesisStream,
  type SseEvent,
  type SynthesisResult,
  type SynthesisDeps,
  type SynthesisInput,
} from './synthesis'

// Enrichers
export { runEnrichment, HistoryEnricher, MemoryEnricher, StateEnricher } from './enrichers'

