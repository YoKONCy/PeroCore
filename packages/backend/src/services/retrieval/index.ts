/**
 * PEDSA 认知检索引擎桶导出
 *
 * @module packages/backend/src/services/retrieval
 */

export { ContextRnn, type ContextRnnConfig } from './contextRnn'
export { ClusterRouter, type ClusterRouterConfig, type ActiveCluster } from './clusterRouter'
export {
  contextAwareRerank,
  diversityFilter,
  type RetrievalCandidate,
  type RankedCandidate,
  type RerankConfig,
} from './dpDiversity'
export {
  RetrievalFeedback,
  type FeedbackSignal,
  type FeedbackConfig,
  type InjectedMemory,
} from './retrievalFeedback'
export {
  ContextualRetriever,
  type ContextualRetrieverDeps,
  type CognitiveSearchRequest,
  type CognitiveSearchResult,
} from './contextualRetriever'
