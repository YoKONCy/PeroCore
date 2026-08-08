/**
 * Pipeline 模块导出
 *
 * AIOS: 旧版 5 阶段管道（Ingress → Enrichment → Synthesis → Egress）已由
 * ContextCompiler + ThreadService 替代，相关文件已备份为 .bak。
 * 废弃 Phase 类型（ChatRequest/IngressResult/Enricher/EnrichedContext/
 * AssembledPrompt/EgressInput/EgressResult）已从 types.ts 移除。
 *
 * 仅保留并导出活跃模块引用的核心类型。
 *
 * @module packages/backend/src/services/pipeline
 */

export type {
  ChatMessage,
  MultimodalContent,
  ToolDefinition,
  ToolCallRecord,
} from './types'
