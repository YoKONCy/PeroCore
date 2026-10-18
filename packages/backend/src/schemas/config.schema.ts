/**
 * 配置 API 请求校验
 *
 * @module packages/backend/src/schemas/config.schema
 */

import { z } from 'zod'
import { EMBEDDING_ENABLED_KEY, MEMORY_BACKGROUND_ENABLED_KEY } from '@infos/shared'

/** 获取配置 */
export const getConfigSchema = z.object({
  key: z.string().min(1),
})

/** 设置配置 */
export const setConfigSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
  })
  .refine(
    ({ key, value }) =>
      ![EMBEDDING_ENABLED_KEY, MEMORY_BACKGROUND_ENABLED_KEY].includes(key) ||
      value === 'true' ||
      value === 'false',
    { message: '开关配置必须为 true 或 false' },
  )

/** 批量获取配置 */
export const batchGetConfigSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(50),
})
