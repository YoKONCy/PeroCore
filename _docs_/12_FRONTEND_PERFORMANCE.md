# 前端性能优化规范

> **版本**：0.2.0 · **更新时间**：2026-04-17
> **适用范围**：`packages/frontend/` 全部代码
> **依赖规范**：[05_FRONTEND_ARCHITECTURE](./05_FRONTEND_ARCHITECTURE.md)、[06_FILE_SIZE_LIMITS](./06_FILE_SIZE_LIMITS.md)
> **参考项目**：VCPChat（同类 Electron + 聊天 UI 项目，已实施大量性能优化）

---

## 1. 原前端性能审计

### 1.1 文件规模

| 文件 | 行数 | 字节 | 核心问题 |
|---|---|---|---|
| `LauncherView.vue` | **2,571** | 112KB | 巨型单文件，JS + 模板 + CSS 全部内联 |
| `DashboardView.vue` | **2,794** | 80KB | 11 个 Tab 组件虽已拆分，但 DashboardView 本身仍承载 2800 行逻辑+5 个 Modal |
| `ChatInterface.vue` | **2,193** | 80KB | SSE 流式渲染 + 消息解析 + 音频播放全在一个文件 |
| `Pet3DView.vue` | **2,518** | 68KB | Three.js 3D 渲染 + 音频 + 语音 + UI 混合 |
| `StrongholdView.vue` | **681** | 29KB | 相对合理 |

### 1.2 发现的具体问题

#### ① `<keep-alive>` 无限缓存

```vue
<!-- App.vue L4-7 -->
<keep-alive>
  <component :is="Component" />
</keep-alive>
```

**问题**：所有路由组件永远不会被销毁。Pet3DView 的 Three.js 场景、LauncherView 的下载定时器、ChatInterface 的 SSE 连接全部同时驻留内存。

#### ② `setInterval` 泄漏风险

| 文件 | 定时器 | 间隔 | 清理 |
|---|---|---|---|
| `Pet3DView.vue:1148` | `fetchPetState` | 30s | ❌ 无 `clearInterval`（但 keep-alive 会阻止 onUnmounted 触发） |
| `ChatInterface.vue:1854` | `groupPollingInterval` | - | ✅ 有清理 |
| `ChatInterface.vue:1895` | `visionCheckInterval` | 5s | ✅ 有清理 |
| `StrongholdView.vue:681` | `pollTimer` | 5s | ✅ 有清理 |
| `ReActProcessViewer.vue:123` | `statusTimer` | 2s | ✅ 有清理 |
| `LauncherView.vue:2185` | `statsInterval` | 2s | ✅ 有清理 |

#### ③ Markdown 渲染无缓存

`AsyncMarkdown.vue` 每次 `props.content` 变化都重新执行 `marked.parse()` + `DOMPurify.sanitize()` + highlight.js 全量渲染。对于 SSE 流式追加的消息，**每个 delta token 都触发完整的 Markdown + 代码高亮重渲**。

#### ④ 重复 watch 监听

`AsyncMarkdown.vue` 对 `props.content` 注册了 **两个 watch**（L146 和 L157），每次内容变化调用 `render()` 两次。

#### ⑤ `addEventListener` 清理不确定

| 文件 | 注册数 | 清理 |
|---|---|---|
| `Pet3DView.vue` | 6 个 window 事件 | ✅ 在 `onUnmounted` 中清理，但 keep-alive 下不一定触发 |
| `BedrockAvatar.vue` | 4 个 window 事件 | ✅ 有清理 |
| `ContextMenu.vue` | 3 个 window 事件 | ❓ 匿名函数，无法正确 removeEventListener |
| `OnboardingOverlay.vue` | 2 个 window 事件 | ✅ 有清理 |
| `App.vue` | 2 个 window 事件 | ❌ 永不清理（生命周期内始终活跃，问题不大） |

#### ⑥ 消息列表无虚拟滚动

`ChatInterface.vue` 的消息列表使用 `v-for` 直接渲染所有消息。当对话历史很长时，DOM 节点数量线性增长，每个消息还包含多段 `parseMessage()` → `AsyncMarkdown` 渲染链。

#### ⑦ DashboardView Tabs 同步导入

虽然 11 个 Tab 组件被拆分成独立文件，但 DashboardView 全部 **同步 import**。未使用的 Tab 也会被打入首屏 chunk。

