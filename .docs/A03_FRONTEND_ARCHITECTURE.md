# 前端架构与性能优化

> **适用范围**：`packages/frontend/` 全部代码
> **技术栈**：Vue 3 + Vite + Pinia + TailwindCSS 4 + logic composables
> **最后更新**：2026-04-22

---

## 1. 核心架构

前端采用 **"视图-Store-逻辑"** 三层分离架构，并引入 **Transport 层** 实现跨环境兼容。

```
┌─────────────────────────────────────────────────────────┐
│  View 层 (views/ components/)                            │
│  职责：UI 渲染、组件编排、用户交互                        │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Logic 层 (composables/)                                 │
│  职责：响应式业务逻辑 (useXxx)、生命周期管理、UI 状态控制   │
└───────────┬───────────┴───────────┬─────────────────────┘
            │                       │
┌───────────▼───────────┐   ┌───────▼─────────────────────┐
│  State 层 (stores/)    │   │  Transport 层 (api/)         │
│  职责：跨组件全局数据    │   │  职责：通信适配 (IPC/REST)   │
└───────────────────────┘   └─────────────────────────────┘
```

---

## 2. 跨环境兼容 (Transport)

同一组件必须能同时运行在 **Electron (桌面)** 和 **Browser (Docker 版)** 中。

- **Electron 模式**：通过 `window.electron` 调用主进程 IPC
- **Browser 模式**：通过 `fetch/WebSocket` 调用后端 API

所有 API 调用统一封装在 `api/` 目录下，并根据环境自动切换实现。

---

## 3. 性能优化 (P0 级别)

> 本规范继承自 PeroCore 审计及 VCPChat 优化经验。

### 3.1 `<keep-alive>` 白名单

- **原则**：只缓存切换频繁且初始化开销大的页面。
- **Electron 白名单**：`['DashboardView']`
- **Browser/Docker 例外**：`WebShellView` 作为 Web 容器入口承载浏览器模式的长生命周期 Shell 状态，顶层允许在 Browser/Docker 模式缓存 `['WebShellView']`。
- **必须销毁**：`Pet3DView` (释放 WebGL)、`LauncherView` (停止下载计时器)、`ChatInterface` (断开 SSE)

### 3.2 响应式性能

- **禁止深度响应**：对大型数组（消息列表、记忆列表、日志、任务）和物理引擎对象（Three.js）必须使用 `shallowRef` 或 `markRaw`。
- **避免多余 watch**：禁止在 `useStreamMarkdown` 等高产出逻辑中使用冗余的深度监听。

### 3.3 流式增量渲染 (30fps)

针对 SSE 流式 Markdown 消息，采用 **"稳定区/尾部区"** 分段架构：

1. **稳定区 (Stable)**：已完全闭合的代码块或段落，只在边界推进时渲染一次，渲染后变为静态 DOM。
2. **尾部区 (Tail)**：正在追加的文本，使用轻量级流水线渲染。
3. **调度**：使用 `useThrottleFn` 限制渲染频率为 33ms (30fps)，避免 token 级频繁重渲。

### 3.4 视界优化 (IntersectionObserver)

不使用复杂的虚拟滚动，采用 **"不可见暂停"** 策略：

- 监测每条消息是否在视口内。
- **不可见时**：暂停消息内的 Web Animations、CSS 动效、Video/Audio、Canvas 循环。
- **可见时**：恢复运行。
- **优化**：在消息容器上使用 `content-visibility: auto`。

---

## 4. 组件规范

### 4.1 逻辑分层示例

```typescript
// composables/chat/useChatFlow.ts (Logic 层)
export function useChatFlow() {
  const messages = shallowRef<ChatMessage[]>([])
  async function sendMessage(text: string) {
    /* ... */
  }
  return { messages, sendMessage }
}
```

```vue
<!-- components/chat/ChatBox.vue (View 层) -->
<script setup>
const { messages, sendMessage } = useChatFlow()
</script>
<template>
  <MessageList :items="messages" />
  <ChatInput @send="sendMessage" />
</template>
```

### 4.2 路由分包

使用 `defineAsyncComponent` 实现路由级代码分割：

```typescript
const DashboardView = () => import('@/views/DashboardView.vue')
const Pet3DView = () => import('@/views/Pet3DView.vue') // 3D 组件必须异步加载
```

---

## 5. 3D 与动画规范 (Three.js)

- **资源管理**：所有 Texture/Geometry 必须在 `onUnmounted` 中手动 dispose。
- **降级处理**：低功耗设备模式下（由 backend 探测），禁用 Bloom、SAO 等昂贵 Shader。
- **离屏渲染**：主 UI 操作时，降低 3D 渲染帧率。

---

## 6. CSS 样式体系

### 6.1 核心原则：Tailwind-First

**Tailwind 是默认选择，scoped CSS 是例外。**

所有组件的布局、间距、颜色、字体、交互状态优先使用 Tailwind utility class 直接写在模板中。只有以下场景才使用 scoped CSS：

- 复杂动画 (`@keyframes`)
- 伪元素 (`::before`, `::after`)
- 滚动条自定义 (`::-webkit-scrollbar`)
- WebGL/Canvas 容器的特殊布局

**禁止的做法**：在 `<style scoped>` 中用自定义类名重新发明 Tailwind 已经提供的 utility（如 `display: flex`、`padding: 8px`、`color: xxx`）。

### 6.2 架构分层

