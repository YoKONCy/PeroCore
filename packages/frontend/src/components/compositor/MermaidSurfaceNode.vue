<script setup lang="ts">
/**
 * MermaidSurfaceNode.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onMounted, ref, watch } from 'vue'

type MermaidModule = (typeof import('mermaid'))['default']
let mermaidPromise: Promise<MermaidModule> | null = null

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import('mermaid').then((module) => module.default)
  return mermaidPromise
}

const props = withDefaults(defineProps<{ source: string; active?: boolean }>(), { active: true })
const html = ref('')
const error = ref('')
let renderGeneration = 0

async function render(): Promise<void> {
  const generation = ++renderGeneration
  if (!props.active) {
    html.value = ''
    error.value = ''
    return
  }
  try {
    const mermaid = await loadMermaid()
    if (generation !== renderGeneration || !props.active) return
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
    const result = await mermaid.render(`infos-mermaid-${crypto.randomUUID()}`, props.source)
    if (generation !== renderGeneration) return
    html.value = result.svg
    error.value = ''
  } catch (cause) {
    if (generation !== renderGeneration) return
    error.value = cause instanceof Error ? cause.message : String(cause)
    html.value = ''
  }
}

onMounted(() => void render())
watch(
  () => [props.source, props.active] as const,
  () => void render(),
)
</script>

<template>
  <div class="surface-mermaid">
    <!-- Mermaid 使用 strict securityLevel，且只在稳定块形成后挂载。 -->
    <div v-if="html" class="surface-mermaid__canvas" v-html="html" />
    <pre v-else class="surface-mermaid__fallback"><code>{{ error || source }}</code></pre>
  </div>
</template>

<style scoped>
.surface-mermaid {
  max-width: 100%;
  overflow: auto;
  margin: 8px 0;
}
.surface-mermaid__canvas :deep(svg) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.surface-mermaid__fallback {
  white-space: pre-wrap;
  color: var(--color-text-secondary);
}
</style>
