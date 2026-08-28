<script setup lang="ts">
/**
 * ToolTechnicalDrawer.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed } from 'vue'

const props = defineProps<{
  name: string
  args: string
  result?: string
  isError?: boolean
  durationMs?: number
}>()
const emit = defineEmits<{ close: [] }>()

const formattedArgs = computed(() => formatJson(props.args))
const formattedResult = computed(() => formatJson(props.result ?? ''))

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
</script>

<template>
  <div class="ttd-backdrop" @click.self="emit('close')">
    <aside class="ttd" role="dialog" aria-modal="true" aria-label="工具技术详情">
      <header class="ttd-header">
        <div class="ttd-title">
          <small>工具调用详情</small>
          <strong>{{ name }}</strong>
        </div>
        <button class="ttd-close" type="button" aria-label="关闭工具详情" @click="emit('close')">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="ttd-content">
        <dl class="ttd-meta">
          <div>
            <dt>执行状态</dt>
            <dd :class="{ 'is-error': isError }">
              <i aria-hidden="true" />
              {{ isError ? '失败' : result === undefined ? '执行中' : '完成' }}
            </dd>
          </div>
          <div>
            <dt>执行耗时</dt>
            <dd>{{ durationMs === undefined ? '—' : `${durationMs} ms` }}</dd>
          </div>
        </dl>
        <section>
          <div class="ttd-section-title">
            <h4>调用参数</h4>
            <span>REQUEST</span>
          </div>
          <pre>{{ formattedArgs || '{}' }}</pre>
        </section>
        <section>
          <div class="ttd-section-title">
            <h4>返回结果</h4>
            <span>RESPONSE</span>
          </div>
          <pre :class="{ 'is-error': isError }">{{ formattedResult || '等待结果…' }}</pre>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ttd-backdrop {
  position: fixed;
  inset: 32px 0 22px;
  z-index: 1200;
  background: color-mix(in srgb, #050712 48%, transparent);
  backdrop-filter: blur(2px);
}
.ttd {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  width: min(520px, calc(100vw - 32px));
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--ui-border-strong);
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  box-shadow:
    -12px 14px 36px color-mix(in srgb, #000 35%, transparent),
    -4px 0 0 color-mix(in srgb, var(--ui-accent-purple) 18%, transparent);
}
.ttd-header {
  display: flex;
  min-height: 76px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 14px 20px;
  border-bottom: 1px solid var(--ui-border-default);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--ui-accent-purple) 12%, transparent),
      transparent 62%
    ),
    var(--ui-bg-surface-soft);
}
.ttd-title {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.ttd-title small {
  color: var(--ui-accent-purple);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.ttd-title strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font:
    14px var(--font-mono),
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ttd-close {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border-default);
  border-radius: 6px;
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease;
}
.ttd-close:hover,
.ttd-close:focus-visible {
  border-color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
  outline: none;
}
.ttd-content {
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.ttd-content::-webkit-scrollbar,
.ttd pre::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.ttd-content::-webkit-scrollbar-thumb,
.ttd pre::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--ui-scrollbar-thumb);
}
.ttd-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0 0 18px;
}
.ttd-meta div {
  display: grid;
  gap: 7px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 7px;
  background: var(--ui-bg-surface-soft);
}
.ttd dt {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
}
.ttd dd {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--ui-success);
  font:
    11px var(--font-mono),
    monospace;
}
.ttd dd i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}
.ttd dd.is-error {
  color: var(--ui-danger);
}
.ttd section + section {
  margin-top: 18px;
}
.ttd-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ttd h4 {
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 11px;
  font-weight: 800;
}
.ttd-section-title span {
  color: var(--ui-text-muted);
  font:
    8px var(--font-mono),
    monospace;
  letter-spacing: 0.12em;
}
.ttd pre {
  max-height: min(36vh, 360px);
  margin: 0;
  overflow: auto;
  padding: 14px 16px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 7px;
  background: color-mix(in srgb, var(--ui-bg-surface) 88%, #050712);
  color: var(--ui-text-secondary);
  font:
    11px/1.65 var(--font-mono),
    monospace;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ttd pre.is-error {
  border-color: color-mix(in srgb, var(--ui-danger) 42%, var(--ui-border-subtle));
}
@media (max-width: 620px) {
  .ttd-backdrop {
    inset: 32px 0 22px;
  }
  .ttd {
    top: 8px;
    right: 8px;
    bottom: 8px;
    left: 8px;
    width: auto;
  }
  .ttd-meta {
    grid-template-columns: 1fr;
  }
}
</style>
