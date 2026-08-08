/**
 * 记忆核心域导出
 *
 * @module packages/backend/src/services/memory
 */

export { MemoryService } from './memoryService'
export {
  MemorySearchService,
  type MemorySearchResult,
  type SearchParams,
  type AdvancedSearchParams,
} from './memorySearch'
// AIOS: ConversationLogService 已移除（废弃，Scorer 改用 ThreadRepository）
export { ScorerService, type ScorerConfig, type ScorerOutput } from './scorerService'
export { DiaryEngine, type DiaryEntry, type DiaryInput } from './diaryEngine'
export { MemoryImporter, type ImportRequest, type ImportResult } from './importer'
export {
  MemoryGraphService,
  type GraphData,
  type GraphNode,
  type GraphEdge,
} from './graph/memoryGraph'
export {
  ReflectionOrchestrator,
  Tagger,
  Consolidator,
  Auditor,
  RetirementPolicy,
  DreamAssociator,
  GraphGardener,
  type ReflectionResult,
} from './maintenance'
// 第五阶段长记忆：Provider / Gate / TaskRunner
export {
  type MemoryProvider,
  type MemoryProvenance,
  type MemoryType,
  type MemoryStatus,
  type CanonicalMemory,
  type MemoryCandidate,
  type MemorySearchResultItem,
  type MemorySearchParams,
  type AddMemoryInput,
  type GateResult,
  type GateDecision,
} from './memoryProvider'
export { MemoryGate } from './memoryGate'
export { LocalMemoryProvider } from './localMemoryProvider'
export {
  type MemoryTaskRunner,
  type MemoryTaskType,
  type MemoryTaskStatus,
  type MemoryTaskResult,
} from './memoryTaskRunner'
export { LocalMemoryTaskRunner } from './localMemoryTaskRunner'
