# API 响应规范

> **版本**：0.3.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 后端所有 REST API

---

## 1. 统一响应信封

**所有** REST API 必须返回以下格式：

```typescript
interface ApiResponse<T = unknown> {
  /** 业务状态码（UPPER_SNAKE_CASE，从规范表中选取） */
  code: string
  /** 面向用户的友好消息（中文），可直接显示在 UI 上 */
  message: string
  /** 业务数据（成功时）或错误详情（失败时） */
  data?: T
}
```

---

## 2. message 规范化机制

### 2.1 默认 message 注册表

每个 code 在 `@perocore/shared` 中注册一个默认中文 message：

```typescript
// @perocore/shared/src/constants/responseCodes.ts
export const CODE_MESSAGES: Record<string, string> = {
  OK: '操作成功',
  CREATED: '创建成功',
  // ... 完整列表见下方规范表
}
```

### 2.2 使用规则

- **大多数场景**：使用默认 message，保证一致性
- **需要上下文时**：后端可覆盖默认 message，追加具体信息
- **前端兜底**：如果后端返回为空，前端可用 `CODE_MESSAGES[code]` 回填

```typescript
// 使用默认 message
throw new AppError('NOT_FOUND')
// → { code: "NOT_FOUND", message: "请求的资源不存在" }

// 覆盖 message，追加上下文
throw new AppError('NOT_FOUND', { message: '未找到 ID 为 42 的记忆' })
// → { code: "NOT_FOUND", message: "未找到 ID 为 42 的记忆" }
```

### 2.3 message 语言

- **固定中文**，面向终端用户
- 技术细节（堆栈、原始错误文本）放 `data` 或日志中，不放 message

---

## 3. data 字段用途

| 状态 | data 的内容 | 是否必须 |
|---|---|---|
| 成功 + 有业务数据 | 业务对象 / 列表 / 分页结构 | **必须** |
| 成功 + 纯操作（删除等） | 省略 | 可选 |
| 失败 + 需前端精细处理 | 错误详情（字段校验、重试时间等） | **建议有** |
| 失败 + 通用错误 | 省略 | 可选 |

---

## 4. HTTP 状态码清单

本项目使用以下 **15 个** HTTP 状态码，不使用 204：

| HTTP 码 | 标准语义 | PeroCore 使用场景 |
|---|---|---|
| **200** | OK | 查询、更新、删除、动作执行成功 |
| **201** | Created | 新建资源成功 |
| **202** | Accepted | 异步任务已入队 |
| **400** | Bad Request | 请求参数有误、校验失败 |
| **401** | Unauthorized | 未认证、Token 无效/过期 |
| **403** | Forbidden | 已认证但无权限 |
| **404** | Not Found | 资源不存在 |
| **405** | Method Not Allowed | HTTP 方法不对（框架自动处理） |
| **409** | Conflict | 资源冲突（重名、重复创建） |
| **413** | Payload Too Large | 上传内容/文件过大 |
| **415** | Unsupported Media Type | 不支持的文件/内容类型 |
| **422** | Unprocessable Entity | 请求合法但业务上无法处理 |
| **429** | Too Many Requests | 客户端请求频率过高 |
| **500** | Internal Server Error | 服务内部错误（我们的 bug） |
| **502** | Bad Gateway | 上游服务返回错误（LLM API 等） |
| **503** | Service Unavailable | 服务暂不可用（启动中/维护中） |
| **504** | Gateway Timeout | 上游服务超时 |

---

## 5. 完整 Code 规范表

> **严格约束**：后续开发 **有且只能** 使用以下规范表中的 code。
> 如需新增 code，必须先更新本文档并经过 review。

### 5.1 成功类 (2xx)

#### HTTP 200 OK

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `OK` | 操作成功 | 业务数据或省略 | 查询、更新、删除、通用动作成功 |

#### HTTP 201 Created

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `CREATED` | 创建成功 | 新创建的资源对象 | 新建记忆、模型、Agent、MCP 配置 |

#### HTTP 202 Accepted

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `ACCEPTED` | 任务已提交，正在后台处理 | `{ taskId?: string }` | 重索引、维护任务、梦境生成、批量分析 |

---

### 5.2 客户端错误类 (4xx)

#### HTTP 400 Bad Request

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `BAD_REQUEST` | 请求参数有误 | 可选，任意补充 | 通用兜底 |
| `VALIDATION_ERROR` | 请求参数校验失败 | `{ fields: Record<string, string> }` | Zod 校验不通过（字段级详情） |
| `MISSING_FIELD` | 缺少必填字段 | `{ field: string }` | 某个必填字段未传 |
| `INVALID_FORMAT` | 请求格式错误 | 可选 | JSON 解析失败、非法编码 |
| `OUT_OF_RANGE` | 参数值超出允许范围 | `{ field: string, min?: number, max?: number }` | importance > 10、page < 1 |
| `INVALID_PARAMETER` | 参数类型或值无效 | `{ field: string, expected: string }` | 期望 number 传了 string |

