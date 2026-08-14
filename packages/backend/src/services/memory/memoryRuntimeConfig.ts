import { z } from 'zod'
import type { ConfigRepository } from '../../repositories/config.repo'

/** 主 Agent 记忆运行配置的唯一 KV 键。 */
export const MEMORY_RUNTIME_CONFIG_KEY = 'memory.runtime'

const channelConfigSchema = z.object({
  /** 发送给模型的最近完整对话轮次数。 */
  contextPairs: z.number().int().min(1).max(100),
  retrievalLimit: z.number().int().min(0).max(30),
})

/** 总览页可管理的主 Agent 记忆运行配置。Social 应用配置不属于此合同。 */
export const memoryRuntimeConfigSchema = z.object({
  channels: z.object({
    desktop: channelConfigSchema,
    group: channelConfigSchema,
  }),
  scorerBatchSize: z.union([z.literal(4), z.literal(8), z.literal(16)]),
  retrievalMinScore: z.union([z.literal(0.2), z.literal(0.3), z.literal(0.45)]),
})

export type MemoryRuntimeConfig = z.infer<typeof memoryRuntimeConfigSchema>

export const DEFAULT_MEMORY_RUNTIME_CONFIG: MemoryRuntimeConfig = {
  channels: {
    desktop: { contextPairs: 20, retrievalLimit: 8 },
    group: { contextPairs: 20, retrievalLimit: 3 },
  },
  scorerBatchSize: 8,
  retrievalMinScore: 0.3,
}

/** 将旧版消息条数合同迁移为对话轮次合同；数值保持不变，尊重用户此前填写的窗口规模。 */
function migrateLegacyConfig(stored: unknown): unknown {
  if (!stored || typeof stored !== 'object') return stored
  const root = structuredClone(stored) as Record<string, unknown>
  if (!root.channels || typeof root.channels !== 'object') return root
  const channels = root.channels as Record<string, unknown>
  delete channels.companion
  for (const channelName of ['desktop', 'group']) {
    const channel = channels[channelName]
    if (!channel || typeof channel !== 'object') continue
    const values = channel as Record<string, unknown>
    if (values.contextPairs === undefined && typeof values.contextMessages === 'number') {
      values.contextPairs = values.contextMessages
    }
    delete values.contextMessages
  }
  return root
}

/** 从 ConfigRepository 读取并校验配置；缺失或损坏时返回安全默认值。 */
export async function loadMemoryRuntimeConfig(
  configRepo: Pick<ConfigRepository, 'get'>,
): Promise<MemoryRuntimeConfig> {
  const raw = await configRepo.get(MEMORY_RUNTIME_CONFIG_KEY)
  let stored: unknown
  if (raw) {
    try {
      stored = JSON.parse(raw)
    } catch {
      stored = undefined
    }
  }
  const parsed = memoryRuntimeConfigSchema.safeParse(migrateLegacyConfig(stored))
  return parsed.success ? parsed.data : structuredClone(DEFAULT_MEMORY_RUNTIME_CONFIG)
}
