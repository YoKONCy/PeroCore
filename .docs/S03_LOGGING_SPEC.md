# 日志与可观测性规范

> **适用范围**：PeroCore-TS 全项目
> **最后更新**：2026-04-21

---

## 1. 后端日志

### 1.1 日志库

使用 **consola**。

### 1.2 初始化

```typescript
// lib/logger.ts
import { createConsola } from 'consola'

export function createLogger(module: string) {
  return createConsola({ defaults: { tag: module } })
}
```

### 1.3 使用

```typescript
const logger = createLogger('MemoryService')

logger.info('记忆已创建', { memoryId: 42, agentId: 'pero' })
logger.warn('LLM 调用重试', { attempt: 2, maxRetries: 3 })
logger.error('数据库操作失败', { error: err.message, stack: err.stack })
```

### 1.4 日志级别

| 级别 | 用途 |
|---|---|
| `error` | 系统异常、需要人工介入 |
| `warn` | 降级、重试、非致命异常 |
| `info` | 关键业务节点（创建/删除/配置变更/启动/关闭） |
| `debug` | 开发调试信息（生产环境默认关闭） |

### 1.5 日志语言

**日志消息使用中文**，结构化数据字段用英文 key：

```typescript
// ✅
logger.info('记忆已创建', { memoryId: 42 })
// ❌
logger.info('Memory created', { memoryId: 42 })
```

---

## 2. 前端日志

```typescript
// lib/logger.ts
export const logger = {
  info: (tag: string, message: string, data?: unknown) => {
    console.log(`[${tag}] ${message}`, data ?? '')
    if ((window as any).electron) {
      (window as any).electron.send('log-from-renderer', `[${tag}] ${message}`)
    }
  },
  warn: (tag: string, message: string, data?: unknown) => {
    console.warn(`[${tag}] ${message}`, data ?? '')
  },
  error: (tag: string, message: string, data?: unknown) => {
    console.error(`[${tag}] ${message}`, data ?? '')
  },
}
```

禁止直接使用 `console.log`。

---

## 3. 请求日志中间件

```typescript
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  const status = c.res.status

  if (status >= 400) {
    logger.warn('HTTP', `${c.req.method} ${c.req.path} → ${status} (${duration}ms)`)
  } else {
    logger.info('HTTP', `${c.req.method} ${c.req.path} → ${status} (${duration}ms)`)
  }
})
```

---

## 4. 文件持久化

日志写入 `$PERO_DATA_DIR/logs/` 目录。

| 维度 | 策略 |
|---|---|
| 文件命名 | `perocore-2026-04-20.log`（按天） |
| 大小上限 | 5MB / 文件，超出分片 `.1.log`, `.2.log` |
| 保留天数 | 14 天，启动时自动清理 |
| 格式 | `[ISO8601] [LEVEL] [Module] 消息 {结构化数据}` |

---

## 5. 健康检查

```typescript
app.get('/health', (c) => c.json({
  status: 'ok',
  uptime: process.uptime(),
  version: APP_VERSION,
  memory: process.memoryUsage(),
}))
```

Docker Compose 中配置 healthcheck：

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:9120/api/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

*本文档由 Carola 整理，适用于 PeroCore-TS 日志规范。*
