<script setup lang="ts">
/** ToolCardEdit — infOS 文件变更检查器：统一 Diff 轨道、行号和修改统计。 */
import { computed } from 'vue'

const props = defineProps<{ args: string; result?: string; isError?: boolean }>()

function parseObject(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const argsObj = computed(() => parseObject(props.args))
const resultObj = computed(() => parseObject(props.result))
const filePath = computed(() =>
  String(argsObj.value.path ?? argsObj.value.file_path ?? resultObj.value.path ?? ''),
)
const normalizedPath = computed(() => filePath.value.replaceAll('\\', '/'))
const fileName = computed(() => normalizedPath.value.split('/').pop() || normalizedPath.value)
const fileDir = computed(() =>
  normalizedPath.value.slice(0, Math.max(0, normalizedPath.value.lastIndexOf('/'))),
)
const lineCount = (text: string) => (text ? text.replace(/\r?\n$/, '').split(/\r?\n/).length : 0)
const operation = computed(() =>
  String(
    resultObj.value.operation ?? (argsObj.value.old_text !== undefined ? 'edit' : 'overwrite'),
  ),
)
const insertions = computed(() => {
  if (resultObj.value.insertions !== undefined) return Number(resultObj.value.insertions)
  return lineCount(
    typeof argsObj.value.new_text === 'string'
      ? argsObj.value.new_text
      : String(argsObj.value.content ?? ''),
  )
})
const deletions = computed(() => {
  if (resultObj.value.deletions !== undefined) return Number(resultObj.value.deletions)
  return typeof argsObj.value.old_text === 'string' ? lineCount(argsObj.value.old_text) : 0
})
const editRange = computed(
  () => resultObj.value.editRange as { startLine?: number; endLine?: number } | undefined,
)
const oldText = computed(() =>
  typeof argsObj.value.old_text === 'string' ? argsObj.value.old_text : '',
)
const newText = computed(() => {
  if (typeof argsObj.value.new_text === 'string') return argsObj.value.new_text
  if (typeof argsObj.value.content === 'string') return argsObj.value.content
  return ''
})
const errorText = computed(() => (props.isError ? props.result || '文件修改失败' : ''))
const diffTruncated = computed(() => Boolean(resultObj.value.diffTruncated))

const opLabel: Record<string, string> = {
  edit: 'EDIT',
  overwrite: 'WRITE',
  create: 'CREATE',
  append: 'APPEND',
}

interface DiffRow {
  kind: 'context' | 'remove' | 'add'
  oldLine?: number
  newLine?: number
  text: string
}

/**
 * 为工具轨迹生成轻量统一 Diff。工具执行本身已提供精确 old/new 文本，
 * 这里只做公共前后缀收缩，避免 UI 重复展示不变区和引入重量级 Diff 依赖。
 */
const diffRows = computed<DiffRow[]>(() => {
  const structured = resultObj.value.diffPreview
  if (Array.isArray(structured)) {
    return structured.filter((row): row is DiffRow => {
      if (!row || typeof row !== 'object') return false
      const value = row as Partial<DiffRow>
      return (
        ['context', 'remove', 'add'].includes(String(value.kind)) && typeof value.text === 'string'
      )
    })
  }
  if (!oldText.value && !newText.value) return []
  const toLines = (text: string) => {
    if (!text) return []
    const lines = text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    return lines
  }
  const oldLines = toLines(oldText.value)
  const newLines = toLines(newText.value)
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  )
    suffix += 1

  const rows: DiffRow[] = []
  const contextBefore = Math.max(0, prefix - 2)
  for (let i = contextBefore; i < prefix; i += 1)
    rows.push({ kind: 'context', oldLine: i + 1, newLine: i + 1, text: oldLines[i] ?? '' })
  for (let i = prefix; i < oldLines.length - suffix; i += 1)
    rows.push({ kind: 'remove', oldLine: i + 1, text: oldLines[i] ?? '' })
  for (let i = prefix; i < newLines.length - suffix; i += 1)
    rows.push({ kind: 'add', newLine: i + 1, text: newLines[i] ?? '' })
  const suffixStart = oldLines.length - suffix
  for (let i = suffixStart; i < Math.min(oldLines.length, suffixStart + 2); i += 1) {
    const newLine = newLines.length - suffix + (i - suffixStart) + 1
    rows.push({ kind: 'context', oldLine: i + 1, newLine, text: oldLines[i] ?? '' })
  }
  return rows.slice(0, 40)
})
</script>

