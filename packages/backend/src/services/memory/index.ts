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
export { ConversationLogService, type SavePairResult } from './conversationLog'
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
