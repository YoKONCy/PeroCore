<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { PromptRole, PromptFormat, PromptFramework } from '@infos/shared'
import { PROMPT_FORMATS, PROMPT_GENERATION_TYPES, promptFormat } from '@infos/shared'
import { PButton, PInput, PSelect, PSwitch, PDialog, PixelIcon } from '../../pixel'
import {
  usePromptWorkspace,
  type PromptSection,
} from '../../../composables/dashboard/usePromptWorkspace'
import { useAgentStore } from '../../../stores/useAgentStore'
import { useNotificationStore } from '../../../stores/useNotificationStore'
import SillyTavernFrameworkEditor from './SillyTavernFrameworkEditor.vue'

const store = useAgentStore()
const notifications = useNotificationStore()
const {
  view,
  bundle,
  busy,
  error,
  section,
  search,
  formatFilter,
  setFormatFilter,
  stImport,
  stImportOpen,
  reloadStImport,
  commitStImport,
  exportStPreset,
  selectedId,
  mode,
  source,
  issues,
  preview,
  previewOpen,
  previewAgent,
  previewChannel,
  previewGeneration,
  variablesText,
  scopeAgent,
  scopeChannel,
  versionId,
  historical,
  diffId,
  activeDiff,
  changedEntries,
  pendingDialog,
  dirty,
  framework,
  document,
  resources,
  frameworkOptions,
  sourceOptions,
  currentAssignment,
  setSection,
  select,
  setMode,
  create,
  createIndependent,
  assignSelectedFramework,
  remove,
  reset,
  addBlock,
  moveBlock,
  assignment,
  save,
  validate,
  renderPreview,
  showVersion,
  restoreVersion,
  restoreDefaults,
  exportBundle,
  importBundle,
  load,
} = usePromptWorkspace()
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(-1)
const overrideFrom = ref('')
const overrideTo = ref('')
const frameworkOverrideFrom = ref('')
const frameworkOverrideTo = ref('')
const independentOpen = ref(false)
const activationOpen = ref(false)
const activation = reactive({ agentId: '', channel: '' })
const independent = reactive({
  name: '我的提示词框架',
  body: '',
  history: true,
  format: 'custom' as PromptFormat,
  layout: 'text' as 'text' | 'blocks',
  scope: 'all' as 'all' | 'range' | 'later',
  agentId: '',
  channel: '',
})
const stScope = reactive({ scope: 'later' as 'all' | 'range' | 'later', agentId: '', channel: '' })
const isSt = computed(() =>
  Boolean(framework.value && promptFormat(framework.value) === 'sillytavern'),
)
const formatOptions = [{ value: '', label: '全部格式' }, ...PROMPT_FORMATS]
const generationOptions = PROMPT_GENERATION_TYPES.map((item) => ({ ...item }))
const formatLabel = (item: PromptFramework) =>
  PROMPT_FORMATS.find((format) => format.value === promptFormat(item))?.label ?? '自定义框架'
