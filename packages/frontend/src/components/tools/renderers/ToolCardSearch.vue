<script setup lang="ts">
import { t as __t } from '../../../i18n/index'

/** ToolCardSearch — 搜索索引表，使用文件/坐标/内容列而非结果卡片。 */
import { computed } from 'vue'
import { parseToolSearchResult, toolSearchSummary } from '../../../lib/toolSearchResult'
const props = defineProps<{ args: string; result?: string; isError?: boolean }>()
function parse(raw?: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
const args = computed(() => parse(props.args))
const result = computed(() => (props.isError ? undefined : parseToolSearchResult(props.result)))
const query = computed(() => String(args.value.query ?? args.value.pattern ?? ''))
const matches = computed(() => result.value?.rows ?? [])
const summary = computed(() => {
  if (props.isError) return __t('ui.tools', '搜索失败')
  if (props.result === undefined) return __t('ui.tools', '等待结果')
  return result.value ? toolSearchSummary(result.value) : __t('ui.tools', '搜索结果')
})
const partialPreview = computed(() => result.value?.previewTruncated || matches.value.length > 8)
</script>
<template>
  <section class="search-inspector">
    <header>
      <b>QUERY</b>
      <code :title="query">{{ query || '搜索' }}</code>
      <strong>{{ summary }}</strong>
    </header>
    <div v-if="matches.length" class="search-table">
      <div class="search-table__head">
        <span>LOC</span>
        <span>FILE / MATCH</span>
      </div>
      <div v-for="(match, index) in matches.slice(0, 8)" :key="index" class="search-row">
        <code>
          {{
            match.kind === 'directory'
              ? '目录'
              : match.line
                ? `${match.line}:${match.column ?? 1}`
                : '—'
          }}
        </code>
        <div>
          <strong>{{ match.file || __t('ui.tools', '未知位置') }}</strong>
          <span v-if="match.content">{{ match.content }}</span>
        </div>
      </div>
    </div>
    <pre v-else-if="isError" class="search-error">{{ props.result }}</pre>
    <div v-else-if="props.result === undefined" class="search-empty">
      {{ __t('ui.tools', '等待搜索结果……') }}
    </div>
    <div v-else-if="result?.auditOnly" class="search-empty">
      {{ __t('ui.tools', '已保留数量，正文需重新搜索') }}
    </div>
    <div v-else-if="result" class="search-empty">{{ __t('ui.tools', '未找到匹配项') }}</div>
    <pre v-else class="search-raw">{{ props.result }}</pre>
    <footer v-if="partialPreview && matches.length" class="search-note">
      {{ __t('ui.tools', '仅展示前') }} {{ Math.min(8, matches.length) }}
      {{ __t('ui.tools', '项') }}
    </footer>
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
.search-raw {
  margin: 0;
  padding: 10px;
  color: var(--ui-text-secondary);
  font: 10px/1.5 var(--ui-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.search-note {
  padding: 6px 10px;
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-mono);
  text-align: right;
}
</style>