#### ⑧ `defineAsyncComponent` 完全未使用

项目中 **0 个** `defineAsyncComponent` 调用。所有组件都是同步导入。

#### ⑨ 部分数据已用 `shallowRef` 优化

**亮点：** Dashboard composables 中已正确使用 `shallowRef` 保存大型数组（memories、logs、tasks）和 Three.js 对象。这是好的做法。

---

## 2. VCPChat 性能优化策略参考

> VCPChat 是同类型 Electron + 聊天 UI 项目（原生 HTML + JS），在前端性能方面做了大量精细化优化。
> 以下归纳其核心策略，以供 PeroCore-TS 迁移时参考借鉴。

### 2.1 morphdom 增量 DOM 更新

VCPChat 引入 [morphdom](https://github.com/patrick-steele-idem/morphdom) 做 SSE 流式消息的 DOM diff-patch。不是每次销毁重建 DOM，而是把新 HTML 通过 morphdom 与现有 DOM 做最小化 diff：

```javascript
// VCPChat streamManager.js
morphdom(tailRoot, `<div>${rawHtml}</div>`, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl, toEl) {
        if (fromEl.isEqualNode(toEl)) return false;     // 跳过相同节点
        if (fromEl.tagName === 'VIDEO' && !fromEl.paused) return false; // 保留播放状态
        if (fromEl.tagName === 'IMG' && fromEl.complete) return false;  // 已加载图片不动
        return true;
    }
});
```

**PeroCore-TS 借鉴**：Vue 的 vDOM diff 不适用于 `v-html` 场景。流式 Markdown 渲染考虑在 composable 层手动管理 DOM diff。

### 2.2 稳定区/尾部区分段渲染

StreamManager 将消息内容拆成两个 DOM 区域：

- **`stable-root`**：已闭合的完整结构（代码块、工具调用块等），**只渲染一次**
- **`tail-root`**：正在流式追加的尾部，**每帧只用 morphdom 更新这部分**

```
┌──────────────────────────────────────┐
│ stable-root (不再变化)               │
│ - 已闭合的代码块 ✅                   │
│ - 已闭合的工具调用 ✅                 │
├──────────────────────────────────────┤
│ tail-root (每帧 morphdom 更新)       │
│ - 当前正在追加的段落                  │
│ - 未闭合的代码块                      │
└──────────────────────────────────────┘
```

**关键算法**：`findExplicitStablePrefix()` 会扫描文本，找出所有已闭合的代码块 (`` ``` ``→`` ``` ``)、工具调用块等，将其标记为"稳定前缀"。这比简单的 debounce 更精细——在**语义结构级别**做了增量切割。

### 2.3 全局 `requestAnimationFrame` 渲染循环

不是每条消息各启一个定时器，而是用一个统一的 renderLoop，且限制到 **30fps**：

```javascript
// VCPChat streamManager.js：全局渲染循环
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

function renderLoop(currentTime) {
    if (elapsed < FRAME_INTERVAL) {
        requestAnimationFrame(renderLoop); return;  // 跳过本帧
    }
    for (const [messageId] of streamingTimers) {
        processAndRenderSmoothChunk(messageId);       // 统一处理所有活动流
    }
    requestAnimationFrame(renderLoop);
}
```

**PeroCore-TS 借鉴**：如果有多条消息同时流式输出（群聊场景），统一调度比各自 watch 更高效。

### 2.4 IntersectionObserver 视界优化器

VCPChat 用 `IntersectionObserver` 监测每条消息是否在可视区域内，**自动暂停不可见消息的所有资源消耗**：

| 资源类型 | 不可见时操作 | 恢复操作 |
|---|---|---|
| CSS @keyframes | 添加 `.vcp-paused` 类 | 移除 `.vcp-paused` |
| Web Animations API | `anim.pause()` | `anim.play()` |
| anime.js 实例 | `anim.pause()` | `anim.play()` |
| Three.js 渲染循环 | `cancelAnimationFrame` + `setAnimationLoop(null)` | 重启 renderLoop |
| Canvas + rAF 动画 | `pauseCallback()` + `visibility: hidden` | `resumeCallback()` |
| video / audio | `media.pause()` + 记录 wasPlaying | `media.play()` |
| SVG SMIL 动画 | `svg.pauseAnimations()` | `svg.unpauseAnimations()` |
| GIF / WebP 动图 | `visibility: hidden` | `visibility: visible` |

额外特性：
- **`MutationObserver`**：监听消息内动态插入的新元素，自动纳入暂停/恢复管理
- **`Element.prototype.animate` 全局拦截**：自动注册新创建的 Web Animations
- **`createPausableRAF()`**：包装 rAF，让嵌入脚本的 Canvas 动画也能被暂停
- **批量处理队列**：50ms 节流，避免频繁触发暂停/恢复
- **`containIntrinsicSize` 固化高度**：配合 `content-visibility: auto` 优化大量消息的布局性能

**PeroCore-TS 借鉴**：这是虚拟滚动的**轻量替代方案**。所有消息保留在 DOM 中，但不可见的不消耗 CPU/GPU。对于聊天消息中嵌入动画、视频、Three.js 场景的场景，比虚拟滚动更优雅。

### 2.5 分批渲染历史消息

加载聊天历史时不是一次性渲染，而是分阶段：

1. **先渲染最新 5 条**（用户立刻看到最近的对话）
2. 用 `requestIdleCallback`（降级到 `requestAnimationFrame`）在**浏览器空闲时**分批插入旧消息（每批 10 条）
3. 用 `DocumentFragment` 批量 appendChild，减少 reflow
4. 动态调整延迟：小批次减少等待时间

```javascript
// VCPChat messageRenderer.js
if ('requestIdleCallback' in window) {
    requestIdleCallback(insertBatch, { timeout: 1000 });
} else {
    requestAnimationFrame(insertBatch);
}
```

### 2.6 DOM 引用缓存 + 视图上下文缓存

避免流式渲染期间频繁的 DOM 查询和视图计算：

```javascript
// VCPChat streamManager.js
const messageDomCache = new Map();     // messageId → {messageItem, contentDiv}
const viewContextCache = new Map();     // messageId → boolean (是否在当前视图)
let currentViewSignature = null;        // 视图切换时才清空缓存
```

附带优化：
- 滚动 **100ms 节流**
- 历史保存 **1000ms 防抖**
- 话题列表 IPC 请求 **阶梯式延迟**（`100 + index * 10` ms）

### 2.7 双模式内容处理流水线

区分 full-render 和 stream-fast 两种 Markdown 预处理路径：

| 模式 | 步骤 | 场景 |
|---|---|---|
| `FULL_RENDER` | 11 步（含保护/转换/恢复） | 最终消息渲染、编辑后刷新 |
| `STREAM_FAST` | 4 步（仅轻量幂等修正） | SSE 流式追加中的每帧 |

---

## 3. v2 优化方案

> 综合 PeroCore v1 审计结果和 VCPChat 参考经验，制定以下优化方案。

### 3.1 `<keep-alive>` 白名单控制

```vue
<!-- App.vue -->
<router-view v-slot="{ Component }">
  <keep-alive :include="['DashboardView']" :max="2">
    <component :is="Component" />
  </keep-alive>
</router-view>
```

**规则**：
- 只缓存切换频繁且初始化开销大的页面（如 DashboardView）
- Pet3DView（Three.js）和 LauncherView 不应缓存 — 离开时必须释放 GPU/WebGL 资源
- ChatInterface 使用 Pinia 持久化消息状态，组件可安全销毁

### 3.2 SSE 流式 Markdown 增量渲染（借鉴 VCPChat 分段架构）

**核心思路**：将 VCPChat 的"稳定区/尾部区"分段策略移植到 Vue composable 中：

```typescript
// composables/chat/useStreamMarkdown.ts

/** 流式消息的增量 Markdown 渲染
 *  策略：稳定区/尾部区分段 + 帧率限制 + 已完成消息缓存
 */
export function useStreamMarkdown() {
  const stableHtml = ref('')           // 已闭合块的渲染结果（不再变化）
  const tailHtml = ref('')             // 正在追加的尾部 HTML
  let stableCutoff = 0                 // 稳定前缀的字符偏移

  function onChunk(fullText: string) {
    // 1. 查找已闭合的结构边界（代码块、工具调用块等）
    const newCutoff = findStablePrefix(fullText, stableCutoff)

    // 2. 稳定区仅在边界推进时更新（渲染一次后不再变）
    if (newCutoff > stableCutoff) {
      stableHtml.value = marked.parse(fullText.slice(0, newCutoff))
      stableCutoff = newCutoff
    }

    // 3. 尾部每帧使用轻量 STREAM_FAST 流水线
    tailHtml.value = marked.parse(
      applyStreamFastPipeline(fullText.slice(stableCutoff))
    )
  }

  // 30fps 帧率限制（与 VCPChat 一致）
  const throttledChunk = useThrottleFn(onChunk, 33)

  return { stableHtml, tailHtml, onChunk: throttledChunk }
}
```

**关键函数 `findStablePrefix()`**：

```typescript
/** 扫描已闭合的 Markdown 结构，返回稳定前缀的字符偏移 */
function findStablePrefix(text: string, startOffset: number): number {
  let stableCutoff = startOffset
  let i = startOffset

  while (i < text.length) {
    // 已闭合的代码块
    if (text.startsWith('```', i)) {
      const fenceEnd = findMatchingFenceEnd(text, i)
      if (fenceEnd === -1) break  // 未闭合 → 停止
      stableCutoff = fenceEnd
      i = fenceEnd
      continue
    }
    // 已闭合的工具调用
    if (text.startsWith('<<<[TOOL_REQUEST]>>>', i)) { /* ... */ }
    i++
  }
  return stableCutoff
}
```

**对应模板**：

```vue
<template>
  <div class="message-content">
    <!-- 稳定区：不再变化 -->
    <div class="stream-stable" v-html="stableHtml" />
    <!-- 尾部：每帧更新 -->
    <div class="stream-tail" v-html="tailHtml" />
  </div>
