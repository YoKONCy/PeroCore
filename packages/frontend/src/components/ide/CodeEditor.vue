<script setup lang="ts">
/**
 * CodeEditor — 代码编辑器占位
 *
 * TODO: P5 接入 Monaco Editor (defineAsyncComponent)
 * 当前为简单 textarea fallback。
 *
 * @props initialContent - 初始内容
 * @props language - 语言标识
 * @props filePath - 文件路径
 * @emits save - 保存 (Ctrl+S)
 * @emits change - 内容变化
 */
import { ref, watch, onMounted } from 'vue'
import { PixelIcon } from '../pixel'

interface Props {
  initialContent: string
  language?: string
  filePath?: string
}

const props = withDefaults(defineProps<Props>(), {
  language: 'plaintext',
  filePath: '',
})

const emit = defineEmits<{
  save: [content: string]
  change: [content: string]
}>()

const content = ref(props.initialContent)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.initialContent,
  (v) => {
    content.value = v
  },
)

function onInput() {
  emit('change', content.value)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    emit('save', content.value)
  }
  // Tab 插入空格
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = textareaRef.value
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    content.value = content.value.substring(0, start) + '  ' + content.value.substring(end)
    void el.offsetHeight // force reflow
    el.selectionStart = el.selectionEnd = start + 2
    emit('change', content.value)
  }
}

onMounted(() => {
  textareaRef.value?.focus()
})
</script>

<template>
  <div class="code-editor">
    <!-- 状态栏 -->
    <div class="ce-status">
      <span class="ce-lang">
        <PixelIcon name="code" size="xs" />
        {{ language }}
      </span>
      <span v-if="filePath" class="ce-path">{{ filePath }}</span>
    </div>

    <!-- 编辑区 (TODO: Monaco 替换) -->
    <textarea
      ref="textareaRef"
      v-model="content"
      class="ce-textarea"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.ce-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.ce-lang {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-sky-500);
  text-transform: uppercase;
}
.ce-path {
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.ce-textarea {
  flex: 1;
  padding: 16px;
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  border: none;
  outline: none;
  resize: none;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}
.ce-textarea::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.ce-textarea::-webkit-scrollbar-track {
  background: transparent;
}
.ce-textarea::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
</style>
