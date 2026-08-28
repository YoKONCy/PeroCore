<script setup lang="ts">
/**
 * PetBubbleSurface.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed } from 'vue'
import type {
  ErrorSurfaceProps,
  MarkdownSurfaceProps,
  StatusSurfaceProps,
  ToolCallSurfaceProps,
} from '@infos/shared'
import type { CompositorSurface } from '../../stores'
import { segmentStreamMarkdown } from '../../compositor/markdownSegmentation'
import ChatRichText from '../chat/ChatRichText.vue'
import RunPulse from '../chat/RunPulse.vue'

const props = defineProps<{ surface: CompositorSurface }>()

const markdownBlocks = computed(() =>
  props.surface.nodes
    .filter((node) => node.kind === 'markdown')
    .flatMap((node) => {
      const value = node.props as MarkdownSurfaceProps
      return segmentStreamMarkdown(value.source, node.nodeId, value.phase === 'committed')
    })
    .filter((block) => block.kind === 'markdown'),
)

const latestStatus = computed(() => {
  const status = [...props.surface.nodes].reverse().find((node) => node.kind === 'status')
  return status ? (status.props as StatusSurfaceProps) : undefined
})

const pulseState = computed(() => {
  const state = latestStatus.value?.state
  if (state === 'calling') return 'calling' as const
  if (state === 'generating' || state === 'running') return 'generating' as const
  if (state === 'paused') return 'paused' as const
  if (state === 'waiting_input') return 'waiting' as const
  if (state === 'completed') return 'completed' as const
  if (state === 'failed' || state === 'tool_failed' || state === 'cancelled')
    return 'failed' as const
  return 'thinking' as const
})

const hasError = computed(() => props.surface.nodes.some((node) => node.kind === 'error'))

const compactStatus = computed(() => {
  const error = props.surface.nodes.find((node) => node.kind === 'error')
  if (error) return (error.props as ErrorSurfaceProps).message
  const tool = [...props.surface.nodes].reverse().find((node) => node.kind === 'tool-call')
  if (tool) {
    const value = tool.props as ToolCallSurfaceProps
    return value.state === 'calling' ? `正在使用工具：${value.name}` : ''
  }
  const status = [...props.surface.nodes].reverse().find((node) => node.kind === 'status')
  if (!status) return ''
  const value = status.props as StatusSurfaceProps
  return value.message ?? statusLabel(value.state)
})

const plainText = computed(() => {
  const markdown = props.surface.nodes
    .filter((node) => node.kind === 'markdown')
    .map((node) => (node.props as MarkdownSurfaceProps).source)
    .join('\n')
  return stripMarkdown(markdown) || compactStatus.value
})

function statusLabel(state: StatusSurfaceProps['state']): string {
  const labels: Partial<Record<StatusSurfaceProps['state'], string>> = {
    thinking: '努力思考中...',
    calling: '正在调用工具...',
    generating: '正在组织回复...',
    tool_failed: '工具执行失败了...',
  }
  return labels[state] ?? ''
}

function stripMarkdown(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_~]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

defineExpose({ plainText })
</script>

<template>
  <div class="pet-bubble-surface" :data-surface-id="surface.surfaceId">
    <ChatRichText v-for="block in markdownBlocks" :key="block.id" :content="block.source" compact />
    <RunPulse
      v-if="markdownBlocks.length === 0 && compactStatus"
      :state="pulseState"
      :label="compactStatus"
      :elapsed-ms="latestStatus?.totalDurationMs ?? latestStatus?.outputDurationMs"
      :live="surface.state === 'open'"
      :show-time="Boolean(latestStatus) && !hasError"
      compact
      class="pet-bubble-surface__pulse"
    />
  </div>
</template>

<style scoped>
.pet-bubble-surface {
  overflow-wrap: anywhere;
}
.pet-bubble-surface__pulse {
  max-width: min(280px, 86vw);
}
</style>
