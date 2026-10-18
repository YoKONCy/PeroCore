<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ST_MARKERS,
  ST_MARKER_BINDINGS,
  PROMPT_GENERATION_TYPES,
  ST_UTILITY_FIELDS,
} from '@infos/shared'
import type {
  PromptBlock,
  PromptFramework,
  PromptGenerationType,
  PromptRole,
  StUtilityKey,
  StCharacterPrompt,
} from '@infos/shared'
import { PButton, PInput, PSelect, PSwitch } from '../../pixel'
import SillyTavernVariablePanel from './SillyTavernVariablePanel.vue'

const props = withDefaults(
  defineProps<{
    variables: Array<{ name: string; label: string }>
    agents?: Array<{ label: string; value: string }>
  }>(),
  { agents: () => [] },
)
const emit = defineEmits<{ add: []; move: [from: number, to: number] }>()
const framework = defineModel<PromptFramework>('framework', { required: true })
const dragging = ref(-1),
  variableName = ref('')
const characterId = ref('')
const characterOptions = computed(() => [
  { value: '', label: '通用设置' },
  ...props.agents.filter((agent) => agent.value),
])
const character = computed(() => framework.value.sillyTavern?.characters?.[characterId.value] ?? {})
const characterFields: Array<{ value: keyof StCharacterPrompt; label: string }> = [
  { value: 'description', label: '角色描述' },
  { value: 'personality', label: '性格' },
  { value: 'scenario', label: '场景' },
  { value: 'examples', label: '示例对话' },
  { value: 'firstMessage', label: '开场白' },
  { value: 'creatorNotes', label: '创作者备注' },
  { value: 'version', label: '角色版本' },
  { value: 'authorsNote', label: '作者注释' },
]
const roleOptions = [
  { value: 'system', label: '系统消息' },
  { value: 'user', label: '用户消息' },
  { value: 'assistant', label: '助手消息' },
]
const kinds = [
  { value: 'template', label: '提示词' },
  { value: 'history', label: '聊天历史' },
  { value: 'marker', label: '数据标记' },
]
const positions = [
  { value: 'relative', label: '列表位置' },
  { value: 'in_chat', label: '历史内插入' },
]
const markers = computed(() => [
  ...ST_MARKERS.map((item) => ({ label: item.label, value: item.value })),
  ...framework.value.blocks
    .filter(
      (block) =>
        block.kind === 'marker' &&
        block.marker &&
        !ST_MARKERS.some((marker) => marker.value === block.marker),
    )
    .map((block) => ({ label: block.name, value: block.marker! })),
])
const bindings = computed(() => [
  { value: '', label: '留空' },
  { value: '$text', label: '手动填写' },
  ...props.variables
    .filter((variable) => !['native_history', 'current_message'].includes(variable.name))
    .map((variable) => ({ value: variable.name, label: variable.label })),
])
const customValues = computed(() =>
  Object.entries(framework.value.sillyTavern?.values ?? {}).filter(
    ([key]) => !markers.value.some((marker) => marker.value === key),
  ),
)
const sampling = computed(() =>
  Object.entries(framework.value.sillyTavern?.sourcePreset ?? {}).filter(
    ([key, value]) =>
      [
        'temperature',
        'top_p',
        'top_k',
        'min_p',
        'frequency_penalty',
        'presence_penalty',
        'openai_max_tokens',
        'openai_max_context',
      ].includes(key) && typeof value === 'number',
  ),
)
const unknownTriggers = (block: PromptBlock) =>
  (block.triggers ?? []).filter(
    (value) => !PROMPT_GENERATION_TYPES.some((type) => type.value === value),
  )
function forbidValue(block: PromptBlock): boolean {
  if (block.forbidOverrides !== undefined) return block.forbidOverrides
  const source = framework.value.sillyTavern?.sourcePreset?.prompts
  const original = Array.isArray(source)
    ? source.find(
        (item) =>
          item && typeof item === 'object' && item.identifier === (block.stIdentifier ?? block.id),
      )
    : undefined
  return original?.forbid_overrides === true
}
function config() {
  return (framework.value.sillyTavern ??= { markerBindings: { ...ST_MARKER_BINDINGS }, values: {} })
}
function utilityValue(key: StUtilityKey): string {
  const cfg = config()
  return (
    cfg.utility?.[key] ??
    (typeof cfg.sourcePreset?.[key] === 'string' ? (cfg.sourcePreset[key] as string) : '')
  )
}
function setUtility(key: StUtilityKey, value: string) {
  ;(config().utility ??= {})[key] = value
}
function setCharacter(key: keyof StCharacterPrompt, value: string) {
  const profiles = (config().characters ??= {})
  if (!Object.hasOwn(profiles, characterId.value)) profiles[characterId.value] = {}
  if (value) profiles[characterId.value]![key] = value
  else delete profiles[characterId.value]![key]
}
function setKind(block: PromptBlock, kind: string) {
  block.kind = kind as PromptBlock['kind']
  if (kind === 'history') {
    block.position = 'relative'
    block.stIdentifier = 'chatHistory'
  } else if (kind === 'marker') {
    block.marker ??= 'charDescription'
    block.stIdentifier = block.marker
  } else {
    block.marker = undefined
    block.stIdentifier = block.id
  }
}
function setMarker(block: PromptBlock, marker: string) {
  block.marker = marker
  block.stIdentifier = marker
}
function toggleTrigger(block: PromptBlock, type: PromptGenerationType) {
  block.triggers = block.triggers?.includes(type)
    ? block.triggers.filter((item) => item !== type)
    : [...(block.triggers ?? []), type]
}
function addVariable() {
  const name = variableName.value.trim()
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
    name.startsWith('__') ||
    ['constructor', 'prototype', 'component'].includes(name)
  )
    return
  config().values[name] ??= ''
  variableName.value = ''
}
</script>

