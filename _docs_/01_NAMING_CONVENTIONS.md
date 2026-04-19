# 命名规范

> **版本**：0.1.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 全项目（前端 / 后端 / Electron / 共享包）

---

## 1. 文件命名

| 位置 | 规范 | 示例 |
|---|---|---|
| 后端 TS 文件 | **camelCase** | `memoryService.ts`, `memoryRouter.ts` |
| 前端 Vue 组件 | **PascalCase** | `ChatInterface.vue`, `PButton.vue` |
| 前端 Composable | **camelCase, `use` 前缀** | `useChat.ts`, `usePetVoice.ts` |
| 前端 Pinia Store | **camelCase, `use` 前缀 + `Store` 后缀** | `useMemoryStore.ts`, `useConfigStore.ts` |
| 类型定义文件 | **camelCase, `.types.ts` 后缀** | `memory.types.ts`, `agent.types.ts` |
| 常量文件 | **camelCase** | `errorCodes.ts`, `defaultConfig.ts` |
| 测试文件 | **同名 + `.test.ts`** | `memoryService.test.ts` |
| 路由文件 | **camelCase, `.router.ts` 后缀** | `memory.router.ts`, `chat.router.ts` |
| Repository 文件 | **camelCase, `.repo.ts` 后缀** | `memory.repo.ts`, `vector.repo.ts` |
| 中间件文件 | **camelCase** | `authMiddleware.ts`, `errorHandler.ts` |

---

## 2. 代码命名

遵守 TypeScript 社区标准（ESLint `@typescript-eslint/naming-convention`）。

| 项目 | 规范 | 示例 |
|---|---|---|
| 变量 | camelCase | `let userName = 'pero'` |
| 函数 / 方法 | camelCase | `createMemory()`, `fetchLogs()` |
| 类 | PascalCase | `MemoryService`, `OpenAiProvider` |
| 接口 | PascalCase | `ApiResponse`, `LlmProvider` |
| 类型别名 | PascalCase | `MemoryDto`, `ChatMessage` |
| 枚举名 | PascalCase | `ResponseCode`, `ErrorSeverity` |
| 枚举值 | UPPER_SNAKE_CASE | `ResponseCode.NOT_FOUND` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_PORT` |
| 泛型参数 | 单大写字母 | `<T>`, `<K, V>` |
| 私有成员 | `private` 关键字，无下划线前缀 | `private apiKey: string` |
| 布尔变量 | is / has / can / should 前缀 | `isLoading`, `hasError`, `canRetry` |

---

## 3. API 路由路径

继承自 PeroCore v1 `BACKEND_API_STYLE_GUIDE.md`：

| 规则 | 示例 |
|---|---|
| 资源用**复数名词** | `/api/memories`, `/api/models` |
| 动作用 **kebab-case** | `/api/memories/retry-sync` |
| 路径层级 **2-4 层** | `/api/memories/{id}` ✅ · `/api/a/b/c/d/e` ❌ |
| **不混用**下划线和连字符 | `retry-sync` ✅ · `retry_sync` ❌ |
| 同一域**不允许**单复数并存 | 只用 `/api/memories`，不再有 `/api/memory` |

---

## 4. 数据库命名

| 项目 | 规范 | 示例 |
|---|---|---|
| 表名 | snake_case，复数 | `memory_nodes`, `conversation_logs` |
| 列名 | snake_case | `agent_id`, `created_at`, `is_active` |
| 索引名 | `idx_{表名}_{列名}` | `idx_memory_nodes_agent_id` |
| 外键名 | `fk_{表名}_{列名}` | `fk_conversation_logs_session_id` |

---

## 5. CSS / 样式规范

### 5.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 工具框架 | **Tailwind CSS v3** | 沿用 v1，原子类为主 |
| 设计令牌 | **CSS Custom Properties** | `:root` 集中管理颜色/尺寸/间距 |
| 自定义类 | **kebab-case** | `.pixel-border-moe`, `.chat-input` |
| BEM（可选） | 仅复杂组件 | `.message-item__avatar`, `.message-item--active` |

### 5.2 设计令牌 (Design Tokens)

所有颜色、尺寸等设计值集中定义在 CSS 变量中，**禁止在组件中硬编码色值**：

```css
/* assets/tokens.css — 像素风设计令牌 */
:root {
  /* ── 像素边框体系 ── */
  --pixel-border-width: 2px;

  /* Sky 色系 (天蓝, 主角色) */
  --sky-outline: #0369a1;
  --sky-shadow:  #0284c7;
  --sky-light:   #7dd3fc;
  --sky-face:    #38bdf8;
  --sky-hover:   #0ea5e9;

  /* Pink 色系 (粉红, 强调色) */
  --pink-outline: #831843;
  --pink-shadow:  #db2777;
  --pink-light:   #fbcfe8;
  --pink-face:    #f472b6;

  /* Amber / Emerald / Indigo... 同理 */

  /* ── 语义色 ── */
  --color-primary:   var(--sky-face);
  --color-accent:    var(--pink-face);
  --color-success:   #10b981;
  --color-warning:   #f59e0b;
  --color-danger:    #ef4444;

  /* ── 背景 ── */
  --bg-card:  rgba(255, 255, 255, 0.9);
  --bg-glass: rgba(255, 255, 255, 0.6);
  --bg-page:  transparent;

  /* ── 文字 ── */
  --text-primary:   #0f172a;
  --text-secondary: #64748b;

  /* ── 滚动条 ── */
  --scrollbar-track: #f1f5f9;
  --scrollbar-thumb: var(--sky-face);

  /* ── 间距 ── */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;

  /* ── 字体 ── */
  --font-sans: 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
  --font-pixel: 'Zpix', 'DotGothic16', monospace;
}
```

### 5.3 Tailwind 主题扩展

在 `tailwind.config.ts` 中将设计令牌桥接到 Tailwind：

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        // 语义色 → Tailwind 类: bg-primary, text-accent 等
        primary:   'var(--color-primary)',
        accent:    'var(--color-accent)',
        success:   'var(--color-success)',
        warning:   'var(--color-warning)',
        danger:    'var(--color-danger)',
        // 像素边框色系
        sky: {
          face:    'var(--sky-face)',
          outline: 'var(--sky-outline)',
          shadow:  'var(--sky-shadow)',
          light:   'var(--sky-light)',
          hover:   'var(--sky-hover)',
        },
      },
      fontFamily: {
        sans:  'var(--font-sans)',
        pixel: 'var(--font-pixel)',
      },
    },
  },
}
```

