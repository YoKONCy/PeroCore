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
- **白名单**：`['DashboardView']`
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
  async function sendMessage(text: string) { /* ... */ }
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

### 6.1 架构分层

```
┌─────────────────────────────────────────────┐
│  TailwindCSS 4 (utility 工具类)              │
│  布局/间距/排版/响应式: flex, p-4, text-lg   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  tokens.css (CSS Variables 设计令牌)         │
│  单一真相源: --sky-face, --pink-outline      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  style.css (@theme 桥接 + 像素风组件类)      │
│  pixel-border-*, pixel-btn-*, 动画           │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  <style scoped> (组件专属样式)               │
│  组件级别的布局细节                           │
└─────────────────────────────────────────────┘
```

### 6.2 TailwindCSS 使用规范

#### ✅ 允许使用

| 用途 | 示例 | 说明 |
|---|---|---|
| 布局 | `flex`, `grid`, `items-center` | Flexbox/Grid 布局 |
| 间距 | `p-4`, `m-2`, `gap-3` | 内外边距 |
| 排版 | `text-lg`, `font-bold`, `tracking-wide` | 字号/字重/字间距 |
| 尺寸 | `w-10`, `h-10`, `max-w-xs` | 宽高约束 |
| 显隐 | `hidden`, `block`, `inline-flex` | Display 切换 |
| 定位 | `relative`, `absolute`, `z-10` | 定位上下文 |
| 溢出 | `overflow-hidden`, `truncate` | 溢出控制 |
| 过渡 | `transition-all`, `duration-300` | 过渡动画 |
| 原生色板 | `bg-white`, `bg-slate-50`, `text-slate-700` | Tailwind 标准色板 |
| 语义令牌色 | `bg-sky-face`, `text-pink-shadow` | @theme 桥接的自定义色 |
| 交互修饰 | `hover:bg-sky-50`, `group-hover:scale-105` | 伪类状态 |
| 响应式 | `md:grid-cols-2`, `sm:hidden` | 响应式断点 |

#### ❌ 严禁使用

| 禁止行为 | 原因 |
|---|---|
| `bg-[#ff00ff]` arbitrary values 硬编码颜色 | 必须通过 tokens.css 定义 |
| `w-[137px]` arbitrary values 硬编码尺寸 | 优先使用标准间距或 scoped CSS |
| `@apply` 在 scoped style 中大量使用 | 与 Vanilla CSS 架构冲突 |
| 用 Tailwind 替代像素风组件类 | `pixel-border-sky`, `pixel-btn-pink` 等必须使用自定义 CSS |
| 在 `tailwind.config` 中重复定义 tokens.css 已有的变量 | 单一真相源原则 |

#### 🔶 谨慎使用

| 场景 | 指导 |
|---|---|
| 条件样式过多 | 超过 5 个 Tailwind class 含交互修饰符时，考虑提取为 scoped CSS |
| 组件级颜色变体 | 优先用 tokens.css 语义变量 + scoped CSS，而非 Tailwind 色板 |

### 6.3 色彩使用优先级

```
1. tokens.css 语义变量 (var(--sky-face), var(--color-primary))
   ↓ 如果不够用
2. @theme 桥接色 (bg-sky-face, text-pink-outline)
   ↓ 如果是通用色
3. Tailwind 原生色板 (bg-white, text-slate-700, bg-emerald-50)
   ↓ 禁止跳到这里
4. ❌ 硬编码 (bg-[#ff0000])
```

### 6.4 像素风组件类 (pixel-*)

以下自定义 CSS 类是项目核心视觉语言，**不可用 Tailwind 替代**：

- 像素边框系列: `pixel-border-sm`, `pixel-border-sky`, `pixel-border-pink` 等
- 像素按钮系列: `pixel-btn-sky`, `pixel-btn-pink`, `pixel-btn-yellow` 等
- 像素卡片: `pixel-card`, `pixel-card-moe`
- 像素亚克力: `pixel-glass`
- 像素网格: `pixel-grid-overlay`
- 像素动画: `animate-pixel-bounce`, `animate-pixel-float`, `animate-pixel-shake` 等
- 交互效果: `pixel-hover-lift`, `press-effect`, `bouncy-hover`

---

*本文档由 Carola 整理，适用于 PeroCore-TS 前端架构规范。*
