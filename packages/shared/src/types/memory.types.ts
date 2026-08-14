/**
 * 记忆系统类型定义
 *
 * @module packages/shared/src/types/memory.types
 */

/** 记忆类型枚举 */
export type MemoryType =
  | 'event' // 事件型记忆
  | 'fact' // 事实型记忆
  | 'preference' // 偏好型记忆
  | 'promise' // 承诺型记忆
  | 'reflection' // 反思型记忆
  | 'summary' // 总结型记忆

/** 记忆来源 (从哪个场景/渠道产生) */
export type MemorySource =
  | 'desktop' // 桌面端日常对话
  | 'work' // 工作模式（隔离会话）
  | 'social' // 所有外部平台社交接入
  | 'group' // infOS 内部据点多 Agent 群聊
  | 'group_chat' // 旧内部据点名称兼容
  | 'mobile' // 移动端
  | 'scheduler' // 定时任务触发（记忆秘书等）

/** 情感极性 */
export type Sentiment =
  | 'happy'
  | 'sad'
  | 'neutral'
  | 'angry'
  | 'surprised'
  | 'fearful'
  | 'disgusted'

/** 记忆节点数据传输对象 */
export interface MemoryDto {
  id: number
  content: string
  tags: string
  clusters: string | null
  importance: number
  baseImportance: number
  accessCount: number
  lastAccessed: string
  sentiment: string
  timestamp: number
  realTime: string
  source: MemorySource
  type: MemoryType
  agentId: string
}

/** 创建记忆请求 */
export interface CreateMemoryDto {
  content: string
  agentId: string
  tags?: string
  importance?: number
  source?: MemorySource
  type?: MemoryType
  sentiment?: Sentiment
}