</template>
```

### 3.3 IntersectionObserver 不可见消息暂停（替代纯虚拟滚动）

```typescript
// composables/chat/useMessageVisibility.ts

/** 自动暂停不可见消息的动画和媒体资源 */
export function useMessageVisibility(chatContainer: Ref<HTMLElement | null>) {
  const observer = ref<IntersectionObserver | null>(null)
  const pausedMessages = new WeakSet<HTMLElement>()

  onMounted(() => {
    observer.value = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          if (entry.isIntersecting) {
            resumeMessage(el)
            pausedMessages.delete(el)
          } else {
            pauseMessage(el)
            pausedMessages.add(el)
          }
        }
      },
      { root: chatContainer.value, rootMargin: '200px 0px', threshold: 0 }
    )
  })

  function pauseMessage(el: HTMLElement) {
    el.classList.add('msg-paused')
    // 暂停 Web Animations
    el.getAnimations({ subtree: true }).forEach(a => {
      if (a.playState === 'running') a.pause()
    })
    // 暂停视频/音频
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach(m => {
      if (!m.paused) { m.dataset.wasPlaying = 'true'; m.pause() }
    })
    // 固化高度供 content-visibility 使用
    el.style.containIntrinsicSize = `auto ${el.offsetHeight}px`
  }

  function resumeMessage(el: HTMLElement) {
    el.classList.remove('msg-paused')
    el.getAnimations({ subtree: true }).forEach(a => {
      if (a.playState === 'paused') a.play()
    })
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach(m => {
      if (m.dataset.wasPlaying === 'true') { m.play(); delete m.dataset.wasPlaying }
    })
  }

  function observe(messageEl: HTMLElement) {
    observer.value?.observe(messageEl)
  }

  function unobserve(messageEl: HTMLElement) {
    observer.value?.unobserve(messageEl)
    pausedMessages.delete(messageEl)
  }

  onUnmounted(() => observer.value?.disconnect())

  return { observe, unobserve }
}
```

**配套 CSS**：

```css
.msg-paused {
  content-visibility: auto;
  /* contain-intrinsic-size 由 JS 动态设置 */
}
.msg-paused video,
.msg-paused canvas {
  visibility: hidden;
}
/* 暂停 CSS 动画 */
.msg-paused * {
  animation-play-state: paused !important;
}
```

### 3.4 分批渲染历史消息

```typescript
// composables/chat/useHistoryRenderer.ts

