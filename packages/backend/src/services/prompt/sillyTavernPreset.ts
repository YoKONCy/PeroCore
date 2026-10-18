import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ST_MARKER_BINDINGS,
  ST_MARKERS,
  PROMPT_GENERATION_TYPES,
  ST_UTILITY_FIELDS,
} from '@infos/shared'
import type {
  PromptBlock,
  PromptFramework,
  PromptIssue,
  SillyTavernImport,
  StUtilityKey,
} from '@infos/shared'

const promptSchema = z
  .object({
    identifier: z.string().min(1).max(300),
    name: z.string().max(300).optional(),
    role: z.enum(['system', 'user', 'assistant']).optional(),
    content: z.string().max(200_000).optional(),
    marker: z.boolean().optional(),
    enabled: z.boolean().optional(),
    forbid_overrides: z.boolean().optional(),
    injection_position: z.number().int().min(0).max(1).optional(),
    injection_depth: z.number().int().min(0).max(10_000).optional(),
    injection_order: z.number().int().min(-100_000).max(100_000).optional(),
    injection_trigger: z.array(z.string().min(1).max(50)).max(10).optional(),
  })
  .passthrough()
const orderSchema = z
  .object({
    character_id: z.union([z.string(), z.number()]).optional(),
    order: z
      .array(z.object({ identifier: z.string(), enabled: z.boolean().optional() }).passthrough())
      .max(500),
  })
  .passthrough()
const presetSchema = z
  .object({
    prompts: z.array(promptSchema).min(1).max(500),
    prompt_order: z.array(orderSchema).max(100).optional(),
  })
  .passthrough()

/** 导入只生成可审阅草稿；原始字段保留，不修改模型连接、凭据或权限。 */
export function importSillyTavernPreset(
  raw: unknown,
  name = '酒馆预设',
  profile?: number,
): SillyTavernImport {
  let input = raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('prompts' in raw)) {
    const old = raw as Record<string, unknown>
    if (
      ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt'].some((key) => typeof old[key] === 'string')
    ) {
      input = {
        ...old,
        prompts: [
          { identifier: 'main', name: '主提示词', role: 'system', content: old.main_prompt ?? '' },
          {
            identifier: 'nsfw',
            name: '辅助提示词',
            role: 'system',
            content: old.nsfw_prompt ?? '',
          },
          { identifier: 'chatHistory', name: '对话历史', marker: true },
          {
            identifier: 'jailbreak',
            name: '历史后指令',
            role: 'system',
            content: old.jailbreak_prompt ?? '',
          },
        ],
      }
    }
  }
  const parsed = presetSchema.safeParse(input)
  if (!parsed.success)
    throw new Error(
      '不是有效的 SillyTavern Chat Completion 预设；暂不支持 Text Completion 指令模板',
    )
  const preset = parsed.data
  if (JSON.stringify(preset).length > 4_000_000) throw new Error('酒馆预设不能超过 4 MB')
  const byId = new Map(preset.prompts.map((prompt) => [prompt.identifier, prompt]))
  if (byId.size !== preset.prompts.length) throw new Error('酒馆预设存在重复的提示词标识')
  if (
    preset.prompts.some((prompt) =>
      ['__proto__', 'constructor', 'prototype'].includes(prompt.identifier),
    )
  )
    throw new Error('酒馆提示词标识包含保留名称')
  const profiles = preset.prompt_order ?? []
  const selected =
    profile ??
    Math.max(
      0,
      profiles.findIndex((item) => Number(item.character_id) === 100001),
    )
  if (profiles.length && !profiles[selected]) throw new Error('所选排序方案不存在')
  const order =
    profiles[selected]?.order ??
    preset.prompts.map((prompt) => ({
      identifier: prompt.identifier,
      enabled: prompt.enabled ?? true,
    }))
  if (new Set(order.map((item) => item.identifier)).size !== order.length)
    throw new Error('排序方案存在重复条目')
  const issues: PromptIssue[] = []
  const missing = order.filter((item) => !byId.has(item.identifier))
  if (missing.length)
    throw new Error(`排序引用的提示词不存在：${missing.map((item) => item.identifier).join('、')}`)
  const frameworkId = `custom.st.${randomUUID()}`
  const listed = new Set(order.map((item) => item.identifier))
  const entries = [
    ...order,
    ...preset.prompts
      .filter((prompt) => !listed.has(prompt.identifier))
      .map((prompt) => ({ identifier: prompt.identifier, enabled: false })),
  ]
  const blocks: PromptBlock[] = entries.flatMap((entry, index) => {
    const prompt = byId.get(entry.identifier)
    if (!prompt) return []
    const unknown = (prompt.injection_trigger ?? []).filter(
      (trigger) => !PROMPT_GENERATION_TYPES.some((item) => item.value === trigger),
    )
    if (unknown.length)
      issues.push({
        level: entry.enabled === false ? 'warning' : 'error',
        source: prompt.identifier,
        message: `暂不支持生成触发类型：${unknown.join('、')}`,
      })
    if ((prompt.name?.length ?? 0) > 100)
      issues.push({
        level: 'warning',
        source: prompt.identifier,
        message: '显示名称已缩短；原始名称保存在源预设中',
      })
    const markerName = ST_MARKERS.find((item) => item.value === prompt.identifier)?.label
    return [
      {
        id: `${frameworkId}.${index}`,
        name: (markerName ?? prompt.name ?? prompt.identifier).slice(0, 100),
        kind:
          prompt.identifier === 'chatHistory' ? 'history' : prompt.marker ? 'marker' : 'template',
        role: prompt.role ?? 'system',
        enabled: entry.enabled ?? true,
        template: prompt.content ?? '',
        marker: prompt.marker ? prompt.identifier : undefined,
        position: prompt.injection_position === 1 ? 'in_chat' : 'relative',
        depth: prompt.injection_depth ?? 4,
        order: prompt.injection_order ?? 100,
        triggers: prompt.injection_trigger ?? [],
        stIdentifier: prompt.identifier,
        forbidOverrides: prompt.forbid_overrides ?? false,
      },
    ]
  })
  if (preset.extensions && Object.keys(preset.extensions as object).length)
    issues.push({
      level: 'warning',
      source: 'extensions',
      message: '扩展设置仅保留原文，不执行酒馆扩展脚本',
    })
  const utility: Partial<Record<StUtilityKey, string>> = {}
  for (const field of ST_UTILITY_FIELDS) {
    const value = preset[field.value]
    if (typeof value === 'string') {
      if (value.length > 200_000) throw new Error(`${field.label}超过 200K 字符`)
      utility[field.value] = value
    }
  }
  if (
    Object.keys(preset).some(
      (key) =>
        ![
          'prompts',
          'prompt_order',
          'extensions',
          ...ST_UTILITY_FIELDS.map((field) => field.value),
        ].includes(key),
    )
  )
    issues.push({
      level: 'warning',
      source: 'preset',
      message: '采样、连接及其他原预设字段仅保留，模型配置不随导入改变',
    })
  // 正文由可编辑条目保存，源预设只保存元数据，避免大预设重复占用配置容量。
  const sourcePreset = structuredClone({
    ...preset,
    prompts: preset.prompts.map(({ content: _content, ...metadata }) => metadata),
  })
  return {
    framework: {
      id: frameworkId,
      name:
        name
          .replace(/\.json$/i, '')
          .trim()
          .slice(0, 100) || '酒馆预设',
      format: 'sillytavern',
      builtin: false,
      bindings: [],
      blocks,
      sillyTavern: {
        markerBindings: { ...ST_MARKER_BINDINGS },
        values: {},
        sourcePreset,
        orderProfile: selected,
        utility,
        characters: {},
      },
    },
    issues,
    orderProfiles: profiles.map((item, value) => ({
      value,
      label: `排序方案 ${value + 1}${item.character_id === undefined ? '' : ` · ${item.character_id}`}`,
    })),
  }
}

