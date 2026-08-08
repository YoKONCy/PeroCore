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
  <div class="input-shell pixel-border-moe">
    <!-- 待发送图片预览 -->
    <div v-if="pendingImages.length > 0" class="input-image-list">
      <div v-for="(img, idx) in pendingImages" :key="idx" class="input-image-item">
        <img :src="img.url" class="input-image-preview pixel-border-moe" alt="待发送图片" />
        <button class="input-image-remove pixel-border-moe" @click="removeImage(idx)">
          <PixelIcon name="close" size="xs" />
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-main">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled || isSending"
        class="input-textarea"
        rows="1"
        @keydown="onKeydown"
        @input="autoResize"
        @paste="onPaste"
      />

      <div class="input-actions">
        <!-- 图片选择按钮 -->
        <button
          v-if="!isSending"
          class="input-action-btn input-image-btn pixel-border-moe"
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
          class="hidden"
          @change="handleFileSelect"
        />

        <!-- 停止按钮 -->
        <button
          v-if="isSending"
          class="input-action-btn input-stop-btn pixel-border-moe"
          title="停止生成"
          @click="emit('stop')"
        >
          <PixelIcon name="square" size="xs" />
          <span>停止</span>
        </button>

        <!-- 发送按钮 -->
        <button
          v-else
          class="input-action-btn input-send-btn pixel-border-moe"
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
.input-shell {
  overflow: hidden;
  background: rgba(255, 252, 249, 0.9);
  backdrop-filter: blur(12px);
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    inset -2px -2px 0 0 rgba(249, 168, 212, 0.14),
    inset 2px 2px 0 0 rgba(255, 255, 255, 0.72),
    0 -8px 28px rgba(249, 168, 212, 0.1);
  transition: all 0.18s ease;
}

.input-shell:focus-within {
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    inset -2px -2px 0 0 rgba(249, 168, 212, 0.22),
    inset 2px 2px 0 0 rgba(255, 255, 255, 0.78),
    0 -10px 32px rgba(249, 168, 212, 0.16);
}

.input-image-list {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(45, 27, 30, 0.08);
}

.input-image-item {
  position: relative;
  flex-shrink: 0;
}

.input-image-preview {
  width: 64px;
  height: 64px;
  object-fit: cover;
}

.input-image-remove {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-red-face);
  color: white;
  cursor: pointer;
  transition: transform 0.16s ease;
}

.input-image-remove:hover {
  transform: scale(1.08);
}

.input-main {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 16px;
}

.input-textarea {
  flex: 1;
  min-height: 26px;
  max-height: 200px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-moe-cocoa);
  font-family: var(--font-pixel);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.65;
}

.input-textarea::placeholder {
  color: rgba(45, 27, 30, 0.36);
}

.input-textarea:disabled {
  opacity: 0.5;
}

.input-actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}

.input-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 34px;
  height: 32px;
  padding: 0 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  transition: all 0.16s ease;
}

.input-action-btn:active {
  transform: translate(1px, 1px);
}

.input-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.input-image-btn {
  background: rgba(255, 255, 255, 0.58);
  color: rgba(45, 27, 30, 0.42);
}

.input-image-btn:hover {
  background: rgba(167, 216, 240, 0.14);
  color: var(--color-moe-sky);
}

.input-stop-btn {
  background: var(--color-red-face);
  color: white;
}

.input-stop-btn:hover {
  background: var(--color-red-400);
}

.input-send-btn {
  background: var(--color-moe-pink);
  color: white;
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    inset -2px -2px 0 0 var(--color-pink-shadow),
    inset 2px 2px 0 0 var(--color-pink-light);
}

.input-send-btn:hover:not(:disabled) {
  background: #f472b6;
  transform: translateY(-1px);
}
</style>