这样就能用 Tailwind 类引用令牌：

```html
<!-- ✅ 通过 Tailwind 使用设计令牌 -->
<button class="bg-primary text-white hover:bg-sky-hover">确认</button>

<!-- ✅ 自定义像素风类也引用令牌 -->
<!-- .pixel-btn-sky 内部用 var(--sky-*) -->

<!-- ❌ 禁止硬编码色值 -->
<button class="bg-[#38bdf8]">确认</button>
```

### 5.4 深色模式 / 主题切换

通过覆盖 CSS 变量实现主题切换，**无需重写类名**：

```css
/* 工作模式 (暗色) */
[data-theme="work"] {
  --sky-face:    #1e3a5f;
  --sky-outline: #020617;
  --bg-card:     rgba(15, 23, 42, 0.9);
  --bg-glass:    rgba(15, 23, 42, 0.6);
  --text-primary: #e2e8f0;
}
```

### 5.5 像素风组件类

沿用 v1 的像素风设计体系（`pixel-border-*`, `pixel-btn-*`, `pixel-card`, `pixel-glass` 等），但内部改用设计令牌引用色值。动画继续使用 `steps()` 缓动函数保持像素步进感。

---

## 6. 注释规范

继承自 `COMMENT_TRANSLATION_STANDARDS.md`，并在此基础上细化格式标准。

### 6.1 语言规则

- **业务逻辑注释**必须使用中文
- **专业术语**保留英文原文（Token, Embedding, Prompt, Agent, IPC, Scorer, TriviumDB 等）
- 注释解释 **What**（做什么）和 **Why**（为什么），不复述 How（怎么做——代码本身就是 How）
- 禁止保留思考过程、调试笔记、copilot 生成的废话注释

### 6.2 文件头注释

每个**非平凡**的 TS 文件顶部加文件头注释（工具类/常量类小文件可省略）：