#### HTTP 401 Unauthorized

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `UNAUTHORIZED` | 未认证，请先登录 | — | 通用兜底 |
| `TOKEN_EXPIRED` | 认证已过期，请重新登录 | — | Gateway Token 过期 |
| `TOKEN_INVALID` | 认证信息无效 | — | Token 格式错误、签名不对 |

#### HTTP 403 Forbidden

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `FORBIDDEN` | 无权执行此操作 | — | 权限不足 |

#### HTTP 404 Not Found

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `NOT_FOUND` | 请求的资源不存在 | `{ resource?: string, id?: string \| number }` | 通用的资源不存在 |
| `AGENT_NOT_FOUND` | 指定的 Agent 不存在 | `{ agentId: string }` | 切换/查询不存在的 Agent |
| `MEMORY_NOT_FOUND` | 指定的记忆不存在 | `{ memoryId: number }` | 查询/删除不存在的记忆 |
| `MODEL_NOT_FOUND` | 指定的模型配置不存在 | `{ modelId: number }` | 切换/删除不存在的模型 |

#### HTTP 405 Method Not Allowed

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `METHOD_NOT_ALLOWED` | 不支持该请求方法 | — | 框架自动处理 |

#### HTTP 409 Conflict

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `CONFLICT` | 资源冲突 | 可选 | 通用兜底 |
| `DUPLICATE_NAME` | 名称已存在 | `{ name: string, existingId?: number }` | 模型名/Agent 名重复 |
| `ALREADY_EXISTS` | 资源已存在 | `{ resource: string }` | 重复创建同一资源 |

#### HTTP 413 Payload Too Large

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `PAYLOAD_TOO_LARGE` | 上传内容过大 | `{ maxSize: string, actualSize?: string }` | 文件/请求体超出限制 |

#### HTTP 415 Unsupported Media Type

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `UNSUPPORTED_MEDIA_TYPE` | 不支持该文件类型 | `{ received: string, allowed: string[] }` | 上传了不支持的格式 |

#### HTTP 422 Unprocessable Entity

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `UNPROCESSABLE` | 请求无法处理 | 可选 | 通用兜底 |
| `RESOURCE_BUSY` | 资源正忙，请稍后再试 | `{ resource: string }` | 正在重索引时又请求重索引 |
| `TASK_ALREADY_RUNNING` | 该任务已在运行中 | `{ taskId?: string }` | 重复提交同一后台任务 |
| `PRECONDITION_FAILED` | 前置条件不满足 | `{ reason: string }` | 缺少前置配置才能执行的操作 |

#### HTTP 429 Too Many Requests

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `RATE_LIMITED` | 请求过于频繁，请稍后再试 | `{ retryAfter?: number }` | 客户端请求限流 |

---

### 5.3 服务端错误类 (5xx)

#### HTTP 500 Internal Server Error

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `INTERNAL_ERROR` | 服务内部错误，请稍后再试 | 可选 | **通用兜底**（未归类的异常） |
| `DB_ERROR` | 数据库操作失败 | `{ operation?: string }` | SQLite / TriviumDB 操作异常 |
| `CONFIG_ERROR` | 配置异常 | `{ key?: string }` | 缺少关键配置、配置格式错误 |

#### HTTP 502 Bad Gateway

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `LLM_ERROR` | AI 服务异常，请稍后再试 | `{ provider: string, model?: string }` | LLM API 返回非限流错误 |
| `LLM_RATE_LIMITED` | AI 服务繁忙，请稍后再试 | `{ provider: string, retryAfter?: number }` | LLM API 返回 429 |
| `EMBEDDING_ERROR` | 向量服务异常 | `{ provider: string }` | Embedding API 失败 |
| `EXTERNAL_ERROR` | 外部服务异常 | `{ service: string }` | MCP、TTS 等第三方服务失败 |
| `MCP_ERROR` | MCP 服务调用失败 | `{ server?: string, tool?: string }` | MCP 工具执行失败 |

#### HTTP 503 Service Unavailable

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `SERVICE_UNAVAILABLE` | 服务暂不可用 | — | 通用兜底 |
| `SERVICE_INITIALIZING` | 服务正在启动中，请稍后再试 | — | 后端还未完成初始化 |

#### HTTP 504 Gateway Timeout

| code | 默认 message | data | 典型场景 |
|---|---|---|---|
| `GATEWAY_TIMEOUT` | 上游服务响应超时 | `{ service?: string }` | 通用超时 |
| `LLM_TIMEOUT` | AI 服务响应超时 | `{ provider: string, model?: string }` | LLM API 超时 |

