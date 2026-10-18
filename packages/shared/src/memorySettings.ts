/** 两个开关彼此独立，关闭时保留已有记忆和索引。 */
export const MEMORY_BACKGROUND_ENABLED_KEY = 'memory.background.enabled'
export const EMBEDDING_ENABLED_KEY = 'embedding.enabled'

/** 宿主向后台记忆任务提供的只读执行门控。 */
export interface MemoryBackgroundPolicy {
  readonly enabled: boolean
  readonly signal: AbortSignal
}