<template>
  <section class="diff-inspector">
    <header class="diff-inspector__head">
      <span class="diff-inspector__mode">{{ opLabel[operation] ?? operation.toUpperCase() }}</span>
      <div class="diff-inspector__path">
        <strong :title="filePath">{{ fileName || '未知文件' }}</strong>
        <small v-if="fileDir">{{ fileDir }}</small>
      </div>
      <div class="diff-inspector__stats" aria-label="变更统计">
        <span class="is-add">+{{ insertions }}</span>
        <span class="is-remove">−{{ deletions }}</span>
        <span v-if="editRange?.startLine" class="is-range">
          L{{ editRange.startLine }}–{{ editRange.endLine }}
        </span>
      </div>
    </header>

    <div v-if="diffRows.length" class="diff-grid" role="table" aria-label="文件差异">
      <div
        v-for="(row, index) in diffRows"
        :key="index"
        class="diff-row"
        :class="`is-${row.kind}`"
        role="row"
      >
        <span class="diff-line diff-line--old">{{ row.oldLine ?? '' }}</span>
        <span class="diff-line diff-line--new">{{ row.newLine ?? '' }}</span>
        <span class="diff-sign">
          {{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '·' }}
        </span>
        <code>{{ row.text || ' ' }}</code>
      </div>
    </div>

    <div v-if="diffTruncated" class="diff-inspector__truncated">
      <span>DIFF PREVIEW LIMITED</span>
      <span>仅展示前 {{ diffRows.length }} 行，总统计仍基于完整文件</span>
    </div>

    <div v-else-if="!errorText && !diffRows.length" class="diff-inspector__summary">
      <span>变更已写入</span>
      <code>
        {{
          resultObj.bytes ? `${resultObj.bytes} bytes` : `${insertions + deletions} lines touched`
        }}
      </code>
    </div>

    <div v-if="errorText" class="diff-inspector__error">
      <b>ERR</b>
      <pre>{{ errorText }}</pre>
    </div>
  </section>
</template>

<style scoped>
.diff-inspector {
  --diff-gutter: 38px;
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: var(--ui-bg-surface);
}
.diff-inspector__head {
  display: grid;
  min-height: 40px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: stretch;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.diff-inspector__mode {
  display: grid;
  min-width: 58px;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.diff-inspector__path {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  padding: 0 11px;
  align-self: center;
}
.diff-inspector__path strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font: 700 11px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-inspector__path small {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-inspector__stats {
  display: flex;
  align-items: center;
  border-left: 1px solid var(--ui-border-default);
  font: 800 10px var(--ui-font-mono);
}
.diff-inspector__stats span {
  display: grid;
  min-width: 34px;
  height: 100%;
  padding: 0 7px;
  place-items: center;
  border-right: 1px solid var(--ui-border-subtle);
}
.diff-inspector__stats .is-add {
  color: var(--ui-success);
  background: var(--ui-success-soft);
}
.diff-inspector__stats .is-remove {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.diff-inspector__stats .is-range {
  color: var(--ui-text-tertiary);
  font-weight: 600;
}
.diff-grid {
  max-height: 300px;
  overflow: auto;
  background: var(--ui-bg-surface);
}
.diff-row {
  display: grid;
  min-height: 22px;
  grid-template-columns: var(--diff-gutter) var(--diff-gutter) 24px minmax(max-content, 1fr);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border-subtle) 58%, transparent);
  font: 10px/22px var(--ui-font-mono);
}
.diff-row.is-add {
  background: color-mix(in srgb, var(--ui-success-soft) 72%, transparent);
}
.diff-row.is-remove {
  background: color-mix(in srgb, var(--ui-danger-soft) 72%, transparent);
}
.diff-line {
  padding: 0 7px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  text-align: right;
  user-select: none;
}
.diff-sign {
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  text-align: center;
  user-select: none;
}
.is-add .diff-sign {
  color: var(--ui-success);
}
.is-remove .diff-sign {
  color: var(--ui-danger);
}
.diff-row code {
  min-width: max-content;
  padding: 0 10px;
  color: var(--ui-text-secondary);
  white-space: pre;
}
.is-add code,
.is-remove code {
  color: var(--ui-text-primary);
}
.diff-inspector__truncated {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px;
  border-top: 1px solid var(--ui-border-default);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.06em;
}
.diff-inspector__truncated span:last-child {
  color: var(--ui-text-tertiary);
  font-weight: 500;
  letter-spacing: 0;
}
.diff-inspector__summary {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  color: var(--ui-text-secondary);
  font-size: 10px;
}
.diff-inspector__summary code {
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.diff-inspector__error {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  border-top: 2px solid var(--ui-danger);
  background: var(--ui-danger-soft);
}
.diff-inspector__error b {
  display: grid;
  place-items: start center;
  padding-top: 10px;
  border-right: 1px solid color-mix(in srgb, var(--ui-danger) 30%, transparent);
  color: var(--ui-danger);
  font: 800 9px var(--ui-font-mono);
}
.diff-inspector__error pre {
  margin: 0;
  padding: 9px 11px;
  overflow: auto;
  color: var(--ui-danger);
  font: 10px/1.5 var(--ui-font-mono);
  white-space: pre-wrap;
}
</style>
