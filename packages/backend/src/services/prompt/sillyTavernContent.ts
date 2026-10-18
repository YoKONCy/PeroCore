import { ST_UTILITY_FIELDS } from '@infos/shared'
import type {
  PromptBlock,
  PromptFramework,
  PromptRole,
  StCharacterPrompt,
  StUtilityKey,
} from '@infos/shared'

export function stForbidOverrides(framework: PromptFramework, block: PromptBlock): boolean {
  if (block.forbidOverrides !== undefined) return block.forbidOverrides
  const source = framework.sillyTavern?.sourcePreset?.prompts
  const original = Array.isArray(source)
    ? source.find(
        (item) =>
          item && typeof item === 'object' && item.identifier === (block.stIdentifier ?? block.id),
      )
    : undefined
  return original?.forbid_overrides === true
}

export function stUtility(framework: PromptFramework): Partial<Record<StUtilityKey, string>> {
  const result: Partial<Record<StUtilityKey, string>> = {}
  for (const field of ST_UTILITY_FIELDS) {
    const value =
      framework.sillyTavern?.utility?.[field.value] ??
      framework.sillyTavern?.sourcePreset?.[field.value]
    if (typeof value === 'string') result[field.value] = value
  }
  return result
}
export function stCharacter(framework: PromptFramework, agentId: string): StCharacterPrompt {
  const profiles = framework.sillyTavern?.characters ?? {}
  return {
    ...(Object.hasOwn(profiles, '') ? profiles[''] : {}),
    ...(Object.hasOwn(profiles, agentId) ? profiles[agentId] : {}),
  }
}

/** 示例正文只替换名字占位，不执行来自角色资料的宏或变量写入。 */
export function parseStExamples(
  source: string,
  user: string,
  character: string,
): Array<Array<{ role: PromptRole; content: string }>> {
  const normalize = (value: string) => value.trim().toLowerCase()
  const users = new Set([user, '{{user}}', '<USER>', 'user', 'example_user', '用户'].map(normalize))
  const assistants = new Set(
    [
      character,
      '{{char}}',
      '<CHAR>',
      '<BOT>',
      'assistant',
      'example_assistant',
      'char',
      '角色',
    ].map(normalize),
  )
  users.delete('')
  assistants.delete('')
  const replaceNames = (value: string) =>
    value.replace(
      /\{\{\s*(user|char)\s*\}\}|<(USER|CHAR|BOT)>/gi,
      (_whole, macro: string | undefined, tag: string | undefined) =>
        (macro ?? tag ?? '').toLowerCase() === 'user' ? user : character,
    )
  const groups: Array<Array<{ role: PromptRole; content: string }>> = []
  for (const text of source
    .split(/<START>/gi)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const messages: Array<{ role: PromptRole; content: string }> = []
    let recognized = false
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^:\r\n：]{1,120})[:：][\t ]*(.*)$/.exec(line)
      const sender = match ? normalize(match[1]!) : ''
      const role = users.has(sender) ? 'user' : assistants.has(sender) ? 'assistant' : undefined
      if (role && match) {
        recognized = true
        messages.push({ role, content: match[2]! })
      } else if (messages.length) messages.at(-1)!.content += `\n${line}`
      else messages.push({ role: 'system', content: line })
    }
    if (!recognized) return []
    groups.push(
      messages
        .map((message) => ({ role: message.role, content: replaceNames(message.content).trim() }))
        .filter((message) => message.content),
    )
  }
  return groups
}
