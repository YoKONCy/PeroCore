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
  <div
    class="border-2 border-slate-200 bg-white transition-all shadow-[0_-4px_16px_rgba(0,0,0,0.05)] focus-within:border-sky-300 focus-within:shadow-[0_-4px_16px_rgba(56,189,248,0.08)]"
  >
    <!-- 待发送图片预览 -->
    <div
      v-if="pendingImages.length > 0"
      class="flex gap-2 px-4 pt-3 pb-2 overflow-x-auto border-b border-slate-200"
    >
      <div v-for="(img, idx) in pendingImages" :key="idx" class="relative flex-shrink-0">
        <img
          :src="img.url"
          class="w-16 h-16 object-cover border border-slate-200"
          alt="待发送图片"
        />
        <button
          class="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] bg-rose-500 text-white border-none flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
          @click="removeImage(idx)"
        >
          <PixelIcon name="close" size="xs" />
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="flex items-end gap-2 px-4 py-3">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled || isSending"
        class="flex-1 min-h-[24px] max-h-[200px] border-none bg-transparent text-slate-800 font-pixel text-sm leading-relaxed resize-none outline-none placeholder:text-slate-400 disabled:opacity-50"
        rows="1"
        @keydown="onKeydown"
        @input="autoResize"
        @paste="onPaste"
      />

      <div class="flex-shrink-0 flex gap-2">
        <!-- 图片选择按钮 -->
        <button
          v-if="!isSending"
          class="flex items-center gap-1 px-2 py-1.5 bg-slate-50 text-slate-400 border-2 border-slate-200 cursor-pointer font-bold text-xs transition-all active:scale-95 hover:border-sky-300 hover:text-sky-500"
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
          class="flex items-center gap-1 px-2.5 py-1 bg-rose-500 text-white border-2 border-rose-600 cursor-pointer font-bold text-xs transition-all active:scale-95 hover:bg-rose-400"
          title="停止生成"
          @click="emit('stop')"
        >
          <PixelIcon name="square" size="xs" />
          <span>停止</span>
        </button>

        <!-- 发送按钮 -->
        <button
          v-else
          class="flex items-center gap-1 px-3 py-1.5 bg-sky-500 text-white border-2 border-sky-600 cursor-pointer font-bold text-xs transition-all active:scale-95 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="disabled || (!inputText.trim() && pendingImages.length === 0)"
          @click="send"
        >
          <PixelIcon name="send" size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>
