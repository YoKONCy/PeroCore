<template>
  <div class="moe-mermaid-wrapper" ref="wrapperRef">
    <!-- 顶部标题栏与交互按钮组 -->
    <div class="moe-mermaid-header">
      <div class="moe-mermaid-title">
        <span class="moe-mermaid-dot dot-red"></span>
        <span class="moe-mermaid-dot dot-yellow"></span>
        <span class="moe-mermaid-dot dot-green"></span>
        <span class="moe-mermaid-label">架构流程图 · Flowchart</span>
      </div>

      <!-- 操作工具栏 -->
      <div class="moe-mermaid-toolbar">
        <button
          type="button"
          class="moe-tool-btn"
          title="放大 (Zoom In)"
          @click.stop="zoomInInline"
        >
          ➕
        </button>
        <button
          type="button"
          class="moe-tool-btn"
          title="缩小 (Zoom Out)"
          @click.stop="zoomOutInline"
        >
          ➖
        </button>
        <button
          type="button"
          class="moe-tool-btn"
          title="复位 (Reset)"
          @click.stop="resetInline"
        >
          🔄
        </button>
        <button
          type="button"
          class="moe-tool-btn highlight"
          title="全屏沉浸放大查看 (Fullscreen)"
          @click.stop="openModal"
        >
          ⛶ 全屏放大
        </button>
        <button
          type="button"
          class="moe-tool-btn"
          title="复制 Mermaid 源码"
          @click.stop="copyCode"
        >
          {{ isCopied ? '✓ 已复制' : '📋 源码' }}
        </button>
      </div>
    </div>

    <!-- 流程图主体渲染区 -->
    <div
      class="moe-mermaid-body"
      title="双击或点击右上角可全屏放大"
      @dblclick="openModal"
    >
      <div v-if="isLoading" class="moe-mermaid-loading">
        <span class="loading-icon">✨</span>
        <span>正在绘制流程图...</span>
      </div>
      <div v-else-if="error" class="moe-mermaid-error">
        <div class="error-tip">⚠️ 流程图渲染提示：</div>
        <pre>{{ error }}</pre>
      </div>
      <div
        v-else
        class="moe-mermaid-viewport"
      >
        <div
          class="moe-mermaid-svg-container"
          :style="{ transform: `scale(${inlineScale})`, transformOrigin: 'center center' }"
          v-html="svgContent"
        ></div>

        <!-- 悬浮提示胶囊 -->
        <div class="moe-zoom-hint" @click.stop="openModal">
          <span>🔍 点击放大查看</span>
        </div>
      </div>
    </div>

    <!-- 全屏灯箱模态框 (Teleport 到 body 避免被父级 overflow 遮挡) -->
    <Teleport to="body">
      <Transition name="moe-modal-fade">
        <div
          v-if="isModalOpen"
          class="moe-lightbox-mask"
          @click.self="closeModal"
        >
          <!-- 灯箱顶部浮动控制条 -->
          <div class="moe-lightbox-bar">
            <div class="lightbox-info">
              <span class="lightbox-title">🌸 架构流程图全屏检视</span>
              <span class="lightbox-scale-badge">{{ Math.round(modalScale * 100) }}%</span>
            </div>
            <div class="lightbox-actions">
              <button
                type="button"
                class="lightbox-btn"
                title="放大"
                @click="zoomInModal"
              >
                ➕
              </button>
              <button
                type="button"
                class="lightbox-btn"
                title="缩小"
                @click="zoomOutModal"
              >
                ➖
              </button>
              <button
                type="button"
                class="lightbox-btn"
                title="重置居中"
                @click="resetModal"
              >
                🔄 复位
              </button>
              <button
                type="button"
                class="lightbox-btn close-btn"
                title="关闭 (Esc)"
                @click="closeModal"
              >
                ✕ 关闭
              </button>
            </div>
          </div>

          <!-- 灯箱可拖拽画布区域 -->
          <div
            class="moe-lightbox-canvas"
            :class="{ grabbing: isDragging }"
            @wheel.prevent="handleWheel"
            @mousedown="startDrag"
            @mousemove="onDrag"
            @mouseup="stopDrag"
            @mouseleave="stopDrag"
          >
            <div
              class="moe-lightbox-svg-wrapper"
              :style="{
                transform: `translate(${panX}px, ${panY}px) scale(${modalScale})`,
                cursor: isDragging ? 'grabbing' : 'grab'
              }"
              v-html="svgContent"
            ></div>
          </div>

          <!-- 底部快捷操作提示 -->
          <div class="moe-lightbox-footer">
            <span>💡 提示：按住鼠标左键可拖动画布，滚轮可自由缩放，按 <b>ESC</b> 键随时退出全屏</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  code: string
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const svgContent = ref('')
const isLoading = ref(true)
const error = ref('')
const isCopied = ref(false)

