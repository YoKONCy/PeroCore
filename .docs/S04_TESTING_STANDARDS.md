# 测试规范

> **适用范围**：PeroCore-TS 全部 packages
> **最后更新**：2026-04-21
> **核心原则**：**每开发一个模块，就必须同步编写对应的单元测试**

---

## 1. 强制要求

| 规则 | 说明 |
|---|---|
| **模块必须有测试** | Service / Repository / Composable / 工具函数必须有 `*.test.ts` |
| **PR 不裸奔** | 不允许提交没有测试的业务模块代码（纯类型/常量除外） |
| **测试伴随代码** | 测试文件与源码同目录 |
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

### Co-located 模式

```
packages/backend/src/
├── services/memory/
│   ├── memoryService.ts
│   ├── memoryService.test.ts      ← 单元测试
│   ├── memoryRepository.ts
│   └── memoryRepository.test.ts
└── __tests__/                      ← 跨模块集成测试
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

```typescript
describe('MemoryService', () => {
  describe('创建记忆', () => {
    it('应当成功创建并返回新记忆的 ID', async () => {
      // Arrange
      mockRepo.create.mockResolvedValue({ id: 'mem_001', content: '测试' })
      // Act
      const result = await service.createMemory({ content: '测试', agentId: 'agent_001' })
      // Assert
      expect(result.id).toBe('mem_001')
      expect(mockRepo.create).toHaveBeenCalledOnce()
    })

    it('内容为空时应当抛出验证错误', async () => {
      await expect(
        service.createMemory({ content: '', agentId: 'agent_001' })
      ).rejects.toThrow('内容不能为空')
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
| `@perocore/shared` | 80% | 70% |
| `@perocore/backend` | 60% | 50% |
| `@perocore/frontend` | 50% | 40% |

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

*本文档由 Carola 整理，适用于 PeroCore-TS 测试规范。*
