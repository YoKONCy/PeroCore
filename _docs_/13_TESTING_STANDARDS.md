# 单元测试与质量保障规范

> **版本**：0.1.0 · **更新时间**：2026-04-18
> **适用范围**：PeroCore-TS 全部 packages
> **核心原则**：**每开发一个模块，就必须同步编写对应的单元测试**

---

## 1. 核心规则

### 1.1 强制要求

| 规则 | 说明 |
|---|---|
| **模块必须有测试** | 每个新开发的 Service / Repository / Composable / 工具函数模块，**必须**有对应的 `*.test.ts` 或 `*.spec.ts` 文件 |
| **PR 不裸奔** | 不允许提交没有测试的业务模块代码（纯类型定义、常量文件除外） |
| **测试伴随代码** | 测试文件与源码同目录，遵循 `__tests__/` 或 co-located 模式 |
| **测试即文档** | 测试用例描述必须使用中文，让测试报告本身就是可读的功能文档 |

### 1.2 豁免范围

以下文件**不要求**单元测试：

- 纯类型定义文件：`*.d.ts`、`types.ts`、`interfaces.ts`
- 纯常量/枚举文件：`constants.ts`、`codes.ts`
- 配置文件：`vite.config.ts`、`drizzle.config.ts`
- 入口引导文件：`main.ts`、`index.ts`（仅做 re-export 的）
- Electron 壳层的胶水代码：`electron/main.ts`、`preload.ts`

---

## 2. 技术栈选型

### 2.1 测试框架：Vitest

| 项目 | 选型 | 理由 |
|---|---|---|
| 测试框架 | **Vitest** | 与 Vite 深度集成，原生 TS 支持，API 兼容 Jest |
| 断言库 | Vitest 内置 (`expect`) | 无需额外依赖 |
| Mock 库 | Vitest 内置 (`vi.fn`, `vi.mock`) | 支持模块级/函数级 Mock |
| 前端组件测试 | **@vue/test-utils** + **@testing-library/vue** | Vue 3 官方推荐 |
| HTTP Mock | **msw** (Mock Service Worker) | 拦截 fetch/XHR，不侵入业务代码 |
| 覆盖率 | **c8** / **istanbul**（Vitest 内置） | `vitest --coverage` 一键输出 |

### 2.2 配置文件

```typescript
// vitest.config.ts（项目根目录）
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  test: {
    // 全局 API（不需要每个文件 import describe/it/expect）
    globals: true,

    // 测试环境
    environment: 'node',   // 后端默认 node
    // 前端组件测试在各自 package 里覆盖为 'jsdom' 或 'happy-dom'

    // 文件匹配
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // 覆盖率
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/constants/**',
      ],
      // 覆盖率红线
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },

    // 路径别名（与 tsconfig 对齐）
    alias: {
      '@perocore/shared': resolve(__dirname, 'packages/shared/src'),
      '@perocore/backend': resolve(__dirname, 'packages/backend/src'),
      '@perocore/frontend': resolve(__dirname, 'packages/frontend/src'),
    },
  },
})
```

---

## 3. 文件组织

### 3.1 测试文件放置策略：Co-located（同目录）

```
packages/backend/src/
├── services/
│   ├── memory/
│   │   ├── memoryService.ts           # 源码
│   │   ├── memoryService.test.ts      # ← 单元测试
│   │   ├── memoryRepository.ts
│   │   └── memoryRepository.test.ts   # ← 单元测试
│   └── chat/
│       ├── chatService.ts
│       └── chatService.test.ts
├── utils/
│   ├── llmJsonParser.ts
│   └── llmJsonParser.test.ts
└── __tests__/                          # 跨模块集成测试
    └── memoryPipeline.integration.test.ts
```

```
packages/frontend/src/
├── composables/
│   ├── chat/
│   │   ├── useStreamMarkdown.ts
│   │   └── useStreamMarkdown.test.ts  # ← 单元测试
│   └── useEventListener.ts
│       └── useEventListener.test.ts
├── components/
│   ├── chat/
│   │   ├── MessageItem.vue
│   │   └── MessageItem.test.ts        # ← 组件测试
│   └── common/
│       ├── PixelButton.vue
│       └── PixelButton.test.ts
└── stores/
    ├── chatStore.ts
    └── chatStore.test.ts
```

