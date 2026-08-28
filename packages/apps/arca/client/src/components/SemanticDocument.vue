<script setup lang="ts">
/**
 * SemanticDocument.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, ref } from 'vue'
import type { DocumentNode, DocumentNodeId, DocumentSemanticDiff } from '@infos/document-engine'

const props = defineProps<{
  nodes: DocumentNode[]
  rootNodeId: DocumentNodeId
  drafts?: Array<{ nodeId: DocumentNodeId; value: string }>
  writable?: boolean
  mode?: 'create' | 'read' | 'review'
  diff?: DocumentSemanticDiff
}>()
const emit = defineEmits<{
  draft: [nodeId: DocumentNodeId, value: string]
  commit: [nodeId: DocumentNodeId]
  collaborate: [nodeId: DocumentNodeId]
  insert: [node: DocumentNode, type: 'paragraph' | 'heading' | 'quote' | 'code-block']
  delete: [node: DocumentNode]
  move: [node: DocumentNode, edge: 'start' | 'end']
  comment: [node: DocumentNode]
}>()

const activeNodeId = ref<DocumentNodeId>()
const menuNodeId = ref<DocumentNodeId>()
const composing = ref(false)
const dirtyNodes = new Set<DocumentNodeId>()

const ordered = computed(() => {
  const children = new Map<string, DocumentNode[]>()
  for (const node of props.nodes) {
    if (!node.parentId) continue
    const group = children.get(node.parentId) ?? []
    group.push(node)
    children.set(node.parentId, group)
  }
  for (const group of children.values()) {
    group.sort((left, right) => left.orderKey.localeCompare(right.orderKey))
  }
  const output: DocumentNode[] = []
  const visit = (parentId: string) => {
    for (const node of children.get(parentId) ?? []) {
      output.push(node)
      visit(node.nodeId)
    }
  }
  visit(props.rootNodeId)
  return output
})

const textChanges = computed(
  () => new Map((props.diff?.textChanges ?? []).map((change) => [change.nodeId, change])),
)

function headingLevel(node: DocumentNode): number {
  const level = Number(node.attributes.level ?? 2)
  return Math.min(6, Math.max(1, Number.isFinite(level) ? level : 2))
}

function valueOf(node: DocumentNode): string {
  return props.drafts?.find((draft) => draft.nodeId === node.nodeId)?.value ?? node.text ?? ''
}

function renderedValue(node: DocumentNode): string {
  return dirtyNodes.has(node.nodeId) ? (node.text ?? '') : valueOf(node)
}

function editable(node: DocumentNode): boolean {
  return props.mode === 'create' && Boolean(props.writable) && node.text !== undefined
}

function update(node: DocumentNode, event: Event) {
  const element = event.currentTarget as HTMLElement
  dirtyNodes.add(node.nodeId)
  emit('draft', node.nodeId, element.innerText.replace(/\r/g, ''))
}

function commit(node: DocumentNode) {
  if (composing.value || !dirtyNodes.has(node.nodeId)) return
  dirtyNodes.delete(node.nodeId)
  emit('commit', node.nodeId)
}

function handleKeydown(node: DocumentNode, event: KeyboardEvent) {
  if (!editable(node) || composing.value) return
  if (event.key === 'Escape') {
    ;(event.currentTarget as HTMLElement).blur()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).blur()
  }
}

function typeLabel(node: DocumentNode): string {
  const labels: Record<string, string> = {
    heading: '标题',
    paragraph: '正文',
    quote: '引用',
    'code-block': '代码',
    'list-item': '列表',
    citation: '引用源',
    'table-cell': '单元格',
  }
  return labels[node.type] ?? node.type
}

function menuAction(
  node: DocumentNode,
  action:
    | { kind: 'insert'; type: 'paragraph' | 'heading' | 'quote' | 'code-block' }
    | { kind: 'move'; edge: 'start' | 'end' }
    | { kind: 'comment' }
    | { kind: 'delete' },
) {
  if (action.kind === 'insert') emit('insert', node, action.type)
  else if (action.kind === 'move') emit('move', node, action.edge)
  else if (action.kind === 'comment') emit('comment', node)
  else emit('delete', node)
  menuNodeId.value = undefined
}
</script>

<template>
  <article class="semantic-document" :data-mode="mode ?? 'create'" aria-label="语义文稿">
    <section
      v-for="node in ordered"
      :key="node.nodeId"
      :data-node-id="node.nodeId"
      class="semantic-block"
      :class="{
        'semantic-block--active': activeNodeId === node.nodeId,
        'semantic-block--changed': textChanges.has(node.nodeId),
      }"
      @focusin="activeNodeId = node.nodeId"
    >
      <div class="block-gutter" contenteditable="false">
        <span class="block-trace"><i /></span>
        <button
          v-if="mode === 'create' && writable"
          type="button"
          title="块操作"
          @mousedown.prevent
          @click.stop="menuNodeId = menuNodeId === node.nodeId ? undefined : node.nodeId"
        >
          ⠿
        </button>
        <button
          v-if="mode === 'create' && writable"
          type="button"
          title="在后方插入正文"
          @mousedown.prevent
          @click.stop="emit('insert', node, 'paragraph')"
        >
          ＋
        </button>
      </div>
      <span class="block-kind" contenteditable="false">{{ typeLabel(node) }}</span>

      <div v-if="mode === 'review' && textChanges.has(node.nodeId)" class="inline-semantic-diff">
        <del>{{ textChanges.get(node.nodeId)?.before }}</del>
        <ins>{{ textChanges.get(node.nodeId)?.after }}</ins>
      </div>
      <component
        :is="
          node.type === 'heading'
            ? `h${headingLevel(node)}`
            : node.type === 'quote'
              ? 'blockquote'
              : node.type === 'code-block'
                ? 'pre'
                : node.type === 'list-item'
                  ? 'li'
                  : node.type === 'citation'
                    ? 'cite'
                    : node.type === 'table-cell'
                      ? 'span'
                      : 'p'
        "
        v-else-if="node.text !== undefined"
        class="editable-node"
        :class="`document-${node.type}`"
        :contenteditable="editable(node) ? 'plaintext-only' : 'false'"
        :tabindex="editable(node) ? 0 : undefined"
        :data-placeholder="node.type === 'heading' ? '写下标题' : '输入内容 · Ctrl+Enter提交'"
        :spellcheck="node.type !== 'code-block'"
        @input="update(node, $event)"
        @blur="commit(node)"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="handleKeydown(node, $event)"
      >
        {{ renderedValue(node) }}
      </component>
      <div v-else-if="node.type === 'table'" class="document-table" role="table" />
      <div v-else-if="node.type === 'asset'" class="document-asset">资源节点</div>

      <div
        v-if="menuNodeId === node.nodeId && mode === 'create' && writable"
        class="block-menu"
        contenteditable="false"
        @click.stop
      >
        <button @click="menuAction(node, { kind: 'insert', type: 'paragraph' })">插入正文</button>
        <button @click="menuAction(node, { kind: 'insert', type: 'heading' })">插入标题</button>
        <button @click="menuAction(node, { kind: 'insert', type: 'quote' })">插入引用</button>
        <button @click="menuAction(node, { kind: 'insert', type: 'code-block' })">插入代码</button>
        <hr />
        <button @click="menuAction(node, { kind: 'move', edge: 'start' })">移到章节开头</button>
        <button @click="menuAction(node, { kind: 'move', edge: 'end' })">移到章节末尾</button>
        <button @click="menuAction(node, { kind: 'comment' })">添加评论</button>
        <button class="danger" @click="menuAction(node, { kind: 'delete' })">删除块</button>
      </div>

      <button
        v-if="mode === 'create' && node.text !== undefined"
        class="block-collaborate"
        type="button"
        contenteditable="false"
        title="让协作者处理这个语义块"
        @mousedown.prevent
        @click.stop="emit('collaborate', node.nodeId)"
      >
        ✦
      </button>
    </section>
  </article>
</template>