/** 分批加载聊天历史，首批先渲染最新 N 条 */
export function useHistoryRenderer(chatContainer: Ref<HTMLElement | null>) {
  async function renderHistory(
    messages: ChatMessage[],
    options = { initialBatch: 5, batchSize: 10, batchDelay: 80 }
  ) {
    const { initialBatch, batchSize, batchDelay } = options

    if (messages.length <= initialBatch) {
      // 少量消息直接渲染
      return messages
    }

    // 阶段 1：立即渲染最新 N 条
    const latest = messages.slice(-initialBatch)
    renderBatch(latest)
    await nextTick()

    // 阶段 2：用 requestIdleCallback 分批渲染历史
    const older = messages.slice(0, -initialBatch)
    for (let i = older.length; i > 0; i -= batchSize) {
      const batch = older.slice(Math.max(0, i - batchSize), i)
      await idleInsertBatch(batch)
      await sleep(batchDelay)
    }
  }

  function idleInsertBatch(batch: ChatMessage[]): Promise<void> {
    return new Promise(resolve => {
      const insert = () => { renderBatch(batch); resolve() }
      if ('requestIdleCallback' in window) {
        requestIdleCallback(insert, { timeout: 1000 })
      } else {
        requestAnimationFrame(insert)
      }
    })
  }

  return { renderHistory }
}
```

### 3.5 组件异步加载

```typescript
// DashboardView.vue — Tab 组件异步加载
const OverviewTab = defineAsyncComponent(() => import('./tabs/OverviewTab.vue'))
const MemoriesTab = defineAsyncComponent(() => import('./tabs/MemoriesTab.vue'))
const ModelConfigTab = defineAsyncComponent(() => import('./tabs/ModelConfigTab.vue'))
// ... 其他 Tab