---

## 6. 使用汇总

| 统计项 | 数量 |
|---|---|
| HTTP 状态码 | 15 个 |
| 业务 code 总数 | 38 个 |
| 成功类 code | 3 个 |
| 客户端错误 code | 20 个 |
| 服务端错误 code | 15 个 |

---

## 7. 后端实现示例

### 7.1 AppError 基类

```typescript
// lib/appError.ts
import { CODE_MESSAGES } from '@perocore/shared'

export class AppError extends Error {
  public httpStatus: number
  public code: string
  public data?: unknown

  constructor(code: string, options?: { message?: string; data?: unknown }) {
    const message = options?.message ?? CODE_MESSAGES[code] ?? '未知错误'
    super(message)
    this.code = code
    this.data = options?.data
    this.httpStatus = CODE_TO_HTTP[code] ?? 500
  }
}

// code → HTTP 状态码映射
const CODE_TO_HTTP: Record<string, number> = {
  // 2xx
  OK: 200, CREATED: 201, ACCEPTED: 202,
  // 4xx
  BAD_REQUEST: 400, VALIDATION_ERROR: 400, MISSING_FIELD: 400,
  INVALID_FORMAT: 400, OUT_OF_RANGE: 400, INVALID_PARAMETER: 400,
  UNAUTHORIZED: 401, TOKEN_EXPIRED: 401, TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404, AGENT_NOT_FOUND: 404, MEMORY_NOT_FOUND: 404, MODEL_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409, DUPLICATE_NAME: 409, ALREADY_EXISTS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE: 422, RESOURCE_BUSY: 422, TASK_ALREADY_RUNNING: 422, PRECONDITION_FAILED: 422,
  RATE_LIMITED: 429,
  // 5xx
  INTERNAL_ERROR: 500, DB_ERROR: 500, CONFIG_ERROR: 500,
  LLM_ERROR: 502, LLM_RATE_LIMITED: 502, EMBEDDING_ERROR: 502,
  EXTERNAL_ERROR: 502, MCP_ERROR: 502,
  SERVICE_UNAVAILABLE: 503, SERVICE_INITIALIZING: 503,
  GATEWAY_TIMEOUT: 504, LLM_TIMEOUT: 504,
}
```

### 7.2 全局错误中间件

```typescript
// middleware/errorHandler.ts
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { code: err.code, message: err.message, data: err.data },
      err.httpStatus,
    )
  }

  // 未知异常 → 500 + INTERNAL_ERROR
  logger.error('未捕获异常', { error: err.message, stack: err.stack })
  return c.json(
    { code: 'INTERNAL_ERROR', message: '服务内部错误，请稍后再试' },
    500,
  )
})
```

### 7.3 Router 中的使用

```typescript
router.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const memory = await ctx.memoryService.getById(id)

  if (!memory) {
    throw new AppError('MEMORY_NOT_FOUND', {
      message: `未找到 ID 为 ${id} 的记忆`,
      data: { memoryId: id },
    })
  }

  return c.json({ code: 'OK', message: '获取成功', data: memory })
})
```

---

## 8. 分页响应

### 8.1 参数默认值

| 参数 | 默认值 | 最小值 | 最大值 | 说明 |
|---|---|---|---|---|
| `page` | `1` | `1` | — | 超出总页数时返回空 items |
| `pageSize` | `20` | `1` | `100` | 超过 100 自动截断为 100 |

### 8.2 数据结构

```typescript
interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// 使用方式：
// → HTTP 200 + { code: "OK", message: "获取成功", data: PaginatedData<MemoryDto> }
```

### 8.3 请求示例

```
GET /api/memories                     → page=1, pageSize=20
GET /api/memories?page=2              → page=2, pageSize=20
GET /api/memories?page=1&pageSize=50  → page=1, pageSize=50
GET /api/memories?pageSize=999        → page=1, pageSize=100（截断）
```

---

## 9. 流式 / SSE 响应

流式接口（如 `/api/chat/stream`）不遵循信封格式，使用 SSE：

```
event: delta
data: {"content":"你好"}

event: delta
data: {"content":"主人"}

event: tool_call
data: {"name":"file_search","args":{"query":"TypeScript"}}

event: tool_result
data: {"name":"file_search","result":{...}}

event: status
data: {"state":"thinking","message":"正在思考...","turn":1}

event: done
data: {"usage":{"promptTokens":100,"completionTokens":50}}

event: error
data: {"code":"LLM_ERROR","message":"AI 服务异常"}
```

---

*本文档由 Carola 整理，适用于 PeroCore-TS 后端 API 规范。*