// 懒渲染状态与 IntersectionObserver
let isRendered = false
let observer: IntersectionObserver | null = null

// 页内缩放状态
const inlineScale = ref(1)

// 全屏灯箱状态
const isModalOpen = ref(false)
const modalScale = ref(1.2)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStart = { x: 0, y: 0 }

// 模块级单例初始化状态
let mermaidInitialized = false

// 页内缩放控制
function zoomInInline() {
  inlineScale.value = Math.min(inlineScale.value + 0.2, 2.5)
}

function zoomOutInline() {
  inlineScale.value = Math.max(inlineScale.value - 0.2, 0.6)
}

function resetInline() {
  inlineScale.value = 1
}

// 全屏灯箱控制
function openModal() {
  isModalOpen.value = true
  modalScale.value = 1.3
  panX.value = 0
  panY.value = 0
  if (typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden'
  }
}

function closeModal() {
  isModalOpen.value = false
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
}

function zoomInModal() {
  modalScale.value = Math.min(modalScale.value + 0.25, 4.0)
}

function zoomOutModal() {
  modalScale.value = Math.max(modalScale.value - 0.25, 0.4)
}

function resetModal() {
  modalScale.value = 1.2
  panX.value = 0
  panY.value = 0
}

// 滚轮无极缩放
function handleWheel(event: WheelEvent) {
  const delta = event.deltaY < 0 ? 0.15 : -0.15
  modalScale.value = Math.max(0.4, Math.min(modalScale.value + delta, 4.5))
}

// 鼠标拖拽画布
function startDrag(event: MouseEvent) {
  isDragging.value = true
  dragStart.x = event.clientX - panX.value
  dragStart.y = event.clientY - panY.value
}

function onDrag(event: MouseEvent) {
  if (!isDragging.value) return
  panX.value = event.clientX - dragStart.x
  panY.value = event.clientY - dragStart.y
}

function stopDrag() {
  isDragging.value = false
}

// 复制源码
async function copyCode() {
  try {
    const raw = decodeURIComponent(props.code).trim()
    await navigator.clipboard.writeText(raw)
    isCopied.value = true
    setTimeout(() => {
      isCopied.value = false
    }, 2000)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

// 全局 ESC 退出全屏监听
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isModalOpen.value) {
    closeModal()
  }
}