### 3.2 命名规则

| 类型 | 文件名模式 | 示例 |
|---|---|---|
| 单元测试 | `<模块名>.test.ts` | `memoryService.test.ts` |
| 组件测试 | `<组件名>.test.ts` | `MessageItem.test.ts` |
| 集成测试 | `<场景名>.integration.test.ts` | `memoryPipeline.integration.test.ts` |
| E2E 测试 | `<场景名>.e2e.test.ts` | `chatFlow.e2e.test.ts` |

---

## 4. 测试编写规范

### 4.1 基本结构（AAA 模式）

```typescript
// memoryService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryService } from './memoryService'

describe('MemoryService', () => {
  let service: MemoryService
  let mockRepo: any

  beforeEach(() => {
    // Arrange：构建 Mock 依赖
    mockRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }
    service = new MemoryService(mockRepo)
  })

  describe('创建记忆', () => {
    it('应当成功创建并返回新记忆的 ID', async () => {
      // Arrange
      mockRepo.create.mockResolvedValue({ id: 'mem_001', content: '测试内容' })

      // Act
      const result = await service.createMemory({
        content: '测试内容',
        agentId: 'agent_001',
      })

      // Assert
      expect(result.id).toBe('mem_001')
      expect(mockRepo.create).toHaveBeenCalledOnce()
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: '测试内容' })
      )
    })

    it('内容为空时应当抛出验证错误', async () => {
      // Act & Assert
      await expect(
        service.createMemory({ content: '', agentId: 'agent_001' })
      ).rejects.toThrow('内容不能为空')
    })
  })

  describe('删除记忆', () => {
    it('记忆不存在时应当返回 NOT_FOUND', async () => {
      mockRepo.findById.mockResolvedValue(null)

      const result = await service.deleteMemory('non_existent_id')

      expect(result.code).toBe('NOT_FOUND')
    })
  })
})
```

### 4.2 测试用例描述规则

```typescript
// ✅ 好的描述：中文，说明行为和预期
describe('LlmJsonParser', () => {
  it('应当从 Markdown 代码块中提取 JSON 对象', () => { ... })
  it('输入为空字符串时应当返回 null', () => { ... })
  it('JSON 格式错误时应当抛出 ParseError', () => { ... })
})

// ❌ 不好的描述：英文或不明确
describe('LlmJsonParser', () => {
  it('test parse', () => { ... })
  it('works', () => { ... })
  it('error case', () => { ... })
})
```

### 4.3 Mock 策略

```typescript
// === 1. 依赖注入的 Service → Mock 构造函数参数 ===
const mockRepo = { findById: vi.fn() }
const service = new MemoryService(mockRepo)

// === 2. 模块级 Mock（整个模块替换）===
vi.mock('../utils/tokenizer', () => ({
  countTokens: vi.fn().mockReturnValue(100),
}))

// === 3. 外部 API → 使用 msw ===
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

const server = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{ message: { content: '测试回复' } }],
    })
  })
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// === 4. Drizzle DB → 使用内存 SQLite ===
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const testDb = drizzle(new Database(':memory:'))
```

### 4.4 Vue 组件测试

```typescript
// MessageItem.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageItem from './MessageItem.vue'

describe('MessageItem 组件', () => {
  it('应当正确渲染用户消息', () => {
    const wrapper = mount(MessageItem, {
      props: {
        message: {
          id: 'msg_001',
          role: 'user',
          content: '你好',
          timestamp: Date.now(),
        },
      },
    })

    expect(wrapper.find('.message-content').text()).toContain('你好')
    expect(wrapper.find('.message-role').text()).toContain('用户')
  })

  it('助手消息应当渲染 Markdown 内容', async () => {
    const wrapper = mount(MessageItem, {
      props: {
        message: {
          id: 'msg_002',
          role: 'assistant',
          content: '**加粗文字**',
          timestamp: Date.now(),
        },
      },
    })

    await wrapper.vm.$nextTick()
    expect(wrapper.find('.message-content').html()).toContain('<strong>')
  })
})
```