<template>
  <div class="st-editor">
    <details class="bindings-panel">
      <summary>辅助提示词</summary>
      <details v-for="field in ST_UTILITY_FIELDS" :key="field.value" class="st-utility-field">
        <summary>
          {{ field.label }}
          <small v-if="utilityValue(field.value)" class="muted-text">已配置</small>
        </summary>
        <textarea
          :value="utilityValue(field.value)"
          class="code-editor compact-editor"
          :aria-label="field.label"
          spellcheck="false"
          @input="setUtility(field.value, ($event.target as HTMLTextAreaElement).value)"
        />
      </details>
    </details>
    <details class="bindings-panel">
      <summary>角色覆盖</summary>
      <PSelect v-model="characterId" :options="characterOptions" size="sm" teleport />
      <div class="st-character-fields">
        <label class="field">
          主提示词
          <textarea
            :value="character.main ?? ''"
            class="code-editor compact-editor"
            placeholder="留空继承；可使用 {{original}}"
            spellcheck="false"
            @input="setCharacter('main', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <label class="field">
          历史后指令
          <textarea
            :value="character.postHistory ?? ''"
            class="code-editor compact-editor"
            placeholder="留空继承；可使用 {{original}}"
            spellcheck="false"
            @input="setCharacter('postHistory', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>
      <details class="st-utility-field">
        <summary>角色资料</summary>
        <div class="st-character-fields">
          <label v-for="field in characterFields" :key="field.value" class="field">
            {{ field.label }}
            <textarea
              :value="character[field.value] ?? ''"
              class="code-editor compact-editor"
              :aria-label="field.label"
              :placeholder="
                field.value === 'examples'
                  ? '<START>\n{{user}}: 你好\n{{char}}: 你好！'
                  : '留空继承'
              "
              @input="setCharacter(field.value, ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
        </div>
      </details>
    </details>
    <SillyTavernVariablePanel :agents="agents" />
    <details class="bindings-panel">
      <summary>数据映射</summary>
      <div v-for="marker in markers" :key="marker.value" class="st-mapping-row">
        <label>{{ marker.label }}</label>
        <PSelect
          :model-value="
            framework.sillyTavern?.markerBindings[marker.value] ??
            ST_MARKER_BINDINGS[marker.value] ??
            ''
          "
          :options="bindings"
          size="sm"
          teleport
          @update:model-value="config().markerBindings[marker.value] = String($event)"
        />
        <textarea
          v-if="framework.sillyTavern?.markerBindings[marker.value] === '$text'"
          :value="framework.sillyTavern?.values[marker.value] ?? ''"
          class="code-editor compact-editor"
          :aria-label="marker.label"
          placeholder="填写文本"
          @input="config().values[marker.value] = ($event.target as HTMLTextAreaElement).value"
        />
      </div>
    </details>
    <details class="bindings-panel">
      <summary>
        固定宏值
        <small>{{ customValues.length }}</small>
      </summary>
      <div v-for="[name, value] in customValues" :key="name" class="st-variable-row">
        <code v-text="`{{${name}}}`" />
        <PInput
          :model-value="value"
          size="sm"
          @update:model-value="config().values[name] = $event"
        />
        <button class="icon-button" aria-label="删除变量" @click="delete config().values[name]">
          ×
        </button>
      </div>
      <div class="row">
        <PInput
          v-model="variableName"
          placeholder="变量名"
          size="sm"
          @keydown.enter.prevent="addVariable"
        />
        <PButton variant="ghost" size="sm" @click="addVariable">＋ 变量</PButton>
      </div>
    </details>
    <TransitionGroup name="blocks" tag="div" class="blocks-list">
      <article
        v-for="(block, index) in framework.blocks"
        :key="block.id"
        class="prompt-block"
        :class="{ muted: !block.enabled }"
        @dragover.prevent
        @drop.prevent="
          () => {
            emit('move', dragging, index)
            dragging = -1
          }
        "
      >
        <header class="block-header">
          <button
            class="drag-handle"
            draggable="true"
            aria-label="拖动排序"
            @dragstart="
              ($event) => {
                dragging = index
                $event.dataTransfer?.setData('text/plain', block.id)
              }
            "
            @dragend="dragging = -1"
          >
            ⠿
          </button>
          <span class="block-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <PInput v-model="block.name" size="sm" />
          <PSwitch v-model="block.enabled" />
          <button
            class="icon-button"
            :disabled="index === 0"
            aria-label="上移"
            @click="emit('move', index, index - 1)"
          >
            ↑
          </button>
          <button
            class="icon-button"
            :disabled="index === framework.blocks.length - 1"
            aria-label="下移"
            @click="emit('move', index, index + 1)"
          >
            ↓
          </button>
          <button
            class="icon-button"
            aria-label="删除条目"
            @click="framework.blocks.splice(index, 1)"
          >
            ×
          </button>
        </header>
        <div class="st-block-fields">
          <PSelect
            :model-value="block.kind"
            :options="kinds"
            size="sm"
            teleport
            @update:model-value="setKind(block, String($event))"
          />
          <PSelect
            v-if="block.kind !== 'history'"
            :model-value="block.role"
            :options="roleOptions"
            size="sm"
            teleport
            @update:model-value="block.role = $event as PromptRole"
          />
          <PSelect
            v-if="block.kind !== 'history'"
            :model-value="block.position ?? 'relative'"
            :options="positions"
            size="sm"
            teleport
            @update:model-value="block.position = $event as 'relative' | 'in_chat'"
          />
        </div>
        <div
          v-if="block.position === 'in_chat' && block.kind !== 'history'"
          class="st-position-fields"
        >
          <label class="field">
            深度
            <input
              v-model.number="block.depth"
              class="st-number"
              type="number"
              min="0"
              max="10000"
            />
          </label>
          <label class="field">
            顺序
            <input
              v-model.number="block.order"
              class="st-number"
              type="number"
              min="-100000"
              max="100000"
            />
          </label>
        </div>
        <textarea
          v-if="block.kind === 'template'"
          v-model="block.template"
          class="code-editor compact-editor"
          spellcheck="false"
          aria-label="酒馆宏正文"
          placeholder="填写提示词，可使用酒馆宏"
        />
        <label
          v-if="['main', 'jailbreak'].includes(block.stIdentifier ?? block.id)"
          class="history-toggle"
        >
          <PSwitch
            :model-value="forbidValue(block)"
            @update:model-value="block.forbidOverrides = $event"
          />
          禁止角色覆盖
        </label>
        <PSelect
          v-else-if="block.kind === 'marker'"
          :model-value="block.marker ?? 'charDescription'"
          :options="markers"
          size="sm"
          teleport
          @update:model-value="setMarker(block, String($event))"
        />
        <details class="st-triggers">
          <summary>
            触发
            <small>
              {{
                block.triggers?.length
                  ? block.triggers
                      .map(
                        (type) =>
                          PROMPT_GENERATION_TYPES.find((item) => item.value === type)?.label ??
                          type,
                      )
                      .join('、')
                  : '全部'
              }}
            </small>
          </summary>
          <div class="st-trigger-options">
            <button
              v-for="type in PROMPT_GENERATION_TYPES"
              :key="type.value"
              :class="{ active: block.triggers?.includes(type.value) }"
              :aria-pressed="Boolean(block.triggers?.includes(type.value))"
              @click="toggleTrigger(block, type.value)"
            >
              {{ type.label }}
            </button>
            <button
              v-for="type in unknownTriggers(block)"
              :key="type"
              class="error"
              :aria-label="`移除未知触发类型 ${type}`"
              @click="block.triggers = block.triggers?.filter((value) => value !== type)"
            >
              {{ type }} ×
            </button>
          </div>
        </details>
      </article>
    </TransitionGroup>
    <PButton variant="secondary" size="sm" @click="emit('add')">＋ 条目</PButton>
    <details v-if="sampling.length" class="bindings-panel">
      <summary>原预设参数</summary>
      <dl class="st-sampling">
        <div v-for="[key, value] in sampling" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <small class="muted-text">仅保留原预设参数</small>
    </details>
    <details class="tutorial">
      <summary>酒馆格式教程</summary>
      <p>
        列表位置按条目顺序编排。历史内插入的深度 0 在最新消息后，深度 1
        在最新消息前；深度包含本次用户消息，同一位置的顺序数越小越靠前。
      </p>
      <p>
        支持 if / else
        条件块、块式宏、变量简写和持久变量。聊天变量按会话隔离，全局变量跨角色与会话共享；真实回合成功后提交，预览只模拟。预览的示例
        JSON 可用 local_variables / global_variables 提供变量初值。
      </p>
      <p>
        “角色覆盖”可使用 original
        引用原提示词；条目勾选“禁止角色覆盖”后保留原正文。角色资料中的示例对话使用 START 分组和 user
        / char 说话人标记，解析为独立消息。辅助提示词随框架发布，持久变量清空立即生效。
      </p>
      <p>
        历史和数据替换结果不会再次执行宏。扩展脚本、世界书激活仍未接入。历史中的系统指令按原位置使用带标记的用户消息，预览展示实际发送角色。
      </p>
    </details>
  </div>
</template>

<style scoped src="./promptManagement.css"></style>
