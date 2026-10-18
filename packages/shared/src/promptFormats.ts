import type { PromptFormat, PromptFramework } from './types/promptWorkspace.types'

export const PROMPT_FORMATS: Array<{ value: PromptFormat; label: string; description: string }> = [
  { value: 'infos', label: 'infOS 原生格式', description: '内置槽位与组件编排' },
  { value: 'sillytavern', label: 'SillyTavern 格式', description: '酒馆预设、宏与历史插入' },
  { value: 'custom', label: '自定义框架', description: '完整正文或自由消息编排' },
]
export function promptFormat(framework: Pick<PromptFramework, 'format' | 'builtin'>): PromptFormat {
  return framework.format ?? (framework.builtin ? 'infos' : 'custom')
}
export const ST_MARKERS = [
  { value: 'charDescription', label: '角色描述', variable: 'persona_definition' },
  { value: 'charPersonality', label: '角色性格', variable: '' },
  { value: 'scenario', label: '场景', variable: '' },
  { value: 'personaDescription', label: '用户设定', variable: 'user_persona' },
  { value: 'dialogueExamples', label: '示例对话', variable: '' },
  { value: 'worldInfoBefore', label: '世界信息（前）', variable: '' },
  { value: 'worldInfoAfter', label: '世界信息（后）', variable: '' },
]
export const ST_MARKER_BINDINGS = Object.fromEntries(
  ST_MARKERS.map((marker) => [marker.value, marker.variable]),
)
export const PROMPT_GENERATION_TYPES = [
  { value: 'normal', label: '普通对话' },
  { value: 'continue', label: '续写' },
  { value: 'impersonate', label: '代写用户' },
  { value: 'swipe', label: '切换回复' },
  { value: 'regenerate', label: '重新生成' },
  { value: 'quiet', label: '后台生成' },
] as const
export const ST_UTILITY_FIELDS = [
  { value: 'new_chat_prompt', label: '新聊天' },
  { value: 'new_group_chat_prompt', label: '新群聊' },
  { value: 'new_example_chat_prompt', label: '示例分隔' },
  { value: 'group_nudge_prompt', label: '群聊点名' },
  { value: 'continue_nudge_prompt', label: '续写提示' },
  { value: 'impersonation_prompt', label: '用户代写提示' },
  { value: 'send_if_empty', label: '空消息替代' },
  { value: 'scenario_format', label: '场景格式' },
  { value: 'personality_format', label: '性格格式' },
] as const