// 3D 重型组件
const BedrockAvatar = defineAsyncComponent({
  loader: () => import('@/components/avatar/BedrockAvatar.vue'),
  loadingComponent: AvatarSkeleton,
  delay: 200,
})
```

### 3.6 事件监听器生命周期管理

```typescript
// composables/useEventListener.ts
import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

/** 自动管理 addEventListener / removeEventListener 的 composable */
export function useEventListener(
  target: EventTarget | Ref<EventTarget | null>,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) {
  const add = () => {
    const el = unref(target)
    el?.addEventListener(event, handler, options)
  }
  const remove = () => {
    const el = unref(target)
    el?.removeEventListener(event, handler, options)
  }

  // 兼容 keep-alive：activated 重新绑定，deactivated 解绑
  onMounted(add)
  onActivated(add)
  onUnmounted(remove)
  onDeactivated(remove)
}
```

### 3.7 定时器生命周期管理

```typescript
// composables/useInterval.ts

/** 自动管理 setInterval 的 composable，兼容 keep-alive */
export function useInterval(
  callback: () => void,
  interval: number,
  options?: { immediate?: boolean },
) {
  let timer: ReturnType<typeof setInterval> | null = null

  const start = () => {
    stop()
    if (options?.immediate) callback()
    timer = setInterval(callback, interval)
  }
  const stop = () => {
    if (timer) { clearInterval(timer); timer = null }
  }

  onMounted(start)
  onActivated(start)
  onUnmounted(stop)
  onDeactivated(stop)

  return { start, stop }
}
```

### 3.8 大列表优化继承

v1 已在 Dashboard composables 中使用 `shallowRef` 保存 memories/logs/tasks 列表。v2 延续此策略，并扩展：

```typescript
// ✅ 大型数组用 shallowRef (已有)
const memories = shallowRef<MemoryDto[]>([])
const logs = shallowRef<LogEntry[]>([])

// ✅ 新增：消息列表也用 shallowRef
const messages = shallowRef<ChatMessage[]>([])

// ✅ 新增：Three.js 对象用 shallowRef (已有)
const scene = shallowRef<THREE.Scene | null>(null)

// ❌ 禁止：对大型数组使用 ref（深度响应，性能灾难）
const messages = ref<ChatMessage[]>([])  // 每个字段都是 Proxy
```

### 3.9 构建优化

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // 手动分包
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-three': ['three'],
          'vendor-markdown': ['marked', 'dompurify', 'highlight.js'],
          'vendor-monaco': ['@guolao/vue-monaco-editor'],
          'vendor-protobuf': ['protobufjs'],
        },
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 资源内联阈值 (小于 4KB 的资源内联为 base64)
    assetsInlineLimit: 4096,
  },
})
```

### 3.10 图片与资源优化

| 策略 | 说明 |
|---|---|
| 懒加载 | 消息中的图片使用 `loading="lazy"` 和 IntersectionObserver |
| WebP 优先 | 构建时将 PNG/JPG 转为 WebP |
| 图片压缩 | 用户上传图片在前端预压缩后再发送 |
| SVG 精灵 | PixelIcon 组件的像素图标改为 SVG sprite sheet |