### 4.5 Composable 测试

```typescript
// useStreamMarkdown.test.ts
import { describe, it, expect, vi } from 'vitest'
import { useStreamMarkdown } from './useStreamMarkdown'

// 由于 composable 依赖 Vue 生命周期，需要用 withSetup 或在组件内测试
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'

function withSetup<T>(composable: () => T): { result: T; app: any } {
  let result!: T
  const TestComponent = defineComponent({
    setup() {
      result = composable()
      return {}
    },
    render: () => null,
  })
  const app = mount(TestComponent)
  return { result, app }
}

describe('useStreamMarkdown', () => {
  it('稳定区应当在代码块闭合后更新', async () => {
    const { result } = withSetup(() => useStreamMarkdown())

    // 模拟流式输入：代码块完整闭合
    result.onChunk('```js\nconsole.log("hi")\n```\n继续输出...')
    await nextTick()

    // 稳定区应当包含已闭合的代码块
    expect(result.stableHtml.value).toContain('<code')
    // 尾部应当包含后续内容
    expect(result.tailHtml.value).toContain('继续输出')
  })
})
```

### 4.6 Pinia Store 测试

```typescript
// chatStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from './chatStore'

describe('ChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('addMessage 应当将消息追加到列表', () => {
    const store = useChatStore()

    store.addMessage({
      id: 'msg_001',
      role: 'user',
      content: '测试消息',
      timestamp: Date.now(),
    })

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toBe('测试消息')
  })

  it('clearMessages 应当清空列表', () => {
    const store = useChatStore()
    store.addMessage({ id: '1', role: 'user', content: '...', timestamp: 0 })
    store.clearMessages()

    expect(store.messages).toHaveLength(0)
  })
})
```

---

## 5. 各 Package 测试策略

### 5.1 `@perocore/shared`

| 测试类型 | 目标 | 工具 |
|---|---|---|
| 单元测试 | 工具函数、类型守卫、常量验证 | Vitest |
| 环境 | `node` | — |

重点：`ResponseCode` 枚举完整性、`ApiResponse` 类型守卫、通用工具函数。

### 5.2 `@perocore/backend`

| 测试类型 | 目标 | 工具 |
|---|---|---|
| 单元测试 | Service 层业务逻辑 | Vitest + Mock Repo |
| 单元测试 | Repository 层数据操作 | Vitest + 内存 SQLite |
| 集成测试 | Router → Service → Repository 链路 | Vitest + Hono `app.request()` |
| API Mock | 外部 LLM/Embedding API | msw |

重点：
- Service 测试通过 Mock Repository 隔离数据层
- Repository 测试使用 `better-sqlite3` 内存模式 (`:memory:`)
- Router 集成测试使用 Hono 的 `app.request()` 发送 HTTP 请求

```typescript
// Router 集成测试示例
import { app } from '../app'

describe('GET /api/v1/memories', () => {
  it('应当返回分页的记忆列表', async () => {
    const res = await app.request('/api/v1/memories?page=1&pageSize=10')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.code).toBe('OK')
    expect(body.data.items).toBeInstanceOf(Array)
    expect(body.data.pagination.page).toBe(1)
  })
})
```

### 5.3 `@perocore/frontend`

| 测试类型 | 目标 | 工具 |
|---|---|---|
| 单元测试 | Composable 逻辑 | Vitest + withSetup 辅助 |
| 组件测试 | Vue 组件渲染和交互 | @vue/test-utils + happy-dom |
| Store 测试 | Pinia Store CRUD | Vitest + createTestingPinia |
| 环境 | `happy-dom`（更快）或 `jsdom` | — |

```typescript
// packages/frontend/vitest.config.ts（覆盖根配置）
import { mergeConfig, defineConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(rootConfig, defineConfig({
  test: {
    environment: 'happy-dom',
  },
}))
```

---

## 6. 测试运行与 CI

