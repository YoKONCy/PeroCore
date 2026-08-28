import { z } from 'zod'
import type { ConfigRepository } from '../../repositories/config.repo'

/** 主 Agent 记忆运行配置的唯一 KV 键。 */
export const MEMORY_RUNTIME_CONFIG_KEY = 'memory.runtime'

const channelConfigSchema = z.object({
  /** 发送给模型的最近完整对话轮次数。 */
  contextPairs: z.number().int().min(1).max(100),
  /** 是否在该通道自动注入 EventNote RAG。 */
  enableAutoRag: z.boolean(),
  /** 自动 RAG 的相关事件召回数量，不包含固定补充项。 */
  retrievalLimit: z.number().int().min(1).max(30),
})

const advancedConfigSchema = z.object({
  /** 自动 RAG 使用 TriviumDB 认知管线和 SA-PPR，主动查询仍使用确定性 BFS。 */
  enableSaPpr: z.boolean(),
  expandDepth: z.number().int().min(1).max(6),
  teleportAlpha: z.number().min(0).max(1),
  minScore: z.number().min(-1).max(1),
  enableFista: z.boolean(),
  enableDpp: z.boolean(),
  enableContextRnn: z.boolean(),
  enableLeiden: z.boolean(),
  enableFeedback: z.boolean(),
})

/** 总览页可管理的主 Agent 记忆运行配置。Social 应用配置不属于此合同。 */
export const memoryRuntimeConfigSchema = z
  .object({
    channels: z.object({
      desktop: channelConfigSchema,
      group: channelConfigSchema,
    }),
    advanced: advancedConfigSchema,
    workContextExpirationPairs: z.number().int().min(1).max(50),
  })
  .transform((config) =>
    config.advanced.enableSaPpr
      ? config
      : {
          ...config,
          advanced: {
            ...config.advanced,
            enableFista: false,
            enableDpp: false,
            enableContextRnn: false,
            enableLeiden: false,
            enableFeedback: false,
          },
        },
  )

export type MemoryRuntimeConfig = z.infer<typeof memoryRuntimeConfigSchema>

/** 同时遵守 Thread Policy 与通道级自动 RAG 开关。 */
export function shouldRunAutoRag(
  policyEnabled: boolean,
  channelConfig: MemoryRuntimeConfig['channels'][keyof MemoryRuntimeConfig['channels']] | undefined,
): boolean {
  return policyEnabled && channelConfig?.enableAutoRag !== false
}

export const DEFAULT_MEMORY_RUNTIME_CONFIG: MemoryRuntimeConfig = {
  channels: {
    desktop: { contextPairs: 20, enableAutoRag: true, retrievalLimit: 8 },
    group: { contextPairs: 20, enableAutoRag: true, retrievalLimit: 3 },
  },
  advanced: {
    enableSaPpr: false,
    expandDepth: 2,
    teleportAlpha: 0.15,
    minScore: 0.1,
    enableFista: false,
    enableDpp: false,
    enableContextRnn: false,
    enableLeiden: false,
    enableFeedback: false,
  },
  workContextExpirationPairs: 5,
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
    if (values.enableAutoRag === undefined) {
      values.enableAutoRag = values.retrievalLimit !== 0
    }
    if (values.retrievalLimit === 0) {
      values.retrievalLimit =
        DEFAULT_MEMORY_RUNTIME_CONFIG.channels[
          channelName as keyof MemoryRuntimeConfig['channels']
        ].retrievalLimit
    }
    delete values.contextMessages
  }
  delete root.scorerBatchSize
  delete root.retrievalMinScore
  const advanced =
    root.advanced && typeof root.advanced === 'object'
      ? (root.advanced as Record<string, unknown>)
      : {}
  root.advanced = {
    ...structuredClone(DEFAULT_MEMORY_RUNTIME_CONFIG.advanced),
    ...advanced,
  }
  if (root.workContextExpirationPairs === undefined) root.workContextExpirationPairs = 5
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
