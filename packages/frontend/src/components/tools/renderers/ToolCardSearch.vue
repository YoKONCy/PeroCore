<script setup lang="ts">
/** ToolCardSearch — 搜索索引表，使用文件/坐标/内容列而非结果卡片。 */
import { computed } from 'vue'
const props = defineProps<{ args: string; result?: string; isError?: boolean }>()
interface Match {
  file?: string
  line?: number
  column?: number
  content?: string
}
function parse(raw?: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}
const args = computed(() => parse(props.args))
const result = computed(() => parse(props.result))
const query = computed(() => String(args.value.query ?? args.value.pattern ?? ''))
const matches = computed(() => (result.value.matches as Match[] | undefined) ?? [])
const total = computed(() => Number(result.value.total ?? matches.value.length))
</script>
<template>
  <section class="search-inspector">
    <header>
      <b>QUERY</b>
      <code :title="query">{{ query || '搜索' }}</code>
      <strong>{{ total }} HITS</strong>
    </header>
    <div v-if="matches.length" class="search-table">
      <div class="search-table__head">
        <span>LOC</span>
        <span>FILE / MATCH</span>
      </div>
      <div v-for="(match, index) in matches.slice(0, 8)" :key="index" class="search-row">
        <code>{{ match.line ? `${match.line}:${match.column ?? 1}` : '—' }}</code>
        <div>
          <strong>{{ match.file || '未知位置' }}</strong>
          <span v-if="match.content">{{ match.content }}</span>
        </div>
      </div>
    </div>
    <pre v-else-if="isError" class="search-error">{{ result }}</pre>
    <div v-else class="search-empty">NO MATCHES</div>
  </section>
</template>
<style scoped>
.search-inspector {
  background: var(--ui-bg-surface);
}
.search-inspector > header {
  display: grid;
  min-height: 38px;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.search-inspector > header b {
  display: grid;
  height: 100%;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.search-inspector > header code {
  overflow: hidden;
  padding: 0 10px;
  color: var(--ui-text-primary);
  font: 10px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-inspector > header strong {
  height: 100%;
  padding: 0 10px;
  border-left: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px/38px var(--ui-font-mono);
}
.search-table__head,
.search-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
}
.search-table__head {
  min-height: 24px;
  border-bottom: 1px solid var(--ui-border-default);
  color: var(--ui-text-disabled);
  font: 800 8px/24px var(--ui-font-mono);
}
.search-table__head span {
  padding: 0 9px;
}
.search-table__head span:first-child {
  border-right: 1px solid var(--ui-border-default);
  text-align: right;
}
.search-row {
  min-height: 36px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.search-row > code {
  padding: 0 9px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--tc-accent);
  font: 9px/36px var(--ui-font-mono);
  text-align: right;
}
.search-row > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 4px 10px;
}
.search-row strong,
.search-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-row strong {
  color: var(--ui-text-primary);
  font: 9px var(--ui-font-mono);
}
.search-row span {
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.search-row:hover {
  background: var(--ui-bg-hover);
}
.search-empty {
  padding: 18px;
  color: var(--ui-text-disabled);
  font: 800 9px var(--ui-font-mono);
  text-align: center;
  letter-spacing: 0.12em;
}
.search-error {
  margin: 0;
  padding: 10px;
  border-top: 2px solid var(--ui-danger);
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
  font: 10px/1.5 var(--ui-font-mono);
}
</style>