async function renderDiagram() {
  if (typeof window === 'undefined') return
  isLoading.value = true
  error.value = ''

  try {
    let rawCode = decodeURIComponent(props.code).trim()
    if (!rawCode) {
      isLoading.value = false
      return
    }

    // 语法自愈预处理：连接线文本 -->|text| 若包含括号 () 等字符，自动加双引号包裹
    rawCode = rawCode.replace(/-->\|([^"\n|]+)\|/g, (match, label) => {
      const trimmed = label.trim()
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        return match
      }
      if (/[()[\]{}:;]/.test(trimmed)) {
        return `-->|"${trimmed}"|`
      }
      return match
    })

    // 快速检测字体，最多等待 150ms 超时回退，彻底防止外部网络波动卡死渲染
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 150)),
      ])
    }

    const { default: mermaid } = await import('mermaid')

    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        flowchart: {
          padding: 24,
          htmlLabels: true,
          useMaxWidth: true,
          nodeSpacing: 50,
          rankSpacing: 50,
          curve: 'basis',
        },
        themeVariables: {
          primaryColor: '#fce7f3',
          primaryTextColor: '#2d1b1e',
          primaryBorderColor: '#f472b6',
          lineColor: '#836551',
          secondaryColor: '#fef3c7',
          tertiaryColor: '#e0f2fe',
          background: '#ffffff',
          mainBkg: '#fff5f8',
          nodeBorder: '#f472b6',
          clusterBkg: 'rgba(255, 255, 255, 0.75)',
          clusterBorder: '#f9a8d4',
          fontSize: '13.5px',
          edgeLabelBackground: '#ffffff',
          actorBorder: '#f472b6',
          actorBkg: '#fce7f3',
          signalColor: '#836551',
          signalTextColor: '#2d1b1e',
        },
      })
      mermaidInitialized = true
    }

    const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`
    const { svg } = await mermaid.render(uniqueId, rawCode)
    svgContent.value = svg
  } catch (err) {
    console.error('[Mermaid Render Error]', err)
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
  }
}

function initLazyRender() {
  if (typeof window === 'undefined') return
  if ('IntersectionObserver' in window && wrapperRef.value) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !isRendered) {
            isRendered = true
            renderDiagram()
            observer?.disconnect()
            observer = null
            break
          }
        }
      },
      { rootMargin: '250px 0px' }
    )
    observer.observe(wrapperRef.value)
  } else {
    // 降级兜底直接渲染
    isRendered = true
    renderDiagram()
  }
}

onMounted(() => {
  initLazyRender()
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = ''
  }
})

watch(() => props.code, () => {
  renderDiagram()
})
</script>

<style scoped>
.moe-mermaid-wrapper {
  margin: 1.8rem 0;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid var(--moe-cocoa-brown, #4a3728);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 4px 4px 0 var(--moe-sakura-pink, #f472b6);
  backdrop-filter: blur(8px);
  content-visibility: auto;
  contain-intrinsic-size: 1px 300px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.moe-mermaid-wrapper:hover {
  box-shadow: 6px 6px 0 var(--moe-sakura-pink, #f472b6);
}

.moe-mermaid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #fff0f5;
  border-bottom: 2px solid var(--moe-cocoa-brown, #4a3728);
  gap: 8px;
  flex-wrap: wrap;
}

.moe-mermaid-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.moe-mermaid-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

.dot-red { background: #ff5f56; }
.dot-yellow { background: #ffbd2e; }
.dot-green { background: #27c93f; }

.moe-mermaid-label {
  margin-left: 6px;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--moe-cocoa-brown, #4a3728);
  letter-spacing: 0.5px;
}

/* 操作工具栏 */
.moe-mermaid-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.moe-tool-btn {
  padding: 3px 8px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--moe-cocoa-brown, #4a3728);
  background: #ffffff;
  border: 1.5px solid var(--moe-cocoa-brown, #4a3728);
  border-radius: 4px;
  box-shadow: 1px 1px 0 var(--moe-cocoa-brown, #4a3728);
  cursor: pointer;
  transition: all 0.1s ease;
  user-select: none;
}

.moe-tool-btn:hover {
  transform: translate(-1px, -1px);
  box-shadow: 2px 2px 0 var(--moe-cocoa-brown, #4a3728);
  background: #fff5f8;
}

.moe-tool-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 0 0 0;
}

.moe-tool-btn.highlight {
  background: #fbcfe8;
  color: #9d174d;
}

.moe-tool-btn.highlight:hover {
  background: #f472b6;
  color: #ffffff;
}

/* 主体内容区 */
.moe-mermaid-body {
  position: relative;
  padding: 1.5rem 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow-x: auto;
  min-height: 140px;
  cursor: zoom-in;
}

.moe-mermaid-viewport {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.moe-mermaid-svg-container {
  width: 100%;
  display: flex;
  justify-content: center;
  transition: transform 0.2s ease;
}

.moe-mermaid-svg-container :deep(svg) {
  max-width: 100% !important;
  height: auto !important;
}

/* 阻止 foreignObject 裁剪文字 */
.moe-mermaid-svg-container :deep(foreignObject) {
  overflow: visible !important;
}

.moe-mermaid-svg-container :deep(.node .label) {
  line-height: 1.45 !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  color: #2d1b1e !important;
  text-align: center !important;
}

.moe-mermaid-svg-container :deep(.node rect),
.moe-mermaid-svg-container :deep(.node polygon) {
  stroke-width: 2px !important;
  rx: 6px !important;
  ry: 6px !important;
}

.moe-mermaid-svg-container :deep(.edgeLabel) {
  font-size: 12px !important;
  color: #4a3728 !important;
}

/* 仅对内层文本标签应用背景防连线遮挡，绝不对外层 SVG <g> 容器设置 border 避免产生悬空半括号残边 */
.moe-mermaid-svg-container :deep(.edgeLabel span),
.moe-mermaid-svg-container :deep(.edgeLabel p) {
  background-color: rgba(255, 255, 255, 0.95) !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  display: inline-block;
  line-height: 1.35 !important;
}

/* 悬浮提示胶囊 */
.moe-zoom-hint {
  position: absolute;
  right: 10px;
  bottom: -6px;
  background: rgba(255, 255, 255, 0.92);
  border: 1.5px solid #f472b6;
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #db2777;
  box-shadow: 0 2px 6px rgba(244, 114, 182, 0.2);
  opacity: 0.6;
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: auto;
  cursor: pointer;
}

.moe-mermaid-body:hover .moe-zoom-hint {
  opacity: 1;
  transform: translateY(-2px);
}

/* 加载中与错误状态 */
.moe-mermaid-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #db2777;
  font-weight: 600;
  font-size: 0.95rem;
}

.loading-icon {
  animation: spin 1.5s infinite linear;
  display: inline-block;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.moe-mermaid-error {
  width: 100%;
  padding: 12px;
  background: #fff1f2;
  border: 1px dashed #f43f5e;
  border-radius: 6px;
  color: #be123c;
  font-size: 0.85rem;
}

.moe-mermaid-error pre {
  margin-top: 6px;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-all;
}

/* --- 全屏灯箱模态框样式 (Lightbox Modal) --- */
.moe-lightbox-mask {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(45, 27, 30, 0.75);
  backdrop-filter: blur(12px) saturate(160%);
  display: flex;
  flex-direction: column;
  user-select: none;
}

.moe-lightbox-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 2px solid var(--moe-cocoa-brown, #4a3728);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.lightbox-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lightbox-title {
  font-size: 1rem;
  font-weight: 800;
  color: var(--moe-cocoa-brown, #4a3728);
}

.lightbox-scale-badge {
  background: #fce7f3;
  color: #db2777;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid #f472b6;
}

.lightbox-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lightbox-btn {
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--moe-cocoa-brown, #4a3728);
  background: #ffffff;
  border: 2px solid var(--moe-cocoa-brown, #4a3728);
  border-radius: 6px;
  box-shadow: 2px 2px 0 var(--moe-cocoa-brown, #4a3728);
  cursor: pointer;
  transition: all 0.1s ease;
}

.lightbox-btn:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 var(--moe-cocoa-brown, #4a3728);
  background: #fff5f8;
}

.lightbox-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 0 0 0;
}

.lightbox-btn.close-btn {
  background: #f43f5e;
  color: #ffffff;
  border-color: #be123c;
  margin-left: 12px;
}

.lightbox-btn.close-btn:hover {
  background: #e11d48;
}

.moe-lightbox-canvas {
  flex: 1;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  padding: 40px;
}

.moe-lightbox-svg-wrapper {
  transition: transform 0.05s ease-out;
  transform-origin: center center;
  will-change: transform;
}

.moe-lightbox-svg-wrapper :deep(svg) {
  min-width: 600px;
  max-width: none !important;
  height: auto !important;
  filter: drop-shadow(0 10px 25px rgba(0, 0, 0, 0.25));
}

.moe-lightbox-svg-wrapper :deep(foreignObject) {
  overflow: visible !important;
}

.moe-lightbox-footer {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.85);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  text-align: center;
  font-size: 0.82rem;
  color: #4a3728;
}

/* 渐变过渡动画 */
.moe-modal-fade-enter-active,
.moe-modal-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.moe-modal-fade-enter-from,
.moe-modal-fade-leave-to {
  opacity: 0;
}
</style>
