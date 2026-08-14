<script setup lang="ts">
/** ToolCardGeneric — 通用工具遥测面板，采用固定分区与代码轨道。 */
defineProps<{ args: string; result?: string; isError?: boolean }>()
</script>
<template>
  <section class="generic-inspector" :class="{ 'is-error': isError }">
    <div v-if="args" class="generic-section">
      <header>
        <b>IN</b>
        <span>ARGUMENTS</span>
      </header>
      <pre>{{ args }}</pre>
    </div>
    <div v-if="result" class="generic-section">
      <header>
        <b>OUT</b>
        <span>{{ isError ? 'ERROR' : 'RESULT' }}</span>
      </header>
      <pre>{{ result }}</pre>
    </div>
  </section>
</template>
<style scoped>
.generic-inspector {
  display: grid;
  background: var(--ui-bg-surface);
}
.generic-section + .generic-section {
  border-top: 1px solid var(--ui-border-default);
}
.generic-section header {
  display: grid;
  min-height: 27px;
  grid-template-columns: 44px minmax(0, 1fr);
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
}
.generic-section header b {
  display: grid;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 8px var(--ui-font-mono);
}
.generic-section header span {
  padding: 0 9px;
  color: var(--ui-text-tertiary);
  font: 800 8px/27px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.generic-section pre {
  max-height: 220px;
  margin: 0;
  overflow: auto;
  padding: 9px 11px 9px 54px;
  background: linear-gradient(
    90deg,
    var(--ui-bg-surface-soft) 43px,
    var(--ui-border-subtle) 44px,
    transparent 45px
  );
  color: var(--ui-text-secondary);
  font: 10px/1.55 var(--ui-font-mono);
  white-space: pre-wrap;
  word-break: break-all;
}
.generic-inspector.is-error {
  border-top: 2px solid var(--ui-danger);
}
.generic-inspector.is-error .generic-section:last-child header b,
.generic-inspector.is-error .generic-section:last-child pre {
  color: var(--ui-danger);
}
.generic-inspector.is-error .generic-section:last-child pre {
  background-color: var(--ui-danger-soft);
}
</style>