### 6.1 npm scripts

```jsonc
// package.json (root)
{
  "scripts": {
    "test": "vitest",                        // 交互式 watch 模式
    "test:run": "vitest run",                // 单次运行（CI 用）
    "test:coverage": "vitest run --coverage", // 输出覆盖率
    "test:ui": "vitest --ui",               // Web UI 查看结果
    "test:backend": "vitest run --project backend",
    "test:frontend": "vitest run --project frontend",
    "test:shared": "vitest run --project shared"
  }
}
```

### 6.2 覆盖率目标

| Package | 最低行覆盖率 | 最低分支覆盖率 | 说明 |
|---|---|---|---|
| `@perocore/shared` | 80% | 70% | 核心共享模块，质量要求最高 |
| `@perocore/backend` | 60% | 50% | Service 层重点覆盖，Router 层可适当放宽 |
| `@perocore/frontend` | 50% | 40% | 组件测试成本较高，优先覆盖 Composable 和 Store |

### 6.3 测试分级

```
Level 1 - 单元测试（每个模块必须有）
  └── 最小粒度，Mock 所有外部依赖
  └── 运行速度：< 5秒 / 100个用例

Level 2 - 集成测试（关键流程必须有）
  └── Router → Service → Repository 链路
  └── 使用内存 SQLite，不 Mock Repository

Level 3 - E2E 测试（核心场景建议有）
  └── Playwright / Electron e2e
  └── 覆盖用户可见的关键交互流程
  └── [待定] 具体工具和方案后续确认
```

---

## 7. 编写测试的最佳实践

### 7.1 每个 `describe` 至少包含

1. **正常路径** (Happy Path)：输入合法数据，验证预期输出
2. **边界条件** (Edge Case)：空字符串、空数组、null/undefined、极大值
3. **错误处理** (Error Path)：非法输入、依赖失败时的行为

```typescript
describe('VectorWriteHelper', () => {
  describe('写入向量', () => {
    it('应当成功写入并返回 ID (正常路径)', async () => { ... })
    it('空向量应当抛出 VALIDATION_ERROR (边界条件)', async () => { ... })
    it('TriviumDB 连接失败时应当抛出 INTERNAL_ERROR (错误处理)', async () => { ... })
  })
})
```

### 7.2 禁止事项

| ❌ 禁止 | 理由 |
|---|---|
| 测试间共享可变状态 | 用 `beforeEach` 重置，`afterEach` 清理 |
| 测试依赖执行顺序 | 每个 `it` 必须独立可运行 |
| 测试中使用 `setTimeout` | 使用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()` |
| 直接测试私有方法 | 通过公开 API 间接验证私有逻辑 |
| 测试框架代码 | 不要测 Vue/Hono/Drizzle 的内部行为 |
| 快照测试滥用 | 仅对 UI 组件的渲染结构使用 snapshot，业务逻辑不用 |

### 7.3 通用 fixtures 和 test helpers

```
packages/
├── shared/src/__tests__/
│   └── fixtures/              # 共享测试数据
│       ├── mockMessages.ts    # 标准化的测试消息
│       ├── mockAgents.ts      # 标准化的测试 Agent 配置
│       └── mockMemories.ts    # 标准化的测试记忆数据
├── backend/src/__tests__/
│   └── helpers/
│       ├── createTestDb.ts    # 内存 SQLite 工厂
│       └── createTestApp.ts   # 带 Mock 的 Hono app 工厂
└── frontend/src/__tests__/
    └── helpers/
        ├── withSetup.ts       # Composable 测试辅助
        └── createTestRouter.ts # 测试用 Router
```

---

## 8. 待定事项

- [ ] E2E 测试框架选型（Playwright vs Cypress vs Electron custom）
- [ ] CI 流水线配置（GitHub Actions / 其他）
- [ ] 性能测试基准（Benchmark 工具和指标）
- [ ] TriviumDB Rust 模块的测试方案（N-API 层的集成测试）

---

*本文档由 Carola 整理，适用于 PeroCore-TS 单元测试与质量保障规范。*
