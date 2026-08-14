# 测试规范

> **适用范围**：infOS-TS 全部 packages
> **最后更新**：2026-04-21
> **核心原则**：**每开发一个模块，就必须同步编写对应的单元测试**

---

## 1. 强制要求

| 规则 | 说明 |
|---|---|
| **模块必须有测试** | Service / Repository / Composable / 工具函数必须有 `*.test.ts` |
| **PR 不裸奔** | 不允许提交没有测试的业务模块代码（纯类型/常量除外） |
| **测试伴随代码** | 测试文件放在对应 package 的 `tests/unit` 目录，并保持与 `src` 内模块路径一致 |
| **测试即文档** | 测试用例描述必须使用中文 |

### 豁免范围

纯类型定义 (`.d.ts`)、纯常量/枚举、配置文件、入口引导文件 (`index.ts` 仅 re-export)、Electron 壳层胶水代码。

---

## 2. 技术栈

| 项目 | 选型 |
|---|---|
| 测试框架 | **Vitest** |
| 断言/Mock | Vitest 内置 (`expect`, `vi.fn`) |
| 前端组件测试 | **@vue/test-utils** + **@testing-library/vue** |
| HTTP Mock | **msw** (Mock Service Worker) |
| 覆盖率 | Vitest 内置 `--coverage` (v8) |

---

## 3. 文件组织

### Package 级 `tests/unit` 模式

单元测试统一放在对应 package 的 `tests/unit` 目录下，目录结构应镜像 `src` 内被测模块路径。这样既能保持源码目录纯净，也能在 monorepo 中清晰区分 frontend、backend、shared 等 package 的测试边界。

```
packages/backend/
├── src/
│   ├── services/memory/
│   │   └── memoryService.ts
│   └── repositories/
│       └── memory.repo.ts
└── tests/
    ├── unit/
    │   ├── services/memory/
    │   │   └── memoryService.test.ts
    │   └── repositories/
    │       └── memory.repo.test.ts
    └── integration/
        └── memoryPipeline.integration.test.ts
```

### 命名规则

| 类型 | 模式 |
|---|---|
| 单元测试 | `<模块名>.test.ts` |
| 组件测试 | `<组件名>.test.ts` |
| 集成测试 | `<场景名>.integration.test.ts` |

---

## 4. 编写规范

### 4.1 AAA 模式 + 中文描述

测试用例必须遵循 Arrange / Act / Assert 三段式。可用空行分隔三个阶段；如测试逻辑较长，可以使用中文注释标记阶段。测试描述必须使用中文，并说明期望行为。

```typescript
describe('MemoryService', () => {
  describe('创建记忆', () => {
    it('应当成功创建并返回新记忆的 ID', async () => {
      const mockRepo = { create: vi.fn() }
      const service = new MemoryService(mockRepo)
      mockRepo.create.mockResolvedValue({ id: 'mem_001', content: '测试' })

      const result = await service.createMemory({ content: '测试', agentId: 'agent_001' })

      expect(result.id).toBe('mem_001')
      expect(mockRepo.create).toHaveBeenCalledOnce()
    })

    it('内容为空时应当抛出验证错误', async () => {
      const mockRepo = { create: vi.fn() }
      const service = new MemoryService(mockRepo)

      await expect(service.createMemory({ content: '', agentId: 'agent_001' })).rejects.toThrow(
        '内容不能为空',
      )
    })
  })
})
```

### 4.2 每个 describe 至少包含

1. **正常路径** (Happy Path)
2. **边界条件** (空字符串、null、极大值)
3. **错误处理** (非法输入、依赖失败)

### 4.3 Mock 策略

```typescript
// 1. DI → Mock 构造函数参数
const mockRepo = { findById: vi.fn() }
const service = new MemoryService(mockRepo)

// 2. 模块级 Mock
vi.mock('../utils/tokenizer', () => ({
  countTokens: vi.fn().mockReturnValue(100),
}))

// 3. 外部 API → msw
const server = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({ choices: [{ message: { content: '测试' } }] })
  })
)

// 4. SQLite → 内存模式
const testDb = drizzle(new Database(':memory:'))
```

### 4.4 禁止事项

| 禁止 | 理由 |
|---|---|
| 测试间共享可变状态 | 用 `beforeEach` 重置 |
| 测试依赖执行顺序 | 每个 `it` 独立可运行 |
| 测试中 `setTimeout` | 用 `vi.useFakeTimers()` |
| 直接测试私有方法 | 通过公开 API 间接验证 |
| 快照测试滥用 | 仅对 UI 渲染结构使用 |

---

## 5. 覆盖率要求

| Package | 最低行覆盖率 | 最低分支覆盖率 |
|---|---|---|
| `@infos/shared` | 80% | 70% |
| `@infos/backend` | 60% | 50% |
| `@infos/frontend` | 50% | 40% |

---

## 6. npm scripts

```jsonc
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

---

*本文档由 Carola 整理，适用于 infOS-TS 测试规范。*
