/**
 * 记忆 API 请求校验
 *
 * @module packages/backend/src/schemas/memory.schema
 */

import { z } from 'zod'

/** 有效的记忆来源：social 为外部平台；group/group_chat 为内部据点（后者兼容旧名称） */
const memorySources = ['desktop', 'social', 'group', 'group_chat', 'mobile', 'scheduler'] as const

/** 有效的记忆类型 */
const memoryTypes = ['event', 'fact', 'preference', 'promise', 'reflection', 'summary'] as const

/** 创建记忆 */
export const createMemorySchema = z.object({
  content: z.string().min(1, '记忆内容不能为空').max(10000),
  agentId: z.string().min(1).default('pero'),
  tags: z.string().optional(),
  importance: z.number().int().min(1).max(10).optional(),
  source: z.enum(memorySources).optional().default('desktop'),
  type: z.enum(memoryTypes).optional().default('event'),
  sentiment: z.string().optional(),
})

/** 列表查询参数 */
export const listMemorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  agentId: z.string().optional(),
  source: z.enum(memorySources).optional(),
  type: z.enum(memoryTypes).optional(),
})

/** 语义搜索 */
export const searchMemorySchema = z.object({
  query: z.string().min(1, '搜索词不能为空'),
  agentId: z.string().min(1).default('pero'),
  source: z.enum(memorySources).optional().default('desktop'),
  topK: z.number().int().min(1).max(50).optional().default(10),
  minScore: z.number().min(0).max(1).optional(),
})