### 3.11 Web Worker 卸载

将 CPU 密集型操作移到 Web Worker：

| 操作 | 理由 |
|---|---|
| Markdown 渲染 | `marked.parse()` + highlight.js 对长文本可能阻塞 UI 线程 |
| DOMPurify 净化 | 对大量 HTML 内容的净化操作 |
| 消息解析 | `parseMessage()` 中的正则匹配（thinking/monologue/tool 块解析） |
| 搜索过滤 | Dashboard 中记忆/日志的客户端筛选 |

---

## 4. PeroCore v1 vs VCPChat 对照表

| 优化维度 | VCPChat ✅ | PeroCore v1 ❌ | v2 方案 |
|---|---|---|---|
| 流式 DOM 更新 | morphdom diff patch | `v-html` 全量替换 | 稳定区/尾部区分段 + Vue 响应式 |
| 渲染调度 | 全局 rAF Loop + 30fps 限流 | 每条消息独立 watch 触发 | `useThrottleFn` 33ms |
| 内容分段 | `findExplicitStablePrefix()` | 全文每次重渲 | `findStablePrefix()` composable |
| 不可见消息 | IntersectionObserver 暂停全部动画 | 无（keep-alive 全缓存） | `useMessageVisibility` composable |
| 历史加载 | 先 5 条 + requestIdleCallback 分批 | 一次性全量渲染 | `useHistoryRenderer` 分批 |
| DOM 查询 | Map 缓存 + 签名失效 | 每次 querySelector | Vue ref + Map 缓存 |
| 渲染流水线 | FULL / STREAM_FAST 双模式 | 统一完整流水线 | 双模式流水线 |
| 滚动节流 | 100ms 节流 | 无节流 | `useThrottleFn` |
| IPC/数据保存 | 1000ms 防抖 | 无防抖 | `useDebounceFn` |

---

## 5. 优先级

| 优先级 | 优化项 | 预期收益 | 参考来源 |
|---|---|---|---|
| **P0** | keep-alive 白名单 | 防止 GPU/Timer/WebSocket 泄漏 | PeroCore 审计 |
| **P0** | useEventListener / useInterval composable | 杜绝事件/定时器泄漏 | PeroCore 审计 |
| **P0** | SSE Markdown 稳定区/尾部区分段渲染 | 流式聊天不再卡顿 | **VCPChat** |
| **P0** | IntersectionObserver 不可见消息暂停 | 不可见的动画/视频/Canvas 不消耗资源 | **VCPChat** |
| **P1** | 分批渲染历史消息 | 切换话题时首屏秒开 | **VCPChat** |
| **P1** | Tab 组件 defineAsyncComponent | 首屏 JS 减少 ~40% | PeroCore 审计 |
| **P1** | Vite manualChunks 分包 | 首屏加载 chunk 缩小 | PeroCore 审计 |
| **P2** | shallowRef 扩展到消息列表 | 减少不必要的深度响应 | PeroCore 审计 |
| **P2** | 双模式渲染流水线 | 流式中省去不必要的预处理步骤 | **VCPChat** |
| **P2** | Markdown Web Worker | 长消息渲染不阻塞 UI | PeroCore 审计 |
| **P2** | 图片懒加载 + WebP | 减少带宽和内存占用 | PeroCore 审计 |
| **P3** | SVG 精灵 | 减少 HTTP 请求 | PeroCore 审计 |

---

## 6. 待定事项

- [x] ~~SSE 增量渲染的具体 diff 算法~~ → 采用 VCPChat 的稳定区/尾部区分段架构
- [x] ~~虚拟滚动库选型~~ → 优先使用 IntersectionObserver 暂停方案（VCPChat 验证有效），如不足再引入虚拟滚动
- [ ] `findStablePrefix()` 需支持的 Markdown 结构清单（代码块、数学公式块、工具调用块等）
- [ ] Three.js WebGL 资源释放检查清单（Pet3DView / BedrockAvatar）
- [ ] Markdown Web Worker 具体实现方案（marked + highlight.js 是否支持 Worker 环境）
- [ ] 双模式流水线 STREAM_FAST 应跳过哪些具体步骤

---

*本文档由 Carola 整理，适用于 PeroCore-TS 前端性能优化规范。*
*v0.2.0 更新：融入 VCPChat 性能优化策略分析，补充稳定区/尾部区分段渲染、IntersectionObserver、分批加载等方案。*