const layoutOptions = [
  { value: 'text', label: '完整正文' },
  { value: 'blocks', label: '自由编排' },
]
const activationOptions = [
  { value: 'all', label: '全部对话' },
  { value: 'range', label: '指定范围' },
  { value: 'later', label: '稍后指派' },
]
function openIndependent() {
  Object.assign(independent, {
    name: '我的提示词框架',
    body: '',
    history: true,
    format: 'custom',
    layout: 'text',
    scope: 'all',
    agentId: '',
    channel: '',
  })
  independentOpen.value = true
}
function submitIndependent() {
  if (createIndependent(independent)) independentOpen.value = false
}
function openActivation() {
  activation.agentId = scopeAgent.value
  activation.channel = scopeChannel.value
  activationOpen.value = true
}
function submitActivation() {
  if (assignSelectedFramework(activation.agentId, activation.channel)) activationOpen.value = false
}
previewAgent.value = store.activeAgentId
const sections: Array<{ id: PromptSection; label: string; icon: string }> = [
  { id: 'framework', label: '框架', icon: 'settings' },
  { id: 'slot', label: '槽位', icon: 'list' },
  { id: 'component', label: '组件', icon: 'puzzle' },
  { id: 'task', label: '任务', icon: 'terminal' },
  { id: 'assignments', label: '指派', icon: 'users' },
  { id: 'versions', label: '版本', icon: 'clock' },
]
const roleOptions = [
  { value: 'system', label: '系统消息' },
  { value: 'user', label: '用户消息' },
  { value: 'assistant', label: '助手消息' },
]
const kindOptions = [
  { value: 'template', label: '模板' },
  { value: 'history', label: '原生历史' },
]
const bindingKinds = [
  { value: 'template', label: '模板' },
  { value: 'persona', label: '角色人设' },
  { value: 'capabilities', label: '能力片段' },
]
const channelOptions = [
  { value: '', label: '所有频道' },
  { value: 'desktop', label: '主对话' },
  { value: 'group', label: '据点' },
  { value: 'social', label: '社交' },
  { value: 'task', label: '后台任务' },
]
const agentOptions = computed(() => [
  { label: '所有角色', value: '' },
  ...store.agents.map((agent) => ({ label: agent.name, value: agent.id })),
])
const overrideTargets = computed(() =>
  bundle.value.documents
    .filter((d) => d.kind === bundle.value.documents.find((d) => d.id === overrideFrom.value)?.kind)
    .map((d) => ({ label: d.name, value: d.id })),
)
const dependencies = computed(() => [
  ...new Set(
    [...(document.value?.body ?? '').matchAll(/component\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
      (m) => m[1],
    ),
  ),
])
const visibleVariables = computed(() => [
  ...(view.value?.variables ?? []),
  ...(document.value?.variables ?? [])
    .filter((name) => !view.value?.variables.some((v) => v.name === name))
    .map((name) => ({ name, label: name })),
])
const hasBuiltin = computed(() =>
  Boolean(
    view.value?.defaults.documents.some((d) => d.id === selectedId.value) ||
    view.value?.defaults.frameworks.some((f) => f.id === selectedId.value),
  ),
)
const activeVersion = computed(() =>
  view.value?.releases.find((r) => r.id === view.value?.activeReleaseId),
)
function addOverride() {
  if (overrideFrom.value && overrideTo.value)
    assignment().overrides[overrideFrom.value] = overrideTo.value
  overrideFrom.value = ''
  overrideTo.value = ''
}
function scopeLabel(agentId: string, channel: string) {
  return `${store.agents.find((a) => a.id === agentId)?.name ?? (agentId || '全局')} · ${channelOptions.find((c) => c.value === channel)?.label ?? channel}`
}
function onImport(event: Event) {
  const input = event.target as HTMLInputElement
  Object.assign(stScope, { scope: 'later', agentId: '', channel: '' })
  void importBundle(input.files?.[0])
  input.value = ''
}
async function insertVariable(name: string) {
  const value = `{{ ${name} }}`
  try {
    await navigator.clipboard.writeText(value)
    notifications.toast('变量已复制', 'success')
  } catch {
    notifications.toast('无法复制变量', 'error')
  }
}
function setVariables(value: string) {
  if (document.value)
    document.value.variables = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
}
function moveBinding(index: number, offset: number) {
  const bindings = framework.value?.bindings
  if (!bindings || index + offset < 0 || index + offset >= bindings.length) return
  const binding = bindings.splice(index, 1)[0]!
  bindings.splice(index + offset, 0, binding)
}
function addFrameworkOverride() {
  if (!framework.value || !frameworkOverrideFrom.value || !frameworkOverrideTo.value) return
  framework.value.overrides ??= {}
  framework.value.overrides[frameworkOverrideFrom.value] = frameworkOverrideTo.value
  frameworkOverrideFrom.value = ''
  frameworkOverrideTo.value = ''
}
</script>

<template>
  <section class="prompt-page" :aria-busy="busy">
    <header class="prompt-heading">
      <div>
        <h2>
          <PixelIcon name="edit" />
          提示词
          <span class="status-chip" :class="{ changed: dirty }">
            {{ dirty ? '未保存' : '草稿' }}
          </span>
        </h2>
        <span class="eyebrow">PROMPT WORKSPACE</span>
      </div>
      <div class="actions">
        <PButton variant="secondary" size="sm" :disabled="busy || !view" @click="openIndependent">
          ＋ 新建框架
        </PButton>
        <PButton variant="ghost" size="sm" :disabled="busy" @click="fileInput?.click()">
          导入
        </PButton>
        <PButton variant="ghost" size="sm" @click="exportBundle">导出</PButton>
        <PButton variant="ghost" size="sm" :disabled="busy || !view" @click="restoreDefaults">
          内置预设
        </PButton>
        <PButton variant="secondary" size="sm" :disabled="busy" @click="validate">校验</PButton>
        <PButton variant="secondary" size="sm" :disabled="busy || !view" @click="save()">
          保存草稿
        </PButton>
        <PButton size="sm" :disabled="busy || !view" @click="save(true)">发布</PButton>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        hidden
        @change="onImport"
      />
    </header>

    <nav class="section-tabs" aria-label="提示词管理">
      <button
        v-for="tab in sections"
        :key="tab.id"
        :class="{ active: section === tab.id }"
        @click="setSection(tab.id)"
      >
        <PixelIcon :name="tab.icon" size="sm" />
        {{ tab.label }}
      </button>
      <span class="release-label" :title="view?.activeReleaseId">
        已发布 {{ activeVersion ? new Date(activeVersion.createdAt).toLocaleString() : '—' }}
      </span>
    </nav>
    <div v-if="error" class="error-banner" role="alert">
      {{ error }}
      <PButton size="sm" variant="ghost" :disabled="busy" @click="load">重新载入</PButton>
    </div>
    <div v-if="view?.recoveryError" class="error-banner" role="alert">{{ view.recoveryError }}</div>

    <div v-if="view" class="prompt-body" :inert="busy">
      <template v-if="!['assignments', 'versions'].includes(section)">
        <aside class="resource-rail surface">
          <PInput v-model="search" placeholder="搜索名称 / ID" size="sm" />
          <PSelect
            v-if="section === 'framework'"
            :model-value="formatFilter"
            :options="formatOptions"
            class="format-filter"
            size="sm"
            teleport
            @update:model-value="setFormatFilter($event as PromptFormat | '')"
          />
          <div class="rail-actions">
            <PButton
              size="sm"
              variant="secondary"
              @click="section === 'framework' ? openIndependent() : create()"
            >
              ＋ {{ section === 'framework' ? '新建框架' : '新模板' }}
            </PButton>
          </div>
          <div class="resource-list">
            <button
              v-for="item in resources"
              :key="item.id"
              :class="['resource-item', { active: item.id === selectedId }]"
              :title="item.id"
              @click="select(item.id)"
            >
              <span>{{ item.name }}</span>
              <small>
                {{
                  section === 'framework'
                    ? { infos: '原生', sillytavern: '酒馆', custom: '自定义' }[
                        promptFormat(item as PromptFramework)
                      ]
                    : item.builtin
                      ? '内置'
                      : '自定义'
                }}
              </small>
            </button>
            <p v-if="!resources.length" class="empty">暂无条目</p>
          </div>
        </aside>

        <main class="editor surface">
          <template v-if="framework || document">
            <div class="editor-heading">
              <div class="title-input">
                <PInput v-if="framework" v-model="framework.name" />
                <PInput v-else-if="document" v-model="document.name" />
                <code>{{ selectedId }}</code>
              </div>
              <div class="actions">
                <PButton size="sm" variant="ghost" @click="create(true)">复制</PButton>
                <PButton v-if="hasBuiltin" size="sm" variant="ghost" @click="reset">
                  恢复内置
                </PButton>
                <PButton v-else size="sm" variant="danger" @click="remove">删除</PButton>
              </div>
            </div>
            <div class="editor-tools">
              <div class="mode-tabs">
                <button :class="{ active: mode === 'visual' }" @click="setMode('visual')">
                  {{ framework ? '编排' : '编辑' }}
                </button>
                <button :class="{ active: mode === 'source' }" @click="setMode('source')">
                  源码
                </button>
              </div>
              <PButton size="sm" variant="secondary" :disabled="busy" @click="renderPreview">
                渲染预览
              </PButton>
            </div>
            <div v-if="framework" class="framework-entry">
              <span class="format-badge">{{ formatLabel(framework) }}</span>
              <div class="actions">
                <PButton
                  v-if="isSt"
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="exportStPreset"
                >
                  导出酒馆预设
                </PButton>
                <PButton size="sm" variant="secondary" @click="openActivation">指派此框架</PButton>
              </div>
            </div>

            <textarea
              v-if="mode === 'source'"
              v-model="source"
              class="code-editor source-editor"
              spellcheck="false"
              aria-label="模板源码"
              @keydown.ctrl.s.prevent="save()"
            />
            <template v-else-if="document">
              <div class="document-meta">
                <label>
                  启用
                  <PSwitch v-model="document.enabled" />
                </label>
              </div>
              <textarea
                v-model="document.body"
                class="code-editor source-editor"
                spellcheck="false"
                aria-label="模板正文"
                @keydown.ctrl.s.prevent="save()"
              />
              <label class="field">
                自定义变量
                <PInput
                  :model-value="document.variables.join(', ')"
                  placeholder="逗号分隔"
                  size="sm"
                  @update:model-value="setVariables"
                />
              </label>
              <div v-if="dependencies.length" class="dependency-list">
                <span>引用</span>
                <button
                  v-for="key in dependencies"
                  :key="key"
                  @click="
                    select(key!, bundle.documents.find((d) => d.id === key)?.kind ?? 'component')
                  "
                >
                  {{ key }}
                </button>
              </div>
            </template>
            <template v-else-if="framework">
              <SillyTavernFrameworkEditor
                v-if="isSt"
                :framework="framework"
                :variables="view.variables"
                :agents="agentOptions"
                @update:framework="Object.assign(framework, $event)"
                @add="addBlock"
                @move="moveBlock"
              />
              <template v-else>
                <details class="bindings-panel">
                  <summary>
                    数据装配
                    <small>{{ framework.bindings.length }}</small>
                  </summary>
                  <div
                    v-for="(binding, index) in framework.bindings"
                    :key="index"
                    class="binding-row"
                  >
                    <div class="row">
                      <PInput v-model="binding.name" placeholder="变量名" size="sm" />
                      <PSelect
                        :model-value="binding.kind"
                        :options="bindingKinds"
                        size="sm"
                        teleport
                        @update:model-value="
                          binding.kind = $event as 'template' | 'capabilities' | 'persona'
                        "
                      />
                      <button
                        class="icon-button"
                        :disabled="index === 0"
                        aria-label="上移装配"
                        @click="moveBinding(index, -1)"
                      >
                        ↑
                      </button>
                      <button
                        class="icon-button"
                        :disabled="index === framework.bindings.length - 1"
                        aria-label="下移装配"
                        @click="moveBinding(index, 1)"
                      >
                        ↓
                      </button>
                      <button
                        class="icon-button"
                        aria-label="删除装配"
                        @click="framework.bindings.splice(index, 1)"
                      >
                        ×
                      </button>
                    </div>
                    <template v-if="binding.kind === 'template'">
                      <PSelect
                        :model-value="binding.source ?? ''"
                        :options="sourceOptions"
                        size="sm"
                        teleport
                        @update:model-value="binding.source = String($event) || undefined"
                      />
                      <textarea
                        v-if="!binding.source"
                        v-model="binding.template"
                        class="code-editor compact-editor"
                        placeholder="内联模板"
                        spellcheck="false"
                      />
                    </template>
                    <PInput v-model="binding.when" placeholder="生效条件（可选）" size="sm" />
                  </div>
                  <PButton
                    size="sm"
                    variant="ghost"
                    @click="
                      framework.bindings.push({
                        name: `variable_${framework.bindings.length + 1}`,
                        kind: 'template',
                        template: '',
                      })
                    "
                  >
                    ＋ 数据装配
                  </PButton>
                </details>
                <details class="bindings-panel">
                  <summary>
                    框架模板替换
                    <small>{{ Object.keys(framework.overrides ?? {}).length }}</small>
                  </summary>
                  <div
                    v-for="(target, origin) in framework.overrides ?? {}"
                    :key="origin"
                    class="override-row"
                  >
                    <code>{{ origin }}</code>
                    <span>→</span>
                    <span>{{ bundle.documents.find((d) => d.id === target)?.name ?? target }}</span>
                    <button
                      class="icon-button"
                      aria-label="移除替换"
                      @click="delete framework.overrides![origin]"
                    >
                      ×
                    </button>
                  </div>
                  <div class="binding-row">
                    <PSelect
                      v-model="frameworkOverrideFrom"
                      :options="sourceOptions.filter((o) => o.value)"
                      placeholder="原模板"
                      size="sm"
                      teleport
                    />
                    <PSelect
                      v-model="frameworkOverrideTo"
                      :options="sourceOptions.filter((o) => o.value)"
                      placeholder="替换为"
                      size="sm"
                      teleport
                    />
                    <PButton
                      size="sm"
                      variant="ghost"
                      :disabled="!frameworkOverrideFrom || !frameworkOverrideTo"
                      @click="addFrameworkOverride"
                    >
                      ＋ 替换
                    </PButton>
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
                        moveBlock(dragging, index)
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
                        @click="moveBlock(index, index - 1)"
                      >
                        ↑
                      </button>
                      <button
                        class="icon-button"
                        :disabled="index === framework.blocks.length - 1"
                        aria-label="下移"
                        @click="moveBlock(index, index + 1)"
                      >
                        ↓
                      </button>
                      <button
                        class="icon-button"
                        aria-label="删除区块"
                        @click="framework.blocks.splice(index, 1)"
                      >
                        ×
                      </button>
                    </header>
                    <div class="block-fields">
                      <PSelect
                        :model-value="block.kind"
                        :options="kindOptions"
                        size="sm"
                        teleport
                        @update:model-value="block.kind = $event as 'template' | 'history'"
                      />
                      <PSelect
                        :model-value="block.role"
                        :options="roleOptions"
                        size="sm"
                        teleport
                        @update:model-value="block.role = $event as PromptRole"
                      />
                      <PInput v-model="block.when" placeholder="生效条件（可选）" size="sm" />
                    </div>
                    <template v-if="block.kind === 'template'">
                      <PSelect
                        :model-value="block.source ?? ''"
                        :options="sourceOptions"
                        size="sm"
                        teleport
                        @update:model-value="block.source = String($event) || undefined"
                      />
                      <textarea
                        v-if="!block.source"
                        v-model="block.template"
                        class="code-editor compact-editor"
                        placeholder="模板正文"
                        spellcheck="false"
                      />
                      <button
                        v-else
                        class="text-link"
                        @click="
                          select(
                            block.source!,
                            bundle.documents.find((d) => d.id === block.source)?.kind ??
                              'component',
                          )
                        "
                      >
                        编辑模板 ↗
                      </button>
                    </template>
                  </article>
                </TransitionGroup>
                <p v-if="!framework.blocks.length" class="empty">添加消息区块，开始编写你的框架</p>
                <PButton variant="secondary" size="sm" @click="addBlock">＋ 区块</PButton>
              </template>
            </template>
          </template>
          <p v-else class="empty">选择一个条目</p>
        </main>

        <aside class="inspector surface">
          <template v-if="isSt">
            <h3>常用宏</h3>
            <div class="st-quick-macros">
              <button
                v-for="name in [
                  'char',
                  'user',
                  'description',
                  'personality',
                  'scenario',
                  'model',
                  'maxPrompt',
                  'date',
                  'time',
                ]"
                :key="name"
                @click="insertVariable(name)"
                v-text="`{{${name}}}`"
              />
            </div>
          </template>
          <h3>变量</h3>
          <div class="variable-list">
            <button
              v-for="variable in visibleVariables"
              :key="variable.name"
              :title="variable.label"
              @click="insertVariable(variable.name)"
            >
              <span>{{ variable.label }}</span>
              <code>{{ variable.name }}</code>
            </button>
          </div>
          <details v-if="!isSt" class="tutorial">
            <summary>模板教程</summary>
            <p>
              变量使用
              <code v-pre>{{ owner_name }}</code>
              。条件使用 Nunjucks 语法。
            </p>
            <p>
              组件需显式引用：
              <code v-pre>{{ component('components/example') }}</code>
              。插入的聊天和工具内容不会再次作为模板执行。
            </p>
            <p>
              数据装配按顺序生成变量，区块按顺序生成消息。system
              区块应放在对话之前；“原生历史”保留用户和角色消息。
            </p>
            <p>空白框架不附加内置人设或规则。权限、工具 Schema 和任务输出校验由运行时管理。</p>
            <p>新任务模板可在“指派”中替换对应任务。审批出错仍按自动审批失败处理。</p>
            <p>预览读取所选角色的人设，记忆和历史使用示例变量。</p>
          </details>
        </aside>
      </template>

      <main v-else-if="section === 'assignments'" class="assignment-page surface">
        <div class="assignment-heading">
          <div>
            <h3>生效范围</h3>
            <div class="row">
              <PSelect v-model="scopeAgent" :options="agentOptions" teleport />
              <PSelect v-model="scopeChannel" :options="channelOptions" teleport />
            </div>
          </div>
          <span class="muted-text">全局 → 频道 → 角色 → 角色频道</span>
        </div>
        <label class="field">
          框架
          <PSelect
            :model-value="currentAssignment?.frameworkId ?? ''"
            :options="[
              { label: '继承', value: '', disabled: !scopeAgent && !scopeChannel },
              ...frameworkOptions,
            ]"
            teleport
            @update:model-value="assignment().frameworkId = String($event)"
          />
        </label>
        <h3>模板替换</h3>
        <div
          v-for="(target, origin) in currentAssignment?.overrides ?? {}"
          :key="origin"
          class="override-row"
        >
          <code>{{ origin }}</code>
          <span>→</span>
          <span>{{ bundle.documents.find((d) => d.id === target)?.name ?? target }}</span>
          <button
            class="icon-button"
            aria-label="移除替换"
            @click="delete assignment().overrides[origin]"
          >
            ×
          </button>
        </div>
        <div class="row">
          <PSelect
            v-model="overrideFrom"
            :options="sourceOptions.filter((o) => o.value)"
            placeholder="原模板"
            teleport
          />
          <span>→</span>
          <PSelect v-model="overrideTo" :options="overrideTargets" placeholder="替换为" teleport />
          <PButton
            size="sm"
            variant="secondary"
            :disabled="!overrideFrom || !overrideTo"
            @click="addOverride"
          >
            添加
          </PButton>
        </div>
        <div class="scope-list">
          <h3>已有指派</h3>
          <div
            v-for="(scope, index) in bundle.assignments"
            :key="`${scope.agentId}/${scope.channel}`"
            class="scope-row"
          >
            <button
              @click="
                () => {
                  scopeAgent = scope.agentId
                  scopeChannel = scope.channel
                }
              "
            >
              {{ scopeLabel(scope.agentId, scope.channel) }}
            </button>
            <span>
              {{ bundle.frameworks.find((f) => f.id === scope.frameworkId)?.name ?? '继承' }}
            </span>
            <button
              v-if="scope.agentId || scope.channel"
              class="icon-button"
              aria-label="删除指派"
              @click="bundle.assignments.splice(index, 1)"
            >
              ×
            </button>
          </div>
        </div>
      </main>

      <main v-else class="versions-page surface">
        <aside class="version-list">
          <button
            v-for="version in [...view.releases].reverse()"
            :key="version.id"
            :class="{ active: version.id === versionId }"
            @click="showVersion(version.id)"
          >
            <strong>{{ version.id === view.activeReleaseId ? '当前版本' : '发布版本' }}</strong>
            <span>{{ new Date(version.createdAt).toLocaleString() }}</span>
            <small>{{ version.note || version.id.slice(0, 8) }}</small>
          </button>
        </aside>
        <div class="version-content">
          <div class="row">
            <h3>
              与当前草稿比较
              <small>{{ changedEntries.length }} 项</small>
            </h3>
            <PButton variant="secondary" size="sm" :disabled="!historical" @click="restoreVersion">
              恢复到草稿
            </PButton>
          </div>
          <div v-if="historical" class="diff-pills">
            <button
              v-for="entry in changedEntries"
              :key="entry.id"
              :class="{ active: activeDiff?.id === entry.id }"
              @click="diffId = entry.id"
            >
              {{ entry.kind }} · {{ entry.id }}
            </button>
          </div>
          <div v-if="activeDiff" class="diff-columns">
            <div>
              <h4>历史版本</h4>
              <pre>{{ activeDiff.before || '（不存在）' }}</pre>
            </div>
            <div>
              <h4>当前草稿</h4>
              <pre>{{ activeDiff.after || '（不存在）' }}</pre>
            </div>
          </div>
          <p v-else class="empty">{{ historical ? '内容一致' : '选择一个版本' }}</p>
        </div>
      </main>
    </div>
    <p v-else-if="busy" class="empty">正在载入……</p>
    <section v-if="issues.length" class="validation-panel" aria-label="校验结果">
      <div v-for="(issue, index) in issues" :key="index" :class="issue.level">
        <code>{{ issue.source }}</code>
        <span>{{ issue.message }}</span>
      </div>
    </section>

    <PDialog v-model="activationOpen" title="指派框架" width="min(580px, calc(100vw - 48px))">
      <p v-if="error" class="preview-issue error" role="alert">{{ error }}</p>
      <div class="independent-form">
        <strong>{{ framework?.name }}</strong>
        <div class="independent-scopes">
          <PSelect v-model="activation.agentId" :options="agentOptions" teleport />
          <PSelect
            v-model="activation.channel"
            :options="channelOptions.filter((option) => option.value !== 'task')"
            teleport
          />
        </div>
        <p class="muted-text">发布后生效，更具体的已有指派仍优先。</p>
      </div>
      <template #footer>
        <PButton size="sm" variant="secondary" @click="activationOpen = false">取消</PButton>
        <PButton size="sm" :disabled="busy" @click="submitActivation">应用到草稿</PButton>
      </template>
    </PDialog>
    <PDialog v-model="independentOpen" title="新建框架" width="min(780px, calc(100vw - 48px))">
      <p v-if="error" class="preview-issue error" role="alert">{{ error }}</p>
      <div class="independent-form">
        <div class="format-choices" role="group" aria-label="框架格式">
          <button
            v-for="format in PROMPT_FORMATS"
            :key="format.value"
            :class="['format-choice', { active: independent.format === format.value }]"
            :aria-pressed="independent.format === format.value"
            @click="independent.format = format.value"
          >
            <strong>{{ format.label }}</strong>
            <small>{{ format.description }}</small>
          </button>
        </div>
        <label class="field">
          名称
          <PInput v-model="independent.name" maxlength="100" />
        </label>
        <label v-if="independent.format !== 'infos'" class="field">
          写法
          <PSelect
            :model-value="independent.layout"
            :options="layoutOptions"
            teleport
            @update:model-value="independent.layout = $event as 'text' | 'blocks'"
          />
        </label>
        <label v-if="independent.format !== 'infos' && independent.layout === 'text'" class="field">
          完整提示词
          <textarea
            v-model="independent.body"
            class="code-editor independent-body"
            spellcheck="false"
            :placeholder="
              independent.format === 'sillytavern'
                ? '填写提示词，可使用 {{char}}、{{user}} 等酒馆宏。'
                : '直接编写完整提示词，可使用变量与模板语法。'
            "
          />
        </label>
        <label v-if="independent.format !== 'infos'" class="history-toggle">
          <PSwitch v-model="independent.history" />
          保留对话历史
        </label>
        <label class="field">
          生效范围
          <PSelect
            :model-value="independent.scope"
            :options="activationOptions"
            teleport
            @update:model-value="independent.scope = $event as 'all' | 'range' | 'later'"
          />
        </label>
        <div v-if="independent.scope === 'range'" class="independent-scopes">
          <PSelect v-model="independent.agentId" :options="agentOptions" teleport />
          <PSelect
            v-model="independent.channel"
            :options="channelOptions.filter((option) => option.value !== 'task')"
            teleport
          />
        </div>
        <p class="muted-text">
          {{
            independent.scope === 'all'
              ? '全部对话：替换现有角色与频道的框架指派，发布后生效。'
              : independent.scope === 'range'
                ? '发布后生效，更具体的已有指派仍优先。'
                : '创建后可在“指派”中启用。'
          }}
        </p>
        <details class="tutorial">
          <summary>框架教程</summary>
          <p>
            infOS 原生格式从内置编排开始。SillyTavern
            格式使用酒馆宏和聊天历史标记，也可以通过顶部“导入”读取酒馆 JSON 预设。
          </p>
          <p>
            自定义框架从完整正文或空白编排开始，不附加内置人设、规则、槽位或能力片段；按需引用变量与组件。
          </p>
          <p>
            完整正文创建一条系统消息，之后可继续拆分编排。本次用户消息、工具协议和任务校验由运行时负责，后台任务提示词仍在“任务”中编辑。
          </p>
        </details>
      </div>
      <template #footer>
        <PButton variant="secondary" size="sm" @click="independentOpen = false">取消</PButton>
        <PButton
          size="sm"
          :disabled="busy || !independent.name.trim() || independent.name.trim().length > 100"
          @click="submitIndependent"
        >
          创建框架
        </PButton>
      </template>
    </PDialog>
    <PDialog v-model="stImportOpen" title="导入酒馆预设" width="min(780px, calc(100vw - 48px))">
      <div v-if="stImport" class="independent-form">
        <p v-if="error" class="preview-issue error" role="alert">{{ error }}</p>
        <label class="field">
          名称
          <PInput v-model="stImport.framework.name" maxlength="100" />
        </label>
        <label v-if="stImport.orderProfiles.length > 1" class="field">
          排序方案
          <PSelect
            :model-value="stImport.framework.sillyTavern?.orderProfile ?? 0"
            :options="stImport.orderProfiles"
            :disabled="busy"
            teleport
            @update:model-value="reloadStImport(Number($event))"
          />
        </label>
        <div class="st-import-stats">
          <span>{{ stImport.framework.blocks.length }} 条目</span>
          <span>{{ stImport.framework.blocks.filter((block) => block.enabled).length }} 启用</span>
          <span>{{ stImport.issues.length }} 项提示</span>
        </div>
        <div v-if="stImport.issues.length" class="st-import-issues">
          <p v-for="(issue, index) in stImport.issues" :key="index" :class="issue.level">
            {{ issue.source }}：{{ issue.message }}
          </p>
        </div>
        <label class="field">
          生效范围
          <PSelect
            :model-value="stScope.scope"
            :options="activationOptions"
            teleport
            @update:model-value="stScope.scope = $event as 'all' | 'range' | 'later'"
          />
        </label>
        <div v-if="stScope.scope === 'range'" class="independent-scopes">
          <PSelect v-model="stScope.agentId" :options="agentOptions" teleport />
          <PSelect
            v-model="stScope.channel"
            :options="channelOptions.filter((option) => option.value !== 'task')"
            teleport
          />
        </div>
        <p class="muted-text">
          {{
            stScope.scope === 'all'
              ? '替换已有角色与频道的框架指派，发布后生效。'
              : '导入草稿后可编辑和预览，发布后生效。'
          }}
        </p>
      </div>
      <template #footer>
        <PButton size="sm" variant="secondary" :disabled="busy" @click="stImportOpen = false">
          取消
        </PButton>
        <PButton
          size="sm"
          :disabled="busy || !stImport || !stImport.framework.name.trim()"
          @click="commitStImport(stScope)"
        >
          导入草稿
        </PButton>
      </template>
    </PDialog>
    <PDialog v-model="previewOpen" title="渲染预览" width="min(1120px, calc(100vw - 48px))">
      <div v-if="error" class="preview-issue error" role="alert">{{ error }}</div>
      <div class="preview-controls">
        <PSelect v-model="previewAgent" :options="agentOptions" size="sm" teleport />
        <PSelect
          v-model="previewChannel"
          :options="channelOptions.filter((o) => o.value)"
          size="sm"
          teleport
        />
        <PSelect
          v-if="isSt"
          v-model="previewGeneration"
          :options="generationOptions"
          size="sm"
          teleport
        />
        <PButton size="sm" :disabled="busy" @click="renderPreview">刷新</PButton>
        <span v-if="preview" class="token-count">
          {{ preview.tokens.toLocaleString() }} 文本 Token · o200k_base
        </span>
      </div>
      <details class="preview-variables">
        <summary>示例变量</summary>
        <textarea
          v-model="variablesText"
          class="code-editor compact-editor"
          spellcheck="false"
          aria-label="示例变量 JSON"
        />
      </details>
      <div class="preview-results">
        <div
          v-for="(issue, index) in preview?.issues ?? []"
          :key="index"
          :class="['preview-issue', issue.level]"
        >
          {{ issue.source }}：{{ issue.message }}
        </div>
        <details v-for="segment in preview?.segments ?? []" :key="segment.id" open>
          <summary>
            <b>{{ segment.role }}</b>
            <small v-if="segment.originalRole" class="format-badge">
              {{ segment.originalRole }} 适配
            </small>
            <code>{{ segment.source }}</code>
            <span>{{ segment.tokens.toLocaleString() }}</span>
          </summary>
          <pre>{{ segment.content }}</pre>
        </details>
        <p v-if="preview && !preview.segments.length && !preview.issues.length" class="empty">
          没有渲染内容
        </p>
      </div>
      <template #footer>
        <PButton variant="secondary" size="sm" @click="previewOpen = false">关闭</PButton>
      </template>
    </PDialog>
    <PDialog
      :model-value="Boolean(pendingDialog)"
      :title="pendingDialog?.title"
      :message="pendingDialog?.message"
      @update:model-value="!$event && (pendingDialog = null)"
      @confirm="pendingDialog?.action()"
      @cancel="pendingDialog = null"
    />
  </section>
</template>

<style scoped src="./promptManagement.css"></style>
