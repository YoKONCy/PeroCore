<script setup lang="ts">
/** ToolCardWeb — Web 请求检查器：协议、主机、目标与响应正文分轨显示。 */
import { computed } from 'vue'
const props = defineProps<{ args: string; result?: string; isError?: boolean }>()
function parse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
const args = computed(() => parse(props.args))
const url = computed(() => String(args.value.url ?? args.value.target ?? ''))
const target = computed(() => {
  try {
    return new URL(url.value)
  } catch {
    return null
  }
})
const lines = computed(() => (props.result ?? '').split(/\r?\n/).slice(0, 12))
</script>
<template>
  <section class="web-inspector" :class="{ 'is-error': isError }">
    <header>
      <b>WEB</b>
      <strong>{{ target?.hostname || 'UNKNOWN HOST' }}</strong>
      <code>{{ target?.protocol.replace(':', '').toUpperCase() || 'URL' }}</code>
    </header>
    <div class="web-target">
      <span>TARGET</span>
      <code :title="url">{{ url || '未知地址' }}</code>
    </div>
    <div v-if="result" class="web-response">
      <div v-for="(line, index) in lines" :key="index">
        <i>{{ index + 1 }}</i>
        <code>{{ line || ' ' }}</code>
      </div>
    </div>
    <footer>
      <span>{{ isError ? 'REQUEST FAILED' : 'RESPONSE CAPTURE' }}</span>
      <span>{{ (result || '').length }} CHARS</span>
    </footer>
  </section>
</template>
<style scoped>
.web-inspector {
  background: var(--ui-bg-surface);
}
.web-inspector > header {
  display: grid;
  min-height: 38px;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.web-inspector > header b {
  display: grid;
  height: 100%;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.web-inspector > header strong {
  overflow: hidden;
  padding: 0 10px;
  color: var(--ui-text-primary);
  font: 700 10px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.web-inspector > header code {
  height: 100%;
  padding: 0 10px;
  border-left: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px/38px var(--ui-font-mono);
}
.web-target {
  display: grid;
  min-height: 30px;
  grid-template-columns: 58px minmax(0, 1fr);
  border-bottom: 1px solid var(--ui-border-default);
}
.web-target span {
  padding: 0 9px;
  border-right: 1px solid var(--ui-border-default);
  color: var(--ui-text-disabled);
  font: 800 8px/30px var(--ui-font-mono);
}
.web-target code {
  overflow: hidden;
  padding: 0 10px;
  color: var(--ui-text-secondary);
  font: 9px/30px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.web-response {
  max-height: 220px;
  overflow: auto;
}
.web-response > div {
  display: grid;
  min-height: 21px;
  grid-template-columns: 42px minmax(max-content, 1fr);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border-subtle) 55%, transparent);
}
.web-response i {
  padding-right: 9px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  font: normal 9px/21px var(--ui-font-mono);
  text-align: right;
}
.web-response code {
  padding: 0 10px;
  color: var(--ui-text-secondary);
  font: 10px/21px var(--ui-font-mono);
  white-space: pre;
}
.web-inspector > footer {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px;
  border-top: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-tertiary);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.web-inspector.is-error {
  border-top: 2px solid var(--ui-danger);
}
.web-inspector.is-error footer span:first-child {
  color: var(--ui-danger);
}
</style>
