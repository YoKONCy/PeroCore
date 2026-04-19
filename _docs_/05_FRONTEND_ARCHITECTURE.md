# 前端架构规范

> **版本**：0.2.0（临时定稿） · **更新时间**：2026-04-19
> **适用范围**：`packages/frontend/` 全部代码
> **技术栈**：Vue 3 + Pinia + Vue Router + Tailwind CSS v3 + CSS 设计令牌 + Protobuf Gateway

---

## 1. API 客户端

### 1.1 统一 ApiClient

所有 HTTP 请求必须通过 `ApiClient` 发出，禁止直接调用 `fetch`：

```typescript
// api/client.ts
import { transport } from './transport'
import type { ApiResponse } from '@perocore/shared'
import { ApiError } from './errors'

class ApiClient {
  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const res = await transport.request<T>(endpoint, options)

    // 业务错误（已用 HTTP 4xx/5xx 表示）
    if (!isSuccessCode(res.code)) {
      throw new ApiError(res.code, res.message, res.data)
    }

    return res
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint)
  }

  async post<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
```

### 1.2 按域拆分的 API 模块

```typescript
// api/modules/memoryApi.ts
import { apiClient } from '../client'
import type { MemoryDto, CreateMemoryDto, PaginatedData } from '@perocore/shared'

export const memoryApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    apiClient.get<PaginatedData<MemoryDto>>(`/memories?${new URLSearchParams(params)}`),

  getById: (id: number) =>
    apiClient.get<MemoryDto>(`/memories/${id}`),

  create: (data: CreateMemoryDto) =>
    apiClient.post<MemoryDto>('/memories', data),

  delete: (id: number) =>
    apiClient.delete(`/memories/${id}`),

  reindex: () =>
    apiClient.post('/memories/reindex'),
}
```

---

## 2. 传输层抽象 (Transport)

核心设计：前端代码 **0 个 Electron 依赖**，通过 Transport 接口隔离。

```typescript
// api/transport.ts
import type { ApiResponse } from '@perocore/shared'

interface Transport {
  /** HTTP API 请求 */
  request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>>
  /** 系统能力调用 (Electron IPC / HTTP fallback) */
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
}

// Docker / 纯 Web 模式
class HttpTransport implements Transport {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}/api${endpoint}`, options)
    return res.json()
  }

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/ipc/${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const body = await res.json()
    return body.data as T
  }
}

// Electron 模式
class ElectronTransport implements Transport {
  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    // 后端 API 照样走 HTTP (localhost:9120)
    const res = await fetch(`http://localhost:9120/api${endpoint}`, options)
    return res.json()
  }

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    // Electron 专属能力走 IPC
    return (window as any).electron.invoke(channel, ...args)
  }
}

// 自动选择
export const transport: Transport = (window as any).electron
  ? new ElectronTransport()
  : new HttpTransport(window.location.origin)
```

---

## 3. 错误处理

### 3.1 错误类型

```typescript
// api/errors.ts
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class NetworkError extends Error {
  constructor(
    public status: number,
    statusText: string,
  ) {
    super(`网络错误: ${status} ${statusText}`)
    this.name = 'NetworkError'
  }
}
```

### 3.2 错误分级与 UI 反馈

```typescript
enum ErrorSeverity {
  SILENT = 'silent',   // 仅记日志
  TOAST = 'toast',     // Toast 通知（非阻断）
  MODAL = 'modal',     // 模态对话框（阻断）
}

const ERROR_UI_MAP: Record<string, ErrorSeverity> = {
  VALIDATION_ERROR: ErrorSeverity.TOAST,
  LLM_ERROR: ErrorSeverity.TOAST,
  RATE_LIMITED: ErrorSeverity.TOAST,
  UNAUTHORIZED: ErrorSeverity.MODAL,
  DB_ERROR: ErrorSeverity.MODAL,
  INTERNAL_ERROR: ErrorSeverity.TOAST,
  // 其他默认 TOAST
}
```

### 3.3 全局错误拦截

```typescript
// main.ts
app.config.errorHandler = (err) => {
  if (err instanceof ApiError) {
    const severity = ERROR_UI_MAP[err.code] || ErrorSeverity.TOAST
    showNotification(err.message, severity)
  } else {
    console.error('[未捕获错误]', err)
    showNotification('发生未知错误', ErrorSeverity.TOAST)
  }
}
```

---

## 4. Pinia Store vs Composable 边界

### 4.1 何时用 Pinia Store

- ✅ 跨组件/跨页面共享的**全局单例**状态
- ✅ 需要 DevTools 调试的状态
- ✅ 需要持久化的状态

```typescript
// stores/useAgentStore.ts
export const useAgentStore = defineStore('agent', () => {
  const currentAgent = ref<AgentDto | null>(null)
  const agents = ref<AgentDto[]>([])

  async function fetchAgents() { /* ... */ }
  async function switchAgent(agentId: string) { /* ... */ }

  return { currentAgent, agents, fetchAgents, switchAgent }
})
```

### 4.2 何时用 Composable

- ✅ 组件内部的 UI 逻辑（表单、滚动、动画）
- ✅ 可复用但**不共享状态**的逻辑
- ✅ 生命周期绑定的逻辑

```typescript
// composables/chat/useChatScroll.ts
export function useChatScroll(containerRef: Ref<HTMLElement | null>) {
  const isAtBottom = ref(true)

  function scrollToBottom() { /* ... */ }
  function onScroll() { /* ... */ }

  onMounted(() => containerRef.value?.addEventListener('scroll', onScroll))
  onUnmounted(() => containerRef.value?.removeEventListener('scroll', onScroll))

  return { isAtBottom, scrollToBottom }
}
```

---

*本文档由 Carola 整理，适用于 PeroCore-TS 前端架构规范。*
