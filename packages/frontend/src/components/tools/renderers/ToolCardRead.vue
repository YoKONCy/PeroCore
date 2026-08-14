<script setup lang="ts">
/** ToolCardRead — 文件读取审计面板；历史记录只显示审计元数据，不伪装成持久正文查看器。 */
import { computed } from 'vue'
const props = defineProps<{ args: string; result?: string; isError?: boolean }>()
function parse(raw?: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}
const args = computed(() => parse(props.args))
const result = computed(() => parse(props.result))
const path = computed(() =>
  String(args.value.path ?? args.value.file_path ?? result.value.path ?? '未知文件'),
)
const name = computed(() => path.value.replaceAll('\\', '/').split('/').pop() || path.value)
const content = computed(() =>
  typeof result.value.content === 'string' ? result.value.content : '',
)
const lines = computed(() => content.value.split(/\r?\n/).slice(0, 12))
const ephemeral = computed(() => result.value.ephemeral === true)
const range = computed(() => {
  const start = args.value.line_start ?? result.value.lineStart
  const end = args.value.line_end ?? result.value.lineEnd
  return start ? `L${start}–${end ?? '…'}` : 'FULL'
})
</script>
<template>
  <section class="read-inspector">
    <header>
      <b>READ</b>
      <strong :title="path">{{ name }}</strong>
      <code>{{ range }}</code>
    </header>
    <div v-if="ephemeral" class="read-audit">
      <span>EPHEMERAL BUFFER</span>
      <dl>
        <div>
          <dt>PATH</dt>
          <dd>{{ path }}</dd>
        </div>
        <div v-if="result.hash">
          <dt>HASH</dt>
          <dd>{{ result.hash }}</dd>
        </div>
        <div>
          <dt>SIZE</dt>
          <dd>
            {{ result.totalBytes ?? result.returnedCharacters ?? 0 }}
            {{ result.totalBytes ? 'bytes' : 'chars' }}
          </dd>
        </div>
        <div v-if="result.totalLines">
          <dt>LINES</dt>
          <dd>{{ result.totalLines }}</dd>
        </div>
      </dl>
      <p>文件正文仅存在于当次 Agent 执行内存，历史轨迹不长期保存。</p>
    </div>
    <div v-else-if="lines.length && content" class="read-code">
      <div v-for="(line, index) in lines" :key="index">
        <i>{{ index + 1 }}</i>
        <code>{{ line || ' ' }}</code>
      </div>
    </div>
    <pre v-else-if="isError" class="read-error">{{ result }}</pre>
  </section>
</template>
<style scoped>
.read-inspector {
  background: var(--ui-bg-surface);
}
.read-inspector > header {
  display: grid;
  min-height: 38px;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.read-inspector > header b {
  display: grid;
  height: 100%;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.read-inspector > header strong {
  overflow: hidden;
  padding: 0 10px;
  color: var(--ui-text-primary);
  font: 700 11px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-inspector > header code {
  height: 100%;
  padding: 0 10px;
  border-left: 1px solid var(--ui-border-default);
  color: var(--ui-text-tertiary);
  font: 9px/38px var(--ui-font-mono);
}
.read-audit > span {
  display: block;
  padding: 7px 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  color: var(--ui-warning);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.read-audit dl {
  margin: 0;
}
.read-audit dl div {
  display: grid;
  min-height: 27px;
  grid-template-columns: 64px minmax(0, 1fr);
  border-bottom: 1px solid var(--ui-border-subtle);
}
.read-audit dt {
  padding: 0 9px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  font: 8px/27px var(--ui-font-mono);
}
.read-audit dd {
  overflow: hidden;
  margin: 0;
  padding: 0 9px;
  color: var(--ui-text-secondary);
  font: 9px/27px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-audit p {
  margin: 0;
  padding: 8px 10px;
  color: var(--ui-text-tertiary);
  font-size: 9px;
}
.read-code {
  max-height: 230px;
  overflow: auto;
}
.read-code > div {
  display: grid;
  min-height: 21px;
  grid-template-columns: 42px minmax(max-content, 1fr);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border-subtle) 55%, transparent);
}
.read-code i {
  padding-right: 9px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  font: normal 9px/21px var(--ui-font-mono);
  text-align: right;
}
.read-code code {
  padding: 0 10px;
  color: var(--ui-text-secondary);
  font: 10px/21px var(--ui-font-mono);
  white-space: pre;
}
.read-error {
  margin: 0;
  padding: 10px;
  border-top: 2px solid var(--ui-danger);
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
  font: 10px/1.5 var(--ui-font-mono);
  white-space: pre-wrap;
}
</style>