```typescript
/**
 * 记忆检索服务
 *
 * 负责从 TriviumDB 和 SQLite 中检索相关记忆，
 * 支持向量语义搜索、图谱扩散和关键词回退。
 *
 * @module packages/backend/src/services/memory/retrievalService
 */
```

**规则**：
- 第一行：模块名称（一句话）
- 空行后：模块职责描述（1-3 行）
- `@module`：完整包内路径（方便搜索定位）
- **不写** `@author`（Git blame 已经追踪）
- **不写** `@date`（Git log 已经追踪）

### 6.3 函数 / 方法注释（JSDoc）

```typescript
/**
 * 通过向量相似度检索最相关的记忆节点
 *
 * 使用 TriviumDB 的 PEDSA 扩散引擎进行语义检索，
 * 结果经过 Reranker 重排序后返回 Top-K。
 *
 * @param query - 用户输入的原始文本
 * @param options - 检索配置（Top-K、扩散深度等）
 * @returns 按相关度降序排列的记忆列表
 * @throws {MemoryError} TriviumDB 连接失败时抛出
 *
 * @example
 * ```ts
 * const memories = await retrieve('主人喜欢吃什么', { topK: 5 })
 * ```
 */
async function retrieve(
  query: string,
  options: RetrievalOptions,
): Promise<MemoryNode[]> {
  // ...
}
```

**规则**：
- 第一行：一句话说明函数做什么
- 空行后（可选）：补充说明实现策略或重要约束
- `@param`：参数名 + 简要说明，复杂类型补充字段含义
- `@returns`：返回值含义
- `@throws`：可能抛出的异常类型及条件
- `@example`（可选）：复杂 API 给调用示例
- **简单 getter/setter 不需要 JSDoc**（类型签名已经自文档化）

### 6.4 类 / 接口注释

```typescript
/**
 * 攒批式记忆评分器
 *
 * 对话不立刻处理，而是攒入缓冲区。
 * 达到阈值后批量调用 LLM 一次性提炼记忆 + 建图谱关系。
 *
 * @see 10_MEMORY_SYSTEM.md §10 — Scorer 攒批触发方案
 */
class BatchScorer {
  // ...
}

/**
 * LLM 提供商统一接口
 *
 * 所有 LLM 适配器（OpenAI、Anthropic、Ollama 等）必须实现此接口。
 */
interface LlmProvider {
  /** 模型标识符（如 `gpt-4o`、`claude-sonnet-4-20250514`） */
  readonly modelId: string

  /** 发送聊天补全请求 */
  chat(messages: ChatMessage[], options?: LlmOptions): Promise<LlmResponse>

  /** 当前 Provider 是否支持流式输出 */
  supportsStreaming(): boolean
}
```

**规则**：
- 类注释说明职责和核心行为
- `@see` 引用相关规范文档
- 接口的每个成员加**单行 JSDoc**（`/** ... */`）
- 不写 `@implements`、`@extends`——TS 类型系统已经表达了

### 6.5 行内注释

```typescript
// ✅ 好：解释 Why
const BATCH_THRESHOLD = 8 // 攒批阈值：8 轮对话触发一次 Scorer，平衡延迟与 Token 节省

// ✅ 好：解释非显而易见的逻辑
if (similarity > 0.92) {
  // 余弦相似度过高说明对话内容重复，跳过以避免重复记忆
  continue
}

// ❌ 差：复述代码
const count = items.length // 获取数组长度

// ❌ 差：写了等于没写
// 处理数据
processData()
```

**规则**：
- 行内注释用 `//`，前面空一行（除非紧跟在声明后面的同行注释）
- 复杂业务分支必须注释原因
- 魔法数字必须注释含义或提取为命名常量

### 6.6 TODO / FIXME / HACK 标记

```typescript
// TODO(D35): Scorer 攒批阈值待确认，暂用 8 — 见 10_MEMORY_SYSTEM.md §10
// FIXME: 社交模式下 variables 注入了错误的模式变量，需要修复
// HACK: steamworks.js 在非 Steam 环境下 require 会 segfault，必须先检查 DLL 存在性
// PERF: 这里可以用 BQ 预筛减少全量扫描，等 TriviumDB BQ 模块稳定后优化
```