/** 当前可视编排回写到酒馆 JSON，未知字段与其他排序方案一并保留。 */
export function exportSillyTavernPreset(framework: PromptFramework): Record<string, unknown> {
  const original = structuredClone(framework.sillyTavern?.sourcePreset ?? {})
  const records = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item)),
        )
      : []
  const oldPrompts = records(original.prompts)
  const prompts = framework.blocks.map((block) => {
    const old = oldPrompts.find((prompt) => prompt.identifier === block.stIdentifier) ?? {}
    const identifier = block.stIdentifier ?? block.marker ?? block.id
    const oldName = typeof old.name === 'string' ? old.name : undefined
    const displayName = (
      ST_MARKERS.find((item) => item.value === identifier)?.label ??
      oldName ??
      identifier
    ).slice(0, 100)
    return {
      ...old,
      identifier,
      name: oldName && block.name === displayName ? oldName : block.name,
      role: block.role,
      content: block.template ?? '',
      marker: block.kind !== 'template',
      system_prompt:
        typeof old.system_prompt === 'boolean'
          ? old.system_prompt
          : block.kind !== 'template' ||
            ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(identifier),
      injection_position: block.position === 'in_chat' ? 1 : 0,
      injection_depth: block.depth ?? 4,
      injection_order: block.order ?? 100,
      injection_trigger: block.triggers ?? [],
      forbid_overrides: block.forbidOverrides ?? old.forbid_overrides === true,
    }
  })
  const profiles = records(original.prompt_order)
  const index = Math.min(framework.sillyTavern?.orderProfile ?? 0, profiles.length)
  const oldOrder = records(profiles[index]?.order)
  const order = framework.blocks.map((block, blockIndex) => ({
    ...oldOrder.find((entry) => entry.identifier === prompts[blockIndex]!.identifier),
    identifier: prompts[blockIndex]!.identifier,
    enabled: block.enabled,
  }))
  if (!profiles.length) profiles.push({ character_id: 100001, order })
  else if (index === profiles.length) profiles.push({ character_id: 100001, order })
  else profiles[index] = { ...profiles[index], order }
  const identifiers = new Set(prompts.map((prompt) => prompt.identifier))
  for (const item of profiles)
    if (Array.isArray(item.order))
      item.order = item.order.filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          identifiers.has((entry as { identifier: string }).identifier),
      )
  return { ...original, ...framework.sillyTavern?.utility, prompts, prompt_order: profiles }
}