```
┌─────────────────────────────────────────────────────────┐
│  Tailwind Utilities (模板 class="..." 中直接使用)        │
│  ★ 主力：布局/间距/颜色/字体/交互/响应式 全部在这里      │
└──────────────────┬──────────────────────────────────────┘
                   │ 混合使用
┌──────────────────▼──────────────────────────────────────┐
│  全局像素类 (style.css 中定义)                           │
│  pixel-border-*, pixel-btn-*, press-effect, font-pixel  │
│  ★ 像素风视觉语言，直接在模板 class 中引用               │
└──────────────────┬──────────────────────────────────────┘
                   │ 支撑
┌──────────────────▼──────────────────────────────────────┐
│  tokens.css (CSS Variables)                              │
│  颜色令牌单一真相源 → 通过 @theme 桥接到 Tailwind        │
└──────────────────┬──────────────────────────────────────┘
                   │ 仅在必要时
┌──────────────────▼──────────────────────────────────────┐
│  <style scoped> (例外场景)                               │
│  仅用于: @keyframes / 伪元素 / 滚动条 / 复杂选择器       │
└─────────────────────────────────────────────────────────┘
```

### 6.3 模板写法示例

```vue
<!-- ✅ 正确：Tailwind + 全局像素类混合 -->
<div class="flex items-center gap-3 p-4 bg-white pixel-border-sky press-effect">
  <span class="text-sm font-bold text-slate-600 font-pixel">标题</span>
</div>

<!-- ❌ 错误：用 scoped CSS 重写同样效果 -->
<div class="my-card">
  <span class="my-card-title">标题</span>
</div>
<style scoped>
.my-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}
.my-card-title {
  font-size: 14px;
  font-weight: 700;
}
</style>
```

### 6.4 Tailwind 使用范围

#### ✅ 允许使用

| 用途   | 示例                                                                 |
| ------ | -------------------------------------------------------------------- |
| 布局   | `flex`, `grid`, `items-center`, `justify-between`                    |
| 间距   | `p-4`, `m-2`, `gap-3`, `space-y-2`                                   |
| 排版   | `text-lg`, `font-bold`, `font-pixel`, `tracking-wide`                |
| 尺寸   | `w-10`, `h-10`, `min-w-0`, `max-w-xs`                                |
| 颜色   | `bg-white`, `bg-sky-50`, `text-slate-700`, `bg-sky-face`             |
| 边框   | `border`, `border-sky-100`, `rounded-xl`                             |
| 阴影   | `shadow-md`, `shadow-sky-100/50`                                     |
| 交互   | `hover:bg-sky-50`, `group-hover:scale-105`, `active:translate-y-0.5` |
| 过渡   | `transition-all`, `duration-300`                                     |
| 响应式 | `md:grid-cols-2`, `sm:hidden`                                        |
| 条件   | `:class="[cond ? 'bg-white' : 'bg-transparent']"`                    |

#### ❌ 禁止

| 禁止行为                                       | 原因                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| `bg-[#ff00ff]` 硬编码颜色                      | 必须通过 tokens.css → @theme 桥接                    |
| `w-[137px]` 硬编码尺寸                         | 用标准尺寸或极端情况 scoped CSS                      |
| `@apply` 在 scoped style 中大量使用            | 失去了 Tailwind 的优势                               |
| scoped CSS 重写 Tailwind utility               | 不要用 `.card { display: flex }` 代替 `class="flex"` |
| 用 Tailwind `box-shadow` 替代 `pixel-border-*` | 像素风类是项目核心视觉，不可替代                     |

### 6.5 色彩使用优先级

```
1. @theme 桥接色 (bg-sky-face, text-pink-shadow, border-sky-100)
   ↓ 通用中性色
2. Tailwind 原生色板 (bg-white, text-slate-700, bg-emerald-50)
   ↓ 极端情况需要自定义
3. tokens.css var() 在 scoped CSS 中 (仅 @keyframes / 伪元素等)
   ↓ 禁止
4. ❌ 硬编码 (bg-[#ff0000], color: #xxx)
```

### 6.6 像素风全局类 (pixel-\*)

以下定义在 `style.css` 中的类是项目核心视觉语言，**直接在模板 class 中引用**：

| 类别     | 类名                                                                                                     | 用途                      |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| 像素边框 | `pixel-border-sm`, `pixel-border-sky`, `pixel-border-pink`, `pixel-border-emerald`, `pixel-border-amber` | FC 风多层 box-shadow 边框 |
| 像素按钮 | `pixel-btn-sky`, `pixel-btn-pink`, `pixel-btn-yellow`                                                    | 完整像素风按钮样式        |
| 像素卡片 | `pixel-card`, `pixel-card-moe`                                                                           | 像素风卡片容器            |
| 像素字体 | `font-pixel`                                                                                             | Zpix/DotGothic16 像素字体 |
| 像素网格 | `pixel-grid-overlay`                                                                                     | 4px 网格纹理叠加层        |
| 交互效果 | `press-effect`, `bouncy-hover`, `pixel-hover-lift`                                                       | 按下/悬浮/抬升效果        |
| 像素动画 | `animate-pixel-bounce`, `animate-pixel-float`, `animate-pixel-shake`                                     | 像素步进动画              |

### 6.7 scoped CSS 保留场景

仅在以下场景使用 `<style scoped>`：

```vue
<style scoped>
/* ✅ 动画关键帧 */
@keyframes fade-slide { ... }
.fade-slide-enter-active { ... }

/* ✅ 伪元素 */
.indicator::before { content: ''; ... }

/* ✅ 滚动条 */
.scrollarea::-webkit-scrollbar { width: 4px; }

/* ✅ 多层嵌套选择器（Tailwind 无法表达） */
.timeline-item:last-child { border-bottom: none; }

/* ❌ 禁止：重写 Tailwind utility */
.my-box { display: flex; padding: 8px; color: red; }
</style>
```

---

_本文档由 Carola 整理，适用于 PeroCore-TS 前端架构规范。_