**标记约定**：

| 标记 | 含义 | 何时用 |
|---|---|---|
| `TODO` | 待办事项，已知要做但现在不做 | 接决策编号 `TODO(D35)` |
| `FIXME` | 已知 Bug 或不正确的行为 | 必须尽快修复 |
| `HACK` | 临时绕过方案，非理想实现 | 说明为什么不得不这么做 |
| `PERF` | 性能优化点 | 当前可用但有优化空间 |

### 6.7 区域分隔符

长文件中按逻辑区域分组时使用：

```typescript
// ══════ 公共 API ══════

export function retrieve() { /* ... */ }
export function store() { /* ... */ }

// ══════ 内部方法 ══════

function buildQuery() { /* ... */ }
function deduplicateResults() { /* ... */ }

// ══════ 类型定义 ══════

interface RetrievalOptions { /* ... */ }
```

**规则**：
- 使用双线等号 `══════` 作为分隔线（视觉突出，不会和代码冲突）
- 分隔符前空一行，后空一行
- 仅在单文件超过 150 行时使用，短文件不需要

### 6.8 Vue 组件注释

```vue
<script setup lang="ts">
/**
 * 聊天消息气泡组件
 *
 * 根据消息来源（用户/AI/系统）展示不同样式的气泡，
 * 支持 Markdown 渲染和流式打字效果。
 *
 * @props message - 消息数据
 * @props isStreaming - 是否正在流式输出
 * @emits retry - 用户点击重试按钮
 */

import { computed } from 'vue'
import type { ChatMessage } from '@perocore/shared'

const props = defineProps<{
  /** 消息数据对象 */
  message: ChatMessage
  /** 是否正在流式输出中 */
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  /** 用户请求重试当前消息 */
  retry: [messageId: string]
}>()
</script>
```

**规则**：
- `<script setup>` 顶部加组件级 JSDoc
- `@props` 和 `@emits` 在组件级注释概要列出
- `defineProps` 和 `defineEmits` 的每个字段加单行 JSDoc
- `<template>` 内不写注释（HTML 注释会被发送到客户端）

### 6.9 日志打印

```typescript
// ✅ 中文日志，语义清晰
logger.info('记忆检索', `检索到 ${results.length} 条相关记忆，耗时 ${ms}ms`)
logger.warn('云同步', `文件 ${fileName} 大小超过 50MB，跳过同步`)
logger.error('Scorer', `LLM 调用失败: ${error.message}`)

// ❌ 英文日志
logger.info('Memory', `Found ${results.length} results`)
```

**规则**：
- 第一个参数是模块标签（与 `08_LOGGING_SPEC.md` 一致）
- 日志消息使用中文（D20 决策）
- 动态值用模板字符串，不用字符串拼接
- 敏感信息（API Key、用户隐私数据）**严禁**出现在日志中

---

## 7. 产品命名

| 名称 | 含义 | 使用场景 |
|---|---|---|
| **PeroCore** | 后端引擎内核 | 代码仓库名、`packages/backend`、技术文档、Docker 镜像名、API 文档 |
| **萌动链接：PeroperoChat** | 完整 Electron 桌面应用（Steam 产品） | Steam 商店页、安装程序、窗口标题、用户可见的产品名 |
| **PeroperoChat** | 上述产品的简称 | 日常口语、社区讨论、非正式场合 |
| **PeroCore-TS** | 整个 TS 重构仓库 | 仅开发期使用，用于区分 Python 版 PeroCore |

**使用原则**：

- 面向用户的 UI / 文案 → 使用 **PeroperoChat** 或 **萌动链接：PeroperoChat**
- 面向开发者的代码 / 文档 → 使用 **PeroCore**
- npm 包 scope → `@perocore/*`
- Docker 镜像 → `perocore` / `perocore-backend`
- Steam App → `萌动链接：PeroperoChat！`（含感叹号，与 v1 `app.setName()` 一致）

> PeroCore 是引擎，PeroperoChat 是产品。关系类似 Unreal Engine 和用它做的游戏。

---

_本文档由 Carola 整理，适用于 PeroCore-TS 全项目命名与注释规范。_

