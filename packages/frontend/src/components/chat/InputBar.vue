<script setup lang="ts">
/**
 * InputBar — 聊天输入框组件
 *
 * 功能：
 * 1. 多行自适应文本域
 * 2. 图片粘贴/预览/删除
 * 3. Enter 发送 / Shift+Enter 换行
 * 4. 发送中状态锁
 * 5. 停止生成按钮
 */
import { ref, nextTick } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'

interface Props {
  /** 是否正在发送/生成中 */
  isSending?: boolean
  /** 输入框占位符 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  isSending: false,
  placeholder: '给 Pero 发消息... (Enter 发送)',
  disabled: false,
})

const emit = defineEmits<{
  send: [text: string, images: string[]]
  stop: []
}>()

const inputText = ref('')
const pendingImages = ref<{ url: string; file?: File }[]>([])
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 键盘事件 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

/** 发送 */
function send() {
  const text = inputText.value.trim()
  if (!text && pendingImages.value.length === 0) return

  emit(
    'send',
    text,
    pendingImages.value.map((img) => img.url),
  )
  inputText.value = ''
  pendingImages.value = []
  void nextTick(() => autoResize())
}

/** 自适应高度 */
function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const maxH = 200
  el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
}

/** 粘贴图片 */
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        const url = URL.createObjectURL(file)
        pendingImages.value.push({ url, file })
      }
    }
  }
}

/** 文件选择器 ref */
const fileInputRef = ref<HTMLInputElement | null>(null)

/** 打开文件选择对话框 */
function openFileDialog() {
  fileInputRef.value?.click()
}

/** 文件选择回调 */
function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files) return
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      pendingImages.value.push({ url, file })
    }
  }
  // 重置 input 以允许重复选择同一文件
  target.value = ''
}

/** 移除待发送图片 */
function removeImage(idx: number) {
  const img = pendingImages.value[idx]
  if (img) URL.revokeObjectURL(img.url)
  pendingImages.value.splice(idx, 1)
}

/** 聚焦 */
function focus() {
  textareaRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="input-bar">
    <!-- 待发送图片预览 -->
    <div v-if="pendingImages.length > 0" class="input-bar-images">
      <div v-for="(img, idx) in pendingImages" :key="idx" class="input-bar-image-wrap">
        <img :src="img.url" class="input-bar-image" alt="待发送图片" />
        <button class="input-bar-image-remove" @click="removeImage(idx)">
          <PixelIcon name="close" size="xs" />
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-bar-main">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled || isSending"
        class="input-bar-textarea"
        rows="1"
        @keydown="onKeydown"
        @input="autoResize"
        @paste="onPaste"
      />

      <div class="input-bar-actions">
        <!-- 图片选择按钮 -->
        <button
          v-if="!isSending"
          class="input-bar-btn input-bar-btn-attach"
          title="添加图片"
          @click="openFileDialog"
        >
          <PixelIcon name="image" size="xs" />
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          multiple
          class="input-bar-file-input"
          @change="handleFileSelect"
        />

        <!-- 停止按钮 -->
        <button
          v-if="isSending"
          class="input-bar-btn input-bar-btn-stop"
          title="停止生成"
          @click="emit('stop')"
        >
          <PixelIcon name="square" size="xs" />
          <span>停止</span>
        </button>

        <!-- 发送按钮 -->
        <button
          v-else
          class="input-bar-btn input-bar-btn-send"
          :disabled="disabled || (!inputText.trim() && pendingImages.length === 0)"
          @click="send"
        >
          <PixelIcon name="send" size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-bar {
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.05);
}
.input-bar:focus-within {
  border-color: var(--color-sky-hover);
  box-shadow: 0 -4px 16px rgba(56, 189, 248, 0.08);
}

/* 图片预览 */
.input-bar-images {
  display: flex;
  gap: 8px;
  padding: 12px 16px 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
}
.input-bar-image-wrap {
  position: relative;
  flex-shrink: 0;
}
.input-bar-image {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border: 1px solid var(--color-border);
}
.input-bar-image-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  background: var(--color-red-face, #ef4444);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s;
}
.input-bar-image-remove:hover {
  transform: scale(1.1);
}

/* 主输入区 */
.input-bar-main {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
}

.input-bar-textarea {
  flex: 1;
  min-height: 24px;
  max-height: 200px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
}
.input-bar-textarea::placeholder {
  color: var(--color-text-muted);
}
.input-bar-textarea:disabled {
  opacity: 0.5;
}

/* 按钮 */
.input-bar-actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}
.input-bar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  cursor: pointer;
  font-weight: 700;
  font-size: 12px;
  transition: all 0.15s;
}
.input-bar-btn:active {
  transform: scale(0.95);
}

.input-bar-btn-send {
  padding: 6px 12px;
  background: var(--color-sky-500);
  color: white;
  border: 2px solid var(--color-sky-shadow);
}
.input-bar-btn-send:hover:not(:disabled) {
  background: var(--color-sky-hover);
}
.input-bar-btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 附件按钮 */
.input-bar-btn-attach {
  padding: 6px 8px;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  border: 2px solid var(--color-border);
}
.input-bar-btn-attach:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
}
.input-bar-file-input {
  display: none;
}

.input-bar-btn-stop {
  padding: 4px 10px;
  background: var(--color-red-face, #ef4444);
  color: white;
  border: 2px solid var(--color-red-shadow, #dc2626);
}
.input-bar-btn-stop:hover {
  background: var(--color-red-400, #f87171);
}
</style>
